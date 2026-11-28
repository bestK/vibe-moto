package main

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"vibe-moto-server/internal/auth"
	"vibe-moto-server/internal/economy"
	"vibe-moto-server/internal/hub"
	"vibe-moto-server/internal/intruders"
	"vibe-moto-server/internal/mcproto"
	"vibe-moto-server/internal/sshproxy"
	"vibe-moto-server/internal/world"
)

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func economyPayload(st economy.EconomyState, extra map[string]any) map[string]any {
	out := map[string]any{
		"ok":            true,
		"coins":         st.Coins,
		"inventory":     st.Inventory,
		"caps":          st.Caps,
		"bagCapacity":   st.BagCapacity,
		"savedItems":    st.SavedItems,
		"shieldUntil":   st.ShieldUntil,
		"teleportCards": st.TeleportCards,
		"shop":          st.Shop,
	}
	for k, v := range extra {
		out[k] = v
	}
	return out
}

func economyErrorStatus(err error) int {
	switch {
	case errors.Is(err, auth.ErrUnauthorized):
		return http.StatusUnauthorized
	case errors.Is(err, economy.ErrForbidden):
		return http.StatusForbidden
	case errors.Is(err, economy.ErrListingNotFound),
		errors.Is(err, economy.ErrBlueprintNotFound),
		errors.Is(err, auth.ErrAccountNotFound),
		errors.Is(err, auth.ErrMarkerNotFound),
		errors.Is(err, auth.ErrAvatarNotFound):
		return http.StatusNotFound
	default:
		return http.StatusBadRequest
	}
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func extractBearer(r *http.Request) string {
	h := strings.TrimSpace(r.Header.Get("Authorization"))
	if strings.HasPrefix(strings.ToLower(h), "bearer ") {
		return strings.TrimSpace(h[7:])
	}
	return strings.TrimSpace(r.URL.Query().Get("token"))
}

func buildHandler(
	accounts *auth.Store,
	worlds *world.Store,
	econ *economy.Store,
	intruderStore *intruders.Store,
	wsHub *hub.Hub,
	mcSrv *mcproto.Server,
	startedAt time.Time,
	publicHost string,
) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		mcOnline := 0
		if mcSrv != nil {
			mcOnline = mcSrv.OnlineCount()
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":          true,
			"service":     "vibe-moto-server",
			"uptimeSec":   int(time.Since(startedAt).Seconds()),
			"webOnline":   wsHub.OnlineCount(),
			"mcOnline":    mcOnline,
			"online":      wsHub.OnlineCount() + mcOnline,
			"accounts":    accounts.Count(),
			"totalBlocks": worlds.TotalBlocks(),
			"mcProtocol":  mcproto.DefaultVersionName,
			"mcPort":      25565,
		})
	})

	mux.HandleFunc("/api/auth/register", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req struct {
			Username    string `json:"username"`
			Password    string `json:"password"`
			DisplayName string `json:"displayName"`
			ColorIdx    int    `json:"colorIdx"`
			AvatarIdx   int    `json:"avatarIdx"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		acc, token, err := accounts.Register(req.Username, req.Password, req.DisplayName, req.ColorIdx, req.AvatarIdx)
		if err != nil {
			code := http.StatusBadRequest
			if err == auth.ErrUsernameTaken {
				code = http.StatusConflict
			}
			writeJSON(w, code, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, map[string]any{
			"ok":      true,
			"token":   token,
			"account": acc,
		})
	})

	mux.HandleFunc("/api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var req struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		acc, token, err := accounts.Login(req.Username, req.Password)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"token":   token,
			"account": acc,
		})
	})

	mux.HandleFunc("/api/auth/me", func(w http.ResponseWriter, r *http.Request) {
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "account": acc})
	})

	mux.HandleFunc("/api/auth/profile", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut && r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		var req struct {
			DisplayName *string `json:"displayName"`
			ColorIdx    *int    `json:"colorIdx"`
			AvatarIdx   *int    `json:"avatarIdx"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		updated, err := accounts.UpdateProfile(acc.ID, req.DisplayName, req.ColorIdx, req.AvatarIdx)
		if err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "account": updated})
	})

	// ── Economy, Shop, Item Bag ──
	mux.HandleFunc("/api/economy/state", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		var accountID string
		if tok := extractBearer(r); tok != "" {
			if acc, err := accounts.VerifyToken(tok); err == nil {
				accountID = acc.ID
			}
		}
		st, authenticated := econ.GetState(accountID)
		writeJSON(w, http.StatusOK, economyPayload(st, map[string]any{
			"authenticated": authenticated,
		}))
	})

	mux.HandleFunc("/api/economy/reward", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		var req struct {
			Kind         string                `json:"kind"`
			Amount       *int                  `json:"amount"`
			BlockRewards []economy.BlockReward `json:"blockRewards"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		st, grantedCoins, grantedBlocks, err := econ.ClaimReward(acc.ID, req.Kind, req.Amount, req.BlockRewards)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, economyPayload(st, map[string]any{
			"grantedCoins":  grantedCoins,
			"grantedBlocks": grantedBlocks,
		}))
	})

	mux.HandleFunc("/api/economy/shop/buy", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		var req struct {
			ItemID string `json:"itemId"`
			Qty    int    `json:"qty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		st, err := econ.BuyShopItem(acc.ID, req.ItemID, req.Qty)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, economyPayload(st, nil))
	})

	mux.HandleFunc("/api/economy/bag/stash", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		var req struct {
			Item string `json:"item"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		st, err := econ.StashBagItem(acc.ID, req.Item)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, economyPayload(st, nil))
	})

	mux.HandleFunc("/api/economy/bag/use", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		var req struct {
			Index int `json:"index"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		item, st, err := econ.UseBagItem(acc.ID, req.Index)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, economyPayload(st, map[string]any{
			"item": item,
		}))
	})

	mux.HandleFunc("/api/economy/teleport/use", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		st, err := econ.UseTeleportCard(acc.ID)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, economyPayload(st, map[string]any{
			"state": st,
		}))
	})

	// ── World Map Markers & Online Players ──
	mux.HandleFunc("/api/map/markers", func(w http.ResponseWriter, r *http.Request) {
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		switch r.Method {
		case http.MethodGet:
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":      true,
				"markers": accounts.GetMapMarkers(acc.ID),
			})
		case http.MethodPost:
			var req struct {
				Name  string  `json:"name"`
				WX    float64 `json:"wx"`
				WY    float64 `json:"wy"`
				WS    float64 `json:"ws"`
				Color string  `json:"color"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
				return
			}
			marker, all, err := accounts.AddMapMarker(acc.ID, req.Name, req.WX, req.WY, req.WS, req.Color)
			if err != nil {
				writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{
				"ok":      true,
				"marker":  marker,
				"markers": all,
			})
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
	})

	mux.HandleFunc("/api/map/markers/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		markerID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/map/markers/"))
		all, err := accounts.DeleteMapMarker(acc.ID, markerID)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"id":      markerID,
			"markers": all,
		})
	})

	mux.HandleFunc("/api/map/players", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		slug := world.SanitizeRoom(r.URL.Query().Get("room"))
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"room":    slug,
			"players": wsHub.RoomPlayers(slug),
		})
	})

	// ── Intruder Records ──
	mux.HandleFunc("/api/intruders", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		rawRecords := []intruders.Record{}
		if intruderStore != nil {
			rawRecords = intruderStore.ListByOwner(acc.ID, r.URL.Query().Get("room"))
		}
		enriched := make([]intruders.EnrichedRecord, 0, len(rawRecords))
		for _, rec := range rawRecords {
			enriched = append(enriched, wsHub.EnrichIntruderRecord(rec))
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"records": enriched,
		})
	})

	mux.HandleFunc("/api/intruders/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		recID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/intruders/"))
		if intruderStore == nil || !intruderStore.Delete(acc.ID, recID) {
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "入侵记录不存在"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok": true,
			"id": recID,
		})
	})

	// ── Multiple Saved Custom Avatars ──
	mux.HandleFunc("/api/avatars", func(w http.ResponseWriter, r *http.Request) {
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		switch r.Method {
		case http.MethodGet:
			avatars, activeID := accounts.GetCustomAvatars(acc.ID)
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":       true,
				"avatars":  avatars,
				"activeId": activeID,
			})
		case http.MethodPost:
			var req struct {
				Name            string                `json:"name"`
				Prompt          string                `json:"prompt"`
				PortraitDataUrl string                `json:"portraitDataUrl"`
				Skin            auth.CustomAvatarSkin `json:"skin"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
				return
			}
			av, all, activeID, err := accounts.SaveCustomAvatar(acc.ID, req.Name, req.Prompt, req.PortraitDataUrl, req.Skin)
			if err != nil {
				writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{
				"ok":       true,
				"avatar":   av,
				"avatars":  all,
				"activeId": activeID,
			})
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
	})

	mux.HandleFunc("/api/avatars/active", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPut && r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		activeID, err := accounts.SetActiveCustomAvatar(acc.ID, req.ID)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       true,
			"activeId": activeID,
		})
	})

	mux.HandleFunc("/api/avatars/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		avID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/avatars/"))
		all, activeID, err := accounts.DeleteCustomAvatar(acc.ID, avID)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       true,
			"id":       avID,
			"avatars":  all,
			"activeId": activeID,
		})
	})

	// ── Player Marketplace ──
	mux.HandleFunc("/api/market/listings", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":       true,
			"listings": econ.GetMarketListings(),
		})
	})

	mux.HandleFunc("/api/market/list", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		var req struct {
			BlockType  int `json:"blockType"`
			Qty        int `json:"qty"`
			PriceCoins int `json:"priceCoins"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		listing, st, err := econ.CreateMarketListing(acc.ID, req.BlockType, req.Qty, req.PriceCoins)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusCreated, economyPayload(st, map[string]any{
			"listing": listing,
		}))
	})

	mux.HandleFunc("/api/market/buy", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		var req struct {
			ListingID string `json:"listingId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		listing, st, err := econ.BuyMarketListing(acc.ID, req.ListingID)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, economyPayload(st, map[string]any{
			"listing": listing,
		}))
	})

	mux.HandleFunc("/api/market/cancel", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		var req struct {
			ListingID string `json:"listingId"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
			return
		}
		st, err := econ.CancelMarketListing(acc.ID, req.ListingID)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, economyPayload(st, map[string]any{
			"listingId": req.ListingID,
		}))
	})

	// ── Blueprints ──
	mux.HandleFunc("/api/blueprints", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			tok := extractBearer(r)
			if tok == "" {
				writeJSON(w, http.StatusOK, map[string]any{
					"ok":            true,
					"authenticated": false,
					"blueprints":    []auth.Blueprint{},
				})
				return
			}
			acc, err := accounts.VerifyToken(tok)
			if err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":            true,
				"authenticated": true,
				"blueprints":    econ.GetBlueprints(acc.ID),
			})
		case http.MethodPost:
			acc, err := accounts.VerifyToken(extractBearer(r))
			if err != nil {
				writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
				return
			}
			var req struct {
				Name   string                `json:"name"`
				SizeX  int                   `json:"sizeX"`
				SizeY  int                   `json:"sizeY"`
				SizeZ  int                   `json:"sizeZ"`
				Blocks []auth.BlueprintBlock `json:"blocks"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "请求格式错误"})
				return
			}
			bp, all, err := econ.SaveBlueprint(acc.ID, req.Name, req.SizeX, req.SizeY, req.SizeZ, req.Blocks)
			if err != nil {
				writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
				return
			}
			writeJSON(w, http.StatusCreated, map[string]any{
				"ok":         true,
				"blueprint":  bp,
				"blueprints": all,
			})
		default:
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		}
	})

	mux.HandleFunc("/api/blueprints/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodDelete {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
			return
		}
		acc, err := accounts.VerifyToken(extractBearer(r))
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": err.Error()})
			return
		}
		bpID := strings.TrimSpace(strings.TrimPrefix(r.URL.Path, "/api/blueprints/"))
		all, err := econ.DeleteBlueprint(acc.ID, bpID)
		if err != nil {
			writeJSON(w, economyErrorStatus(err), map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":         true,
			"id":         bpID,
			"blueprints": all,
		})
	})

	mux.HandleFunc("/api/rooms", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":    true,
			"rooms": wsHub.RoomSummaries(),
		})
	})

	mux.HandleFunc("/api/world/", func(w http.ResponseWriter, r *http.Request) {
		slug := world.SanitizeRoom(strings.TrimPrefix(r.URL.Path, "/api/world/"))
		rw := worlds.GetRoom(slug)
		if r.Method == http.MethodGet {
			writeJSON(w, http.StatusOK, map[string]any{
				"ok":     true,
				"room":   slug,
				"count":  rw.Count(),
				"blocks": rw.SnapshotCompact(),
			})
			return
		}
		if r.Method == http.MethodPost {
			var req struct {
				Op string `json:"op"`
				GX int    `json:"gx"`
				GY int    `json:"gy"`
				GZ int    `json:"gz"`
				B  int    `json:"b"`
			}
			if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid payload"})
				return
			}

			var actorID, actorName string
			if tok := extractBearer(r); tok != "" {
				if acc, err := accounts.VerifyToken(tok); err == nil {
					actorID = acc.ID
					actorName = acc.DisplayName
				}
			}

			lookup := accounts.GetShieldInfo
			changed := false
			ev := hub.VoxelEvent{
				Op: req.Op,
				GX: req.GX,
				GY: req.GY,
				GZ: world.WrapGZ(req.GZ),
				B:  req.B,
			}

			switch req.Op {
			case "set":
				ok, prev, hadPrev, rej := rw.SetBlockChecked(req.GX, req.GY, req.GZ, req.B, actorID, actorName, lookup)
				if rej != nil {
					writeJSON(w, http.StatusForbidden, map[string]any{
						"ok":           false,
						"error":        "shielded",
						"reason":       "shielded",
						"ownerName":    rej.OwnerName,
						"remainingSec": rej.RemainingSec,
					})
					return
				}
				if ok {
					changed = true
					if hadPrev && prev.OwnerID != "" && prev.OwnerID != actorID {
						wsHub.RecordIntrusion(slug, prev.OwnerID, actorID, "", actorName, req.GX, req.GY, req.GZ, prev.Type, "overwrite")
					}
					if actorID != "" {
						ev.OwnerID = actorID
						ev.OwnerName = actorName
						accounts.OnBlockPlaced(actorID, req.B)
					}
				}
			case "del":
				ok, prev, rej := rw.DeleteBlockChecked(req.GX, req.GY, req.GZ, actorID, lookup)
				if rej != nil {
					writeJSON(w, http.StatusForbidden, map[string]any{
						"ok":           false,
						"error":        "shielded",
						"reason":       "shielded",
						"ownerName":    rej.OwnerName,
						"remainingSec": rej.RemainingSec,
					})
					return
				}
				if ok {
					changed = true
					if prev.OwnerID != "" && prev.OwnerID != actorID {
						wsHub.RecordIntrusion(slug, prev.OwnerID, actorID, "", actorName, req.GX, req.GY, req.GZ, prev.Type, "break")
					}
					if actorID != "" {
						accounts.OnBlockBroken(actorID, prev.Type)
					}
				}
			case "clear":
				removed, rej := rw.ClearAllChecked(actorID, lookup)
				if rej != nil {
					writeJSON(w, http.StatusForbidden, map[string]any{
						"ok":           false,
						"error":        "shielded",
						"reason":       "shielded",
						"ownerName":    rej.OwnerName,
						"remainingSec": rej.RemainingSec,
					})
					return
				}
				if removed > 0 {
					changed = true
				}
			default:
				writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid op"})
				return
			}

			if changed {
				wsHub.BroadcastVoxel(slug, ev, nil)
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": rw.Count()})
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	})

	mux.HandleFunc("/ws", wsHub.ServeWS)
	mux.HandleFunc("/ws/ssh", sshproxy.ServeWS)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"service":     "VIBE MOTO Open World Server (Golang)",
			"mcProtocol":  mcproto.DefaultVersionName,
			"mcAddress":   publicHost + ":25565",
			"wsEndpoint":  "/ws",
			"sshEndpoint": "/ws/ssh",
			"health":      "/api/health",
		})
	})

	return withCORS(mux)
}

func main() {
	httpAddr := envOr("HTTP_ADDR", ":25580")
	mcAddr := envOr("MC_ADDR", ":25565")
	dataDir := envOr("DATA_DIR", "./data")
	mcMotd := envOr("MC_MOTD", "VIBE MOTO Open World // 暴力摩托开放世界")
	publicHost := envOr("PUBLIC_HOST", "moto.linkof.link")
	startedAt := time.Now()

	accounts, err := auth.NewStore(dataDir)
	if err != nil {
		log.Fatalf("init auth store: %v", err)
	}
	worlds, err := world.NewStore(dataDir)
	if err != nil {
		log.Fatalf("init world store: %v", err)
	}
	econ, err := economy.NewStore(dataDir, accounts)
	if err != nil {
		log.Fatalf("init economy store: %v", err)
	}
	intruderStore, err := intruders.NewStore(dataDir)
	if err != nil {
		log.Fatalf("init intruder store: %v", err)
	}

	wsHub := hub.New(worlds, accounts, intruderStore)
	mcSrv := mcproto.NewServer(mcAddr, mcMotd, publicHost, worlds, wsHub)
	if err := mcSrv.Start(); err != nil {
		log.Printf("[mc] warning: failed to start Minecraft protocol listener on %s: %v", mcAddr, err)
	}

	handler := buildHandler(accounts, worlds, econ, intruderStore, wsHub, mcSrv, startedAt, publicHost)

	srv := &http.Server{
		Addr:              httpAddr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		log.Printf("[http] Vibe Moto Go server listening on %s", httpAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server error: %v", err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Printf("[main] shutting down gracefully...")
	worlds.FlushAll()
	_ = mcSrv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(ctx)
}
