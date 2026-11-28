package hub

import (
	"encoding/json"
	"log"
	"math"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"vibe-moto-server/internal/auth"
	"vibe-moto-server/internal/intruders"
	"vibe-moto-server/internal/world"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type OnlineSample struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type RoomSummary struct {
	Slug       string `json:"slug"`
	Players    int    `json:"players"`
	BlockCount int    `json:"blockCount"`
}

type VoxelEvent struct {
	Type      string `json:"t"`
	Op        string `json:"op"` // "set" | "del" | "clear"
	GX        int    `json:"gx,omitempty"`
	GY        int    `json:"gy,omitempty"`
	GZ        int    `json:"gz,omitempty"`
	B         int    `json:"b,omitempty"`
	From      string `json:"from,omitempty"`
	OwnerID   string `json:"ownerId,omitempty"`
	OwnerName string `json:"ownerName,omitempty"`
}

type PlayerPos struct {
	WX        float64 `json:"wx"`
	WY        float64 `json:"wy"`
	WS        float64 `json:"ws"`
	OnFoot    bool    `json:"onFoot"`
	Room      string  `json:"room"`
	UpdatedAt int64   `json:"updatedAt"`
}

type OnlinePlayer struct {
	ID        string  `json:"id"`
	AccountID string  `json:"accountId,omitempty"`
	Name      string  `json:"name"`
	WX        float64 `json:"wx"`
	WY        float64 `json:"wy"`
	WS        float64 `json:"ws"`
	OnFoot    bool    `json:"onFoot"`
}

type Client struct {
	hub       *Hub
	conn      *websocket.Conn
	send      chan []byte
	id        string
	accountID string
	name      string
	room      string
	colorIdx  int
	avatarIdx int
	wx        float64
	wy        float64
	ws        float64
	onFoot    bool
	updatedAt int64
	hasPos    bool
}

type Hub struct {
	mu           sync.RWMutex
	rooms        map[string]map[*Client]struct{}
	worlds       *world.Store
	accounts     *auth.Store
	intruders    *intruders.Store
	lastPos      map[string]PlayerPos
	onVoxelHooks []func(room string, ev VoxelEvent)
}

func New(worlds *world.Store, accounts *auth.Store, intruderStore *intruders.Store) *Hub {
	return &Hub{
		rooms:     make(map[string]map[*Client]struct{}),
		worlds:    worlds,
		accounts:  accounts,
		intruders: intruderStore,
		lastPos:   make(map[string]PlayerPos),
	}
}

func (h *Hub) AddVoxelHook(fn func(room string, ev VoxelEvent)) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.onVoxelHooks = append(h.onVoxelHooks, fn)
}

func (h *Hub) ShieldLookup() world.ShieldLookup {
	if h.accounts == nil {
		return nil
	}
	return h.accounts.GetShieldInfo
}

func (h *Hub) OnlineCount() int {
	h.mu.RLock()
	defer h.mu.RUnlock()
	total := 0
	for _, m := range h.rooms {
		total += len(m)
	}
	return total
}

func (h *Hub) OnlineSamples(limit int) []OnlineSample {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]OnlineSample, 0, limit)
	for _, m := range h.rooms {
		for c := range m {
			if len(out) >= limit {
				return out
			}
			out = append(out, OnlineSample{ID: c.id, Name: c.name})
		}
	}
	return out
}

func (h *Hub) RoomSummaries() []RoomSummary {
	h.mu.RLock()
	defer h.mu.RUnlock()
	seen := make(map[string]bool)
	out := make([]RoomSummary, 0, len(h.rooms)+1)
	for slug, m := range h.rooms {
		seen[slug] = true
		out = append(out, RoomSummary{
			Slug:       slug,
			Players:    len(m),
			BlockCount: h.worlds.GetRoom(slug).Count(),
		})
	}
	if !seen["global"] {
		out = append(out, RoomSummary{
			Slug:       "global",
			Players:    0,
			BlockCount: h.worlds.GetRoom("global").Count(),
		})
	}
	return out
}

func (h *Hub) RoomPlayers(room string) []OnlinePlayer {
	slug := world.SanitizeRoom(room)
	h.mu.RLock()
	peers := h.rooms[slug]
	out := make([]OnlinePlayer, 0, len(peers))
	for c := range peers {
		out = append(out, OnlinePlayer{
			ID:        c.id,
			AccountID: c.accountID,
			Name:      c.name,
			WX:        c.wx,
			WY:        c.wy,
			WS:        c.ws,
			OnFoot:    c.onFoot,
		})
	}
	h.mu.RUnlock()
	sort.Slice(out, func(i, j int) bool {
		if out[i].Name == out[j].Name {
			return out[i].ID < out[j].ID
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func (h *Hub) updateClientPos(c *Client, wx, wy, ws float64, onFoot bool) {
	if math.IsNaN(wx) || math.IsInf(wx, 0) || math.IsNaN(wy) || math.IsInf(wy, 0) || math.IsNaN(ws) || math.IsInf(ws, 0) {
		return
	}
	now := time.Now().Unix()
	pos := PlayerPos{
		WX:        wx,
		WY:        wy,
		WS:        ws,
		OnFoot:    onFoot,
		Room:      c.room,
		UpdatedAt: now,
	}
	h.mu.Lock()
	c.wx = wx
	c.wy = wy
	c.ws = ws
	c.onFoot = onFoot
	c.updatedAt = now
	c.hasPos = true
	if c.id != "" {
		h.lastPos[c.id] = pos
	}
	if c.accountID != "" {
		h.lastPos[c.accountID] = pos
	}
	h.mu.Unlock()
}

func (h *Hub) ResolvePlayerPosition(accountID, clientID string) (PlayerPos, bool, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	online := false
	for _, peers := range h.rooms {
		for c := range peers {
			matched := (accountID != "" && c.accountID == accountID) || (accountID == "" && clientID != "" && c.id == clientID)
			if !matched && clientID != "" && c.id == clientID {
				matched = true
			}
			if matched {
				online = true
				if c.hasPos {
					return PlayerPos{
						WX:        c.wx,
						WY:        c.wy,
						WS:        c.ws,
						OnFoot:    c.onFoot,
						Room:      c.room,
						UpdatedAt: c.updatedAt,
					}, true, true
				}
			}
		}
	}

	if accountID != "" {
		if pos, ok := h.lastPos[accountID]; ok {
			return pos, true, online
		}
	}
	if clientID != "" {
		if pos, ok := h.lastPos[clientID]; ok {
			return pos, true, online
		}
	}
	return PlayerPos{}, false, online
}

func (h *Hub) EnrichIntruderRecord(rec intruders.Record) intruders.EnrichedRecord {
	pos, found, online := h.ResolvePlayerPosition(rec.IntruderAccountID, rec.IntruderClientID)
	out := intruders.EnrichedRecord{
		Record: rec,
		Online: online,
	}
	if found {
		wx, wy, ws := pos.WX, pos.WY, pos.WS
		out.LiveWX = &wx
		out.LiveWY = &wy
		out.LiveWS = &ws
		out.LastSeen = pos.UpdatedAt
	}
	return out
}

func (h *Hub) sendToAccount(accountID string, msg []byte) {
	if accountID == "" {
		return
	}
	h.mu.RLock()
	var targets []*Client
	for _, peers := range h.rooms {
		for c := range peers {
			if c.accountID == accountID {
				targets = append(targets, c)
			}
		}
	}
	h.mu.RUnlock()

	for _, c := range targets {
		select {
		case c.send <- msg:
		default:
		}
	}
}

func (h *Hub) RecordIntrusion(
	room, ownerID, intruderAccountID, intruderClientID, intruderName string,
	gx, gy, gz, blockType int,
	action string,
) {
	if h.intruders == nil || ownerID == "" || ownerID == intruderAccountID {
		return
	}
	saved := h.intruders.Add(intruders.Record{
		Room:              world.SanitizeRoom(room),
		OwnerID:           ownerID,
		IntruderAccountID: intruderAccountID,
		IntruderClientID:  intruderClientID,
		IntruderName:      intruderName,
		GX:                gx,
		GY:                gy,
		GZ:                world.WrapGZ(gz),
		BlockType:         blockType,
		Action:            action,
	})
	enriched := h.EnrichIntruderRecord(saved)
	alert, err := json.Marshal(map[string]any{
		"t":      "intruder_alert",
		"record": enriched,
	})
	if err != nil {
		return
	}
	h.sendToAccount(ownerID, alert)
}

func (h *Hub) BroadcastVoxel(room string, ev VoxelEvent, exclude *Client) {
	slug := world.SanitizeRoom(room)
	ev.Type = "vox"
	raw, err := json.Marshal(ev)
	if err != nil {
		return
	}
	h.broadcastRaw(slug, raw, exclude)

	h.mu.RLock()
	hooks := append([]func(string, VoxelEvent){}, h.onVoxelHooks...)
	h.mu.RUnlock()
	for _, fn := range hooks {
		fn(slug, ev)
	}
}

func (h *Hub) broadcastRaw(room string, msg []byte, exclude *Client) {
	h.mu.RLock()
	peers := h.rooms[room]
	if len(peers) == 0 {
		h.mu.RUnlock()
		return
	}
	targets := make([]*Client, 0, len(peers))
	for c := range peers {
		if c != exclude {
			targets = append(targets, c)
		}
	}
	h.mu.RUnlock()

	for _, c := range targets {
		select {
		case c.send <- msg:
		default:
			// Drop slow consumer frames instead of blocking room tick
		}
	}
}

func (h *Hub) register(c *Client) {
	h.mu.Lock()
	m := h.rooms[c.room]
	if m == nil {
		m = make(map[*Client]struct{})
		h.rooms[c.room] = m
	}
	m[c] = struct{}{}
	h.mu.Unlock()
}

func (h *Hub) unregister(c *Client) {
	h.mu.Lock()
	if m := h.rooms[c.room]; m != nil {
		delete(m, c)
		if len(m) == 0 {
			delete(h.rooms, c.room)
		}
	}
	h.mu.Unlock()

	bye, _ := json.Marshal(map[string]any{
		"t":  "bye",
		"id": c.id,
	})
	h.broadcastRaw(c.room, bye, c)
	close(c.send)
}

func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	roomSlug := world.SanitizeRoom(r.URL.Query().Get("room"))
	clientID := r.URL.Query().Get("cid")
	name := r.URL.Query().Get("name")
	token := r.URL.Query().Get("token")

	var accountID string
	var colorIdx, avatarIdx int
	if token != "" {
		if acc, err := h.accounts.VerifyToken(token); err == nil {
			accountID = acc.ID
			if name == "" {
				name = acc.DisplayName
			}
			colorIdx = acc.ColorIdx
			avatarIdx = acc.AvatarIdx
		}
	}
	if name == "" {
		name = "RIDER"
	}
	if clientID == "" {
		clientID = "ws_" + time.Now().Format("150405.000")
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	c := &Client{
		hub:       h,
		conn:      conn,
		send:      make(chan []byte, 64),
		id:        clientID,
		accountID: accountID,
		name:      name,
		room:      roomSlug,
		colorIdx:  colorIdx,
		avatarIdx: avatarIdx,
	}
	h.register(c)

	// Immediately send welcome + full persistent voxel world snapshot for this room
	rw := h.worlds.GetRoom(roomSlug)
	welcomeMsg, _ := json.Marshal(map[string]any{
		"t":          "world_init",
		"room":       roomSlug,
		"blocks":     rw.SnapshotCompact(),
		"online":     h.OnlineCount(),
		"mcProtocol": "1.20.4 (TCP :25565)",
	})
	select {
	case c.send <- welcomeMsg:
	default:
	}

	go c.writePump()
	c.readPump()
}

func (c *Client) readPump() {
	defer func() {
		c.hub.unregister(c)
		_ = c.conn.Close()
	}()

	c.conn.SetReadLimit(64 * 1024)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		var env struct {
			T      string   `json:"t"`
			Op     string   `json:"op"`
			GX     int      `json:"gx"`
			GY     int      `json:"gy"`
			GZ     int      `json:"gz"`
			B      int      `json:"b"`
			Name   string   `json:"name"`
			WX     *float64 `json:"wx"`
			WY     *float64 `json:"wy"`
			WS     *float64 `json:"ws"`
			OnFoot bool     `json:"onFoot"`
		}
		if err := json.Unmarshal(raw, &env); err != nil {
			continue
		}

		switch env.T {
		case "ping":
			pong, _ := json.Marshal(map[string]any{"t": "pong", "ts": time.Now().UnixMilli()})
			select {
			case c.send <- pong:
			default:
			}

		case "pos":
			if env.WX != nil && env.WY != nil && env.WS != nil {
				c.hub.updateClientPos(c, *env.WX, *env.WY, *env.WS, env.OnFoot)
			}

		case "vox":
			rw := c.hub.worlds.GetRoom(c.room)
			lookup := c.hub.ShieldLookup()
			sendRejected := func(op string, gx, gy, gz int, rej *world.ShieldRejection) {
				msg, _ := json.Marshal(map[string]any{
					"t":            "vox_rejected",
					"reason":       "shielded",
					"ownerName":    rej.OwnerName,
					"remainingSec": rej.RemainingSec,
					"op":           op,
					"gx":           gx,
					"gy":           gy,
					"gz":           world.WrapGZ(gz),
				})
				select {
				case c.send <- msg:
				default:
				}
			}

			changed := false
			ev := VoxelEvent{
				Type: "vox",
				Op:   env.Op,
				GX:   env.GX,
				GY:   env.GY,
				GZ:   world.WrapGZ(env.GZ),
				B:    env.B,
				From: c.id,
			}

			switch env.Op {
			case "set":
				ok, prev, hadPrev, rej := rw.SetBlockChecked(env.GX, env.GY, env.GZ, env.B, c.accountID, c.name, lookup)
				if rej != nil {
					sendRejected("set", env.GX, env.GY, env.GZ, rej)
					continue
				}
				if ok {
					changed = true
					if hadPrev && prev.OwnerID != "" && prev.OwnerID != c.accountID {
						c.hub.RecordIntrusion(c.room, prev.OwnerID, c.accountID, c.id, c.name, env.GX, env.GY, env.GZ, prev.Type, "overwrite")
					}
					if c.accountID != "" {
						ev.OwnerID = c.accountID
						ev.OwnerName = c.name
						c.hub.accounts.OnBlockPlaced(c.accountID, env.B)
					}
				}
			case "del":
				ok, prev, rej := rw.DeleteBlockChecked(env.GX, env.GY, env.GZ, c.accountID, lookup)
				if rej != nil {
					sendRejected("del", env.GX, env.GY, env.GZ, rej)
					continue
				}
				if ok {
					changed = true
					if prev.OwnerID != "" && prev.OwnerID != c.accountID {
						c.hub.RecordIntrusion(c.room, prev.OwnerID, c.accountID, c.id, c.name, env.GX, env.GY, env.GZ, prev.Type, "break")
					}
					if c.accountID != "" {
						c.hub.accounts.OnBlockBroken(c.accountID, prev.Type)
					}
				}
			case "clear":
				removed, rej := rw.ClearAllChecked(c.accountID, lookup)
				if rej != nil {
					sendRejected("clear", 0, 0, 0, rej)
					continue
				}
				if removed > 0 {
					changed = true
				}
			}
			if changed {
				c.hub.BroadcastVoxel(c.room, ev, c)
			}

		case "state", "hit", "item":
			if env.Name != "" {
				c.hub.mu.Lock()
				c.name = env.Name
				c.hub.mu.Unlock()
			}
			c.hub.broadcastRaw(c.room, raw, c)
		}
	}
}

func (c *Client) writePump() {
	ticker := time.NewTicker(25 * time.Second)
	defer func() {
		ticker.Stop()
		_ = c.conn.Close()
	}()

	for {
		select {
		case msg, ok := <-c.send:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				log.Printf("[ws] write err (%s): %v", c.id, err)
				return
			}
		case <-ticker.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
