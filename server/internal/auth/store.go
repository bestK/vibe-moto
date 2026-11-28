package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"golang.org/x/crypto/bcrypt"
)

const (
	InitialCoins          = 500
	MaxBagCapacity        = 12
	InitialTeleportCards  = 1
	MaxTeleportCards      = 50
	MaxMapMarkers         = 30
	MaxCustomAvatars      = 16
	MaxPortraitDataURLLen = 32768
)

var (
	ErrInvalidUsername      = errors.New("用户名需为 2-20 位字母/数字/中文/下划线")
	ErrInvalidPassword      = errors.New("密码长度需为 4-64 位")
	ErrUsernameTaken        = errors.New("该游戏账号已被注册")
	ErrInvalidCreds         = errors.New("账号或密码错误")
	ErrUnauthorized         = errors.New("登录已过期，请重新登录")
	ErrAccountNotFound      = errors.New("账号不存在")
	ErrInvalidMarker        = errors.New("地图标记参数无效")
	ErrTooManyMarkers       = errors.New("地图标记数量已达上限 (30)")
	ErrMarkerNotFound       = errors.New("地图标记不存在")
	ErrInvalidAvatar        = errors.New("自定义形象数据无效")
	ErrAvatarPortraitTooBig = errors.New("自定义形象头像数据过大 (上限 32KB)")
	ErrTooManyAvatars       = errors.New("自定义形象数量已达上限 (16)")
	ErrAvatarNotFound       = errors.New("自定义形象不存在")
)

type MapMarker struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	WX        float64 `json:"wx"`
	WY        float64 `json:"wy"`
	WS        float64 `json:"ws"`
	Color     string  `json:"color"`
	CreatedAt int64   `json:"createdAt"`
}

type CustomAvatarSkin struct {
	Head        string `json:"head"`
	Face        string `json:"face"`
	Hair        string `json:"hair"`
	Jacket      string `json:"jacket"`
	Stripe      string `json:"stripe"`
	Pants       string `json:"pants"`
	Boots       string `json:"boots"`
	BikePrimary string `json:"bikePrimary"`
	BikeAccent  string `json:"bikeAccent"`
	Visor       string `json:"visor"`
	Accessory   string `json:"accessory"`
}

type SavedCustomAvatar struct {
	ID              string           `json:"id"`
	Name            string           `json:"name"`
	Prompt          string           `json:"prompt"`
	PortraitDataUrl string           `json:"portraitDataUrl"`
	Skin            CustomAvatarSkin `json:"skin"`
	CreatedAt       int64            `json:"createdAt"`
}

type BlueprintBlock struct {
	DX int `json:"dx"`
	DY int `json:"dy"`
	DZ int `json:"dz"`
	B  int `json:"b"`
}

type Blueprint struct {
	ID        string           `json:"id"`
	Name      string           `json:"name"`
	SizeX     int              `json:"sizeX"`
	SizeY     int              `json:"sizeY"`
	SizeZ     int              `json:"sizeZ"`
	Blocks    []BlueprintBlock `json:"blocks"`
	CreatedAt int64            `json:"createdAt"`
}

func MaterialCap(blockType int) int {
	switch {
	case blockType >= 1 && blockType <= 6:
		return 99
	case blockType >= 7 && blockType <= 9:
		return 60
	case blockType == 10:
		return 5
	default:
		return 0
	}
}

func MaterialCaps() map[int]int {
	return map[int]int{
		1:  99,
		2:  99,
		3:  99,
		4:  99,
		5:  99,
		6:  99,
		7:  60,
		8:  60,
		9:  60,
		10: 5,
	}
}

func DefaultStarterInventory() map[int]int {
	return map[int]int{
		1:  20,
		2:  20,
		3:  30,
		4:  15,
		5:  15,
		6:  15,
		7:  10,
		8:  8,
		9:  15,
		10: 1,
	}
}

func CloneInventory(src map[int]int) map[int]int {
	out := make(map[int]int, 10)
	for bt := 1; bt <= 10; bt++ {
		if src != nil {
			out[bt] = src[bt]
		} else {
			out[bt] = 0
		}
	}
	return out
}

type Account struct {
	ID                   string              `json:"id"`
	Username             string              `json:"username"`
	DisplayName          string              `json:"displayName"`
	PasswordHash         string              `json:"passwordHash"`
	ColorIdx             int                 `json:"colorIdx"`
	AvatarIdx            int                 `json:"avatarIdx"`
	KOs                  int                 `json:"kos"`
	BlocksPlaced         int                 `json:"blocksPlaced"`
	BlocksBroken         int                 `json:"blocksBroken"`
	CreatedAt            int64               `json:"createdAt"`
	LastLoginAt          int64               `json:"lastLoginAt"`
	Coins                int                 `json:"coins"`
	Inventory            map[int]int         `json:"inventory"`
	BagCapacity          int                 `json:"bagCapacity"`
	SavedItems           []string            `json:"savedItems"`
	ShieldUntil          int64               `json:"shieldUntil"`
	TeleportCards        int                 `json:"teleportCards"`
	TeleportInit         bool                `json:"teleportInit"`
	Blueprints           []Blueprint         `json:"blueprints"`
	MapMarkers           []MapMarker         `json:"mapMarkers"`
	CustomAvatars        []SavedCustomAvatar `json:"customAvatars"`
	ActiveCustomAvatarID string              `json:"activeCustomAvatarId"`
	EconomyInit          bool                `json:"economyInit"`
}

func ensureAccountDefaults(a *Account) {
	if !a.EconomyInit {
		a.Coins = InitialCoins
		a.Inventory = DefaultStarterInventory()
		a.BagCapacity = 0
		a.SavedItems = []string{}
		a.ShieldUntil = 0
		a.TeleportCards = InitialTeleportCards
		a.TeleportInit = true
		a.Blueprints = []Blueprint{}
		a.MapMarkers = []MapMarker{}
		a.CustomAvatars = []SavedCustomAvatar{}
		a.EconomyInit = true
		return
	}
	if !a.TeleportInit {
		if a.TeleportCards < InitialTeleportCards {
			a.TeleportCards = InitialTeleportCards
		}
		a.TeleportInit = true
	}
	if a.Coins < 0 {
		a.Coins = 0
	}
	if a.Inventory == nil {
		a.Inventory = DefaultStarterInventory()
	} else {
		for bt := 1; bt <= 10; bt++ {
			if a.Inventory[bt] < 0 {
				a.Inventory[bt] = 0
			}
		}
	}
	if a.BagCapacity < 0 {
		a.BagCapacity = 0
	}
	if a.BagCapacity > MaxBagCapacity {
		a.BagCapacity = MaxBagCapacity
	}
	if a.TeleportCards < 0 {
		a.TeleportCards = 0
	}
	if a.TeleportCards > MaxTeleportCards {
		a.TeleportCards = MaxTeleportCards
	}
	if a.SavedItems == nil {
		a.SavedItems = []string{}
	}
	if a.Blueprints == nil {
		a.Blueprints = []Blueprint{}
	}
	if a.MapMarkers == nil {
		a.MapMarkers = []MapMarker{}
	}
	if a.CustomAvatars == nil {
		a.CustomAvatars = []SavedCustomAvatar{}
	}
}

type PublicAccount struct {
	ID                   string `json:"id"`
	Username             string `json:"username"`
	DisplayName          string `json:"displayName"`
	ColorIdx             int    `json:"colorIdx"`
	AvatarIdx            int    `json:"avatarIdx"`
	KOs                  int    `json:"kos"`
	BlocksPlaced         int    `json:"blocksPlaced"`
	BlocksBroken         int    `json:"blocksBroken"`
	Coins                int    `json:"coins"`
	BagCapacity          int    `json:"bagCapacity"`
	ShieldUntil          int64  `json:"shieldUntil"`
	TeleportCards        int    `json:"teleportCards"`
	ActiveCustomAvatarID string `json:"activeCustomAvatarId,omitempty"`
	CreatedAt            int64  `json:"createdAt"`
}

func (a *Account) Public() PublicAccount {
	return PublicAccount{
		ID:                   a.ID,
		Username:             a.Username,
		DisplayName:          a.DisplayName,
		ColorIdx:             a.ColorIdx,
		AvatarIdx:            a.AvatarIdx,
		KOs:                  a.KOs,
		BlocksPlaced:         a.BlocksPlaced,
		BlocksBroken:         a.BlocksBroken,
		Coins:                a.Coins,
		BagCapacity:          a.BagCapacity,
		ShieldUntil:          a.ShieldUntil,
		TeleportCards:        a.TeleportCards,
		ActiveCustomAvatarID: a.ActiveCustomAvatarID,
		CreatedAt:            a.CreatedAt,
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
	migrated := false
	for _, a := range list {
		if a == nil || a.ID == "" || a.Username == "" {
			continue
		}
		if !a.EconomyInit || !a.TeleportInit {
			migrated = true
		}
		ensureAccountDefaults(a)
		s.byID[a.ID] = a
		s.byLowerName[strings.ToLower(a.Username)] = a
	}
	if migrated {
		_ = s.saveLocked()
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
		ID:            randomID(),
		Username:      u,
		DisplayName:   dn,
		PasswordHash:  string(hash),
		ColorIdx:      ((colorIdx % 8) + 8) % 8,
		AvatarIdx:     ((avatarIdx % 9) + 9) % 9,
		CreatedAt:     now,
		LastLoginAt:   now,
		Coins:         InitialCoins,
		Inventory:     DefaultStarterInventory(),
		BagCapacity:   0,
		SavedItems:    []string{},
		ShieldUntil:   0,
		TeleportCards: InitialTeleportCards,
		TeleportInit:  true,
		Blueprints:    []Blueprint{},
		MapMarkers:    []MapMarker{},
		CustomAvatars: []SavedCustomAvatar{},
		EconomyInit:   true,
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
	ensureAccountDefaults(acc)
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

// OnBlockPlaced records block placement and deducts 1 from inventory if in stock.
func (s *Store) OnBlockPlaced(id string, blockType int) {
	if id == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	acc, ok := s.byID[id]
	if !ok {
		return
	}
	ensureAccountDefaults(acc)
	acc.BlocksPlaced++
	if blockType >= 1 && blockType <= 10 && acc.Inventory[blockType] > 0 {
		acc.Inventory[blockType]--
	}
	_ = s.saveLocked()
}

// OnBlockBroken records block break and returns 1 block of the broken type to inventory up to cap.
func (s *Store) OnBlockBroken(id string, brokenBlockType int) {
	if id == "" {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	acc, ok := s.byID[id]
	if !ok {
		return
	}
	ensureAccountDefaults(acc)
	acc.BlocksBroken++
	if capLimit := MaterialCap(brokenBlockType); capLimit > 0 {
		if acc.Inventory[brokenBlockType] < capLimit {
			acc.Inventory[brokenBlockType]++
		}
	}
	_ = s.saveLocked()
}

// GetShieldInfo returns an account's shield expiration timestamp and display name.
func (s *Store) GetShieldInfo(accountID string) (int64, string) {
	if accountID == "" {
		return 0, ""
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	acc, ok := s.byID[accountID]
	if !ok {
		return 0, ""
	}
	return acc.ShieldUntil, acc.DisplayName
}

// ReadAccount executes fn under a read lock for the given account ID.
func (s *Store) ReadAccount(accountID string, fn func(acc *Account)) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	acc, ok := s.byID[accountID]
	if !ok {
		return false
	}
	fn(acc)
	return true
}

// WithAccount executes fn under a write lock and persists changes if fn returns nil.
func (s *Store) WithAccount(accountID string, fn func(acc *Account) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	acc, ok := s.byID[accountID]
	if !ok {
		return ErrAccountNotFound
	}
	ensureAccountDefaults(acc)
	if err := fn(acc); err != nil {
		return err
	}
	return s.saveLocked()
}

// WithTwoAccounts atomically locks and updates two accounts (b may be nil if deleted).
func (s *Store) WithTwoAccounts(idA, idB string, fn func(a, b *Account) error) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	accA, ok := s.byID[idA]
	if !ok {
		return ErrAccountNotFound
	}
	ensureAccountDefaults(accA)
	var accB *Account
	if idB != "" && idB != idA {
		if b, exists := s.byID[idB]; exists {
			ensureAccountDefaults(b)
			accB = b
		}
	}
	if err := fn(accA, accB); err != nil {
		return err
	}
	return s.saveLocked()
}

func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.byID)
}

func randomIDPrefix(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

func truncateRunes(s string, max int) string {
	if utf8.RuneCountInString(s) > max {
		return string([]rune(s)[:max])
	}
	return s
}

func sanitizeSkinField(s string, maxLen int) string {
	t := strings.TrimSpace(s)
	return truncateRunes(t, maxLen)
}

// ── World Map Markers ──

func (s *Store) GetMapMarkers(accountID string) []MapMarker {
	if accountID == "" {
		return []MapMarker{}
	}
	out := []MapMarker{}
	s.ReadAccount(accountID, func(acc *Account) {
		out = make([]MapMarker, len(acc.MapMarkers))
		copy(out, acc.MapMarkers)
	})
	return out
}

func (s *Store) AddMapMarker(accountID, name string, wx, wy, ws float64, color string) (MapMarker, []MapMarker, error) {
	if math.IsNaN(wx) || math.IsInf(wx, 0) || math.IsNaN(wy) || math.IsInf(wy, 0) || math.IsNaN(ws) || math.IsInf(ws, 0) {
		return MapMarker{}, nil, ErrInvalidMarker
	}
	nm := strings.TrimSpace(name)
	if nm == "" {
		nm = "标记点"
	}
	nm = truncateRunes(nm, 24)
	col := strings.TrimSpace(color)
	if col == "" {
		col = "#38bdf8"
	}
	col = truncateRunes(col, 24)

	marker := MapMarker{
		ID:        randomIDPrefix("mk_"),
		Name:      nm,
		WX:        wx,
		WY:        wy,
		WS:        ws,
		Color:     col,
		CreatedAt: time.Now().Unix(),
	}

	var all []MapMarker
	err := s.WithAccount(accountID, func(acc *Account) error {
		if len(acc.MapMarkers) >= MaxMapMarkers {
			return ErrTooManyMarkers
		}
		acc.MapMarkers = append(acc.MapMarkers, marker)
		all = make([]MapMarker, len(acc.MapMarkers))
		copy(all, acc.MapMarkers)
		return nil
	})
	return marker, all, err
}

func (s *Store) DeleteMapMarker(accountID, markerID string) ([]MapMarker, error) {
	id := strings.TrimSpace(markerID)
	if id == "" {
		return nil, ErrMarkerNotFound
	}
	var all []MapMarker
	err := s.WithAccount(accountID, func(acc *Account) error {
		idx := -1
		for i, m := range acc.MapMarkers {
			if m.ID == id {
				idx = i
				break
			}
		}
		if idx < 0 {
			return ErrMarkerNotFound
		}
		acc.MapMarkers = append(acc.MapMarkers[:idx], acc.MapMarkers[idx+1:]...)
		all = make([]MapMarker, len(acc.MapMarkers))
		copy(all, acc.MapMarkers)
		return nil
	})
	return all, err
}

// ── Custom Saved Avatars ──

func (s *Store) GetCustomAvatars(accountID string) ([]SavedCustomAvatar, string) {
	if accountID == "" {
		return []SavedCustomAvatar{}, ""
	}
	out := []SavedCustomAvatar{}
	activeID := ""
	s.ReadAccount(accountID, func(acc *Account) {
		out = make([]SavedCustomAvatar, len(acc.CustomAvatars))
		copy(out, acc.CustomAvatars)
		activeID = acc.ActiveCustomAvatarID
	})
	return out, activeID
}

func (s *Store) SaveCustomAvatar(
	accountID, name, prompt, portraitDataURL string,
	skin CustomAvatarSkin,
) (SavedCustomAvatar, []SavedCustomAvatar, string, error) {
	if len(portraitDataURL) > MaxPortraitDataURLLen {
		return SavedCustomAvatar{}, nil, "", ErrAvatarPortraitTooBig
	}
	nm := strings.TrimSpace(name)
	if nm == "" {
		nm = "自定义车手"
	}
	nm = truncateRunes(nm, 24)
	pr := truncateRunes(strings.TrimSpace(prompt), 300)

	cleanSkin := CustomAvatarSkin{
		Head:        sanitizeSkinField(skin.Head, 32),
		Face:        sanitizeSkinField(skin.Face, 32),
		Hair:        sanitizeSkinField(skin.Hair, 32),
		Jacket:      sanitizeSkinField(skin.Jacket, 32),
		Stripe:      sanitizeSkinField(skin.Stripe, 32),
		Pants:       sanitizeSkinField(skin.Pants, 32),
		Boots:       sanitizeSkinField(skin.Boots, 32),
		BikePrimary: sanitizeSkinField(skin.BikePrimary, 32),
		BikeAccent:  sanitizeSkinField(skin.BikeAccent, 32),
		Visor:       sanitizeSkinField(skin.Visor, 32),
		Accessory:   sanitizeSkinField(skin.Accessory, 32),
	}

	av := SavedCustomAvatar{
		ID:              randomIDPrefix("av_"),
		Name:            nm,
		Prompt:          pr,
		PortraitDataUrl: strings.TrimSpace(portraitDataURL),
		Skin:            cleanSkin,
		CreatedAt:       time.Now().Unix(),
	}

	var all []SavedCustomAvatar
	var activeID string
	err := s.WithAccount(accountID, func(acc *Account) error {
		if len(acc.CustomAvatars) >= MaxCustomAvatars {
			return ErrTooManyAvatars
		}
		acc.CustomAvatars = append(acc.CustomAvatars, av)
		all = make([]SavedCustomAvatar, len(acc.CustomAvatars))
		copy(all, acc.CustomAvatars)
		activeID = acc.ActiveCustomAvatarID
		return nil
	})
	return av, all, activeID, err
}

func (s *Store) SetActiveCustomAvatar(accountID, avatarID string) (string, error) {
	id := strings.TrimSpace(avatarID)
	var activeID string
	err := s.WithAccount(accountID, func(acc *Account) error {
		if id == "" {
			acc.ActiveCustomAvatarID = ""
			activeID = ""
			return nil
		}
		found := false
		for _, av := range acc.CustomAvatars {
			if av.ID == id {
				found = true
				break
			}
		}
		if !found {
			return ErrAvatarNotFound
		}
		acc.ActiveCustomAvatarID = id
		activeID = id
		return nil
	})
	return activeID, err
}

func (s *Store) DeleteCustomAvatar(accountID, avatarID string) ([]SavedCustomAvatar, string, error) {
	id := strings.TrimSpace(avatarID)
	if id == "" {
		return nil, "", ErrAvatarNotFound
	}
	var all []SavedCustomAvatar
	var activeID string
	err := s.WithAccount(accountID, func(acc *Account) error {
		idx := -1
		for i, av := range acc.CustomAvatars {
			if av.ID == id {
				idx = i
				break
			}
		}
		if idx < 0 {
			return ErrAvatarNotFound
		}
		acc.CustomAvatars = append(acc.CustomAvatars[:idx], acc.CustomAvatars[idx+1:]...)
		if acc.ActiveCustomAvatarID == id {
			acc.ActiveCustomAvatarID = ""
		}
		all = make([]SavedCustomAvatar, len(acc.CustomAvatars))
		copy(all, acc.CustomAvatars)
		activeID = acc.ActiveCustomAvatarID
		return nil
	})
	return all, activeID, err
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
