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
	wsHub := hub.New(worlds, accounts)
	h := buildHandler(accounts, worlds, econ, wsHub, nil, time.Now(), "localhost")
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
