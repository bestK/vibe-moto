package main

import (
	"bytes"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"

	"vibe-moto-server/internal/auth"
	"vibe-moto-server/internal/economy"
	"vibe-moto-server/internal/hub"
	"vibe-moto-server/internal/intruders"
	"vibe-moto-server/internal/world"
)

func setupTestServer(t *testing.T) (*httptest.Server, *auth.Store, *world.Store, *economy.Store) {
	t.Helper()
	dir := t.TempDir()
	accounts, err := auth.NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	worlds, err := world.NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	econ, err := economy.NewStore(dir, accounts)
	if err != nil {
		t.Fatal(err)
	}
	intruderStore, err := intruders.NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	wsHub := hub.New(worlds, accounts, intruderStore)
	h := buildHandler(accounts, worlds, econ, intruderStore, wsHub, nil, time.Now(), "localhost")
	ts := httptest.NewServer(h)
	t.Cleanup(ts.Close)
	return ts, accounts, worlds, econ
}

func doJSON(t *testing.T, method, url, token string, body any) (*http.Response, map[string]any) {
	t.Helper()
	var r io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		r = bytes.NewReader(raw)
	}
	req, err := http.NewRequest(method, url, r)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp, out
}

func TestLegacyAccountMigration(t *testing.T) {
	dir := t.TempDir()
	legacyAccounts := `[{"id":"acc_old","username":"legacy","displayName":"LegacyRider","passwordHash":"$2a$10$abcdefghijklmnopqrstuv","colorIdx":1,"avatarIdx":2,"createdAt":1700000000,"lastLoginAt":1700000000}]`
	if err := os.WriteFile(filepath.Join(dir, "accounts.json"), []byte(legacyAccounts), 0o600); err != nil {
		t.Fatal(err)
	}

	st, err := auth.NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	var coins int
	var inv map[int]int
	ok := st.ReadAccount("acc_old", func(acc *auth.Account) {
		coins = acc.Coins
		inv = auth.CloneInventory(acc.Inventory)
	})
	if !ok {
		t.Fatal("legacy account not loaded")
	}
	if coins != 500 {
		t.Fatalf("expected 500 initial coins for migrated account, got %d", coins)
	}
	if inv[1] != 20 || inv[3] != 30 || inv[10] != 1 {
		t.Fatalf("unexpected starter inventory: %+v", inv)
	}

	// Spend all coins to 0 and reload store -> should stay 0 (not reset to 500)
	if err := st.WithAccount("acc_old", func(acc *auth.Account) error {
		acc.Coins = 0
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	st2, err := auth.NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	st2.ReadAccount("acc_old", func(acc *auth.Account) {
		if acc.Coins != 0 {
			t.Fatalf("expected 0 coins after reload, got %d", acc.Coins)
		}
	})
}

func TestEconomyShopBagMarketBlueprintsAndShields(t *testing.T) {
	ts, _, _, _ := setupTestServer(t)

	// 1. Guest economy state
	resp, body := doJSON(t, http.MethodGet, ts.URL+"/api/economy/state", "", nil)
	if resp.StatusCode != http.StatusOK || body["ok"] != true || int(body["coins"].(float64)) != 500 {
		t.Fatalf("unexpected guest economy state: status=%d body=%+v", resp.StatusCode, body)
	}

	// 2. Register Alice & Bob
	resp, aliceReg := doJSON(t, http.MethodPost, ts.URL+"/api/auth/register", "", map[string]any{
		"username": "alice", "password": "password1", "displayName": "Alice",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register alice failed: %d %+v", resp.StatusCode, aliceReg)
	}
	aliceToken := aliceReg["token"].(string)

	resp, bobReg := doJSON(t, http.MethodPost, ts.URL+"/api/auth/register", "", map[string]any{
		"username": "bob", "password": "password2", "displayName": "Bob",
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("register bob failed: %d %+v", resp.StatusCode, bobReg)
	}
	bobToken := bobReg["token"].(string)

	// 3. Claim rewards (bounded)
	resp, body = doJSON(t, http.MethodPost, ts.URL+"/api/economy/reward", aliceToken, map[string]any{
		"kind":   "harvest",
		"amount": 9999, // should clamp to max 60
		"blockRewards": []map[string]any{
			{"b": 10, "qty": 10}, // cap for block 10 is 5, starts at 1 -> adds 4
		},
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("reward failed: %d %+v", resp.StatusCode, body)
	}
	if int(body["grantedCoins"].(float64)) != 60 || int(body["coins"].(float64)) != 560 {
		t.Fatalf("expected bounded 60 coins (total 560), got %+v", body)
	}
	inv := body["inventory"].(map[string]any)
	if int(inv["10"].(float64)) != 5 {
		t.Fatalf("expected block 10 capped at 5, got %v", inv["10"])
	}

	// 4. Shop: buy item_bag (+3 slots, 300 coins), shield_10m (250 coins), then shield_30m (after extra reward)
	resp, body = doJSON(t, http.MethodPost, ts.URL+"/api/economy/shop/buy", aliceToken, map[string]any{
		"itemId": "item_bag", "qty": 1,
	})
	if resp.StatusCode != http.StatusOK || int(body["bagCapacity"].(float64)) != 3 || int(body["coins"].(float64)) != 260 {
		t.Fatalf("buy item_bag failed: %d %+v", resp.StatusCode, body)
	}

	resp, body = doJSON(t, http.MethodPost, ts.URL+"/api/economy/shop/buy", aliceToken, map[string]any{
		"itemId": "shield_10m", "qty": 1,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("buy shield_10m failed: %d %+v", resp.StatusCode, body)
	}
	shield1 := int64(body["shieldUntil"].(float64))
	if shield1 <= time.Now().Unix()+500 {
		t.Fatalf("expected active shield >= 500s, got %d", shield1)
	}

	// Earn more coins and stack shield_30m
	for i := 0; i < 3; i++ {
		doJSON(t, http.MethodPost, ts.URL+"/api/economy/reward", aliceToken, map[string]any{"kind": "lap", "amount": 250})
	}
	resp, body = doJSON(t, http.MethodPost, ts.URL+"/api/economy/shop/buy", aliceToken, map[string]any{
		"itemId": "shield_30m", "qty": 1,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("buy shield_30m failed: %d %+v", resp.StatusCode, body)
	}
	shield2 := int64(body["shieldUntil"].(float64))
	if shield2 < shield1+1800 {
		t.Fatalf("expected stackable shield (+1800s), got before=%d after=%d", shield1, shield2)
	}

	// 5. Item Bag stash & use
	resp, body = doJSON(t, http.MethodPost, ts.URL+"/api/economy/bag/stash", aliceToken, map[string]any{"item": "rpg"})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("stash rpg failed: %d %+v", resp.StatusCode, body)
	}
	resp, body = doJSON(t, http.MethodPost, ts.URL+"/api/economy/bag/use", aliceToken, map[string]any{"index": 0})
	if resp.StatusCode != http.StatusOK || body["item"] != "rpg" {
		t.Fatalf("use bag item failed: %d %+v", resp.StatusCode, body)
	}

	// 6. Marketplace: Alice lists 5 planks for 100 coins -> Bob buys -> verify transfer
	resp, listBody := doJSON(t, http.MethodPost, ts.URL+"/api/market/list", aliceToken, map[string]any{
		"blockType": 3, "qty": 5, "priceCoins": 100,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("market list failed: %d %+v", resp.StatusCode, listBody)
	}
	listingID := listBody["listing"].(map[string]any)["id"].(string)

	// Alice cannot buy her own listing
	resp, _ = doJSON(t, http.MethodPost, ts.URL+"/api/market/buy", aliceToken, map[string]any{"listingId": listingID})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 buying own listing, got %d", resp.StatusCode)
	}

	// Bob buys Alice's listing
	resp, buyBody := doJSON(t, http.MethodPost, ts.URL+"/api/market/buy", bobToken, map[string]any{"listingId": listingID})
	if resp.StatusCode != http.StatusOK || int(buyBody["coins"].(float64)) != 400 {
		t.Fatalf("bob market buy failed: %d %+v", resp.StatusCode, buyBody)
	}
	if int(buyBody["inventory"].(map[string]any)["3"].(float64)) != 35 {
		t.Fatalf("expected bob planks = 35, got %v", buyBody["inventory"].(map[string]any)["3"])
	}

	// Alice lists & cancels -> refunded
	resp, list2 := doJSON(t, http.MethodPost, ts.URL+"/api/market/list", aliceToken, map[string]any{
		"blockType": 2, "qty": 5, "priceCoins": 50,
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("market list2 failed: %d", resp.StatusCode)
	}
	lid2 := list2["listing"].(map[string]any)["id"].(string)
	resp, cancelBody := doJSON(t, http.MethodPost, ts.URL+"/api/market/cancel", aliceToken, map[string]any{"listingId": lid2})
	if resp.StatusCode != http.StatusOK || int(cancelBody["inventory"].(map[string]any)["2"].(float64)) != 20 {
		t.Fatalf("cancel refund failed: %d %+v", resp.StatusCode, cancelBody)
	}

	// 7. Blueprints: create, get, delete
	resp, bpBody := doJSON(t, http.MethodPost, ts.URL+"/api/blueprints", aliceToken, map[string]any{
		"name":  "Cyber Shack",
		"sizeX": 2, "sizeY": 2, "sizeZ": 2,
		"blocks": []map[string]any{
			{"dx": 0, "dy": 0, "dz": 0, "b": 3},
			{"dx": 1, "dy": 0, "dz": 0, "b": 10},
		},
	})
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("save blueprint failed: %d %+v", resp.StatusCode, bpBody)
	}
	bpID := bpBody["blueprint"].(map[string]any)["id"].(string)

	resp, bpList := doJSON(t, http.MethodGet, ts.URL+"/api/blueprints", aliceToken, nil)
	if resp.StatusCode != http.StatusOK || len(bpList["blueprints"].([]any)) != 1 {
		t.Fatalf("get blueprints failed: %d %+v", resp.StatusCode, bpList)
	}

	resp, bpDel := doJSON(t, http.MethodDelete, ts.URL+"/api/blueprints/"+bpID, aliceToken, nil)
	if resp.StatusCode != http.StatusOK || len(bpDel["blueprints"].([]any)) != 0 {
		t.Fatalf("delete blueprint failed: %d %+v", resp.StatusCode, bpDel)
	}

	// 8. Shield enforcement over HTTP & WS + inventory deduction/refund
	// Alice places a computer terminal (type 10) via HTTP
	resp, _ = doJSON(t, http.MethodPost, ts.URL+"/api/world/testroom", aliceToken, map[string]any{
		"op": "set", "gx": 50, "gy": 10, "gz": 60, "b": 10,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("alice HTTP set failed: %d", resp.StatusCode)
	}

	// Alice's block 10 inventory should have decremented from 5 to 4
	_, stAfterSet := doJSON(t, http.MethodGet, ts.URL+"/api/economy/state", aliceToken, nil)
	if int(stAfterSet["inventory"].(map[string]any)["10"].(float64)) != 4 {
		t.Fatalf("expected block 10 inventory 4 after placement, got %v", stAfterSet["inventory"].(map[string]any)["10"])
	}

	// Bob tries to delete Alice's shielded block over HTTP -> 403
	resp, rejBody := doJSON(t, http.MethodPost, ts.URL+"/api/world/testroom", bobToken, map[string]any{
		"op": "del", "gx": 50, "gy": 10, "gz": 60,
	})
	if resp.StatusCode != http.StatusForbidden || rejBody["reason"] != "shielded" || rejBody["ownerName"] != "Alice" {
		t.Fatalf("expected 403 shielded, got status=%d body=%+v", resp.StatusCode, rejBody)
	}

	// Bob tries to delete Alice's shielded block over WS -> receives vox_rejected
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws?room=testroom&cid=bob1&token=" + bobToken
	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("ws dial failed: %v", err)
	}
	defer wsConn.Close()

	// Read world_init and verify 6-element blocks
	var initMsg map[string]any
	if err := wsConn.ReadJSON(&initMsg); err != nil {
		t.Fatal(err)
	}
	if initMsg["t"] != "world_init" {
		t.Fatalf("expected world_init, got %+v", initMsg)
	}
	blocks := initMsg["blocks"].([]any)
	if len(blocks) == 0 || len(blocks[0].([]any)) != 6 {
		t.Fatalf("expected 6-element tuples in world_init, got %+v", blocks)
	}

	// Send shielded delete -> expect vox_rejected
	if err := wsConn.WriteJSON(map[string]any{"t": "vox", "op": "del", "gx": 50, "gy": 10, "gz": 60}); err != nil {
		t.Fatal(err)
	}
	var rejMsg map[string]any
	if err := wsConn.ReadJSON(&rejMsg); err != nil {
		t.Fatal(err)
	}
	if rejMsg["t"] != "vox_rejected" || rejMsg["reason"] != "shielded" || rejMsg["ownerName"] != "Alice" {
		t.Fatalf("expected vox_rejected, got %+v", rejMsg)
	}

	// Alice deletes her own block -> inventory returns to 5
	resp, _ = doJSON(t, http.MethodPost, ts.URL+"/api/world/testroom", aliceToken, map[string]any{
		"op": "del", "gx": 50, "gy": 10, "gz": 60,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("alice delete own block failed: %d", resp.StatusCode)
	}
	_, stAfterDel := doJSON(t, http.MethodGet, ts.URL+"/api/economy/state", aliceToken, nil)
	if int(stAfterDel["inventory"].(map[string]any)["10"].(float64)) != 5 {
		t.Fatalf("expected block 10 inventory returned to 5, got %v", stAfterDel["inventory"].(map[string]any)["10"])
	}
}

func startMockSSHServer(t *testing.T) (string, int) {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatal(err)
	}
	cfg := &ssh.ServerConfig{
		PasswordCallback: func(c ssh.ConnMetadata, pass []byte) (*ssh.Permissions, error) {
			if c.User() == "vibe" && string(pass) == "secret" {
				return &ssh.Permissions{}, nil
			}
			return nil, io.EOF
		},
	}
	cfg.AddHostKey(signer)

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = ln.Close() })

	go func() {
		for {
			nConn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				_, chans, reqs, err := ssh.NewServerConn(c, cfg)
				if err != nil {
					return
				}
				go ssh.DiscardRequests(reqs)
				for newChan := range chans {
					if newChan.ChannelType() != "session" {
						_ = newChan.Reject(ssh.UnknownChannelType, "unknown")
						continue
					}
					ch, chReqs, err := newChan.Accept()
					if err != nil {
						return
					}
					go func() {
						defer ch.Close()
						for req := range chReqs {
							switch req.Type {
							case "pty-req", "window-change":
								_ = req.Reply(true, nil)
							case "shell":
								_ = req.Reply(true, nil)
								_, _ = io.WriteString(ch, "WELCOME-VIBE\n")
								go func() {
									buf := make([]byte, 256)
									for {
										n, rerr := ch.Read(buf)
										if n > 0 {
											txt := string(buf[:n])
											_, _ = io.WriteString(ch, "ECHO:"+txt)
											if strings.Contains(txt, "exit") {
												_, _ = ch.SendRequest("exit-status", false, []byte{0, 0, 0, 0})
												_ = ch.Close()
												return
											}
										}
										if rerr != nil {
											return
										}
									}
								}()
							default:
								_ = req.Reply(false, nil)
							}
						}
					}()
				}
			}(nConn)
		}
	}()

	host, portStr, _ := net.SplitHostPort(ln.Addr().String())
	var port int
	_ = json.Unmarshal([]byte(portStr), &port)
	return host, port
}

func TestWebSSHProxy(t *testing.T) {
	ts, _, _, _ := setupTestServer(t)
	sshHost, sshPort := startMockSSHServer(t)

	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws/ssh"

	// 1. Validation error when host/username missing
	c1, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	_ = c1.WriteJSON(map[string]any{"type": "connect", "host": "", "username": ""})
	var errMsg map[string]any
	if err := c1.ReadJSON(&errMsg); err != nil {
		t.Fatal(err)
	}
	if errMsg["type"] != "error" {
		t.Fatalf("expected error message, got %+v", errMsg)
	}
	_ = c1.Close()

	// 2. Full interactive SSH session over WS
	c2, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer c2.Close()

	if err := c2.WriteJSON(map[string]any{
		"type":     "connect",
		"host":     sshHost,
		"port":     sshPort,
		"username": "vibe",
		"password": "secret",
		"cols":     80,
		"rows":     24,
	}); err != nil {
		t.Fatal(err)
	}

	var msg map[string]any
	if err := c2.ReadJSON(&msg); err != nil || msg["type"] != "connected" {
		t.Fatalf("expected connected, got err=%v msg=%+v", err, msg)
	}

	// Read welcome banner
	if err := c2.ReadJSON(&msg); err != nil || msg["type"] != "data" || !strings.Contains(msg["data"].(string), "WELCOME-VIBE") {
		t.Fatalf("expected welcome data, got err=%v msg=%+v", err, msg)
	}

	// Resize + send input
	_ = c2.WriteJSON(map[string]any{"type": "resize", "cols": 100, "rows": 30})
	_ = c2.WriteJSON(map[string]any{"type": "input", "data": "hello\n"})

	if err := c2.ReadJSON(&msg); err != nil || msg["type"] != "data" || !strings.Contains(msg["data"].(string), "ECHO:hello") {
		t.Fatalf("expected echoed input, got err=%v msg=%+v", err, msg)
	}

	// Exit shell -> expect closed
	_ = c2.WriteJSON(map[string]any{"type": "input", "data": "exit\n"})
	gotClosed := false
	for i := 0; i < 5; i++ {
		_ = c2.SetReadDeadline(time.Now().Add(3 * time.Second))
		if err := c2.ReadJSON(&msg); err != nil {
			break
		}
		if msg["type"] == "closed" {
			gotClosed = true
			break
		}
	}
	if !gotClosed {
		t.Fatalf("expected closed message when shell exits")
	}
}

func TestV2TeleportMarkersIntrudersAndAvatars(t *testing.T) {
	ts, _, _, _ := setupTestServer(t)

	// 1. Verify GuestDefaultState has teleportCards=1 and shop uses 道具袋 (not old typo)
	resp, guestBody := doJSON(t, http.MethodGet, ts.URL+"/api/economy/state", "", nil)
	if resp.StatusCode != http.StatusOK || int(guestBody["teleportCards"].(float64)) != 1 {
		t.Fatalf("expected guest teleportCards=1, got status=%d body=%+v", resp.StatusCode, guestBody)
	}
	rawGuest, _ := json.Marshal(guestBody)
	if strings.Contains(string(rawGuest), "道具"+"道路袋") {
		t.Fatalf("found legacy typo in shop payload")
	}
	if !strings.Contains(string(rawGuest), "道具袋") || !strings.Contains(string(rawGuest), "teleport_card") || !strings.Contains(string(rawGuest), "teleport_pack3") {
		t.Fatalf("expected 道具袋 and teleport shop items in catalog")
	}

	// Register Alice & Bob
	_, aliceReg := doJSON(t, http.MethodPost, ts.URL+"/api/auth/register", "", map[string]any{
		"username": "alice_v2", "password": "password1", "displayName": "AliceV2",
	})
	aliceToken := aliceReg["token"].(string)

	_, bobReg := doJSON(t, http.MethodPost, ts.URL+"/api/auth/register", "", map[string]any{
		"username": "bob_v2", "password": "password2", "displayName": "BobV2",
	})
	bobToken := bobReg["token"].(string)

	// 2. Teleport Cards: starts at 1, use -> 0, use again -> 400, buy pack3 -> 3, buy single -> 4
	resp, stBody := doJSON(t, http.MethodGet, ts.URL+"/api/economy/state", aliceToken, nil)
	if resp.StatusCode != http.StatusOK || int(stBody["teleportCards"].(float64)) != 1 {
		t.Fatalf("expected new account teleportCards=1, got %+v", stBody)
	}

	resp, useBody := doJSON(t, http.MethodPost, ts.URL+"/api/economy/teleport/use", aliceToken, nil)
	if resp.StatusCode != http.StatusOK || useBody["ok"] != true {
		t.Fatalf("expected teleport use ok, got status=%d body=%+v", resp.StatusCode, useBody)
	}
	stateObj := useBody["state"].(map[string]any)
	if int(stateObj["teleportCards"].(float64)) != 0 {
		t.Fatalf("expected state.teleportCards=0, got %+v", stateObj)
	}

	// Using when 0 cards -> 400
	resp, _ = doJSON(t, http.MethodPost, ts.URL+"/api/economy/teleport/use", aliceToken, nil)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 when using teleport card at 0, got %d", resp.StatusCode)
	}

	// Buy teleport_pack3 (300 coins, +3 cards) and teleport_card (120 coins, +1 card)
	resp, buyPack := doJSON(t, http.MethodPost, ts.URL+"/api/economy/shop/buy", aliceToken, map[string]any{
		"itemId": "teleport_pack3", "qty": 1,
	})
	if resp.StatusCode != http.StatusOK || int(buyPack["teleportCards"].(float64)) != 3 || int(buyPack["coins"].(float64)) != 200 {
		t.Fatalf("buy teleport_pack3 failed: status=%d body=%+v", resp.StatusCode, buyPack)
	}
	resp, buyOne := doJSON(t, http.MethodPost, ts.URL+"/api/economy/shop/buy", aliceToken, map[string]any{
		"itemId": "teleport_card", "qty": 1,
	})
	if resp.StatusCode != http.StatusOK || int(buyOne["teleportCards"].(float64)) != 4 || int(buyOne["coins"].(float64)) != 80 {
		t.Fatalf("buy teleport_card failed: status=%d body=%+v", resp.StatusCode, buyOne)
	}

	// 3. World Map Markers: auth required, POST, GET, DELETE
	resp, _ = doJSON(t, http.MethodGet, ts.URL+"/api/map/markers", "", nil)
	if resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated markers GET, got %d", resp.StatusCode)
	}
	resp, mkBody := doJSON(t, http.MethodPost, ts.URL+"/api/map/markers", aliceToken, map[string]any{
		"name": "Cyber Base", "wx": 12.5, "wy": 3.0, "ws": 450.25, "color": "#f43f5e",
	})
	if resp.StatusCode != http.StatusCreated || mkBody["ok"] != true {
		t.Fatalf("add marker failed: status=%d body=%+v", resp.StatusCode, mkBody)
	}
	mkID := mkBody["marker"].(map[string]any)["id"].(string)

	resp, mkList := doJSON(t, http.MethodGet, ts.URL+"/api/map/markers", aliceToken, nil)
	if resp.StatusCode != http.StatusOK || len(mkList["markers"].([]any)) != 1 {
		t.Fatalf("get markers failed: status=%d body=%+v", resp.StatusCode, mkList)
	}

	resp, mkDel := doJSON(t, http.MethodDelete, ts.URL+"/api/map/markers/"+mkID, aliceToken, nil)
	if resp.StatusCode != http.StatusOK || len(mkDel["markers"].([]any)) != 0 {
		t.Fatalf("delete marker failed: status=%d body=%+v", resp.StatusCode, mkDel)
	}

	// 4. Intruder Records + Live Position Tracking + Real-time WS intruder_alert
	aliceWSURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws?room=intrroom&cid=alice_c1&token=" + aliceToken
	aliceWS, _, err := websocket.DefaultDialer.Dial(aliceWSURL, nil)
	if err != nil {
		t.Fatalf("alice ws dial failed: %v", err)
	}
	defer aliceWS.Close()
	var tmp map[string]any
	_ = aliceWS.ReadJSON(&tmp) // world_init

	bobWSURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/ws?room=intrroom&cid=bob_c1&token=" + bobToken
	bobWS, _, err := websocket.DefaultDialer.Dial(bobWSURL, nil)
	if err != nil {
		t.Fatalf("bob ws dial failed: %v", err)
	}
	_ = bobWS.ReadJSON(&tmp) // world_init

	// Bob reports live position via WS {t:"pos", ...}
	if err := bobWS.WriteJSON(map[string]any{
		"t": "pos", "wx": 88.5, "wy": 4.2, "ws": 1234.5, "onFoot": true,
	}); err != nil {
		t.Fatal(err)
	}

	// Poll /api/map/players briefly until pos is processed
	var players []any
	for i := 0; i < 20; i++ {
		_, plBody := doJSON(t, http.MethodGet, ts.URL+"/api/map/players?room=intrroom", "", nil)
		players = plBody["players"].([]any)
		foundBobPos := false
		for _, p := range players {
			pm := p.(map[string]any)
			if pm["id"] == "bob_c1" && pm["wx"].(float64) == 88.5 && pm["onFoot"] == true {
				foundBobPos = true
			}
		}
		if foundBobPos {
			break
		}
		time.Sleep(15 * time.Millisecond)
	}
	if len(players) != 2 {
		t.Fatalf("expected 2 online players in intrroom, got %+v", players)
	}

	// Alice places an unshielded block at (15, 3, 25)
	resp, _ = doJSON(t, http.MethodPost, ts.URL+"/api/world/intrroom", aliceToken, map[string]any{
		"op": "set", "gx": 15, "gy": 3, "gz": 25, "b": 4,
	})
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("alice place block failed: %d", resp.StatusCode)
	}
	// Drain Alice's vox broadcast from HTTP set
	_ = aliceWS.SetReadDeadline(time.Now().Add(2 * time.Second))
	_ = aliceWS.ReadJSON(&tmp)

	// Bob breaks Alice's block via WS -> Alice receives real-time intruder_alert!
	if err := bobWS.WriteJSON(map[string]any{
		"t": "vox", "op": "del", "gx": 15, "gy": 3, "gz": 25,
	}); err != nil {
		t.Fatal(err)
	}

	gotAlert := false
	var alertRec map[string]any
	for i := 0; i < 5; i++ {
		_ = aliceWS.SetReadDeadline(time.Now().Add(2 * time.Second))
		var msg map[string]any
		if err := aliceWS.ReadJSON(&msg); err != nil {
			t.Fatalf("alice failed reading intruder_alert: %v", err)
		}
		if msg["t"] == "intruder_alert" {
			gotAlert = true
			alertRec = msg["record"].(map[string]any)
			break
		}
	}
	if !gotAlert || alertRec["action"] != "break" || alertRec["intruderName"] != "BobV2" || alertRec["online"] != true || alertRec["liveWx"].(float64) != 88.5 {
		t.Fatalf("unexpected intruder_alert: gotAlert=%v rec=%+v", gotAlert, alertRec)
	}

	// Bob disconnects -> GET /api/intruders?room=intrroom still reports Bob's last known position with online=false
	_ = bobWS.Close()
	time.Sleep(40 * time.Millisecond)

	resp, intrBody := doJSON(t, http.MethodGet, ts.URL+"/api/intruders?room=intrroom", aliceToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("get intruders failed: status=%d body=%+v", resp.StatusCode, intrBody)
	}
	recs := intrBody["records"].([]any)
	if len(recs) != 1 {
		t.Fatalf("expected 1 intruder record, got %+v", recs)
	}
	rec0 := recs[0].(map[string]any)
	if rec0["online"] != false || rec0["liveWx"].(float64) != 88.5 || rec0["liveWs"].(float64) != 1234.5 {
		t.Fatalf("expected offline intruder with last known pos, got %+v", rec0)
	}

	// Delete intruder record
	recID := rec0["id"].(string)
	resp, _ = doJSON(t, http.MethodDelete, ts.URL+"/api/intruders/"+recID, aliceToken, nil)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("delete intruder record failed: %d", resp.StatusCode)
	}
	_, intrAfter := doJSON(t, http.MethodGet, ts.URL+"/api/intruders?room=intrroom", aliceToken, nil)
	if len(intrAfter["records"].([]any)) != 0 {
		t.Fatalf("expected 0 intruder records after delete, got %+v", intrAfter)
	}

	// 5. Multiple Saved Custom Avatars
	// Portrait exceeding 32768 bytes -> 400
	resp, _ = doJSON(t, http.MethodPost, ts.URL+"/api/avatars", aliceToken, map[string]any{
		"name":            "TooBig",
		"portraitDataUrl": strings.Repeat("A", 32769),
	})
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for oversized portraitDataUrl, got %d", resp.StatusCode)
	}

	resp, avCreate := doJSON(t, http.MethodPost, ts.URL+"/api/avatars", aliceToken, map[string]any{
		"name":            "Cyber Ninja",
		"prompt":          "red cyber ninja",
		"portraitDataUrl": "data:image/png;base64,iVBORw0KGgo=",
		"skin": map[string]any{
			"head": "#111111", "face": "#f5d0c5", "hair": "#ef4444",
			"jacket": "#dc2626", "stripe": "#facc15", "pants": "#1f2937",
			"boots": "#000000", "bikePrimary": "#991b1b", "bikeAccent": "#38bdf8",
			"visor": "#38bdf8", "accessory": "halo",
		},
	})
	if resp.StatusCode != http.StatusCreated || avCreate["ok"] != true {
		t.Fatalf("create avatar failed: status=%d body=%+v", resp.StatusCode, avCreate)
	}
	avID := avCreate["avatar"].(map[string]any)["id"].(string)

	// Activate avatar
	resp, actBody := doJSON(t, http.MethodPut, ts.URL+"/api/avatars/active", aliceToken, map[string]any{"id": avID})
	if resp.StatusCode != http.StatusOK || actBody["activeId"] != avID {
		t.Fatalf("set active avatar failed: status=%d body=%+v", resp.StatusCode, actBody)
	}

	// GET /api/avatars reflects activeId and saved list
	resp, avList := doJSON(t, http.MethodGet, ts.URL+"/api/avatars", aliceToken, nil)
	if resp.StatusCode != http.StatusOK || avList["activeId"] != avID || len(avList["avatars"].([]any)) != 1 {
		t.Fatalf("get avatars failed: status=%d body=%+v", resp.StatusCode, avList)
	}

	// Delete active avatar -> clears activeId
	resp, avDel := doJSON(t, http.MethodDelete, ts.URL+"/api/avatars/"+avID, aliceToken, nil)
	if resp.StatusCode != http.StatusOK || avDel["activeId"] != "" || len(avDel["avatars"].([]any)) != 0 {
		t.Fatalf("delete active avatar failed: status=%d body=%+v", resp.StatusCode, avDel)
	}

	// Revert to built-in ("") explicitly succeeds
	resp, revBody := doJSON(t, http.MethodPut, ts.URL+"/api/avatars/active", aliceToken, map[string]any{"id": ""})
	if resp.StatusCode != http.StatusOK || revBody["activeId"] != "" {
		t.Fatalf("revert active avatar failed: status=%d body=%+v", resp.StatusCode, revBody)
	}
}
