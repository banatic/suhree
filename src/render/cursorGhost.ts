import { drawSprite, GHOST_CURSOR } from "./sprites";

/** Draw the owner's ghost cursor at a CSS position on the thief's strip. */
export function drawGhostCursor(
  ctx: CanvasRenderingContext2D,
  xCss: number,
  yCss: number,
  scale: number,
): void {
  // soft shadow so it reads against busy soil
  ctx.save();
  ctx.globalAlpha = 0.85;
  drawSprite(ctx, GHOST_CURSOR, Math.round(xCss), Math.round(yCss), scale);
  ctx.restore();
}
