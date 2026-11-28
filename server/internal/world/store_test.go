package world

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLegacyAndOwnedWorldPersistence(t *testing.T) {
	dir := t.TempDir()
	wDir := filepath.Join(dir, "worlds")
	if err := os.MkdirAll(wDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// Write a legacy 4-element world file
	legacyPath := filepath.Join(wDir, "legacy.json")
	if err := os.WriteFile(legacyPath, []byte(`[[1,2,3,4],[5,6,7,10,"acc_1","Alice"]]`), 0o644); err != nil {
		t.Fatal(err)
	}

	st, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	rw := st.GetRoom("legacy")
	if rw.Count() != 2 {
		t.Fatalf("expected 2 blocks loaded, got %d", rw.Count())
	}

	b1, ok := rw.GetBlock(1, 2, 3)
	if !ok || b1.Type != 4 || b1.OwnerID != "" || b1.OwnerName != "" {
		t.Fatalf("unexpected legacy block: %+v ok=%v", b1, ok)
	}
	b2, ok := rw.GetBlock(5, 6, 7)
	if !ok || b2.Type != 10 || b2.OwnerID != "acc_1" || b2.OwnerName != "Alice" {
		t.Fatalf("unexpected owned terminal block: %+v ok=%v", b2, ok)
	}

	// Place another block with owner and flush -> verify 6-element JSON array format
	changed, _, _, rej := rw.SetBlockChecked(9, 10, 11, 10, "acc_2", "Bob", nil)
	if !changed || rej != nil {
		t.Fatalf("expected block set to succeed: changed=%v rej=%+v", changed, rej)
	}
	if err := rw.Flush(); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(legacyPath)
	if err != nil {
		t.Fatal(err)
	}
	var parsed [][]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("unmarshal flushed world: %v", err)
	}
	if len(parsed) != 3 {
		t.Fatalf("expected 3 flushed blocks, got %d", len(parsed))
	}
	for _, tuple := range parsed {
		if len(tuple) != 6 {
			t.Fatalf("expected 6-element tuple, got %d: %+v", len(tuple), tuple)
		}
	}

	if BlockTypeToMCStateID(10) == 0 {
		t.Fatalf("expected non-air MC state ID for block type 10")
	}
}

func TestShieldEnforcement(t *testing.T) {
	dir := t.TempDir()
	st, err := NewStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	rw := st.GetRoom("shieldtest")
	rw.ClearAll()

	shieldedUntil := time.Now().Unix() + 600
	lookup := func(ownerID string) (int64, string) {
		if ownerID == "acc_owner" {
			return shieldedUntil, "OwnerName"
		}
		return 0, ""
	}

	ok, _, _, rej := rw.SetBlockChecked(10, 5, 20, 10, "acc_owner", "OwnerName", lookup)
	if !ok || rej != nil {
		t.Fatalf("owner placement failed: ok=%v rej=%+v", ok, rej)
	}

	// Another user trying to overwrite -> rejected
	ok, _, _, rej = rw.SetBlockChecked(10, 5, 20, 2, "acc_other", "Intruder", lookup)
	if ok || rej == nil || rej.OwnerName != "OwnerName" || rej.RemainingSec <= 0 {
		t.Fatalf("expected set rejection, got ok=%v rej=%+v", ok, rej)
	}

	// Guest trying to delete -> rejected
	ok, _, rej = rw.DeleteBlockChecked(10, 5, 20, "", lookup)
	if ok || rej == nil {
		t.Fatalf("expected guest delete rejection, got ok=%v rej=%+v", ok, rej)
	}

	// Another user trying to clear -> rejected
	removed, rej := rw.ClearAllChecked("acc_other", lookup)
	if removed != 0 || rej == nil {
		t.Fatalf("expected clear rejection, got removed=%d rej=%+v", removed, rej)
	}

	// Owner can modify & delete their own shielded block
	ok, _, _, rej = rw.SetBlockChecked(10, 5, 20, 8, "acc_owner", "OwnerName", lookup)
	if !ok || rej != nil {
		t.Fatalf("owner overwrite should succeed: ok=%v rej=%+v", ok, rej)
	}
	ok, prev, rej := rw.DeleteBlockChecked(10, 5, 20, "acc_owner", lookup)
	if !ok || prev.Type != 8 || rej != nil {
		t.Fatalf("owner delete should succeed: ok=%v prev=%+v rej=%+v", ok, prev, rej)
	}
}
