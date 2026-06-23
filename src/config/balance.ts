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
  /** Stage *durations* (ms). Cumulative: seed → sprout → growing → ripe → withered. */
  stages: {
    seed: number; // time as a buried seed
    sprout: number; // time as a sprout
    growing: number; // time growing
    ripe: number; // how long it stays ripe (harvest/steal window) before withering
  };
  /** Palette accent used by the renderer for this tier's crop. */
  color: string;
}

export const BALANCE = {
  strip: {
    // Thin strip: ~2px soil + vertical crops. Must match AppState.band_height_logical in Rust.
    bandHeightLogical: 36,
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
    aScarecrow: 6,
    bScythe: 6,
    minSeconds: 5,
    maxSeconds: 120,
    cooldownMs: 5 * 60 * 1000, // 5 min, applied on success AND failure, per (target,raider)
    lockStaleMs: 130 * 1000, // a lock older than this is treated as abandoned (maxSeconds + grace)
    stealFraction: 0.5, // thief takes this share of a ripe crop's value
    evaporateFraction: 0.5, // the rest evaporates (lost to everyone)
    messageMaxLen: 120,
  },

  crops: {
    tiers: [
      {
        id: 0,
        name: "radish",
        label: "무",
        price: 5,
        harvestValue: 12,
        stages: { seed: 8000, sprout: 12000, growing: 20000, ripe: 60000 },
        color: "#e87aa0",
      },
      {
        id: 1,
        name: "wheat",
        label: "밀",
        price: 25,
        harvestValue: 70,
        stages: { seed: 20000, sprout: 40000, growing: 90000, ripe: 120000 },
        color: "#e7c463",
      },
      {
        id: 2,
        name: "pumpkin",
        label: "호박",
        price: 120,
        harvestValue: 400,
        stages: { seed: 60000, sprout: 120000, growing: 300000, ripe: 300000 },
        color: "#e08a3c",
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
    // Balance-irrelevant. id → { label, type, price }.
    decor: [
      { id: "decor_none", label: "기본", price: 0 },
      { id: "decor_fence", label: "나무 울타리", price: 60 },
      { id: "decor_lantern", label: "등불", price: 140 },
      { id: "decor_blossom", label: "벚꽃길", price: 260 },
    ],
    msgSkin: [
      { id: "skin_plain", label: "쪽지", price: 0 },
      { id: "skin_crow", label: "까마귀 깃털", price: 80 },
      { id: "skin_heart", label: "하트 도장", price: 120 },
      { id: "skin_skull", label: "해골 낙서", price: 200 },
    ],
  },

  economy: {
    startingCoins: 50,
    maxCoins: 1_000_000_000, // mirrors the security rule bound
  },
} as const;

export type DecorId = (typeof BALANCE.cosmetics.decor)[number]["id"];
export type MsgSkinId = (typeof BALANCE.cosmetics.msgSkin)[number]["id"];
