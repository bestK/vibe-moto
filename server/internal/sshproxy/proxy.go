package sshproxy

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  8192,
	WriteBufferSize: 8192,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

type clientMessage struct {
	Type       string `json:"type"`
	Host       string `json:"host,omitempty"`
	Port       int    `json:"port,omitempty"`
	Username   string `json:"username,omitempty"`
	Password   string `json:"password,omitempty"`
	PrivateKey string `json:"privateKey,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
	Cols       int    `json:"cols,omitempty"`
	Rows       int    `json:"rows,omitempty"`
	Data       string `json:"data,omitempty"`
}

type serverMessage struct {
	Type    string `json:"type"`
	Data    string `json:"data,omitempty"`
	Message string `json:"message,omitempty"`
}

type safeWS struct {
	mu   sync.Mutex
	conn *websocket.Conn
}

func (s *safeWS) sendJSON(v any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return s.conn.WriteJSON(v)
}

func (s *safeWS) ping() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = s.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	return s.conn.WriteMessage(websocket.PingMessage, nil)
}

func clampInt(v, minV, maxV, fallback int) int {
	if v <= 0 {
		return fallback
	}
	if v < minV {
		return minV
	}
	if v > maxV {
		return maxV
	}
	return v
}

func buildAuthMethods(password, privateKey, passphrase string) ([]ssh.AuthMethod, error) {
	methods := make([]ssh.AuthMethod, 0, 3)

	keyStr := strings.TrimSpace(privateKey)
	if keyStr != "" {
		signer, err := ssh.ParsePrivateKey([]byte(keyStr))
		if err != nil {
			var missing *ssh.PassphraseMissingError
			if errors.As(err, &missing) {
				pass := passphrase
				if pass == "" {
					pass = password
				}
				if pass != "" {
					signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(keyStr), []byte(pass))
				}
			}
			if err != nil {
				return nil, fmt.Errorf("私钥解析失败: %w", err)
			}
		}
		methods = append(methods, ssh.PublicKeys(signer))
	}

	if password != "" {
		pw := password
		methods = append(methods,
			ssh.Password(pw),
			ssh.KeyboardInteractive(func(user, instruction string, questions []string, echos []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range questions {
					answers[i] = pw
				}
				return answers, nil
			}),
		)
	}

	if len(methods) == 0 {
		return nil, errors.New("请提供密码或 SSH 私钥")
	}
	return methods, nil
}

// ServeWS handles WebSocket-to-SSH terminal proxy connections at /ws/ssh.
// Credentials are kept strictly in ephemeral memory for the connection lifetime and NEVER persisted or logged.
func ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()

	ws := &safeWS{conn: conn}
	conn.SetReadLimit(256 * 1024)

	// Wait up to 30s for the initial connect message
	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	_, raw, err := conn.ReadMessage()
	if err != nil {
		return
	}

	var initMsg clientMessage
	if err := json.Unmarshal(raw, &initMsg); err != nil {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: "无效的连接消息格式"})
		return
	}
	if initMsg.Type != "connect" {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: "首条消息必须为 connect"})
		return
	}

	host := strings.TrimSpace(initMsg.Host)
	username := strings.TrimSpace(initMsg.Username)
	if host == "" || username == "" {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: "Host 和 Username 不能为空"})
		return
	}
	port := initMsg.Port
	if port == 0 {
		port = 22
	}
	if port < 1 || port > 65535 {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: "端口号无效 (1-65535)"})
		return
	}

	authMethods, err := buildAuthMethods(initMsg.Password, initMsg.PrivateKey, initMsg.Passphrase)
	if err != nil {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: err.Error()})
		return
	}

	cols := clampInt(initMsg.Cols, 20, 300, 80)
	rows := clampInt(initMsg.Rows, 5, 120, 24)

	cfg := &ssh.ClientConfig{
		User:            username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}

	// Clear credential fields from struct as soon as authMethods are constructed
	initMsg.Password = ""
	initMsg.PrivateKey = ""
	initMsg.Passphrase = ""

	addr := net.JoinHostPort(host, strconv.Itoa(port))
	sshClient, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: "SSH 连接失败: " + err.Error()})
		return
	}
	defer sshClient.Close()

	sess, err := sshClient.NewSession()
	if err != nil {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: "创建 SSH 会话失败: " + err.Error()})
		return
	}
	defer sess.Close()

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: "请求 PTY 失败: " + err.Error()})
		return
	}

	stdin, err := sess.StdinPipe()
	if err != nil {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: "打开 stdin 失败: " + err.Error()})
		return
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: "打开 stdout 失败: " + err.Error()})
		return
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: "打开 stderr 失败: " + err.Error()})
		return
	}

	if err := sess.Shell(); err != nil {
		_ = ws.sendJSON(serverMessage{Type: "error", Message: "启动 Shell 失败: " + err.Error()})
		return
	}

	if err := ws.sendJSON(serverMessage{Type: "connected"}); err != nil {
		return
	}

	done := make(chan struct{})
	var closeOnce sync.Once
	finish := func() {
		closeOnce.Do(func() {
			close(done)
			_ = stdin.Close()
			_ = sess.Close()
			_ = sshClient.Close()
		})
	}
	defer finish()

	// Clear read deadline for interactive session and keep alive with pings
	_ = conn.SetReadDeadline(time.Time{})
	conn.SetPongHandler(func(string) error { return nil })

	go func() {
		ticker := time.NewTicker(25 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				if err := ws.ping(); err != nil {
					finish()
					return
				}
			case <-done:
				return
			}
		}
	}()

	var streamWG sync.WaitGroup
	streamPipe := func(r io.Reader) {
		defer streamWG.Done()
		buf := make([]byte, 4096)
		for {
			n, rerr := r.Read(buf)
			if n > 0 {
				if werr := ws.sendJSON(serverMessage{
					Type: "data",
					Data: string(buf[:n]),
				}); werr != nil {
					finish()
					return
				}
			}
			if rerr != nil {
				return
			}
		}
	}

	streamWG.Add(2)
	go streamPipe(stdout)
	go streamPipe(stderr)

	// Monitor SSH session termination
	go func() {
		_ = sess.Wait()
		streamWG.Wait()
		_ = ws.sendJSON(serverMessage{Type: "closed"})
		finish()
		_ = conn.Close()
	}()

	// Forward WebSocket messages to SSH stdin / resize
	for {
		_, msgRaw, err := conn.ReadMessage()
		if err != nil {
			finish()
			return
		}
		var msg clientMessage
		if err := json.Unmarshal(msgRaw, &msg); err != nil {
			continue
		}
		switch msg.Type {
		case "input":
			if msg.Data != "" {
				if _, werr := io.WriteString(stdin, msg.Data); werr != nil {
					finish()
					return
				}
			}
		case "resize":
			c := clampInt(msg.Cols, 20, 300, cols)
			r := clampInt(msg.Rows, 5, 120, rows)
			cols, rows = c, r
			_ = sess.WindowChange(rows, cols)
		case "ping":
			_ = ws.sendJSON(serverMessage{Type: "pong"})
		case "close", "disconnect":
			_ = ws.sendJSON(serverMessage{Type: "closed"})
			finish()
			return
		}
	}
}
