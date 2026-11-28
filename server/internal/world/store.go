package world

import (
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

const (
	TrackLength  = 2400
	MinGY        = -64
	MaxGY        = 256
	MinBlockType = 1
	MaxBlockType = 10
)

type BlockKey struct {
	GX int
	GY int
	GZ int
}

type BlockData struct {
	Type      int
	OwnerID   string
	OwnerName string
}

type Block struct {
	GX        int    `json:"gx"`
	GY        int    `json:"gy"`
	GZ        int    `json:"gz"`
	Type      int    `json:"b"`
	OwnerID   string `json:"ownerId,omitempty"`
	OwnerName string `json:"ownerName,omitempty"`
}

// CompactBlock marshals to a 6-element JSON array [gx, gy, gz, b, ownerId, ownerName]
// and unmarshals both legacy 4-element [gx, gy, gz, b] and 6-element arrays.
type CompactBlock struct {
	GX        int
	GY        int
	GZ        int
	Type      int
	OwnerID   string
	OwnerName string
}

func (c CompactBlock) MarshalJSON() ([]byte, error) {
	return json.Marshal([6]any{c.GX, c.GY, c.GZ, c.Type, c.OwnerID, c.OwnerName})
}

func (c *CompactBlock) UnmarshalJSON(data []byte) error {
	var parts []json.RawMessage
	if err := json.Unmarshal(data, &parts); err != nil {
		return err
	}
	if len(parts) < 4 {
		return errors.New("compact block requires at least 4 elements")
	}
	if err := json.Unmarshal(parts[0], &c.GX); err != nil {
		return err
	}
	if err := json.Unmarshal(parts[1], &c.GY); err != nil {
		return err
	}
	if err := json.Unmarshal(parts[2], &c.GZ); err != nil {
		return err
	}
	if err := json.Unmarshal(parts[3], &c.Type); err != nil {
		return err
	}
	c.OwnerID = ""
	c.OwnerName = ""
	if len(parts) >= 5 {
		_ = json.Unmarshal(parts[4], &c.OwnerID)
	}
	if len(parts) >= 6 {
		_ = json.Unmarshal(parts[5], &c.OwnerName)
	}
	return nil
}

// ShieldLookup resolves an owner's shield expiration timestamp (unix seconds) and current display name.
type ShieldLookup func(ownerID string) (shieldUntil int64, ownerName string)

type ShieldRejection struct {
	OwnerID      string
	OwnerName    string
	RemainingSec int64
}

type RoomWorld struct {
	mu     sync.RWMutex
	slug   string
	path   string
	blocks map[BlockKey]BlockData
	dirty  bool
}

type Store struct {
	mu    sync.RWMutex
	dir   string
	rooms map[string]*RoomWorld
}

var safeSlugRe = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

func SanitizeRoom(raw string) string {
	s := safeSlugRe.ReplaceAllString(raw, "")
	if len(s) > 32 {
		s = s[:32]
	}
	if s == "" {
		return "global"
	}
	return s
}

func WrapGZ(gz int) int {
	m := gz % TrackLength
	if m < 0 {
		m += TrackLength
	}
	return m
}

func roadXApprox(s float64) float64 {
	twoPiL := (math.Pi * 2.0) / float64(TrackLength)
	return 38.0*math.Sin(s*2*twoPiL) +
		22.0*math.Sin(s*5*twoPiL+1.35) +
		9.5*math.Cos(s*9*twoPiL-0.5)
}

func roadYApprox(s float64) float64 {
	twoPiL := (math.Pi * 2.0) / float64(TrackLength)
	return 8.5*math.Sin(s*2*twoPiL+0.4) +
		4.0*math.Sin(s*5*twoPiL) +
		1.6*math.Cos(s*10*twoPiL)
}

func NewStore(dataDir string) (*Store, error) {
	wDir := filepath.Join(dataDir, "worlds")
	if err := os.MkdirAll(wDir, 0o755); err != nil {
		return nil, err
	}
	st := &Store{
		dir:   wDir,
		rooms: make(map[string]*RoomWorld),
	}
	// Preload global world
	st.GetRoom("global")
	go st.flushLoop()
	return st, nil
}

func (s *Store) flushLoop() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		s.FlushAll()
	}
}

func (s *Store) FlushAll() {
	s.mu.RLock()
	list := make([]*RoomWorld, 0, len(s.rooms))
	for _, rw := range s.rooms {
		list = append(list, rw)
	}
	s.mu.RUnlock()

	for _, rw := range list {
		_ = rw.Flush()
	}
}

func (s *Store) GetRoom(rawSlug string) *RoomWorld {
	slug := SanitizeRoom(rawSlug)
	s.mu.RLock()
	rw, ok := s.rooms[slug]
	s.mu.RUnlock()
	if ok {
		return rw
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if rw, ok := s.rooms[slug]; ok {
		return rw
	}

	rw = &RoomWorld{
		slug:   slug,
		path:   filepath.Join(s.dir, slug+".json"),
		blocks: make(map[BlockKey]BlockData, 256),
	}
	if !rw.load() {
		rw.seedStarterOutpost()
		rw.dirty = true
		_ = rw.Flush()
	}
	s.rooms[slug] = rw
	return rw
}

func (s *Store) TotalBlocks() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	total := 0
	for _, rw := range s.rooms {
		total += rw.Count()
	}
	return total
}

func (rw *RoomWorld) load() bool {
	raw, err := os.ReadFile(rw.path)
	if err != nil {
		return false
	}
	var compact []CompactBlock
	if err := json.Unmarshal(raw, &compact); err != nil {
		return false
	}
	for _, item := range compact {
		if item.Type >= MinBlockType && item.Type <= MaxBlockType {
			rw.blocks[BlockKey{GX: item.GX, GY: item.GY, GZ: WrapGZ(item.GZ)}] = BlockData{
				Type:      item.Type,
				OwnerID:   item.OwnerID,
				OwnerName: item.OwnerName,
			}
		}
	}
	return true
}

func (rw *RoomWorld) Flush() error {
	rw.mu.Lock()
	if !rw.dirty {
		rw.mu.Unlock()
		return nil
	}
	compact := make([]CompactBlock, 0, len(rw.blocks))
	for k, b := range rw.blocks {
		compact = append(compact, CompactBlock{
			GX:        k.GX,
			GY:        k.GY,
			GZ:        k.GZ,
			Type:      b.Type,
			OwnerID:   b.OwnerID,
			OwnerName: b.OwnerName,
		})
	}
	rw.dirty = false
	rw.mu.Unlock()

	raw, err := json.Marshal(compact)
	if err != nil {
		return err
	}
	tmp := rw.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, rw.path)
}

func (rw *RoomWorld) seedStarterOutpost() {
	baseS := 44
	baseX := int(math.Floor(roadXApprox(float64(baseS)) + 19))
	baseY := int(math.Floor(roadYApprox(float64(baseS))))

	put := func(gx, gy, gz, bt int) {
		rw.blocks[BlockKey{GX: gx, GY: gy, GZ: WrapGZ(gz)}] = BlockData{Type: bt}
	}

	// 5x5 Stone foundation
	for dx := 0; dx < 5; dx++ {
		for dz := 0; dz < 5; dz++ {
			put(baseX+dx, baseY, baseS+dz, 2)
		}
	}
	// Corner oak log pillars
	for h := 1; h <= 3; h++ {
		put(baseX, baseY+h, baseS, 5)
		put(baseX+4, baseY+h, baseS, 5)
		put(baseX, baseY+h, baseS+4, 5)
		put(baseX+4, baseY+h, baseS+4, 5)
	}
	// Plank walls with glass windows & open doorway
	for dx := 1; dx <= 3; dx++ {
		win := 3
		if dx == 2 {
			win = 7
		}
		put(baseX+dx, baseY+1, baseS, 3)
		put(baseX+dx, baseY+2, baseS, win)
		put(baseX+dx, baseY+3, baseS, 3)
		put(baseX+dx, baseY+1, baseS+4, 3)
		put(baseX+dx, baseY+2, baseS+4, win)
		put(baseX+dx, baseY+3, baseS+4, 3)
	}
	for dz := 1; dz <= 3; dz++ {
		win := 3
		if dz == 2 {
			win = 7
		}
		put(baseX+4, baseY+1, baseS+dz, 3)
		put(baseX+4, baseY+2, baseS+dz, win)
		put(baseX+4, baseY+3, baseS+dz, 3)
		if dz != 2 {
			put(baseX, baseY+1, baseS+dz, 3)
			put(baseX, baseY+2, baseS+dz, 7)
		}
		put(baseX, baseY+3, baseS+dz, 3)
	}
	// Brick roof & neon crown
	for dx := 0; dx < 5; dx++ {
		for dz := 0; dz < 5; dz++ {
			put(baseX+dx, baseY+4, baseS+dz, 4)
		}
	}
	put(baseX, baseY+4, baseS+2, 8)
	put(baseX+2, baseY+5, baseS+2, 8)

	// Voxel tree
	tx, tz := baseX+7, baseS+2
	for h := 0; h < 4; h++ {
		put(tx, baseY+h, tz, 5)
	}
	for lx := -1; lx <= 1; lx++ {
		for lz := -1; lz <= 1; lz++ {
			put(tx+lx, baseY+4, tz+lz, 6)
			if absInt(lx)+absInt(lz) <= 1 {
				put(tx+lx, baseY+5, tz+lz, 6)
			}
		}
	}

	// Stepped asphalt jump ramp
	rampX := baseX - 5
	for step := 0; step < 3; step++ {
		for w := 0; w < 2; w++ {
			for h := 0; h <= step; h++ {
				put(rampX+w, baseY+h, baseS+step, 9)
			}
		}
	}
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func checkShield(existing BlockData, actorID string, now int64, lookup ShieldLookup) *ShieldRejection {
	if lookup == nil || existing.OwnerID == "" || existing.OwnerID == actorID {
		return nil
	}
	shieldUntil, latestName := lookup(existing.OwnerID)
	if shieldUntil > now {
		name := existing.OwnerName
		if latestName != "" {
			name = latestName
		}
		if name == "" {
			name = "OWNER"
		}
		return &ShieldRejection{
			OwnerID:      existing.OwnerID,
			OwnerName:    name,
			RemainingSec: shieldUntil - now,
		}
	}
	return nil
}

func (rw *RoomWorld) GetBlock(gx, gy, gz int) (BlockData, bool) {
	k := BlockKey{GX: gx, GY: gy, GZ: WrapGZ(gz)}
	rw.mu.RLock()
	defer rw.mu.RUnlock()
	b, ok := rw.blocks[k]
	return b, ok
}

func (rw *RoomWorld) SetBlock(gx, gy, gz, blockType int) bool {
	changed, _, _, _ := rw.SetBlockChecked(gx, gy, gz, blockType, "", "", nil)
	return changed
}

func (rw *RoomWorld) SetBlockChecked(
	gx, gy, gz, blockType int,
	actorID, actorName string,
	lookup ShieldLookup,
) (changed bool, prev BlockData, hadPrev bool, rej *ShieldRejection) {
	if gy < MinGY || gy > MaxGY || blockType < MinBlockType || blockType > MaxBlockType {
		return false, BlockData{}, false, nil
	}
	wgz := WrapGZ(gz)
	k := BlockKey{GX: gx, GY: gy, GZ: wgz}
	now := time.Now().Unix()

	rw.mu.Lock()
	defer rw.mu.Unlock()
	prev, hadPrev = rw.blocks[k]
	if hadPrev {
		if r := checkShield(prev, actorID, now, lookup); r != nil {
			return false, prev, true, r
		}
		if prev.Type == blockType && prev.OwnerID == actorID {
			return false, prev, true, nil
		}
	}
	ownerName := actorName
	if actorID == "" {
		ownerName = ""
	}
	rw.blocks[k] = BlockData{
		Type:      blockType,
		OwnerID:   actorID,
		OwnerName: ownerName,
	}
	rw.dirty = true
	return true, prev, hadPrev, nil
}

func (rw *RoomWorld) DeleteBlock(gx, gy, gz int) bool {
	changed, _, _ := rw.DeleteBlockChecked(gx, gy, gz, "", nil)
	return changed
}

func (rw *RoomWorld) DeleteBlockChecked(
	gx, gy, gz int,
	actorID string,
	lookup ShieldLookup,
) (changed bool, prev BlockData, rej *ShieldRejection) {
	k := BlockKey{GX: gx, GY: gy, GZ: WrapGZ(gz)}
	now := time.Now().Unix()

	rw.mu.Lock()
	defer rw.mu.Unlock()
	prev, ok := rw.blocks[k]
	if !ok {
		return false, BlockData{}, nil
	}
	if r := checkShield(prev, actorID, now, lookup); r != nil {
		return false, prev, r
	}
	delete(rw.blocks, k)
	rw.dirty = true
	return true, prev, nil
}

func (rw *RoomWorld) ClearAll() {
	_, _ = rw.ClearAllChecked("", nil)
}

func (rw *RoomWorld) ClearAllChecked(actorID string, lookup ShieldLookup) (removed int, rej *ShieldRejection) {
	now := time.Now().Unix()
	rw.mu.Lock()
	defer rw.mu.Unlock()
	if len(rw.blocks) == 0 {
		return 0, nil
	}
	if lookup != nil {
		for _, b := range rw.blocks {
			if r := checkShield(b, actorID, now, lookup); r != nil {
				return 0, r
			}
		}
	}
	removed = len(rw.blocks)
	clear(rw.blocks)
	rw.dirty = true
	return removed, nil
}

func (rw *RoomWorld) SnapshotCompact() []CompactBlock {
	rw.mu.RLock()
	defer rw.mu.RUnlock()
	out := make([]CompactBlock, 0, len(rw.blocks))
	for k, b := range rw.blocks {
		out = append(out, CompactBlock{
			GX:        k.GX,
			GY:        k.GY,
			GZ:        k.GZ,
			Type:      b.Type,
			OwnerID:   b.OwnerID,
			OwnerName: b.OwnerName,
		})
	}
	return out
}

func (rw *RoomWorld) Count() int {
	rw.mu.RLock()
	defer rw.mu.RUnlock()
	return len(rw.blocks)
}

// Minecraft 1.20.4 Block State IDs mapped cleanly to Vibe Moto's 10 voxel block types
func BlockTypeToMCStateID(bt int) int32 {
	switch bt {
	case 1:
		return 9 // grass_block[snowy=false]
	case 2:
		return 14 // cobblestone
	case 3:
		return 15 // oak_planks
	case 4:
		return 1785 // bricks
	case 5:
		return 117 // oak_log[axis=y]
	case 6:
		return 236 // oak_leaves[persistent=true]
	case 7:
		return 264 // glass
	case 8:
		return 4424 // glowstone
	case 9:
		return 10726 // black_concrete (asphalt)
	case 10:
		return 267 // lapis_block (computer terminal)
	default:
		return 0 // air
	}
}
