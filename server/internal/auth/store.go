package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

var (
	ErrInvalidUsername = errors.New("用户名需为 2-20 位字母/数字/中文/下划线")
	ErrInvalidPassword = errors.New("密码长度需为 4-64 位")
	ErrUsernameTaken   = errors.New("该游戏账号已被注册")
	ErrInvalidCreds    = errors.New("账号或密码错误")
	ErrUnauthorized    = errors.New("登录已过期，请重新登录")
)

type Account struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"displayName"`
	PasswordHash string `json:"passwordHash"`
	ColorIdx     int    `json:"colorIdx"`
	AvatarIdx    int    `json:"avatarIdx"`
	KOs          int    `json:"kos"`
	BlocksPlaced int    `json:"blocksPlaced"`
	BlocksBroken int    `json:"blocksBroken"`
	CreatedAt    int64  `json:"createdAt"`
	LastLoginAt  int64  `json:"lastLoginAt"`
}

type PublicAccount struct {
	ID           string `json:"id"`
	Username     string `json:"username"`
	DisplayName  string `json:"displayName"`
	ColorIdx     int    `json:"colorIdx"`
	AvatarIdx    int    `json:"avatarIdx"`
	KOs          int    `json:"kos"`
	BlocksPlaced int    `json:"blocksPlaced"`
	BlocksBroken int    `json:"blocksBroken"`
	CreatedAt    int64  `json:"createdAt"`
}

func (a *Account) Public() PublicAccount {
	return PublicAccount{
		ID:           a.ID,
		Username:     a.Username,
		DisplayName:  a.DisplayName,
		ColorIdx:     a.ColorIdx,
		AvatarIdx:    a.AvatarIdx,
		KOs:          a.KOs,
		BlocksPlaced: a.BlocksPlaced,
		BlocksBroken: a.BlocksBroken,
		CreatedAt:    a.CreatedAt,
	}
}

type tokenPayload struct {
	Sub string `json:"sub"`
	Usr string `json:"usr"`
	Exp int64  `json:"exp"`
}

type Store struct {
	mu          sync.RWMutex
	dataPath    string
	secret      []byte
	byID        map[string]*Account
	byLowerName map[string]*Account
}

func NewStore(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	secret, err := loadOrCreateSecret(filepath.Join(dataDir, "secret.key"))
	if err != nil {
		return nil, err
	}

	s := &Store{
		dataPath:    filepath.Join(dataDir, "accounts.json"),
		secret:      secret,
		byID:        make(map[string]*Account),
		byLowerName: make(map[string]*Account),
	}
	_ = s.load()
	return s, nil
}

func loadOrCreateSecret(path string) ([]byte, error) {
	if raw, err := os.ReadFile(path); err == nil && len(raw) >= 32 {
		return raw, nil
	}
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return nil, err
	}
	_ = os.WriteFile(path, buf, 0o600)
	return buf, nil
}

func (s *Store) load() error {
	raw, err := os.ReadFile(s.dataPath)
	if err != nil {
		return err
	}
	var list []*Account
	if err := json.Unmarshal(raw, &list); err != nil {
		return err
	}
	for _, a := range list {
		if a == nil || a.ID == "" || a.Username == "" {
			continue
		}
		s.byID[a.ID] = a
		s.byLowerName[strings.ToLower(a.Username)] = a
	}
	return nil
}

func (s *Store) saveLocked() error {
	list := make([]*Account, 0, len(s.byID))
	for _, a := range s.byID {
		list = append(list, a)
	}
	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.dataPath + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.dataPath)
}

func sanitizeUsername(raw string) (string, error) {
	u := strings.TrimSpace(raw)
	n := utf8.RuneCountInString(u)
	if n < 2 || n > 20 {
		return "", ErrInvalidUsername
	}
	for _, r := range u {
		if r < 32 || r == '/' || r == '\\' || r == '<' || r == '>' || r == '"' || r == '\'' {
			return "", ErrInvalidUsername
		}
	}
	return u, nil
}

func randomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "acc_" + hex.EncodeToString(b)
}

func (s *Store) Register(username, password, displayName string, colorIdx, avatarIdx int) (PublicAccount, string, error) {
	u, err := sanitizeUsername(username)
	if err != nil {
		return PublicAccount{}, "", err
	}
	if len(password) < 4 || len(password) > 64 {
		return PublicAccount{}, "", ErrInvalidPassword
	}

	dn := strings.TrimSpace(displayName)
	if dn == "" {
		dn = u
	}
	if utf8.RuneCountInString(dn) > 14 {
		dn = string([]rune(dn)[:14])
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return PublicAccount{}, "", err
	}

	lower := strings.ToLower(u)
	now := time.Now().Unix()

	s.mu.Lock()
	defer s.mu.Unlock()

	if _, exists := s.byLowerName[lower]; exists {
		return PublicAccount{}, "", ErrUsernameTaken
	}

	acc := &Account{
		ID:           randomID(),
		Username:     u,
		DisplayName:  dn,
		PasswordHash: string(hash),
		ColorIdx:     ((colorIdx % 8) + 8) % 8,
		AvatarIdx:    ((avatarIdx % 9) + 9) % 9,
		CreatedAt:    now,
		LastLoginAt:  now,
	}
	s.byID[acc.ID] = acc
	s.byLowerName[lower] = acc
	_ = s.saveLocked()

	token, err := s.signToken(acc)
	if err != nil {
		return PublicAccount{}, "", err
	}
	return acc.Public(), token, nil
}

func (s *Store) Login(username, password string) (PublicAccount, string, error) {
	lower := strings.ToLower(strings.TrimSpace(username))
	if lower == "" || password == "" {
		return PublicAccount{}, "", ErrInvalidCreds
	}

	s.mu.Lock()
	acc, ok := s.byLowerName[lower]
	if !ok {
		s.mu.Unlock()
		return PublicAccount{}, "", ErrInvalidCreds
	}
	hash := acc.PasswordHash
	s.mu.Unlock()

	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
		return PublicAccount{}, "", ErrInvalidCreds
	}

	s.mu.Lock()
	acc.LastLoginAt = time.Now().Unix()
	_ = s.saveLocked()
	pub := acc.Public()
	s.mu.Unlock()

	token, err := s.signToken(acc)
	if err != nil {
		return PublicAccount{}, "", err
	}
	return pub, token, nil
}

func (s *Store) VerifyToken(token string) (PublicAccount, error) {
	parts := strings.Split(strings.TrimSpace(token), ".")
	if len(parts) != 2 {
		return PublicAccount{}, ErrUnauthorized
	}
	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return PublicAccount{}, ErrUnauthorized
	}
	sigBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return PublicAccount{}, ErrUnauthorized
	}

	mac := hmac.New(sha256.New, s.secret)
	mac.Write(payloadBytes)
	expected := mac.Sum(nil)
	if !hmac.Equal(sigBytes, expected) {
		return PublicAccount{}, ErrUnauthorized
	}

	var p tokenPayload
	if err := json.Unmarshal(payloadBytes, &p); err != nil {
		return PublicAccount{}, ErrUnauthorized
	}
	if time.Now().Unix() > p.Exp {
		return PublicAccount{}, ErrUnauthorized
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	acc, ok := s.byID[p.Sub]
	if !ok {
		return PublicAccount{}, ErrUnauthorized
	}
	return acc.Public(), nil
}

func (s *Store) UpdateProfile(id string, displayName *string, colorIdx *int, avatarIdx *int) (PublicAccount, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	acc, ok := s.byID[id]
	if !ok {
		return PublicAccount{}, ErrUnauthorized
	}
	if displayName != nil {
		dn := strings.TrimSpace(*displayName)
		if dn != "" {
			if utf8.RuneCountInString(dn) > 14 {
				dn = string([]rune(dn)[:14])
			}
			acc.DisplayName = dn
		}
	}
	if colorIdx != nil {
		acc.ColorIdx = ((*colorIdx % 8) + 8) % 8
	}
	if avatarIdx != nil {
		acc.AvatarIdx = ((*avatarIdx % 9) + 9) % 9
	}
	_ = s.saveLocked()
	return acc.Public(), nil
}

func (s *Store) RecordBlockStat(id string, placedDelta, brokenDelta int) {
	if id == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	acc, ok := s.byID[id]
	if !ok {
		return
	}
	acc.BlocksPlaced += placedDelta
	acc.BlocksBroken += brokenDelta
	_ = s.saveLocked()
}

func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.byID)
}

func (s *Store) signToken(acc *Account) (string, error) {
	p := tokenPayload{
		Sub: acc.ID,
		Usr: acc.Username,
		Exp: time.Now().Add(30 * 24 * time.Hour).Unix(),
	}
	raw, err := json.Marshal(p)
	if err != nil {
		return "", err
	}
	mac := hmac.New(sha256.New, s.secret)
	mac.Write(raw)
	sig := mac.Sum(nil)
	return base64.RawURLEncoding.EncodeToString(raw) + "." + base64.RawURLEncoding.EncodeToString(sig), nil
}
