package buildings

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"vibe-moto-server/internal/world"
)

const (
	MaxBuildingsPerOwner = 30
	MaxNameRunes         = 20
	MergeRadiusMeters    = 14.0
)

var (
	ErrInvalidName      = errors.New("建筑名称长度需为 1~20 个字符")
	ErrTooManyBuildings = errors.New("命名建筑数量已达上限")
	ErrNotFound         = errors.New("建筑不存在")
	ErrForbidden        = errors.New("只能修改自己的建筑")
)

type NamedBuilding struct {
	ID        string `json:"id"`
	Room      string `json:"room"`
	OwnerID   string `json:"ownerId"`
	OwnerName string `json:"ownerName"`
	Name      string `json:"name"`
	GX        int    `json:"gx"`
	GY        int    `json:"gy"`
	GZ        int    `json:"gz"`
	CreatedAt int64  `json:"createdAt"`
}

type Store struct {
	mu        sync.RWMutex
	path      string
	buildings map[string]*NamedBuilding
}

func NewStore(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{
		path:      filepath.Join(dataDir, "buildings.json"),
		buildings: make(map[string]*NamedBuilding),
	}
	_ = s.load()
	return s, nil
}

func (s *Store) load() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return err
	}
	var list []*NamedBuilding
	if err := json.Unmarshal(raw, &list); err != nil {
		return err
	}
	for _, b := range list {
		if b != nil && b.ID != "" && b.Name != "" {
			b.Room = world.SanitizeRoom(b.Room)
			b.GZ = world.WrapGZ(b.GZ)
			s.buildings[b.ID] = b
		}
	}
	return nil
}

func (s *Store) saveLocked() error {
	list := make([]*NamedBuilding, 0, len(s.buildings))
	for _, b := range s.buildings {
		list = append(list, b)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt > list[j].CreatedAt
	})
	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

func newID() string {
	var buf [6]byte
	_, _ = rand.Read(buf[:])
	return "bld_" + hex.EncodeToString(buf[:])
}

func cyclicDistXZ(ax, az, bx, bz int) float64 {
	dx := float64(ax - bx)
	dz := float64(az - bz)
	half := float64(world.TrackLength) / 2.0
	if dz > half {
		dz -= float64(world.TrackLength)
	} else if dz < -half {
		dz += float64(world.TrackLength)
	}
	return math.Hypot(dx, dz)
}

func (s *Store) ListByRoom(room string) []NamedBuilding {
	slug := world.SanitizeRoom(room)
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]NamedBuilding, 0)
	for _, b := range s.buildings {
		if b.Room == slug {
			out = append(out, *b)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

func (s *Store) FindNearestName(room, ownerID string, gx, gz int, maxDist float64) string {
	slug := world.SanitizeRoom(room)
	s.mu.RLock()
	defer s.mu.RUnlock()
	bestName := ""
	bestDist := maxDist
	for _, b := range s.buildings {
		if b.Room != slug {
			continue
		}
		if ownerID != "" && b.OwnerID != ownerID {
			continue
		}
		d := cyclicDistXZ(b.GX, b.GZ, gx, world.WrapGZ(gz))
		if d <= bestDist {
			bestDist = d
			bestName = b.Name
		}
	}
	return bestName
}

func (s *Store) Upsert(room, ownerID, ownerName, name string, gx, gy, gz int) (NamedBuilding, []NamedBuilding, error) {
	clean := strings.TrimSpace(name)
	if clean == "" || utf8.RuneCountInString(clean) > MaxNameRunes {
		return NamedBuilding{}, nil, ErrInvalidName
	}
	slug := world.SanitizeRoom(room)
	wgz := world.WrapGZ(gz)

	s.mu.Lock()
	defer s.mu.Unlock()

	// If owner already has a named building nearby, rename/update it instead of duplicating
	var existing *NamedBuilding
	ownerCount := 0
	for _, b := range s.buildings {
		if b.OwnerID == ownerID {
			ownerCount++
			if b.Room == slug && cyclicDistXZ(b.GX, b.GZ, gx, wgz) <= MergeRadiusMeters {
				existing = b
			}
		}
	}

	now := time.Now().Unix()
	if existing != nil {
		existing.Name = clean
		existing.OwnerName = ownerName
		existing.GX = gx
		existing.GY = gy
		existing.GZ = wgz
		existing.CreatedAt = now
		_ = s.saveLocked()
		return *existing, s.listLocked(slug), nil
	}

	if ownerCount >= MaxBuildingsPerOwner {
		return NamedBuilding{}, nil, ErrTooManyBuildings
	}

	nb := &NamedBuilding{
		ID:        newID(),
		Room:      slug,
		OwnerID:   ownerID,
		OwnerName: ownerName,
		Name:      clean,
		GX:        gx,
		GY:        gy,
		GZ:        wgz,
		CreatedAt: now,
	}
	s.buildings[nb.ID] = nb
	_ = s.saveLocked()
	return *nb, s.listLocked(slug), nil
}

func (s *Store) Delete(ownerID, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.buildings[id]
	if !ok {
		return ErrNotFound
	}
	if b.OwnerID != ownerID {
		return ErrForbidden
	}
	delete(s.buildings, id)
	_ = s.saveLocked()
	return nil
}

func (s *Store) listLocked(slug string) []NamedBuilding {
	out := make([]NamedBuilding, 0)
	for _, b := range s.buildings {
		if b.Room == slug {
			out = append(out, *b)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}
