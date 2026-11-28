package intruders

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"vibe-moto-server/internal/world"
)

const MaxRecordsPerOwner = 100

type Record struct {
	ID                string `json:"id"`
	Room              string `json:"room"`
	OwnerID           string `json:"ownerId"`
	IntruderAccountID string `json:"intruderAccountId,omitempty"`
	IntruderClientID  string `json:"intruderClientId,omitempty"`
	IntruderName      string `json:"intruderName"`
	GX                int    `json:"gx"`
	GY                int    `json:"gy"`
	GZ                int    `json:"gz"`
	BlockType         int    `json:"blockType"`
	Action            string `json:"action"` // "break" | "overwrite"
	CreatedAt         int64  `json:"createdAt"`
}

type EnrichedRecord struct {
	Record
	BuildingName string   `json:"buildingName,omitempty"`
	LiveWX       *float64 `json:"liveWx,omitempty"`
	LiveWY       *float64 `json:"liveWy,omitempty"`
	LiveWS       *float64 `json:"liveWs,omitempty"`
	Online       bool     `json:"online"`
	LastSeen     int64    `json:"lastSeen,omitempty"`
}

type Store struct {
	mu       sync.RWMutex
	dataPath string
	byOwner  map[string][]Record
}

func NewStore(dataDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{
		dataPath: filepath.Join(dataDir, "intruders.json"),
		byOwner:  make(map[string][]Record),
	}
	_ = s.load()
	return s, nil
}

func randomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return "intr_" + hex.EncodeToString(b)
}

func (s *Store) load() error {
	raw, err := os.ReadFile(s.dataPath)
	if err != nil {
		return err
	}
	var list []Record
	if err := json.Unmarshal(raw, &list); err != nil {
		return err
	}
	for _, rec := range list {
		if rec.ID == "" || rec.OwnerID == "" {
			continue
		}
		rec.Room = world.SanitizeRoom(rec.Room)
		s.byOwner[rec.OwnerID] = append(s.byOwner[rec.OwnerID], rec)
	}
	for ownerID, recs := range s.byOwner {
		sortNewestFirst(recs)
		if len(recs) > MaxRecordsPerOwner {
			recs = recs[:MaxRecordsPerOwner]
		}
		s.byOwner[ownerID] = recs
	}
	return nil
}

func sortNewestFirst(recs []Record) {
	sort.SliceStable(recs, func(i, j int) bool {
		if recs[i].CreatedAt == recs[j].CreatedAt {
			return recs[i].ID > recs[j].ID
		}
		return recs[i].CreatedAt > recs[j].CreatedAt
	})
}

func (s *Store) saveLocked() error {
	total := 0
	for _, recs := range s.byOwner {
		total += len(recs)
	}
	all := make([]Record, 0, total)
	for _, recs := range s.byOwner {
		all = append(all, recs...)
	}
	sortNewestFirst(all)

	raw, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.dataPath + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.dataPath)
}

func (s *Store) Add(rec Record) Record {
	if rec.ID == "" {
		rec.ID = randomID()
	}
	rec.Room = world.SanitizeRoom(rec.Room)
	if rec.IntruderName == "" {
		rec.IntruderName = "GUEST"
	}
	if rec.Action != "overwrite" {
		rec.Action = "break"
	}
	if rec.CreatedAt == 0 {
		rec.CreatedAt = time.Now().Unix()
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	recs := append([]Record{rec}, s.byOwner[rec.OwnerID]...)
	if len(recs) > MaxRecordsPerOwner {
		recs = recs[:MaxRecordsPerOwner]
	}
	s.byOwner[rec.OwnerID] = recs
	_ = s.saveLocked()
	return rec
}

func (s *Store) ListByOwner(ownerID, roomFilter string) []Record {
	if ownerID == "" {
		return []Record{}
	}
	filterRoom := strings.TrimSpace(roomFilter)
	if filterRoom != "" {
		filterRoom = world.SanitizeRoom(filterRoom)
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	recs := s.byOwner[ownerID]
	out := make([]Record, 0, len(recs))
	for _, r := range recs {
		if filterRoom != "" && r.Room != filterRoom {
			continue
		}
		out = append(out, r)
	}
	return out
}

func (s *Store) Delete(ownerID, id string) bool {
	if ownerID == "" || strings.TrimSpace(id) == "" {
		return false
	}
	target := strings.TrimSpace(id)
	s.mu.Lock()
	defer s.mu.Unlock()
	recs := s.byOwner[ownerID]
	idx := -1
	for i, r := range recs {
		if r.ID == target {
			idx = i
			break
		}
	}
	if idx < 0 {
		return false
	}
	recs = append(recs[:idx], recs[idx+1:]...)
	if len(recs) == 0 {
		delete(s.byOwner, ownerID)
	} else {
		s.byOwner[ownerID] = recs
	}
	_ = s.saveLocked()
	return true
}
