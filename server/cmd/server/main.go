package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"vibe-moto-server/internal/auth"
	"vibe-moto-server/internal/hub"
	"vibe-moto-server/internal/mcproto"
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

	wsHub := hub.New(worlds, accounts)
	mcSrv := mcproto.NewServer(mcAddr, mcMotd, publicHost, worlds, wsHub)
	if err := mcSrv.Start(); err != nil {
		log.Printf("[mc] warning: failed to start Minecraft protocol listener on %s: %v", mcAddr, err)
	}

	mux := http.NewServeMux()

	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":          true,
			"service":     "vibe-moto-server",
			"uptimeSec":   int(time.Since(startedAt).Seconds()),
			"webOnline":   wsHub.OnlineCount(),
			"mcOnline":    mcSrv.OnlineCount(),
			"online":      wsHub.OnlineCount() + mcSrv.OnlineCount(),
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
			switch req.Op {
			case "set":
				rw.SetBlock(req.GX, req.GY, req.GZ, req.B)
			case "del":
				rw.DeleteBlock(req.GX, req.GY, req.GZ)
			case "clear":
				rw.ClearAll()
			}
			wsHub.BroadcastVoxel(slug, hub.VoxelEvent{
				Op: req.Op, GX: req.GX, GY: req.GY, GZ: world.WrapGZ(req.GZ), B: req.B,
			}, nil)
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "count": rw.Count()})
			return
		}
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
	})

	mux.HandleFunc("/ws", wsHub.ServeWS)

	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"service":    "VIBE MOTO Open World Server (Golang)",
			"mcProtocol": mcproto.DefaultVersionName,
			"mcAddress":  publicHost + ":25565",
			"wsEndpoint": "/ws",
			"health":     "/api/health",
		})
	})

	srv := &http.Server{
		Addr:              httpAddr,
		Handler:           withCORS(mux),
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
