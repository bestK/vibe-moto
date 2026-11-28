package economy

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"vibe-moto-server/internal/auth"
)

const (
	MaxListingsPerSeller = 20
	MaxBlueprintsPerUser = 30
	MaxBlueprintBlocks   = 500
)

var (
	ErrInvalidItem       = errors.New("无效的商品或道具")
	ErrInsufficientCoins = errors.New("金币不足")
	ErrInsufficientStock = errors.New("材料库存不足")
	ErrCapExceeded       = errors.New("已达该材料携带上限")
	ErrBagNotOwned       = errors.New("请先在世界商店购买道具道路袋")
	ErrBagFull           = errors.New("道具道路袋已满")
	ErrBagMaxed          = errors.New("道具道路袋已达最大容量")
	ErrInvalidBagSlot    = errors.New("无效的道具槽位")
	ErrInvalidReward     = errors.New("无效的奖励类型")
	ErrListingNotFound   = errors.New("该商品不存在或已被买走")
	ErrOwnListing        = errors.New("不能购买自己挂售的商品，请直接下架")
	ErrForbidden         = errors.New("无权操作他人数据")
	ErrTooManyListings   = errors.New("挂售数量已达上限")
	ErrInvalidListing    = errors.New("挂售参数无效")
	ErrInvalidBlueprint  = errors.New("蓝图数据无效")
	ErrTooManyBlueprints = errors.New("蓝图数量已达上限 (30)")
	ErrBlueprintNotFound = errors.New("蓝图不存在")
)

var allowedBagItems = map[string]bool{
	"rpg":       true,
	"airstrike": true,
	"sniper":    true,
	"police":    true,
	"turbo":     true,
	"trap":      true,
	"magnet":    true,
	"banana":    true,
}

type ShopItemSpec struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"` // "block" | "bag" | "shield"
	BlockType   int    `json:"blockType,omitempty"`
	Qty         int    `json:"qty,omitempty"`
	Price       int    `json:"price"`
	ZhName      string `json:"zhName"`
	EnName      string `json:"enName"`
	DurationSec int64  `json:"durationSec,omitempty"`
}

type EconomyState struct {
	Coins       int            `json:"coins"`
	Inventory   map[int]int    `json:"inventory"`
	Caps        map[int]int    `json:"caps"`
	BagCapacity int            `json:"bagCapacity"`
	SavedItems  []string       `json:"savedItems"`
	ShieldUntil int64          `json:"shieldUntil"`
	Shop        []ShopItemSpec `json:"shop"`
}

type BlockReward struct {
	B   int `json:"b"`
	Qty int `json:"qty"`
}

type MarketListing struct {
	ID         string `json:"id"`
	SellerID   string `json:"sellerId"`
	SellerName string `json:"sellerName"`
	BlockType  int    `json:"blockType"`
	Qty        int    `json:"qty"`
	PriceCoins int    `json:"priceCoins"`
	CreatedAt  int64  `json:"createdAt"`
}

var shopCatalog = []ShopItemSpec{
	{ID: "block_1", Kind: "block", BlockType: 1, Qty: 1, Price: 6, ZhName: "草方块", EnName: "Grass Block"},
	{ID: "block_2", Kind: "block", BlockType: 2, Qty: 1, Price: 8, ZhName: "圆石", EnName: "Cobblestone"},
	{ID: "block_3", Kind: "block", BlockType: 3, Qty: 1, Price: 8, ZhName: "橡木板", EnName: "Oak Planks"},
	{ID: "block_4", Kind: "block", BlockType: 4, Qty: 1, Price: 10, ZhName: "红砖", EnName: "Bricks"},
	{ID: "block_5", Kind: "block", BlockType: 5, Qty: 1, Price: 10, ZhName: "橡木原木", EnName: "Oak Log"},
	{ID: "block_6", Kind: "block", BlockType: 6, Qty: 1, Price: 6, ZhName: "树叶", EnName: "Oak Leaves"},
	{ID: "block_7", Kind: "block", BlockType: 7, Qty: 1, Price: 14, ZhName: "玻璃", EnName: "Glass"},
	{ID: "block_8", Kind: "block", BlockType: 8, Qty: 1, Price: 22, ZhName: "霓虹灯块", EnName: "Neon Lamp"},
	{ID: "block_9", Kind: "block", BlockType: 9, Qty: 1, Price: 12, ZhName: "赛道沥青", EnName: "Asphalt"},
	{ID: "block_10", Kind: "block", BlockType: 10, Qty: 1, Price: 180, ZhName: "电脑终端", EnName: "Computer Terminal"},
	{ID: "item_bag", Kind: "bag", Qty: 3, Price: 300, ZhName: "道具道路袋 (+3格)", EnName: "Item Bag (+3 Slots)"},
	{ID: "shield_10m", Kind: "shield", Price: 250, ZhName: "建筑防护盾 (+10分钟)", EnName: "Build Shield (+10m)", DurationSec: 600},
	{ID: "shield_30m", Kind: "shield", Price: 600, ZhName: "建筑防护盾 (+30分钟)", EnName: "Build Shield (+30m)", DurationSec: 1800},
}

func ShopCatalog() []ShopItemSpec {
	out := make([]ShopItemSpec, len(shopCatalog))
	copy(out, shopCatalog)
	return out
}

func findShopItem(id string) (ShopItemSpec, bool) {
	for _, it := range shopCatalog {
		if it.ID == id {
			return it, true
		}
	}
	return ShopItemSpec{}, false
}

func GuestDefaultState() EconomyState {
	return EconomyState{
		Coins:       auth.InitialCoins,
		Inventory:   auth.DefaultStarterInventory(),
		Caps:        auth.MaterialCaps(),
		BagCapacity: 0,
		SavedItems:  []string{},
		ShieldUntil: 0,
		Shop:        ShopCatalog(),
	}
}

func stateFromAccount(acc *auth.Account) EconomyState {
	saved := make([]string, len(acc.SavedItems))
	copy(saved, acc.SavedItems)
	return EconomyState{
		Coins:       acc.Coins,
		Inventory:   auth.CloneInventory(acc.Inventory),
		Caps:        auth.MaterialCaps(),
		BagCapacity: acc.BagCapacity,
		SavedItems:  saved,
		ShieldUntil: acc.ShieldUntil,
		Shop:        ShopCatalog(),
	}
}

type Store struct {
	mu         sync.RWMutex
	accounts   *auth.Store
	marketPath string
	listings   map[string]*MarketListing
}

func NewStore(dataDir string, accounts *auth.Store) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	s := &Store{
		accounts:   accounts,
		marketPath: filepath.Join(dataDir, "market.json"),
		listings:   make(map[string]*MarketListing),
	}
	_ = s.loadMarket()
	return s, nil
}

func (s *Store) loadMarket() error {
	raw, err := os.ReadFile(s.marketPath)
	if err != nil {
		return err
	}
	var list []*MarketListing
	if err := json.Unmarshal(raw, &list); err != nil {
		return err
	}
	for _, item := range list {
		if item == nil || item.ID == "" || item.BlockType < 1 || item.BlockType > 10 || item.Qty <= 0 || item.PriceCoins <= 0 {
			continue
		}
		s.listings[item.ID] = item
	}
	return nil
}

func (s *Store) saveMarketLocked() error {
	list := make([]*MarketListing, 0, len(s.listings))
	for _, item := range s.listings {
		list = append(list, item)
	}
	sort.Slice(list, func(i, j int) bool {
		return list[i].CreatedAt > list[j].CreatedAt
	})
	raw, err := json.MarshalIndent(list, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.marketPath + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.marketPath)
}

func randomID(prefix string) string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return prefix + hex.EncodeToString(b)
}

func (s *Store) GetState(accountID string) (EconomyState, bool) {
	if accountID == "" {
		return GuestDefaultState(), false
	}
	var st EconomyState
	ok := s.accounts.ReadAccount(accountID, func(acc *auth.Account) {
		st = stateFromAccount(acc)
	})
	if !ok {
		return GuestDefaultState(), false
	}
	return st, true
}

func (s *Store) ClaimReward(accountID, kind string, amount *int, blockRewards []BlockReward) (EconomyState, int, []BlockReward, error) {
	k := strings.ToLower(strings.TrimSpace(kind))
	var defaultCoins, maxCoins int
	switch k {
	case "lap":
		defaultCoins, maxCoins = 120, 250
	case "ko":
		defaultCoins, maxCoins = 50, 120
	case "nearmiss":
		defaultCoins, maxCoins = 15, 40
	case "harvest":
		defaultCoins, maxCoins = 15, 60
	case "race":
		defaultCoins, maxCoins = 150, 300
	default:
		return EconomyState{}, 0, nil, ErrInvalidReward
	}

	coins := defaultCoins
	if amount != nil {
		coins = *amount
		if coins < 0 {
			coins = 0
		}
		if coins > maxCoins {
			coins = maxCoins
		}
	}

	var st EconomyState
	grantedBlocks := make([]BlockReward, 0, len(blockRewards))

	err := s.accounts.WithAccount(accountID, func(acc *auth.Account) error {
		acc.Coins += coins
		if k == "ko" {
			acc.KOs++
		}
		totalBlocksAdded := 0
		for _, br := range blockRewards {
			if totalBlocksAdded >= 20 {
				break
			}
			capLimit := auth.MaterialCap(br.B)
			if capLimit <= 0 || br.Qty <= 0 {
				continue
			}
			qty := br.Qty
			if qty > 10 {
				qty = 10
			}
			if totalBlocksAdded+qty > 20 {
				qty = 20 - totalBlocksAdded
			}
			cur := acc.Inventory[br.B]
			room := capLimit - cur
			if room <= 0 {
				continue
			}
			if qty > room {
				qty = room
			}
			acc.Inventory[br.B] = cur + qty
			totalBlocksAdded += qty
			grantedBlocks = append(grantedBlocks, BlockReward{B: br.B, Qty: qty})
		}
		st = stateFromAccount(acc)
		return nil
	})
	if err != nil {
		return EconomyState{}, 0, nil, err
	}
	return st, coins, grantedBlocks, nil
}

func (s *Store) BuyShopItem(accountID, itemID string, qty int) (EconomyState, error) {
	spec, ok := findShopItem(strings.TrimSpace(itemID))
	if !ok {
		return EconomyState{}, ErrInvalidItem
	}
	if qty <= 0 {
		qty = 1
	}
	if qty > 99 {
		qty = 99
	}

	var st EconomyState
	err := s.accounts.WithAccount(accountID, func(acc *auth.Account) error {
		cost := spec.Price * qty
		if acc.Coins < cost {
			return ErrInsufficientCoins
		}
		switch spec.Kind {
		case "block":
			capLimit := auth.MaterialCap(spec.BlockType)
			addQty := qty
			if spec.Qty > 1 {
				addQty = qty * spec.Qty
			}
			if acc.Inventory[spec.BlockType]+addQty > capLimit {
				return ErrCapExceeded
			}
			acc.Coins -= cost
			acc.Inventory[spec.BlockType] += addQty

		case "bag":
			if acc.BagCapacity >= auth.MaxBagCapacity {
				return ErrBagMaxed
			}
			addSlots := qty * spec.Qty
			if acc.BagCapacity+addSlots > auth.MaxBagCapacity {
				return ErrBagMaxed
			}
			acc.Coins -= cost
			acc.BagCapacity += addSlots

		case "shield":
			now := time.Now().Unix()
			base := acc.ShieldUntil
			if base < now {
				base = now
			}
			acc.Coins -= cost
			acc.ShieldUntil = base + int64(qty)*spec.DurationSec

		default:
			return ErrInvalidItem
		}
		st = stateFromAccount(acc)
		return nil
	})
	return st, err
}

func (s *Store) StashBagItem(accountID, rawItem string) (EconomyState, error) {
	item := strings.ToLower(strings.TrimSpace(rawItem))
	if !allowedBagItems[item] {
		return EconomyState{}, ErrInvalidItem
	}
	var st EconomyState
	err := s.accounts.WithAccount(accountID, func(acc *auth.Account) error {
		if acc.BagCapacity <= 0 {
			return ErrBagNotOwned
		}
		if len(acc.SavedItems) >= acc.BagCapacity {
			return ErrBagFull
		}
		acc.SavedItems = append(acc.SavedItems, item)
		st = stateFromAccount(acc)
		return nil
	})
	return st, err
}

func (s *Store) UseBagItem(accountID string, index int) (string, EconomyState, error) {
	var usedItem string
	var st EconomyState
	err := s.accounts.WithAccount(accountID, func(acc *auth.Account) error {
		if index < 0 || index >= len(acc.SavedItems) {
			return ErrInvalidBagSlot
		}
		usedItem = acc.SavedItems[index]
		acc.SavedItems = append(acc.SavedItems[:index], acc.SavedItems[index+1:]...)
		st = stateFromAccount(acc)
		return nil
	})
	return usedItem, st, err
}

func (s *Store) GetMarketListings() []MarketListing {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]MarketListing, 0, len(s.listings))
	for _, it := range s.listings {
		out = append(out, *it)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt == out[j].CreatedAt {
			return out[i].ID < out[j].ID
		}
		return out[i].CreatedAt > out[j].CreatedAt
	})
	return out
}

func (s *Store) CreateMarketListing(sellerID string, blockType, qty, priceCoins int) (MarketListing, EconomyState, error) {
	capLimit := auth.MaterialCap(blockType)
	if capLimit <= 0 || qty < 1 || qty > capLimit || priceCoins < 1 || priceCoins > 1_000_000 {
		return MarketListing{}, EconomyState{}, ErrInvalidListing
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	sellerCount := 0
	for _, it := range s.listings {
		if it.SellerID == sellerID {
			sellerCount++
		}
	}
	if sellerCount >= MaxListingsPerSeller {
		return MarketListing{}, EconomyState{}, ErrTooManyListings
	}

	var listing MarketListing
	var st EconomyState
	err := s.accounts.WithAccount(sellerID, func(acc *auth.Account) error {
		if acc.Inventory[blockType] < qty {
			return ErrInsufficientStock
		}
		acc.Inventory[blockType] -= qty
		listing = MarketListing{
			ID:         randomID("mkt_"),
			SellerID:   acc.ID,
			SellerName: acc.DisplayName,
			BlockType:  blockType,
			Qty:        qty,
			PriceCoins: priceCoins,
			CreatedAt:  time.Now().Unix(),
		}
		st = stateFromAccount(acc)
		return nil
	})
	if err != nil {
		return MarketListing{}, EconomyState{}, err
	}

	cp := listing
	s.listings[listing.ID] = &cp
	_ = s.saveMarketLocked()
	return listing, st, nil
}

func (s *Store) BuyMarketListing(buyerID, listingID string) (MarketListing, EconomyState, error) {
	id := strings.TrimSpace(listingID)
	s.mu.Lock()
	defer s.mu.Unlock()

	item, ok := s.listings[id]
	if !ok {
		return MarketListing{}, EconomyState{}, ErrListingNotFound
	}
	if item.SellerID == buyerID {
		return MarketListing{}, EconomyState{}, ErrOwnListing
	}

	var st EconomyState
	err := s.accounts.WithTwoAccounts(buyerID, item.SellerID, func(buyer, seller *auth.Account) error {
		if buyer.Coins < item.PriceCoins {
			return ErrInsufficientCoins
		}
		capLimit := auth.MaterialCap(item.BlockType)
		if buyer.Inventory[item.BlockType]+item.Qty > capLimit {
			return ErrCapExceeded
		}
		buyer.Coins -= item.PriceCoins
		buyer.Inventory[item.BlockType] += item.Qty
		if seller != nil {
			seller.Coins += item.PriceCoins
		}
		st = stateFromAccount(buyer)
		return nil
	})
	if err != nil {
		return MarketListing{}, EconomyState{}, err
	}

	bought := *item
	delete(s.listings, id)
	_ = s.saveMarketLocked()
	return bought, st, nil
}

func (s *Store) CancelMarketListing(actorID, listingID string) (EconomyState, error) {
	id := strings.TrimSpace(listingID)
	s.mu.Lock()
	defer s.mu.Unlock()

	item, ok := s.listings[id]
	if !ok {
		return EconomyState{}, ErrListingNotFound
	}
	if item.SellerID != actorID {
		return EconomyState{}, ErrForbidden
	}

	var st EconomyState
	err := s.accounts.WithAccount(actorID, func(acc *auth.Account) error {
		acc.Inventory[item.BlockType] += item.Qty
		st = stateFromAccount(acc)
		return nil
	})
	if err != nil {
		return EconomyState{}, err
	}

	delete(s.listings, id)
	_ = s.saveMarketLocked()
	return st, nil
}

func (s *Store) GetBlueprints(accountID string) []auth.Blueprint {
	if accountID == "" {
		return []auth.Blueprint{}
	}
	out := []auth.Blueprint{}
	s.accounts.ReadAccount(accountID, func(acc *auth.Account) {
		out = make([]auth.Blueprint, len(acc.Blueprints))
		copy(out, acc.Blueprints)
	})
	return out
}

func (s *Store) SaveBlueprint(accountID, name string, sizeX, sizeY, sizeZ int, blocks []auth.BlueprintBlock) (auth.Blueprint, []auth.Blueprint, error) {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" || len(blocks) == 0 || len(blocks) > MaxBlueprintBlocks {
		return auth.Blueprint{}, nil, ErrInvalidBlueprint
	}
	if utf8.RuneCountInString(trimmed) > 32 {
		trimmed = string([]rune(trimmed)[:32])
	}

	cleanBlocks := make([]auth.BlueprintBlock, 0, len(blocks))
	maxX, maxY, maxZ := 0, 0, 0
	for _, b := range blocks {
		if b.B < 1 || b.B > 10 {
			return auth.Blueprint{}, nil, ErrInvalidBlueprint
		}
		if b.DX < -32 || b.DX > 32 || b.DY < -32 || b.DY > 32 || b.DZ < -32 || b.DZ > 32 {
			return auth.Blueprint{}, nil, ErrInvalidBlueprint
		}
		cleanBlocks = append(cleanBlocks, b)
		if b.DX+1 > maxX {
			maxX = b.DX + 1
		}
		if b.DY+1 > maxY {
			maxY = b.DY + 1
		}
		if b.DZ+1 > maxZ {
			maxZ = b.DZ + 1
		}
	}
	if sizeX <= 0 {
		sizeX = maxX
	}
	if sizeY <= 0 {
		sizeY = maxY
	}
	if sizeZ <= 0 {
		sizeZ = maxZ
	}

	bp := auth.Blueprint{
		ID:        randomID("bp_"),
		Name:      trimmed,
		SizeX:     sizeX,
		SizeY:     sizeY,
		SizeZ:     sizeZ,
		Blocks:    cleanBlocks,
		CreatedAt: time.Now().Unix(),
	}

	var all []auth.Blueprint
	err := s.accounts.WithAccount(accountID, func(acc *auth.Account) error {
		if len(acc.Blueprints) >= MaxBlueprintsPerUser {
			return ErrTooManyBlueprints
		}
		acc.Blueprints = append(acc.Blueprints, bp)
		all = make([]auth.Blueprint, len(acc.Blueprints))
		copy(all, acc.Blueprints)
		return nil
	})
	return bp, all, err
}

func (s *Store) DeleteBlueprint(accountID, bpID string) ([]auth.Blueprint, error) {
	id := strings.TrimSpace(bpID)
	if id == "" {
		return nil, ErrBlueprintNotFound
	}
	var all []auth.Blueprint
	err := s.accounts.WithAccount(accountID, func(acc *auth.Account) error {
		idx := -1
		for i, bp := range acc.Blueprints {
			if bp.ID == id {
				idx = i
				break
			}
		}
		if idx < 0 {
			return ErrBlueprintNotFound
		}
		acc.Blueprints = append(acc.Blueprints[:idx], acc.Blueprints[idx+1:]...)
		all = make([]auth.Blueprint, len(acc.Blueprints))
		copy(all, acc.Blueprints)
		return nil
	})
	return all, err
}
