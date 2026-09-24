/**
 * The bead sphere: one or two concentric shells of instanced beads (`surface`,
 * optional `clouds`), painted from real planet textures per GDD §3, and
 * implementing `GlobeAdapter` so `GameSession` can drive it without knowing
 * about THREE. Owns pop/assemble/burst-away animations, advanced by `update(dt)`.
 */
import * as THREE from 'three';
import { mulberry32, fbm3 } from './noise';
import { PLANETS } from './planets';
import type { LevelConfig } from './levels';
import type { ImageDataLike } from './texture';
import { sampleEquirect } from './texture';
import type { BeadRef, GlobeAdapter, PopEvent, Vec3 } from './types';

export type TextureName = 'earth_daymap' | 'earth_clouds' | 'moon' | 'venus_surface' | 'mars';
export type TextureMap = Partial<Record<TextureName, ImageDataLike>>;

interface Shell {
  kind: 'surface' | 'clouds';
  count: number;
  radius: number;
  dirs: Float32Array;
  nbrStart: Int32Array;
  nbrList: Int32Array;
  colorIdx: Int16Array;
  palette: number[];
  alive: Uint8Array;
  scale: Float32Array;
  mesh: THREE.InstancedMesh;
  beadRadius: number;
  seed: number;
  /** Surface shell only: covering[i] = cloud bead indices whose footprint covers surface bead i. */
  coveredBy?: Int32Array[];
  // Assemble/burst animation state (optional; present once an animation has been kicked off).
  animFrom?: Float32Array; // n*3, far/outward points
  animT0?: Float32Array; // per-bead start time (animClock seconds)
  animDur?: number;
  animEnd?: number;
  animMode?: 'assembling' | 'bursting';
}

interface PopAnim {
  shell: Shell;
  index: number;
  t0: number;
  dur: number;
}

const RAD = 180 / Math.PI;
const tmpM = new THREE.Matrix4();
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

function dirToLonLat(x: number, y: number, z: number): [number, number] {
  const lat = Math.asin(Math.max(-1, Math.min(1, y))) * RAD;
  const lon = Math.atan2(-z, x) * RAD;
  return [lon, lat];
}

/** Evenly distributed points on the unit sphere. */
function fibonacciSphere(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    const t = golden * i;
    out[i * 3] = Math.cos(t) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(t) * r;
  }
  return out;
}

/** Neighbor graph via uniform grid hashing: pairs closer than `maxDist` on the unit sphere. */
function buildNeighbors(dirs: Float32Array, maxDist: number): { start: Int32Array; list: Int32Array } {
  const n = dirs.length / 3;
  const cell = maxDist;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(dirs[i * 3] / cell), Math.floor(dirs[i * 3 + 1] / cell), Math.floor(dirs[i * 3 + 2] / cell));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }
  const lists: number[][] = new Array(n);
  const md2 = maxDist * maxDist;
  for (let i = 0; i < n; i++) {
    const x = dirs[i * 3], y = dirs[i * 3 + 1], z = dirs[i * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    const nb: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get(key(cx + dx, cy + dy, cz + dz));
      if (!arr) continue;
      for (const j of arr) {
        if (j === i) continue;
        const ex = dirs[j * 3] - x, ey = dirs[j * 3 + 1] - y, ez = dirs[j * 3 + 2] - z;
        if (ex * ex + ey * ey + ez * ez < md2) nb.push(j);
      }
    }
    lists[i] = nb;
  }
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + lists[i].length;
  const list = new Int32Array(start[n]);
  for (let i = 0; i < n; i++) list.set(lists[i], start[i]);
  return { start, list };
}

// ---------------- painting (GDD §3) ----------------

// --- small sRGB <-> CIE Lab helpers, used only to keep the k-means display
// palette readable (see readablePalette below). Not a general color library:
// just enough round-tripping to measure/adjust perceptual distance and
// lightness/chroma in a hue-preserving way.
function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linearToSrgb(c: number): number {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(1, v));
}
function rgbToLab(r: number, g: number, b: number): [number, number, number] {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const x = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.0;
  const z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToRgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const fi = (t: number) => (t * t * t > 0.008856 ? t * t * t : (t - 16 / 116) / 7.787);
  const x = fi(fx) * 0.95047, y = fi(fy) * 1.0, z = fi(fz) * 1.08883;
  const R = x * 3.2404542 + y * -1.5371385 + z * -0.4985314;
  const G = x * -0.9692660 + y * 1.8760108 + z * 0.0415560;
  const B = x * 0.0556434 + y * -0.2040259 + z * 1.0572252;
  return [linearToSrgb(R), linearToSrgb(G), linearToSrgb(B)];
}

/**
 * Post-processes raw k-means centroid colors into a readable display palette:
 * hue is kept (the a/b direction in Lab), but lightness is pulled into a band
 * that stays visible under camera-relative gameplay lighting (not crushed to
 * near-black or blown to near-white), weak chroma is nudged up so muted
 * centroids read as a recognizable color rather than grey, and any pair of
 * colors closer than `minDeltaE` (CIE76 distance in Lab) is pulled apart in
 * lightness until they're distinguishable. True near-greys (ice, clouds,
 * regolith) are left alone so realism — oceans blue, deserts sand, forests
 * green, ice white — survives the pass.
 */
function readablePalette(paletteHex: number[]): number[] {
  const MIN_L = 34;
  const MAX_L = 84;
  const MIN_CHROMA = 16;
  const MIN_DELTA_E = 18;

  const labs: [number, number, number][] = paletteHex.map((hex) => {
    const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    return rgbToLab(r, g, b);
  });

  for (const lab of labs) {
    let [L, a, b] = lab;
    if (L < MIN_L) L = MIN_L + (L / MIN_L) * 8;
    if (L > MAX_L) L = MAX_L;
    const chroma = Math.hypot(a, b);
    if (chroma > 2 && chroma < MIN_CHROMA) {
      const s = MIN_CHROMA / chroma;
      a *= s;
      b *= s;
    }
    lab[0] = L;
    lab[1] = a;
    lab[2] = b;
  }

  for (let iter = 0; iter < 24; iter++) {
    let changed = false;
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const dL = labs[i][0] - labs[j][0], da = labs[i][1] - labs[j][1], db = labs[i][2] - labs[j][2];
        const dE = Math.sqrt(dL * dL + da * da + db * db);
        if (dE < MIN_DELTA_E) {
          const need = (MIN_DELTA_E - dE) / 2 + 0.5;
          if (labs[i][0] >= labs[j][0]) {
            labs[i][0] = Math.min(92, labs[i][0] + need);
            labs[j][0] = Math.max(16, labs[j][0] - need);
          } else {
            labs[j][0] = Math.min(92, labs[j][0] + need);
            labs[i][0] = Math.max(16, labs[i][0] - need);
          }
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return labs.map(([L, a, b]) => {
    const [r, g, bl] = labToRgb(L, a, b);
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    return (c(r) << 16) | (c(g) << 8) | c(bl);
  });
}

/** Deterministic k-means over sampled RGB colors. */
function kmeansQuantize(rgb: Float32Array, n: number, k: number, seed: number): { assign: Int16Array; palette: number[] } {
  const kk = Math.max(1, Math.min(k, n));
  const rng = mulberry32(seed);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const centroids = new Float32Array(kk * 3);
  for (let c = 0; c < kk; c++) {
    const p = order[c % n];
    centroids[c * 3] = rgb[p * 3];
    centroids[c * 3 + 1] = rgb[p * 3 + 1];
    centroids[c * 3 + 2] = rgb[p * 3 + 2];
  }
  const assign = new Int16Array(n);
  const sums = new Float64Array(kk * 3);
  const counts = new Int32Array(kk);
  for (let iter = 0; iter < 10; iter++) {
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity;
      const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
      for (let c = 0; c < kk; c++) {
        const dr = r - centroids[c * 3], dg = g - centroids[c * 3 + 1], db = b - centroids[c * 3 + 2];
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) { bestD = d; best = c; }
      }
      assign[i] = best;
    }
    sums.fill(0);
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const c = assign[i];
      sums[c * 3] += rgb[i * 3];
      sums[c * 3 + 1] += rgb[i * 3 + 1];
      sums[c * 3 + 2] += rgb[i * 3 + 2];
      counts[c]++;
    }
    let moved = false;
    for (let c = 0; c < kk; c++) {
      if (counts[c] === 0) continue;
      const nr = sums[c * 3] / counts[c], ng = sums[c * 3 + 1] / counts[c], nb = sums[c * 3 + 2] / counts[c];
      if (Math.abs(nr - centroids[c * 3]) > 0.5 || Math.abs(ng - centroids[c * 3 + 1]) > 0.5 || Math.abs(nb - centroids[c * 3 + 2]) > 0.5) moved = true;
      centroids[c * 3] = nr; centroids[c * 3 + 1] = ng; centroids[c * 3 + 2] = nb;
    }
    if (!moved) break;
  }
  const rawPalette: number[] = [];
  for (let c = 0; c < kk; c++) {
    const r = Math.max(0, Math.min(255, Math.round(centroids[c * 3])));
    const g = Math.max(0, Math.min(255, Math.round(centroids[c * 3 + 1])));
    const b = Math.max(0, Math.min(255, Math.round(centroids[c * 3 + 2])));
    rawPalette.push((r << 16) | (g << 8) | b);
  }
  return { assign, palette: readablePalette(rawPalette) };
}

/** 2 passes of neighbor-majority smoothing. */
function majoritySmooth(colorIdx: Int16Array, nbrStart: Int32Array, nbrList: Int32Array, k: number, passes = 2): Int16Array {
  let cur = colorIdx;
  const hist = new Int32Array(k);
  for (let p = 0; p < passes; p++) {
    const next = new Int16Array(cur.length);
    for (let i = 0; i < cur.length; i++) {
      hist.fill(0);
      hist[cur[i]]++;
      for (let e = nbrStart[i]; e < nbrStart[i + 1]; e++) hist[cur[nbrList[e]]]++;
      let best = cur[i], bestCount = -1;
      for (let c = 0; c < k; c++) if (hist[c] > bestCount) { bestCount = hist[c]; best = c; }
      next[i] = best;
    }
    cur = next;
  }
  return cur;
}

/**
 * Repeatedly merges the smallest connected region into its dominant neighbor
 * color until at most `target` regions remain. Recognizable big features
 * (ocean, large land masses) survive because the *smallest* region is always
 * the one merged next.
 */
function mergeToRegionTarget(colorIdx: Int16Array, nbrStart: Int32Array, nbrList: Int32Array, k: number, target: number): void {
  const n = colorIdx.length;
  if (target < 1 || n === 0) return;
  const hist = new Int32Array(k);
  const seen = new Uint8Array(n);
  let guard = 0;
  while (guard++ < n) {
    seen.fill(0);
    let smallest: number[] | null = null;
    let count = 0;
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      const color = colorIdx[i];
      const comp: number[] = [i];
      seen[i] = 1;
      let qi = 0;
      while (qi < comp.length) {
        const cur = comp[qi++];
        for (let e = nbrStart[cur]; e < nbrStart[cur + 1]; e++) {
          const j = nbrList[e];
          if (!seen[j] && colorIdx[j] === color) { seen[j] = 1; comp.push(j); }
        }
      }
      count++;
      if (!smallest || comp.length < smallest.length) smallest = comp;
    }
    if (count <= target || !smallest) return;
    const color = colorIdx[smallest[0]];
    hist.fill(0);
    for (const ci of smallest) {
      for (let e = nbrStart[ci]; e < nbrStart[ci + 1]; e++) {
        const nc = colorIdx[nbrList[e]];
        if (nc !== color) hist[nc]++;
      }
    }
    let best = -1, bestCount = 0;
    for (let c = 0; c < k; c++) if (hist[c] > bestCount) { bestCount = hist[c]; best = c; }
    if (best < 0) return; // isolated shell (single color) — nothing left to merge into
    for (const ci of smallest) colorIdx[ci] = best;
  }
}

/** GDD §3 pipeline: sample -> k-means -> 2-pass majority smoothing -> merge down to the region target. */
function paintFromTexture(dirs: Float32Array, img: ImageDataLike, k: number, regionTarget: number, seed: number, nbrStart: Int32Array, nbrList: Int32Array): { colorIdx: Int16Array; palette: number[] } {
  const n = dirs.length / 3;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [lon, lat] = dirToLonLat(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
    const [r, g, b] = sampleEquirect(img, lon, lat);
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
  }
  const { assign, palette } = kmeansQuantize(rgb, n, k, seed);
  const smoothed = majoritySmooth(assign, nbrStart, nbrList, palette.length, 2);
  mergeToRegionTarget(smoothed, nbrStart, nbrList, palette.length, regionTarget);
  return { colorIdx: smoothed, palette };
}

/** Resets connected true-clusters smaller than `minSize` back to false. */
function dropSmallTrueClusters(mask: Int16Array, nbrStart: Int32Array, nbrList: Int32Array, minSize: number): void {
  const n = mask.length;
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!mask[i] || seen[i]) continue;
    const comp: number[] = [i];
    seen[i] = 1;
    let qi = 0;
    while (qi < comp.length) {
      const cur = comp[qi++];
      for (let e = nbrStart[cur]; e < nbrStart[cur + 1]; e++) {
        const j = nbrList[e];
        if (!seen[j] && mask[j]) { seen[j] = 1; comp.push(j); }
      }
    }
    if (comp.length < minSize) for (const ci of comp) mask[ci] = 0;
  }
}

const CLOUD_L40 = 102; // 40% of 255 (GDD: cloud bead exists where luminance >= L40)
const CLOUD_MIN_CLUSTER = 12; // isolated/tiny cloud clusters get dropped so patches stay coherent
const GREY_WHITE_PALETTE = [0xffffff, 0xd7dee8]; // at most 2 tones

/**
 * Earth: cloud bead exists where the cloud texture is bright enough, but the
 * raw threshold is noisy (scattered single beads), so the existence mask is
 * itself majority-smoothed on the cloud neighbor graph and tiny/isolated
 * clusters are dropped — clouds read as coherent patches, not static.
 */
function buildEarthCloudPaint(dirs: Float32Array, img: ImageDataLike, nbrStart: Int32Array, nbrList: Int32Array): { keep: Uint8Array; colorIdx: Int16Array; palette: number[] } {
  const n = dirs.length / 3;
  const rawExists = new Int16Array(n);
  const brightness = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const [lon, lat] = dirToLonLat(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
    const [r, g, b] = sampleEquirect(img, lon, lat);
    const L = 0.299 * r + 0.587 * g + 0.114 * b;
    brightness[i] = L;
    rawExists[i] = L >= CLOUD_L40 ? 1 : 0;
  }
  const exists = majoritySmooth(rawExists, nbrStart, nbrList, 2, 2);
  dropSmallTrueClusters(exists, nbrStart, nbrList, CLOUD_MIN_CLUSTER);
  const keep = new Uint8Array(n);
  const colorIdx = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    if (!exists[i]) continue;
    keep[i] = 1;
    colorIdx[i] = brightness[i] > 178 ? 0 : 1; // 2 tones
  }
  return { keep, colorIdx, palette: GREY_WHITE_PALETTE };
}

const VENUS_CLOUD_PALETTE = [0xf6ecd2, 0xdcc48a]; // at most 2 tones

/** Venus: procedural cream bands, always present (no real cloud texture for Venus). */
function buildVenusCloudPaint(dirs: Float32Array, seed: number): Int16Array {
  const n = dirs.length / 3;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = dirs[i * 3], y = dirs[i * 3 + 1], z = dirs[i * 3 + 2];
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    const wobble = (fbm3(x * 3, y * 3, z * 3, seed) - 0.5) * 0.5;
    const band = Math.abs(lat) + wobble;
    out[i] = band < 0.5 ? 0 : 1;
  }
  return out;
}

/** Bucket-based angular coverage: for each `a` bead, which `b` beads lie within its footprint. */
function computeFootprint(aDirs: Float32Array, aSpacing: number, bDirs: Float32Array, bSpacing: number): Int32Array[] {
  const bCount = bDirs.length / 3;
  const cosLimit = Math.cos(Math.max(aSpacing, bSpacing) * 0.75);
  const cell = 0.25;
  const bk = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  const buckets = new Map<string, number[]>();
  for (let j = 0; j < bCount; j++) {
    const k = bk(bDirs[j * 3], bDirs[j * 3 + 1], bDirs[j * 3 + 2]);
    let a = buckets.get(k);
    if (!a) buckets.set(k, (a = []));
    a.push(j);
  }
  const aCount = aDirs.length / 3;
  const out: Int32Array[] = new Array(aCount);
  for (let i = 0; i < aCount; i++) {
    const x = aDirs[i * 3], y = aDirs[i * 3 + 1], z = aDirs[i * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    const hits: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const a = buckets.get(`${cx + dx},${cy + dy},${cz + dz}`);
      if (!a) continue;
      for (const j of a) {
        const d = bDirs[j * 3] * x + bDirs[j * 3 + 1] * y + bDirs[j * 3 + 2] * z;
        if (d > cosLimit) hits.push(j);
      }
    }
    out[i] = Int32Array.from(hits);
  }
  return out;
}

// ---------------- BeadGlobe ----------------

export class BeadGlobe implements GlobeAdapter {
  readonly group = new THREE.Group();
  readonly shells: Shell[] = [];
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.Material;
  private readonly popEvents: PopEvent[] = [];
  private popAnims: PopAnim[] = [];
  private animClock = 0;

  constructor(cfg: LevelConfig, images: TextureMap, material: THREE.Material) {
    const planet = PLANETS[cfg.planet];
    this.geometry = new THREE.SphereGeometry(1, 10, 7);
    this.material = material;

    const surfaceImg = images[planet.surfaceTexture as TextureName];
    if (!surfaceImg) throw new Error(`BeadGlobe: missing surface texture for ${cfg.planet}`);

    // Split the level's region-count budget between shells, roughly by bead share,
    // so the whole level (surface + clouds combined) stays a short mobile session.
    let surfaceTarget = cfg.regionTarget;
    let cloudTarget = 0;
    if (cfg.cloudBeadCount > 0) {
      const totalBeads = cfg.beadCount + cfg.cloudBeadCount;
      cloudTarget = Math.max(2, Math.round((cfg.regionTarget * cfg.cloudBeadCount) / totalBeads));
      surfaceTarget = Math.max(3, cfg.regionTarget - cloudTarget);
    }

    const surfaceDirs = fibonacciSphere(cfg.beadCount);
    const surfaceSpacing = Math.sqrt((4 * Math.PI) / cfg.beadCount);
    const { start: sStart, list: sList } = buildNeighbors(surfaceDirs, surfaceSpacing * 1.45);
    const { colorIdx: sColorIdx, palette: sPalette } = paintFromTexture(surfaceDirs, surfaceImg, cfg.k, surfaceTarget, cfg.seed, sStart, sList);
    const surface = this.makeShell('surface', surfaceDirs, sStart, sList, sColorIdx, sPalette, 1.0, cfg.beadCount, cfg.seed);
    this.shells.push(surface);

    if (cfg.cloudBeadCount > 0) {
      const cloudSpacing = Math.sqrt((4 * Math.PI) / cfg.cloudBeadCount);
      const cloudDirsFull = fibonacciSphere(cfg.cloudBeadCount);
      const { start: cFullStart, list: cFullList } = buildNeighbors(cloudDirsFull, cloudSpacing * 1.6);
      let cloudDirs: Float32Array;
      let cColorIdx: Int16Array;
      let cPalette: number[];
      if (cfg.planet === 'venus') {
        cloudDirs = cloudDirsFull; // always fully covers — no existence mask needed
        cColorIdx = buildVenusCloudPaint(cloudDirs, cfg.seed + 1);
        cPalette = VENUS_CLOUD_PALETTE;
      } else {
        const cloudImg = planet.cloudTexture ? images[planet.cloudTexture as TextureName] : undefined;
        if (!cloudImg) throw new Error(`BeadGlobe: missing cloud texture for ${cfg.planet}`);
        const { keep, colorIdx, palette } = buildEarthCloudPaint(cloudDirsFull, cloudImg, cFullStart, cFullList);
        const kept: number[] = [];
        const keptColor: number[] = [];
        for (let i = 0; i < cfg.cloudBeadCount; i++) {
          if (!keep[i]) continue;
          kept.push(cloudDirsFull[i * 3], cloudDirsFull[i * 3 + 1], cloudDirsFull[i * 3 + 2]);
          keptColor.push(colorIdx[i]);
        }
        cloudDirs = Float32Array.from(kept);
        cColorIdx = Int16Array.from(keptColor);
        cPalette = palette;
      }
      const { start: cStart, list: cList } = buildNeighbors(cloudDirs, cloudSpacing * 1.6);
      mergeToRegionTarget(cColorIdx, cStart, cList, cPalette.length, cloudTarget);
      const clouds = this.makeShell('clouds', cloudDirs, cStart, cList, cColorIdx, cPalette, 1.06, cfg.cloudBeadCount, cfg.seed + 2);
      this.shells.push(clouds);

      const cloudCovers = computeFootprint(cloudDirs, cloudSpacing, surfaceDirs, surfaceSpacing);
      const surfaceCoveredBy: Int32Array[] = new Array(surface.count).fill(null).map(() => [] as number[]) as unknown as Int32Array[];
      const buckets: number[][] = new Array(surface.count);
      for (let i = 0; i < surface.count; i++) buckets[i] = [];
      for (let ci = 0; ci < cloudCovers.length; ci++) {
        for (const si of cloudCovers[ci]) buckets[si].push(ci);
      }
      for (let i = 0; i < surface.count; i++) surfaceCoveredBy[i] = Int32Array.from(buckets[i]);
      surface.coveredBy = surfaceCoveredBy;
    }

    for (const s of this.shells) this.group.add(s.mesh);
  }

  private makeShell(kind: Shell['kind'], dirs: Float32Array, nbrStart: Int32Array, nbrList: Int32Array, colorIdx: Int16Array, palette: number[], radius: number, designCount: number, seed: number): Shell {
    const count = dirs.length / 3;
    const spacing = Math.sqrt((4 * Math.PI) / designCount);
    // Clouds overlap more than surface beads so a coherent patch reads as a solid layer, not dots.
    const beadRadius = spacing * radius * (kind === 'clouds' ? 0.72 : 0.56);
    const mesh = new THREE.InstancedMesh(this.geometry, this.material, Math.max(1, count));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const shell: Shell = {
      kind, count, radius, dirs, nbrStart, nbrList, colorIdx, palette,
      alive: new Uint8Array(count).fill(1), scale: new Float32Array(count).fill(1),
      mesh, beadRadius, seed,
    };
    const rng = mulberry32(seed ^ 0x9e3779b9);
    for (let i = 0; i < count; i++) {
      this.writeMatrix(shell, i);
      tmpC.setHex(palette[colorIdx[i]]);
      const j = 0.94 + rng() * 0.1; // subtle per-bead shade variation, reads as pearls
      tmpC.multiplyScalar(j);
      mesh.setColorAt(i, tmpC);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.userData.shellId = this.shells.length;
    mesh.userData.shell = shell;
    return shell;
  }

  private writeMatrix(shell: Shell, i: number): void {
    const r = shell.radius;
    tmpV.set(shell.dirs[i * 3] * r, shell.dirs[i * 3 + 1] * r, shell.dirs[i * 3 + 2] * r);
    const s = shell.beadRadius * shell.scale[i];
    tmpS.set(s, s, s);
    tmpM.compose(tmpV, tmpQ, tmpS);
    shell.mesh.setMatrixAt(i, tmpM);
  }

  private writeMatrixAtPos(shell: Shell, i: number, x: number, y: number, z: number, scale: number): void {
    tmpV.set(x, y, z);
    const s = shell.beadRadius * scale;
    tmpS.set(s, s, s);
    tmpM.compose(tmpV, tmpQ, tmpS);
    shell.mesh.setMatrixAt(i, tmpM);
  }

  // ---------------- GlobeAdapter ----------------

  aliveCount(): number {
    let n = 0;
    for (const s of this.shells) for (let i = 0; i < s.count; i++) n += s.alive[i];
    return n;
  }

  region(shellId: number, startIdx: number): BeadRef[] {
    const shell = this.shells[shellId];
    const color = shell.colorIdx[startIdx];
    const seen = new Uint8Array(shell.count);
    const out: BeadRef[] = [];
    let frontier = [startIdx];
    seen[startIdx] = 1;
    while (frontier.length) {
      const next: number[] = [];
      for (const i of frontier) {
        out.push({ shellId, index: i });
        for (let p = shell.nbrStart[i]; p < shell.nbrStart[i + 1]; p++) {
          const j = shell.nbrList[p];
          if (!seen[j] && shell.alive[j] && shell.colorIdx[j] === color) {
            seen[j] = 1;
            next.push(j);
          }
        }
      }
      frontier = next;
    }
    return out;
  }

  countRegions(): number {
    let total = 0;
    for (let shellId = 0; shellId < this.shells.length; shellId++) {
      const s = this.shells[shellId];
      const seen = new Uint8Array(s.count);
      for (let i = 0; i < s.count; i++) {
        if (!s.alive[i] || seen[i]) continue;
        total++;
        for (const b of this.region(shellId, i)) seen[b.index] = 1;
      }
    }
    return total;
  }

  private isCovered(shell: Shell, i: number): boolean {
    if (!shell.coveredBy) return false;
    const clouds = this.shells.find((s) => s.kind === 'clouds');
    if (!clouds) return false;
    const cov = shell.coveredBy[i];
    for (let k = 0; k < cov.length; k++) if (clouds.alive[cov[k]]) return true;
    return false;
  }

  isExposed(shellId: number, index: number): boolean {
    const shell = this.shells[shellId];
    if (!shell.alive[index]) return false;
    return !this.isCovered(shell, index);
  }

  colorAt(shellId: number, index: number): number | null {
    const shell = this.shells[shellId];
    if (!shell || !shell.alive[index] || this.isCovered(shell, index)) return null;
    return shell.palette[shell.colorIdx[index]];
  }

  exposedColors(): Map<number, number> {
    const counts = new Map<number, number>();
    for (let shellId = 0; shellId < this.shells.length; shellId++) {
      const s = this.shells[shellId];
      for (let i = 0; i < s.count; i++) {
        if (!s.alive[i] || this.isCovered(s, i)) continue;
        const hex = s.palette[s.colorIdx[i]];
        counts.set(hex, (counts.get(hex) ?? 0) + 1);
      }
    }
    return counts;
  }

  positionOf(shellId: number, index: number): Vec3 {
    const s = this.shells[shellId];
    return { x: s.dirs[index * 3] * s.radius, y: s.dirs[index * 3 + 1] * s.radius, z: s.dirs[index * 3 + 2] * s.radius };
  }

  private forEachExposed(fn: (shellId: number, i: number, x: number, y: number, z: number) => void): void {
    for (let shellId = 0; shellId < this.shells.length; shellId++) {
      const s = this.shells[shellId];
      for (let i = 0; i < s.count; i++) {
        if (!s.alive[i] || this.isCovered(s, i)) continue;
        fn(shellId, i, s.dirs[i * 3] * s.radius, s.dirs[i * 3 + 1] * s.radius, s.dirs[i * 3 + 2] * s.radius);
      }
    }
  }

  beadsInRadius(point: Vec3, radius: number): BeadRef[] {
    const out: BeadRef[] = [];
    const r2 = radius * radius;
    this.forEachExposed((shellId, i, x, y, z) => {
      const dx = x - point.x, dy = y - point.y, dz = z - point.z;
      if (dx * dx + dy * dy + dz * dz <= r2) out.push({ shellId, index: i });
    });
    return out;
  }

  beadsOfColorInHemisphere(color: number, viewDir: Vec3): BeadRef[] {
    const len = Math.hypot(viewDir.x, viewDir.y, viewDir.z) || 1;
    const vx = viewDir.x / len, vy = viewDir.y / len, vz = viewDir.z / len;
    const out: BeadRef[] = [];
    for (let shellId = 0; shellId < this.shells.length; shellId++) {
      const s = this.shells[shellId];
      for (let i = 0; i < s.count; i++) {
        if (!s.alive[i] || this.isCovered(s, i)) continue;
        if (s.palette[s.colorIdx[i]] !== color) continue;
        const dot = s.dirs[i * 3] * vx + s.dirs[i * 3 + 1] * vy + s.dirs[i * 3 + 2] * vz;
        if (dot > 0) out.push({ shellId, index: i });
      }
    }
    return out;
  }

  beadsInBand(normal: Vec3, halfWidth: number): BeadRef[] {
    const len = Math.hypot(normal.x, normal.y, normal.z) || 1;
    const nx = normal.x / len, ny = normal.y / len, nz = normal.z / len;
    const out: BeadRef[] = [];
    for (let shellId = 0; shellId < this.shells.length; shellId++) {
      const s = this.shells[shellId];
      for (let i = 0; i < s.count; i++) {
        if (!s.alive[i] || this.isCovered(s, i)) continue;
        const dot = s.dirs[i * 3] * nx + s.dirs[i * 3 + 1] * ny + s.dirs[i * 3 + 2] * nz;
        if (Math.abs(dot) < halfWidth) out.push({ shellId, index: i });
      }
    }
    return out;
  }

  pop(beads: BeadRef[]): void {
    let i = 0;
    for (const b of beads) {
      const shell = this.shells[b.shellId];
      if (!shell.alive[b.index]) continue;
      const hex = shell.palette[shell.colorIdx[b.index]];
      const pos = this.positionOf(b.shellId, b.index);
      this.popEvents.push({ position: pos, color: hex });
      shell.alive[b.index] = 0;
      this.popAnims.push({ shell, index: b.index, t0: this.animClock + Math.min(i, 40) * 0.016, dur: 0.2 });
      i++;
    }
  }

  /** Popped bead positions + colors since the last call, for FX. */
  drainPopEvents(): PopEvent[] {
    const out = this.popEvents.slice();
    this.popEvents.length = 0;
    return out;
  }

  // ---------------- tutorial targeting helpers (integration layer only) ----------------

  /**
   * Largest currently-exposed connected region of the given hex color (any
   * shell), or null if that color has no exposed beads. Used by the
   * integration layer to spotlight a sizeable target for the "fire" tutorial.
   */
  findLargestExposedRegionOfColor(color: number): BeadRef[] | null {
    let best: BeadRef[] | null = null;
    for (let shellId = 0; shellId < this.shells.length; shellId++) {
      const s = this.shells[shellId];
      const seen = new Uint8Array(s.count);
      for (let i = 0; i < s.count; i++) {
        if (!s.alive[i] || seen[i] || this.isCovered(s, i) || s.palette[s.colorIdx[i]] !== color) continue;
        const region = this.region(shellId, i);
        for (const b of region) seen[b.index] = 1;
        if (!best || region.length > best.length) best = region;
      }
    }
    return best;
  }

  /** Largest currently-exposed connected region on the `clouds` shell (any color), or null. Used by the L40 tutorial. */
  findLargestExposedCloudRegion(): BeadRef[] | null {
    const shellId = this.shells.findIndex((s) => s.kind === 'clouds');
    if (shellId === -1) return null;
    const s = this.shells[shellId];
    let best: BeadRef[] | null = null;
    const seen = new Uint8Array(s.count);
    for (let i = 0; i < s.count; i++) {
      if (!s.alive[i] || seen[i]) continue;
      const region = this.region(shellId, i);
      for (const b of region) seen[b.index] = 1;
      if (!best || region.length > best.length) best = region;
    }
    return best;
  }

  // ---------------- picking (for the integration layer's raycaster) ----------------

  /** Meshes to pass to `THREE.Raycaster.intersectObjects`. */
  raycastTargets(): THREE.Object3D[] {
    return this.shells.map((s) => s.mesh);
  }

  /** Resolves a sorted-by-distance intersection list to the first alive, hittable bead. */
  resolveHit(hits: THREE.Intersection[]): { shellId: number; index: number; point: THREE.Vector3 } | null {
    for (const h of hits) {
      if (h.instanceId === undefined) continue;
      const shellId = (h.object as THREE.InstancedMesh).userData.shellId as number;
      const shell = this.shells[shellId];
      const i = h.instanceId;
      if (!shell.alive[i] || this.isCovered(shell, i)) continue;
      return { shellId, index: i, point: h.point.clone() };
    }
    return null;
  }

  beadRadius(shellId = 0): number {
    return this.shells[shellId]?.beadRadius ?? 0.02;
  }

  // ---------------- level-start / win animations ----------------

  /** Beads fly in from random far points in space and settle, staggered. Resolves when settled. */
  assemble(seconds: number): Promise<void> {
    const now = this.animClock;
    for (const shell of this.shells) {
      const n = shell.count;
      const rng = mulberry32(shell.seed ^ 0x51ed270b);
      const from = new Float32Array(n * 3);
      const t0 = new Float32Array(n);
      const dur = Math.max(0.05, seconds * 0.4);
      for (let i = 0; i < n; i++) {
        const theta = rng() * Math.PI * 2;
        const phi = Math.acos(2 * rng() - 1);
        const r = 6 + rng() * 6;
        from[i * 3] = Math.sin(phi) * Math.cos(theta) * r;
        from[i * 3 + 1] = Math.cos(phi) * r;
        from[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * r;
        t0[i] = now + rng() * Math.max(0, seconds - dur);
      }
      shell.animFrom = from;
      shell.animT0 = t0;
      shell.animDur = dur;
      shell.animEnd = now + seconds;
      shell.animMode = 'assembling';
      shell.alive.fill(1);
    }
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds * 1000)));
  }

  /** All remaining beads fly outward and vanish, staggered. Resolves when finished. */
  burstAway(seconds: number): Promise<void> {
    const now = this.animClock;
    for (const shell of this.shells) {
      const n = shell.count;
      const rng = mulberry32((shell.seed ^ 0x2545f491) + 7);
      const from = new Float32Array(n * 3); // reused as the "to" (outward) target here
      const t0 = new Float32Array(n);
      const dur = Math.max(0.05, seconds * 0.5);
      for (let i = 0; i < n; i++) {
        const scaleOut = 5 + rng() * 4;
        from[i * 3] = shell.dirs[i * 3] * shell.radius * scaleOut;
        from[i * 3 + 1] = shell.dirs[i * 3 + 1] * shell.radius * scaleOut;
        from[i * 3 + 2] = shell.dirs[i * 3 + 2] * shell.radius * scaleOut;
        t0[i] = now + rng() * Math.max(0, seconds - dur);
      }
      shell.animFrom = from;
      shell.animT0 = t0;
      shell.animDur = dur;
      shell.animEnd = now + seconds;
      shell.animMode = 'bursting';
    }
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, seconds * 1000)));
  }

  /** Advances pop/assemble/burst animations. Call every frame with the render delta. */
  update(dt: number): void {
    this.animClock += dt;
    const dirty = new Set<Shell>();
    this.updatePops(dirty);
    this.updateFlyAnims(dirty);
    for (const s of dirty) s.mesh.instanceMatrix.needsUpdate = true;
  }

  private updatePops(dirty: Set<Shell>): void {
    if (this.popAnims.length === 0) return;
    const next: PopAnim[] = [];
    for (const p of this.popAnims) {
      const u = (this.animClock - p.t0) / p.dur;
      if (u < 0) { next.push(p); continue; }
      const s = u >= 1 ? 0 : u < 0.35 ? 1 + 0.4 * (u / 0.35) : 1.4 * (1 - (u - 0.35) / 0.65);
      p.shell.scale[p.index] = s;
      this.writeMatrix(p.shell, p.index);
      dirty.add(p.shell);
      if (u < 1) next.push(p);
    }
    this.popAnims = next;
  }

  private updateFlyAnims(dirty: Set<Shell>): void {
    for (const shell of this.shells) {
      if (!shell.animMode || !shell.animFrom || !shell.animT0 || shell.animDur === undefined || shell.animEnd === undefined) continue;
      const finished = this.animClock >= shell.animEnd;
      const isAssemble = shell.animMode === 'assembling';
      for (let i = 0; i < shell.count; i++) {
        if (!shell.alive[i] && isAssemble === false) continue;
        const t0 = shell.animT0[i];
        const u = Math.max(0, Math.min(1, (this.animClock - t0) / shell.animDur));
        const ease = u * u * (3 - 2 * u);
        const fx = shell.animFrom[i * 3], fy = shell.animFrom[i * 3 + 1], fz = shell.animFrom[i * 3 + 2];
        const tx = shell.dirs[i * 3] * shell.radius, ty = shell.dirs[i * 3 + 1] * shell.radius, tz = shell.dirs[i * 3 + 2] * shell.radius;
        if (isAssemble) {
          const x = fx + (tx - fx) * ease, y = fy + (ty - fy) * ease, z = fz + (tz - fz) * ease;
          this.writeMatrixAtPos(shell, i, x, y, z, shell.scale[i]);
        } else {
          const x = tx + (fx - tx) * ease, y = ty + (fy - ty) * ease, z = tz + (fz - tz) * ease;
          this.writeMatrixAtPos(shell, i, x, y, z, shell.scale[i] * (1 - ease));
        }
      }
      dirty.add(shell);
      if (finished) {
        if (!isAssemble) shell.alive.fill(0);
        shell.animMode = undefined;
        shell.animFrom = undefined;
        shell.animT0 = undefined;
        shell.animDur = undefined;
        shell.animEnd = undefined;
        for (let i = 0; i < shell.count; i++) this.writeMatrix(shell, i);
      }
    }
  }

  dispose(): void {
    for (const s of this.shells) s.mesh.dispose();
    this.geometry.dispose();
  }
}
