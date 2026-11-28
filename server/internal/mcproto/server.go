package mcproto

import (
	"bufio"
	"bytes"
	"crypto/md5"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"

	"vibe-moto-server/internal/hub"
	"vibe-moto-server/internal/world"
)

const (
	// Minecraft Java Edition 1.20.4 (protocol 765)
	DefaultProtocolVersion = 765
	DefaultVersionName     = "1.20.4 (Vibe Moto)"
)

type Server struct {
	addr       string
	motd       string
	publicHost string
	worlds     *world.Store
	hub        *hub.Hub

	mu    sync.RWMutex
	conns map[*mcClient]struct{}
	ln    net.Listener
}

type mcClient struct {
	conn     net.Conn
	mu       sync.Mutex
	username string
	uuid     [16]byte
	proto    int32
	inPlay   bool
}

func NewServer(addr, motd, publicHost string, worlds *world.Store, h *hub.Hub) *Server {
	s := &Server{
		addr:       addr,
		motd:       motd,
		publicHost: publicHost,
		worlds:     worlds,
		hub:        h,
		conns:      make(map[*mcClient]struct{}),
	}
	// Forward live web voxel edits to connected Minecraft clients!
	h.AddVoxelHook(func(room string, ev hub.VoxelEvent) {
		if room != "global" {
			return
		}
		if ev.Op == "set" {
			s.BroadcastBlockChange(ev.GX, ev.GY, -ev.GZ, world.BlockTypeToMCStateID(ev.B))
		} else if ev.Op == "del" {
			s.BroadcastBlockChange(ev.GX, ev.GY, -ev.GZ, 0)
		}
	})
	return s
}

func (s *Server) Start() error {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return err
	}
	s.ln = ln
	log.Printf("[mc] Minecraft Java Protocol server listening on %s (%s)", s.addr, DefaultVersionName)

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go s.handleConn(conn)
		}
	}()
	return nil
}

func (s *Server) Close() error {
	if s.ln != nil {
		return s.ln.Close()
	}
	return nil
}

func (s *Server) OnlineCount() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.conns)
}

func (s *Server) BroadcastBlockChange(x, y, z int, blockStateID int32) {
	var body bytes.Buffer
	writeMCBlockPos(&body, x, y, z)
	writeVarInt(&body, blockStateID)
	pkt := framePacket(0x09, body.Bytes()) // 1.20.4 Play Block Update (0x09)

	s.mu.RLock()
	clients := make([]*mcClient, 0, len(s.conns))
	for c := range s.conns {
		if c.inPlay {
			clients = append(clients, c)
		}
	}
	s.mu.RUnlock()

	for _, c := range clients {
		c.writeRaw(pkt)
	}
}

func (c *mcClient) writeRaw(pkt []byte) {
	c.mu.Lock()
	defer c.mu.Unlock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
	_, _ = c.conn.Write(pkt)
}

func (s *Server) handleConn(conn net.Conn) {
	defer conn.Close()
	br := bufio.NewReaderSize(conn, 8192)
	_ = conn.SetReadDeadline(time.Now().Add(15 * time.Second))

	pktID, payload, err := readPacket(br)
	if err != nil || pktID != 0x00 {
		return
	}

	r := bytes.NewReader(payload)
	protoVer, err := readVarInt(r)
	if err != nil {
		return
	}
	_, err = readMCString(r) // server address
	if err != nil {
		return
	}
	var port uint16
	if err := binary.Read(r, binary.BigEndian, &port); err != nil {
		return
	}
	nextState, err := readVarInt(r)
	if err != nil {
		return
	}

	switch nextState {
	case 1:
		s.handleStatus(conn, br, protoVer)
	case 2:
		s.handleLogin(conn, br, protoVer)
	}
}

func (s *Server) handleStatus(conn net.Conn, br *bufio.Reader, clientProto int32) {
	for {
		_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
		pktID, payload, err := readPacket(br)
		if err != nil {
			return
		}
		switch pktID {
		case 0x00: // Status Request
			webOnline := s.hub.OnlineCount()
			mcOnline := s.OnlineCount()
			totalOnline := webOnline + mcOnline
			blocks := s.worlds.GetRoom("global").Count()

			sampleList := make([]map[string]string, 0, 8)
			for _, p := range s.hub.OnlineSamples(6) {
				sampleList = append(sampleList, map[string]string{
					"name": p.Name,
					"id":   formatUUID(offlineUUID(p.Name)),
				})
			}

			// Echo client's protocol version when valid so any MC Java version sees green compatibility
			repProto := clientProto
			if repProto <= 0 {
				repProto = DefaultProtocolVersion
			}

			resp := map[string]any{
				"version": map[string]any{
					"name":     DefaultVersionName,
					"protocol": repProto,
				},
				"players": map[string]any{
					"max":    100,
					"online": totalOnline,
					"sample": sampleList,
				},
				"description": map[string]any{
					"text": fmt.Sprintf("%s\n§bWeb: https://%s §7| §e%d Blocks", s.motd, s.publicHost, blocks),
				},
				"enforcesSecureChat": false,
			}
			jsonBytes, _ := json.Marshal(resp)
			var out bytes.Buffer
			writeMCString(&out, string(jsonBytes))
			_, _ = conn.Write(framePacket(0x00, out.Bytes()))

		case 0x01: // Ping Request -> Echo 8-byte payload as Pong
			if len(payload) >= 8 {
				_, _ = conn.Write(framePacket(0x01, payload[:8]))
			}
			return
		default:
			return
		}
	}
}

func (s *Server) handleLogin(conn net.Conn, br *bufio.Reader, clientProto int32) {
	_ = conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	pktID, payload, err := readPacket(br)
	if err != nil || pktID != 0x00 {
		return
	}

	r := bytes.NewReader(payload)
	username, err := readMCString(r)
	if err != nil || username == "" {
		return
	}
	uid := offlineUUID(username)

	// Send Login Success (0x02)
	var ls bytes.Buffer
	ls.Write(uid[:])
	writeMCString(&ls, username)
	writeVarInt(&ls, 0) // 0 properties
	if _, err := conn.Write(framePacket(0x02, ls.Bytes())); err != nil {
		return
	}

	// Modern MC 1.20.2+ (protocol >= 764) enters Configuration state after Login Acknowledged (0x03)
	if clientProto >= 764 {
		ackID, _, err := readPacket(br)
		if err != nil || ackID != 0x03 {
			return
		}
		// Immediately send Finish Configuration (0x02 in Configuration clientbound)
		if _, err := conn.Write(framePacket(0x02, nil)); err != nil {
			return
		}
		// Wait for client's Acknowledge Finish Configuration (0x02)
		for {
			_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
			cid, _, err := readPacket(br)
			if err != nil {
				return
			}
			if cid == 0x02 {
				break
			}
		}
	} else {
		// Legacy clients: send friendly JSON disconnect explaining supported version & Web client
		reason, _ := json.Marshal(map[string]string{
			"text": fmt.Sprintf("VIBE MOTO Open World supports MC Java 1.20.4 or Web: https://%s", s.publicHost),
		})
		var disc bytes.Buffer
		writeMCString(&disc, string(reason))
		_, _ = conn.Write(framePacket(0x00, disc.Bytes()))
		return
	}

	client := &mcClient{
		conn:     conn,
		username: username,
		uuid:     uid,
		proto:    clientProto,
		inPlay:   true,
	}

	s.mu.Lock()
	s.conns[client] = struct{}{}
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		delete(s.conns, client)
		s.mu.Unlock()
		log.Printf("[mc] player %s disconnected", username)
	}()

	log.Printf("[mc] player %s joined via Minecraft Java protocol (proto=%d)", username, clientProto)

	// Start Play Keep-Alive loop (clientbound Keep Alive 0x24 in 1.20.4)
	stopKA := make(chan struct{})
	defer close(stopKA)
	go func() {
		ticker := time.NewTicker(12 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				var ka bytes.Buffer
				_ = binary.Write(&ka, binary.BigEndian, time.Now().UnixMilli())
				client.writeRaw(framePacket(0x24, ka.Bytes()))
			case <-stopKA:
				return
			}
		}
	}()

	// Push existing global voxel blocks to MC client
	rw := s.worlds.GetRoom("global")
	for _, b := range rw.SnapshotCompact() {
		var body bytes.Buffer
		writeMCBlockPos(&body, b.GX, b.GY, -b.GZ)
		writeVarInt(&body, world.BlockTypeToMCStateID(b.Type))
		client.writeRaw(framePacket(0x09, body.Bytes()))
	}

	// Read Play packets (Keep-Alive, Player Action dig 0x21, Use Item On place 0x35)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(35 * time.Second))
		pid, data, err := readPacket(br)
		if err != nil {
			return
		}
		switch pid {
		case 0x21: // Player Action (1.20.4) -> status 0/2 = break block
			pr := bytes.NewReader(data)
			status, err := readVarInt(pr)
			if err == nil && (status == 0 || status == 2) {
				if x, y, z, err := readMCBlockPos(pr); err == nil {
					gz := world.WrapGZ(-z)
					ok, prev, rej := rw.DeleteBlockChecked(x, y, gz, "", s.hub.ShieldLookup())
					if rej != nil {
						var body bytes.Buffer
						writeMCBlockPos(&body, x, y, z)
						writeVarInt(&body, world.BlockTypeToMCStateID(prev.Type))
						client.writeRaw(framePacket(0x09, body.Bytes()))
					} else if ok {
						if prev.OwnerID != "" {
							s.hub.RecordIntrusion("global", prev.OwnerID, "", "mc_"+username, username, x, y, gz, prev.Type, "break")
						}
						s.hub.BroadcastVoxel("global", hub.VoxelEvent{
							Op:   "del",
							GX:   x,
							GY:   y,
							GZ:   gz,
							From: "mc_" + username,
						}, nil)
					}
				}
			}
		case 0x35: // Use Item On (1.20.4) -> place stone/plank block on aimed face
			pr := bytes.NewReader(data)
			if _, err := readVarInt(pr); err == nil { // hand
				if x, y, z, err := readMCBlockPos(pr); err == nil {
					face, err := readVarInt(pr)
					if err == nil {
						nx, ny, nz := faceOffset(face)
						px, py, pz := x+nx, y+ny, z+nz
						gz := world.WrapGZ(-pz)
						ok, prev, hadPrev, rej := rw.SetBlockChecked(px, py, gz, 3, "", "", s.hub.ShieldLookup())
						if rej != nil {
							var body bytes.Buffer
							writeMCBlockPos(&body, px, py, pz)
							writeVarInt(&body, world.BlockTypeToMCStateID(prev.Type))
							client.writeRaw(framePacket(0x09, body.Bytes()))
						} else if ok {
							if hadPrev && prev.OwnerID != "" {
								s.hub.RecordIntrusion("global", prev.OwnerID, "", "mc_"+username, username, px, py, gz, prev.Type, "overwrite")
							}
							s.hub.BroadcastVoxel("global", hub.VoxelEvent{
								Op:   "set",
								GX:   px,
								GY:   py,
								GZ:   gz,
								B:    3,
								From: "mc_" + username,
							}, nil)
						}
					}
				}
			}
		}
	}
}

func faceOffset(face int32) (int, int, int) {
	switch face {
	case 0:
		return 0, -1, 0
	case 1:
		return 0, 1, 0
	case 2:
		return 0, 0, -1
	case 3:
		return 0, 0, 1
	case 4:
		return -1, 0, 0
	case 5:
		return 1, 0, 0
	default:
		return 0, 1, 0
	}
}

func offlineUUID(name string) [16]byte {
	sum := md5.Sum([]byte("OfflinePlayer:" + name))
	sum[6] = (sum[6] & 0x0f) | 0x30 // version 3
	sum[8] = (sum[8] & 0x3f) | 0x80 // RFC 4122 variant
	return sum
}

func formatUUID(u [16]byte) string {
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		u[0:4], u[4:6], u[6:8], u[8:10], u[10:16])
}

func readVarInt(r io.ByteReader) (int32, error) {
	var numRead uint
	var result int32
	for {
		b, err := r.ReadByte()
		if err != nil {
			return 0, err
		}
		result |= int32(b&0x7f) << (7 * numRead)
		numRead++
		if numRead > 5 {
			return 0, errors.New("varint too big")
		}
		if (b & 0x80) == 0 {
			break
		}
	}
	return result, nil
}

func writeVarInt(w *bytes.Buffer, v int32) {
	u := uint32(v)
	for {
		if (u & ^uint32(0x7f)) == 0 {
			w.WriteByte(byte(u))
			return
		}
		w.WriteByte(byte((u & 0x7f) | 0x80))
		u >>= 7
	}
}

func readMCString(r *bytes.Reader) (string, error) {
	n, err := readVarInt(r)
	if err != nil || n < 0 || n > 32767 {
		return "", errors.New("invalid mc string len")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return "", err
	}
	return string(buf), nil
}

func writeMCString(w *bytes.Buffer, s string) {
	writeVarInt(w, int32(len(s)))
	w.WriteString(s)
}

func writeMCBlockPos(w *bytes.Buffer, x, y, z int) {
	val := ((int64(x) & 0x3ffffff) << 38) | ((int64(z) & 0x3ffffff) << 12) | (int64(y) & 0xfff)
	_ = binary.Write(w, binary.BigEndian, val)
}

func readMCBlockPos(r io.Reader) (int, int, int, error) {
	var val int64
	if err := binary.Read(r, binary.BigEndian, &val); err != nil {
		return 0, 0, 0, err
	}
	x := int(val >> 38)
	y := int((val << 52) >> 52)
	z := int((val << 26) >> 38)
	return x, y, z, nil
}

func readPacket(br *bufio.Reader) (int32, []byte, error) {
	length, err := readVarInt(br)
	if err != nil || length <= 0 || length > 1<<20 {
		return 0, nil, errors.New("invalid packet length")
	}
	raw := make([]byte, length)
	if _, err := io.ReadFull(br, raw); err != nil {
		return 0, nil, err
	}
	r := bytes.NewReader(raw)
	id, err := readVarInt(r)
	if err != nil {
		return 0, nil, err
	}
	rest, _ := io.ReadAll(r)
	return id, rest, nil
}

func framePacket(id int32, payload []byte) []byte {
	var body bytes.Buffer
	writeVarInt(&body, id)
	if len(payload) > 0 {
		body.Write(payload)
	}
	var out bytes.Buffer
	writeVarInt(&out, int32(body.Len()))
	out.Write(body.Bytes())
	return out.Bytes()
}
