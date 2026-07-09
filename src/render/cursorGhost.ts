import { drawSprite } from "./sprites";
import { cursorSkin } from "./cursorArt";

/** Draw a ghost cursor at a CSS position on the strip, using the given cosmetic skin (or default). */
export function drawGhostCursor(
  ctx: CanvasRenderingContext2D,
  xCss: number,
  yCss: number,
  scale: number,
  cursorId?: string,
  opacity: number = 0.85,
): void {
  const skin = cursorSkin(cursorId);
  ctx.save();
  ctx.globalAlpha = opacity;
  drawSprite(ctx, skin.sprite, Math.round(xCss), Math.round(yCss), scale, skin.overrides);
  ctx.restore();
}
