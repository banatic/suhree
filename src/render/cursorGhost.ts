import { drawSprite } from "./sprites";
import { cursorSkin } from "./cursorArt";

/** Draw a ghost cursor at a CSS position on the strip, using the given cosmetic skin (or default). */
export function drawGhostCursor(
  ctx: CanvasRenderingContext2D,
  xCss: number,
  yCss: number,
  scale: number,
  cursorId?: string,
): void {
  const skin = cursorSkin(cursorId);
  ctx.save();
  ctx.globalAlpha = 0.85;
  drawSprite(ctx, skin.sprite, Math.round(xCss), Math.round(yCss), scale, skin.overrides);
  ctx.restore();
}
