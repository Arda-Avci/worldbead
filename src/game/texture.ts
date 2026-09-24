/**
 * Tiny DOM-adjacent texture loader: fetches an image and decodes it to raw pixel
 * data, plus a bilinear equirectangular sampler used by the bead painter.
 * This is the one file in `src/game/` allowed to touch the DOM/fetch, per the GDD.
 */

export interface ImageDataLike {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major from the top-left. */
  data: Uint8ClampedArray;
}

/** Fetches `url` and decodes it into raw RGBA pixel data. */
export async function loadImageData(url: string): Promise<ImageDataLike> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load texture ${url}: ${res.status}`);
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    ctx = canvas.getContext('2d');
  } else {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    ctx = canvas.getContext('2d');
  }
  if (!ctx) throw new Error(`Failed to get 2D context for texture ${url}`);
  ctx.drawImage(bitmap, 0, 0);
  const id = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close?.();
  return { width: id.width, height: id.height, data: id.data };
}

/**
 * Bilinear sample of an equirectangular image at (lon, lat) in degrees.
 * Convention: u = (lon + 180) / 360, v = (90 - lat) / 180 — matches the bead
 * direction <-> lon/lat mapping used across `src/game/`. Wraps horizontally,
 * clamps vertically. Returns [r, g, b, a] in 0..255.
 */
export function sampleEquirect(img: ImageDataLike, lon: number, lat: number): [number, number, number, number] {
  const u = (lon + 180) / 360;
  const v = (90 - lat) / 180;
  const fx = u * img.width - 0.5;
  const fy = v * img.height - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const wrapX = (x: number) => ((x % img.width) + img.width) % img.width;
  const clampY = (y: number) => Math.max(0, Math.min(img.height - 1, y));
  const xa = wrapX(x0), xb = wrapX(x0 + 1);
  const ya = clampY(y0), yb = clampY(y0 + 1);
  const px = (x: number, y: number): [number, number, number, number] => {
    const o = (y * img.width + x) * 4;
    return [img.data[o], img.data[o + 1], img.data[o + 2], img.data[o + 3]];
  };
  const p00 = px(xa, ya), p10 = px(xb, ya), p01 = px(xa, yb), p11 = px(xb, yb);
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = p00[c] + (p10[c] - p00[c]) * tx;
    const bot = p01[c] + (p11[c] - p01[c]) * tx;
    out[c] = top + (bot - top) * ty;
  }
  return out;
}
