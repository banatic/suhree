// Compress a clipboard-pasted image into a reasonably-sized JPEG data URL for inline chat.
// We store the base64 straight in the Realtime Database message, so every reader pulls it down —
// that counts against the free download quota. Keep the encoded string bounded: downscale to a
// sane longest-edge, then step quality (and, if still too big, dimensions) down until it fits.

const MAX_DIM = 1280; // longest edge after the initial downscale
const MAX_CHARS = 300_000; // encoded-length cap (~225KB); DB rule allows up to 400k, leaving headroom
const MIN_QUALITY = 0.45;

/**
 * Returns a `data:image/jpeg;base64,…` string sized under MAX_CHARS, or null if the blob isn't a
 * decodable image or can't be squeezed under the cap. Transparent pixels are flattened onto white
 * (JPEG has no alpha, so otherwise they'd render black).
 */
export async function compressPastedImage(blob: Blob): Promise<string | null> {
  if (!blob.type.startsWith("image/")) return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null; // not a decodable image
  }

  try {
    let dim = MAX_DIM;
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, dim / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(bitmap, 0, 0, w, h);

      for (let q = 0.82; q >= MIN_QUALITY - 1e-6; q -= 0.12) {
        const url = canvas.toDataURL("image/jpeg", q);
        if (url.length <= MAX_CHARS) return url;
      }
      dim = Math.round(dim * 0.72); // even min quality was too big — shrink the canvas and retry
    }
    return null; // couldn't fit under the cap (extreme resolution) — caller shows a toast
  } finally {
    bitmap.close();
  }
}
