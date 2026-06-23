import { store, consumePanelsDirty } from "../state";
import { renderStrip } from "../render/strip";
import { renderPanels } from "../render/panels";
import { tickRaid } from "../raid/controller";
import { tickCursorStream } from "../raid/cursorStream";

let running = false;

export function startLoop(): void {
  if (running) return;
  running = true;
  const frame = () => {
    store.now = Date.now();
    tickRaid();
    tickCursorStream();
    renderStrip();
    if (consumePanelsDirty()) renderPanels();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
