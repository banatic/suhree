// ─────────────────────────────────────────────────────────────────────────────
// THE single balance/tuning surface. Change numbers here, nowhere else.
// Times are in milliseconds, values are coins.
// ─────────────────────────────────────────────────────────────────────────────

export interface CropTier {
  id: number;
  name: string;
  label: string; // Korean display name
  price: number; // seed cost
  harvestValue: number; // coins for a full (direct) harvest
  /** Stage *durations* (ms). Cumulative: seed → sprout → growing → ripe. Ripe lasts forever. */
  stages: {
    seed: number; // time as a buried seed
    sprout: number; // time as a sprout
    growing: number; // time growing (after which it's ripe and stays ripe — no withering)
  };
  /** Which ripe silhouette the renderer draws (recoloured per tier by `color`). */
  sprite: "radish" | "wheat" | "pumpkin";
  /** Palette accent used by the renderer for this tier's crop. */
  color: string;
}

export const BALANCE = {
  strip: {
    // Thin strip: ~2px soil + vertical crops. Must match AppState.band_height_logical in Rust.
    bandHeightLogical: 48,
    soilLogical: 3,
    // HUD (coins + 상/친/편/꾸/설정) is hidden at rest and rolls UP on hover.
    toolbarHeightLogical: 116,
    hoverEase: 0.26, // per-frame lerp toward the hover target
    preferredMonitor: "primary" as "primary" | "cursor",
  },

  cursorStream: {
    hz: 5, // DEFAULT 5 Hz (privacy + Spark write budget). Build note said 10–15; capped below.
    maxHz: 10, // hard ceiling
    smoothing: 0.35, // lerp factor applied on the thief's side (0..1, higher = snappier)
  },

  raid: {
    baseSeconds: 30,
    // T = base + aScarecrow*ln(1+scarecrowLv) − bScythe*ln(1+scytheLv), clamped.
    // (Legacy survive-the-timer constants; kept for the level preview text.)
    aScarecrow: 6,
    bScythe: 6,
    minSeconds: 5,
    maxSeconds: 120,
    cooldownMs: 5 * 60 * 1000, // 5 min, applied on evict/timeout/clear, per (target,raider)
    fleeCooldownMs: 1 * 60 * 1000, // 1 min — cheaper penalty for a VOLUNTARY 도망치기
    lockStaleMs: 130 * 1000, // a lock older than this is treated as abandoned (maxSeconds + grace)
    stealFraction: 0.5, // thief takes this share of a ripe crop's value
    evaporateFraction: 0.5, // the rest evaporates (lost to everyone)
    messageMaxLen: 120,
  },

  // ── Active raid: a real-time cat-and-mouse in the strip near the taskbar ──────────
  // The raider is NOT surviving a timer — they must CLICK ripe crops to steal them while
  // DODGING the defender's cursor; the defender must CLICK the raider's cursor to evict.
  // Attack power = 낫(scythe) level, defence power = 허수아비(scarecrow) level.
  raidGame: {
    cursorHz: 10, // snappier exchange than the 5 Hz idle ghost (both sides publish during a raid)
    cursorSmoothing: 0.45, // lerp applied to the received ghost (higher = snappier, less laggy)
    timeoutSeconds: 60, // hard cap: the lock can't hang. On timeout the raider auto-flees.
    // Clicks the RAIDER must land on one ripe crop to steal it. More defence → tougher crops;
    // more attack → easier. clicks = clamp(round(base + kDef·ln(1+scarecrowLv) − kAtk·ln(1+scytheLv)), min, max)
    steal: { base: 3, kDef: 2.2, kAtk: 1.7, min: 1, max: 12 },
    stealValueFraction: 1.0, // the raider keeps this share of each crop they FULLY steal
    // Hits the DEFENDER must land on the raider's cursor to evict. More attack → slipperier raider;
    // more defence → quicker catch. hits = clamp(round(base + kAtk·ln(1+scytheLv) − kDef·ln(1+scarecrowLv)), min, max)
    evict: { base: 3, kAtk: 2.2, kDef: 1.7, min: 1, max: 12 },
    evictHitRadius: 28, // CSS px: a defender click within this of the raider ghost counts as a hit
  },

  chat: {
    // Single global "village" room. No Cloud Functions → no server-side pruning; readers only
    // pull the most recent `keep` messages and the node grows slowly (fine for a friends game).
    keep: 60, // limitToLast on the reader
    maxLen: 200, // per-message character cap (mirrors the security rule)
    cooldownMs: 800, // local anti-spam between sends
  },

  raidLog: {
    // Server-wide 서리(steal) feed: one append per raid that looted >0 coins. Spark-friendly like
    // chat — no server pruning, readers only pull the most recent `keep` entries (limitToLast).
    keep: 50,
  },

  crops: {
    // A 16-tier ladder. ROI (harvest/price) holds ~2.5–3.0× across tiers while coins/second rises
    // with tier, so higher seeds reward more capital + attention (and carry more raid risk).
    // The top tiers (포도..용과) are long AFK crops: 24/31/40/50 min total, sized for a class period.
    // Ripe crops never wither — they wait until harvested or stolen. Silhouette reuses 3 shapes,
    // recoloured per tier. Grow time is split seed/sprout/growing ≈ 20%/30%/50%.
    tiers: [
      {
        id: 0,
        name: "radish",
        label: "무",
        price: 5,
        harvestValue: 13,
        stages: { seed: 8000, sprout: 12000, growing: 20000 },
        sprite: "radish",
        color: "#e87aa0",
      },
      {
        id: 1,
        name: "carrot",
        label: "당근",
        price: 12,
        harvestValue: 30,
        stages: { seed: 14000, sprout: 21000, growing: 35000 },
        sprite: "radish",
        color: "#e8913c",
      },
      {
        id: 2,
        name: "potato",
        label: "감자",
        price: 25,
        harvestValue: 65,
        stages: { seed: 22000, sprout: 33000, growing: 55000 },
        sprite: "radish",
        color: "#c9a36a",
      },
      {
        id: 3,
        name: "wheat",
        label: "밀",
        price: 45,
        harvestValue: 120,
        stages: { seed: 32000, sprout: 48000, growing: 80000 },
        sprite: "wheat",
        color: "#e7c463",
      },
      {
        id: 4,
        name: "barley",
        label: "보리",
        price: 80,
        harvestValue: 210,
        stages: { seed: 44000, sprout: 66000, growing: 110000 },
        sprite: "wheat",
        color: "#cdb86a",
      },
      {
        id: 5,
        name: "corn",
        label: "옥수수",
        price: 140,
        harvestValue: 380,
        stages: { seed: 60000, sprout: 90000, growing: 150000 },
        sprite: "wheat",
        color: "#f2cf4d",
      },
      {
        id: 6,
        name: "tomato",
        label: "토마토",
        price: 240,
        harvestValue: 640,
        stages: { seed: 76000, sprout: 114000, growing: 190000 },
        sprite: "radish",
        color: "#e2573c",
      },
      {
        id: 7,
        name: "eggplant",
        label: "가지",
        price: 380,
        harvestValue: 1050,
        stages: { seed: 94000, sprout: 141000, growing: 235000 },
        sprite: "wheat",
        color: "#8a5fb0",
      },
      {
        id: 8,
        name: "pumpkin",
        label: "호박",
        price: 600,
        harvestValue: 1700,
        stages: { seed: 120000, sprout: 180000, growing: 300000 },
        sprite: "pumpkin",
        color: "#e08a3c",
      },
      {
        id: 9,
        name: "watermelon",
        label: "수박",
        price: 950,
        harvestValue: 2700,
        stages: { seed: 150000, sprout: 225000, growing: 375000 },
        sprite: "pumpkin",
        color: "#4e9d52",
      },
      {
        id: 10,
        name: "melon",
        label: "멜론",
        price: 1500,
        harvestValue: 4300,
        stages: { seed: 180000, sprout: 270000, growing: 450000 },
        sprite: "pumpkin",
        color: "#8cc06a",
      },
      {
        id: 11,
        name: "golden_pumpkin",
        label: "황금호박",
        price: 2400,
        harvestValue: 7000,
        stages: { seed: 220000, sprout: 330000, growing: 550000 },
        sprite: "pumpkin",
        color: "#f4c94e",
      },
      // ── Long AFK crops (sized for a class period) ──────────────────────────────
      {
        id: 12,
        name: "grape",
        label: "포도",
        price: 4000,
        harvestValue: 11500,
        stages: { seed: 288000, sprout: 432000, growing: 720000 }, // 24 min
        sprite: "pumpkin",
        color: "#6a4c93",
      },
      {
        id: 13,
        name: "pineapple",
        label: "파인애플",
        price: 6300,
        harvestValue: 18500,
        stages: { seed: 372000, sprout: 558000, growing: 930000 }, // 31 min
        sprite: "wheat",
        color: "#e0a82e",
      },
      {
        id: 14,
        name: "mango",
        label: "망고",
        price: 10000,
        harvestValue: 29500,
        stages: { seed: 480000, sprout: 720000, growing: 1200000 }, // 40 min
        sprite: "pumpkin",
        color: "#f2922e",
      },
      {
        id: 15,
        name: "dragonfruit",
        label: "용과",
        price: 15000,
        harvestValue: 45000,
        stages: { seed: 600000, sprout: 900000, growing: 1500000 }, // 50 min
        sprite: "pumpkin",
        color: "#e34a78",
      },
    ] as CropTier[],
  },

  shop: {
    // cost = round(baseCost * growth^owned)
    plotExpansion: { baseCost: 50, growth: 1.6, maxSlots: 32, startSlots: 6 },
    scarecrow: { baseCost: 40, growth: 1.5 },
    scythe: { baseCost: 40, growth: 1.5 },
  },

  cosmetics: {
    // Balance-irrelevant flexing + a coin sink for late game. Each item has a rarity (display only)
    // and EITHER a price>0 (buyable, stored in the user's `cosmetics` map) OR price 0 with an
    // optional `req` (achievement-unlocked — owned the moment the condition is met, never bought).
    // `req` keys are evaluated in game/unlocks.ts. Item art is drawn in render/{decorArt,theme}.ts,
    // keyed by id — adding an id here without art just draws nothing.
    decor: [
      { id: "decor_none", label: "기본", price: 0, rarity: "일반" },
      { id: "decor_fence", label: "나무 울타리", price: 60, rarity: "일반" },
      { id: "decor_lantern", label: "등불", price: 140, rarity: "일반" },
      { id: "decor_blossom", label: "벚꽃길", price: 260, rarity: "희귀" },
      { id: "decor_flowerbed", label: "꽃밭", price: 700, rarity: "희귀" },
      { id: "decor_pond", label: "연못", price: 1600, rarity: "영웅" },
      { id: "decor_lights", label: "전구 장식", price: 3500, rarity: "영웅" },
      { id: "decor_rainbow", label: "무지개", price: 0, rarity: "전설", req: "dexComplete" },
    ],
    // Band BACKGROUND themes (the sky behind the soil). Drawn in render/theme.ts, keyed by id.
    themes: [
      { id: "theme_day", label: "한낮", price: 0, rarity: "일반" },
      { id: "theme_sunset", label: "노을", price: 500, rarity: "희귀" },
      { id: "theme_night", label: "밤하늘", price: 900, rarity: "희귀" },
      { id: "theme_snow", label: "눈 내리는 밤", price: 1800, rarity: "영웅" },
      { id: "theme_aurora", label: "오로라", price: 0, rarity: "전설", req: "plotMax" },
    ],
    // Titles shown next to the nickname in chat + ranking. Buyable ones are a coin sink; the rest
    // are bragging rights for hitting a milestone. (No art; pure label.)
    titles: [
      { id: "title_none", label: "", price: 0, rarity: "일반" },
      { id: "title_villager", label: "마을 농부", price: 200, rarity: "일반" },
      { id: "title_greenthumb", label: "초록 손가락", price: 800, rarity: "희귀" },
      { id: "title_tycoon", label: "농업 재벌", price: 5000, rarity: "영웅" },
      { id: "title_collector", label: "도감 마스터", price: 0, rarity: "전설", req: "dexComplete" },
      { id: "title_landlord", label: "대지주", price: 0, rarity: "영웅", req: "plotMax" },
      { id: "title_bandit", label: "밤손님", price: 0, rarity: "영웅", req: "scytheMaster" },
      { id: "title_guardian", label: "철벽 수문장", price: 0, rarity: "영웅", req: "scarecrowMaster" },
    ],
    msgSkin: [
      { id: "skin_plain", label: "쪽지", price: 0 },
      { id: "skin_crow", label: "까마귀 깃털", price: 80 },
      { id: "skin_heart", label: "하트 도장", price: 120 },
      { id: "skin_skull", label: "해골 낙서", price: 200 },
    ],
    // Coin thresholds for the "rich"-style title/theme reqs (see game/unlocks.ts).
    scytheMasterLv: 10,
    scarecrowMasterLv: 10,
  },

  economy: {
    startingCoins: 50,
    maxCoins: 1_000_000_000, // mirrors the security rule bound
  },

  market: {
    // Daily SELL-price multiplier per crop (seed BUY price stays fixed). Deterministic by
    // (KST day, tier) so every client sees the same prices with no backend:
    //   factor = minFactor + (hash(day, tier) % steps) * stepSize   → 0.7 .. 1.6 in 0.1 steps.
    minFactor: 0.7,
    steps: 10,
    stepSize: 0.1,
    dayOffsetMs: 9 * 60 * 60 * 1000, // shift the day boundary to KST midnight
  },

  dex: {
    completionReward: 5000, // one-time coin bonus for collecting every crop
  },

  update: {
    // Mandatory versioning: poll latest.json every minute. If the remote semver is newer,
    // the client BLOCKS, installs, and relaunches — no skipping, no playing an old build.
    checkIntervalMs: 60 * 1000,
  },

  presence: {
    // Dual-signal presence. Two independent "alive" signals are OR-ed so neither failure mode
    // (JS timer throttling vs. transient socket recycling) can wrongly show a live user offline:
    //   1) heartbeat: app re-stamps /presence/{uid}/lastSeen every heartbeatMs (the "ping").
    //   2) socket marker: a child under /presence/{uid}/connections, auto-removed onDisconnect.
    // The websocket keepalive is NOT subject to Chromium's background-timer throttling, so the
    // marker stays present even when a backgrounded strip's setInterval is throttled to ~1/min.
    heartbeatMs: 15 * 1000,
    // online ⇔ (serverNow − lastSeen < onlineThresholdMs) OR a connection marker exists.
    // Kept above Chromium's ~60s background-throttle floor so a backgrounded-but-alive client
    // isn't flipped offline by a missed heartbeat.
    onlineThresholdMs: 90 * 1000,
    readerTickMs: 5 * 1000, // how often readers re-evaluate friends' freshness locally
  },
} as const;

export type DecorId = (typeof BALANCE.cosmetics.decor)[number]["id"];
export type MsgSkinId = (typeof BALANCE.cosmetics.msgSkin)[number]["id"];
export type ThemeId = (typeof BALANCE.cosmetics.themes)[number]["id"];
export type TitleId = (typeof BALANCE.cosmetics.titles)[number]["id"];

/** A buyable/unlockable cosmetic entry (decor, theme, or title). */
export interface CosmeticItem {
  id: string;
  label: string;
  price: number;
  rarity?: string;
  req?: string;
}
