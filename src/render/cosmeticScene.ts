// Shared drawing context for cosmetic ART (밭 테마 배경 + decor), used by BOTH the live strip band
// (render/strip.ts) and the small farm-preview thumbnails (render/farmPreview.ts). Keeping the draw
// functions geometry-agnostic (they take a CosmeticScene, never the private BandLayout) lets the
// same art render at any size — full-width band or a 120px friend thumbnail.
//
// All coordinates are device-independent CSS px in the canvas's CURRENT transform (the caller has
// already applied DPR scaling). Sizes should be multiplied by `scale` so art keeps proportion on
// HiDPI / larger bands.
export interface CosmeticScene {
  ctx: CanvasRenderingContext2D;

  // The band rectangle = the whole strip (sky + soil).
  bandX: number;
  bandY: number;
  bandW: number;
  bandH: number;

  // Soil surface line. Theme "sky" fills the band ABOVE this; decor sits ON/above it.
  soilY: number;

  // Horizontal span of the planting row — decor (fence, flowers, …) aligns to this, not the full band.
  rowX0: number;
  rowX1: number;

  scale: number; // ~1 at 96dpi; multiply art sizes by this
  nowMs: number; // monotonic animation clock in ms (use for motion; do NOT call Date.now yourself)
  hoverT: number; // 0..1 hover roll-up. Gate "busy"/animated bits on this. Previews pass 1.
  dock: "top" | "bottom"; // band docked at screen top or bottom
}
