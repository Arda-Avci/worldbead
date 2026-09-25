/**
 * Tiny DOM-adjacent texture loader: fetches an image and decodes it to raw pixel
 * data, plus a bilinear equirectangular sampler used by the bead painter.
 * This is the one file in `src/game/` allowed to touch the DOM/fetch, per the GDD.
 */
import { fbm3 } from './noise';

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
 * Procedurally generates a banded gas-giant equirectangular texture (item
 * #15's 5th cycle body): no real texture is bundled for it, so this paints
 * one in-canvas from latitude bands + `fbm3` turbulence — no network
 * download. Deterministic (fixed seed) so every run/level paints the same
 * planet.
 */
export function generateJupiterBands(width = 512, height = 256): ImageDataLike {
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas');
  if (!(canvas instanceof OffscreenCanvas)) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('generateJupiterBands: no 2D context');

  // Real Jupiter alternates pale "zones" and dark rust/brown "belts" with strong
  // contrast between neighbors (owner feedback: the previous palette was all
  // similar creams/tans and read as nearly monochrome once k-means quantized
  // it). Alternating light/dark keeps every other band clearly distinct.
  const bandColorHex: number[] = [
    0xEDE0BE, // pale cream zone
    0x8C4A24, // rust-brown belt
    0xF4EAD2, // bright equatorial zone
    0x5B2E15, // dark chocolate belt
    0xE0C88E, // tan zone
    0xA8501F, // orange-rust belt
    0xF0E0B8, // pale zone
    0x3D2010, // near-black belt (polar)
  ];
  const bandColors: [number, number, number][] = bandColorHex.map((hex) => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255]);
  const img = ctx.createImageData(width, height);
  const seed = 0x1a2b3c4d;
  for (let y = 0; y < height; y++) {
    const lat = 1 - (y / (height - 1)) * 2; // 1 (north pole) .. -1 (south pole)
    for (let x = 0; x < width; x++) {
      const lon = (x / width) * Math.PI * 2;
      const nx = Math.cos(lon) * Math.cos(lat * Math.PI * 0.5);
      const nz = Math.sin(lon) * Math.cos(lat * Math.PI * 0.5);
      // Band edges are turbulent, not perfectly smooth latitude lines — this fbm term
      // warps *which* band a latitude falls into, giving the wavy, sheared boundaries
      // real Jupiter bands have instead of clean stripes.
      const edgeWarp = fbm3(nx * 2.5, lat * 3 + 5, nz * 2.5, seed + 7) - 0.5;
      const turbulence = fbm3(nx * 3 + lat * 6, lat * 4, nz * 3, seed);
      const swirl = fbm3(nx * 6, lat * 14 + turbulence * 2, nz * 6, seed + 1) - 0.5;
      const bandF = (((lat + edgeWarp * 0.35) * 9 + 9) % bandColors.length + bandColors.length) % bandColors.length;
      const bandLo = bandColors[Math.floor(bandF) % bandColors.length];
      const bandHi = bandColors[(Math.floor(bandF) + 1) % bandColors.length];
      // A sharper (not linear) transition between bands keeps each one reading as its
      // own distinct color class over most of its width, with only a narrow turbulent
      // seam blending into the next — real belts have fairly crisp edges.
      const bandT = smoothstep(0.32, 0.68, bandF - Math.floor(bandF));
      let r = bandLo[0] + (bandHi[0] - bandLo[0]) * bandT;
      let g = bandLo[1] + (bandHi[1] - bandLo[1]) * bandT;
      let b = bandLo[2] + (bandHi[2] - bandLo[2]) * bandT;
      const shade = 1 + swirl * 0.22 + (turbulence - 0.5) * 0.14;
      r *= shade; g *= shade; b *= shade;
      // A single, larger "great red spot" swirl in the southern bands.
      const spotDx = lon - 4.2, spotDy = lat + 0.28;
      const spotDist = Math.hypot(spotDx * 1.5, spotDy * 2.8);
      if (spotDist < 0.62) {
        const t = smoothstep(0.62, 0, spotDist);
        r = r * (1 - t) + 0xC1 * t;
        g = g * (1 - t) + 0x53 * t;
        b = b * (1 - t) + 0x38 * t;
      }
      const o = (y * width + x) * 4;
      img.data[o] = Math.max(0, Math.min(255, Math.round(r)));
      img.data[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      img.data[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
      img.data[o + 3] = 255;
    }
  }
  return { width, height, data: img.data };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
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
