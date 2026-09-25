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
import { FIRE_COLOR } from './invasion';

export type TextureName = 'earth_daymap' | 'earth_clouds' | 'moon' | 'venus_surface' | 'mars' | 'jupiter';
export type TextureMap = Partial<Record<TextureName, ImageDataLike>>;

/** Bead-radius-from-spacing factor for every non-cloud shell (surface/layer). Also used by `computeFootprint` (see there). */
const BEAD_RADIUS_FACTOR = 0.56;
/** Same, for the `clouds` shell — clouds overlap more so a patch reads as a solid layer, not dots. */
const BEAD_RADIUS_FACTOR_CLOUD = 0.72;
function beadRadiusFactor(kind: Shell['kind']): number {
  return kind === 'clouds' ? BEAD_RADIUS_FACTOR_CLOUD : BEAD_RADIUS_FACTOR;
}

interface Shell {
  kind: 'surface' | 'clouds' | 'layer';
  count: number;
  radius: number;
  spacing: number;
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
  /**
   * Index (into `BeadGlobe.shells`) of the shell directly outside this one, if
   * any. This shell's bead `i` is hidden ("covered") while any of the
   * covering shell's beads whose footprint overlaps it are still alive —
   * this is how clouds hide the surface, and how each outer coarse layer
   * hides the finer layer/surface underneath it, until it's fully cleared.
   */
  coveringShellIndex?: number;
  /** covering[i] = bead indices on `coveringShellIndex`'s shell whose footprint covers this shell's bead i. */
  coveredBy?: Int32Array[];
  /** Item #19: clouds shell only — radians/sec the mesh drifts around its local Y axis, independent of the globe's own spin/drag. 0 = static. */
  driftSpeedRad?: number;
  /** Item #19: radians of drift accumulated since the last `coveredBy` recompute (reset each recompute). */
  driftAccumRad?: number;
  // Assemble/burst animation state (optional; present once an animation has been kicked off).
  animFrom?: Float32Array; // n*3, far/outward points
  animT0?: Float32Array; // per-bead start time (animClock seconds)
  animDur?: number;
  animEnd?: number;
  animMode?: 'assembling' | 'bursting';
  /** Alien invasion (item #22): palette index reserved for `FIRE_COLOR` on this shell, once first ignited (lazy — most shells never need one). */
  fireColorIdx?: number;
  /** Alien invasion: bead index -> `animClock` time it was ignited, for the brief bright "just caught fire" pulse. Cleared once the pulse fades. */
  ignitedAt?: Map<number, number>;
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
/** Fire flicker/pulse scratch colors (item #22) — hot is a near-white-hot orange-yellow, well past any planet palette's max lightness. */
const fireEmber = new THREE.Color();
const fireHot = new THREE.Color(0xffee66);
const fireWhite = new THREE.Color(0xffffff);
const fireTmp = new THREE.Color();
const FIRE_PULSE_DURATION = 0.45;
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
 * hue is kept (the a/b direction in Lab), lightness is pulled into a band
 * that stays visible under camera-relative gameplay lighting (not crushed to
 * near-black or blown to near-white), weak chroma is nudged up so muted
 * centroids read as a recognizable color rather than grey, and any pair of
 * colors closer than `minDeltaE` (CIE76 distance in Lab) is pulled apart in
 * lightness until they're distinguishable. True near-greys (ice, clouds,
 * regolith) are left alone so realism — oceans blue, deserts sand, forests
 * green, ice white — survives the pass.
 */
/**
 * `palette` is the final (possibly merged-down) color list; `mergeMap[i]`
 * gives the final palette index that raw centroid `i` maps to, so the
 * caller can remap its per-bead color-index array. `minDeltaE` is the
 * smallest CIE76 distance between any two final colors (for QA reporting).
 */
interface ReadablePaletteResult {
  palette: number[];
  mergeMap: number[];
  minDeltaE: number;
}

function readablePalette(paletteHex: number[]): ReadablePaletteResult {
  // Kept close to the raw k-means centroid: readability must come from
  // lighting/gloss, not from exaggerating colors away from the real
  // texture's tones — the owner's standing rule is that a bead's color must
  // match the ground/ocean color underneath it. A round-3/round-4 attempt at
  // "clearly distinct on every planet" rotated hue up to 55° and pushed a
  // ΔE≥30 floor to get there, which routinely moved a color so far from its
  // own k-means centroid that it stopped matching the real texture — the
  // owner's actual, later bug report ("bead colors don't match the ground").
  // The rule now is explicit: a color may drift **at most `MAX_SHIFT_FROM_ORIGINAL`
  // ΔE from its own raw centroid**, never rotated in hue at all; if two
  // classes are still too close after that limited push, they are MERGED
  // (fewer, but still each still faithful to a real centroid) rather than
  // shoved further apart. `MIN_DELTA_E` is the floor for whatever classes
  // remain after merging, not a target every original centroid must reach on
  // its own.
  const MIN_L = 28;
  const MAX_L = 90;
  const MIN_CHROMA = 16;
  const MIN_DELTA_E = 20;
  const MAX_SHIFT_FROM_ORIGINAL = 10;

  const originalLabs: [number, number, number][] = paletteHex.map((hex) => {
    const r = ((hex >> 16) & 255) / 255, g = ((hex >> 8) & 255) / 255, b = (hex & 255) / 255;
    return rgbToLab(r, g, b);
  });
  const labs: [number, number, number][] = originalLabs.map((lab) => [...lab] as [number, number, number]);

  const distFromOriginal = (i: number): number => {
    const [oL, oa, ob] = originalLabs[i];
    const [L, a, b] = labs[i];
    return Math.sqrt((L - oL) ** 2 + (a - oa) ** 2 + (b - ob) ** 2);
  };
  // Clamps `labs[i]` back onto the sphere of radius `MAX_SHIFT_FROM_ORIGINAL` around its
  // own original centroid whenever a push has moved it further than that.
  const clampToBudget = (i: number): void => {
    const d = distFromOriginal(i);
    if (d <= MAX_SHIFT_FROM_ORIGINAL) return;
    const t = MAX_SHIFT_FROM_ORIGINAL / d;
    const [oL, oa, ob] = originalLabs[i];
    labs[i][0] = oL + (labs[i][0] - oL) * t;
    labs[i][1] = oa + (labs[i][1] - oa) * t;
    labs[i][2] = ob + (labs[i][2] - ob) * t;
  };
  // Nudges `labs[i]`'s lightness by `delta` (toward legibility or away from a too-close
  // neighbor), but never past the per-color drift budget from its own original centroid.
  const shiftLightness = (i: number, delta: number): void => {
    labs[i][0] = Math.max(16, Math.min(92, labs[i][0] + delta));
    clampToBudget(i);
  };

  for (let i = 0; i < labs.length; i++) {
    const [L, a, b] = labs[i];
    let newL = L;
    if (newL < MIN_L) newL = MIN_L + (newL / MIN_L) * 8;
    if (newL > MAX_L) newL = MAX_L;
    labs[i][0] = newL;
    const chroma = Math.hypot(a, b);
    if (chroma > 2 && chroma < MIN_CHROMA) {
      const s = MIN_CHROMA / chroma;
      labs[i][1] = a * s;
      labs[i][2] = b * s;
    }
    clampToBudget(i);
  }

  // Separation pass: push too-close pairs apart in lightness only (no hue rotation — hue is
  // exactly what must stay put to keep matching the ground), each push capped by how much of
  // its ΔE-from-original budget that color has left. A pair that's already at (or near) its
  // budget on both sides just can't be pushed any further, and falls through to the merge
  // step below instead.
  for (let iter = 0; iter < 48; iter++) {
    let changed = false;
    for (let i = 0; i < labs.length; i++) {
      for (let j = i + 1; j < labs.length; j++) {
        const dL = labs[i][0] - labs[j][0], da = labs[i][1] - labs[j][1], db = labs[i][2] - labs[j][2];
        const dE = Math.sqrt(dL * dL + da * da + db * db);
        if (dE < MIN_DELTA_E) {
          const before = [labs[i][0], labs[j][0]];
          const need = (MIN_DELTA_E - dE) / 2 + 0.5;
          if (labs[i][0] >= labs[j][0]) {
            shiftLightness(i, need);
            shiftLightness(j, -need);
          } else {
            shiftLightness(j, need);
            shiftLightness(i, -need);
          }
          if (labs[i][0] !== before[0] || labs[j][0] !== before[1]) changed = true;
        }
      }
    }
    if (!changed) break;
  }

  // Final safety net: merge any pair still under MIN_DELTA_E — either because the lightness
  // push above couldn't move it far enough within its drift budget, or because it was never
  // touched (union-find so a chain of near-duplicates collapses to one representative).
  // Merging and measuring must be two separate passes: recording a pair's distance as
  // `minDeltaE` in the same step that decides to merge it would report a distance that no
  // longer exists once that pair collapses into a single final color.
  const parent = labs.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  };
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const dL = labs[i][0] - labs[j][0], da = labs[i][1] - labs[j][1], db = labs[i][2] - labs[j][2];
      const dE = Math.sqrt(dL * dL + da * da + db * db);
      if (dE < MIN_DELTA_E) parent[find(j)] = find(i);
    }
  }
  let minDeltaE = Infinity;
  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      if (find(i) === find(j)) continue;
      const dL = labs[i][0] - labs[j][0], da = labs[i][1] - labs[j][1], db = labs[i][2] - labs[j][2];
      minDeltaE = Math.min(minDeltaE, Math.sqrt(dL * dL + da * da + db * db));
    }
  }
  if (labs.length < 2) minDeltaE = Infinity;

  const toHex = ([L, a, b]: [number, number, number]): number => {
    const [r, g, bl] = labToRgb(L, a, b);
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
    return (c(r) << 16) | (c(g) << 8) | c(bl);
  };

  const roots = labs.map((_, i) => find(i));
  const uniqueRoots: number[] = [];
  for (const r of roots) if (!uniqueRoots.includes(r)) uniqueRoots.push(r);
  const palette = uniqueRoots.map((r) => toHex(labs[r]));
  const mergeMap = roots.map((r) => uniqueRoots.indexOf(r));
  return { palette, mergeMap, minDeltaE: Number.isFinite(minDeltaE) ? minDeltaE : 999 };
}

/** Deterministic k-means over sampled RGB colors. */
function kmeansQuantize(rgb: Float32Array, n: number, k: number, seed: number): { assign: Int16Array; palette: number[]; minDeltaE: number } {
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
  const { palette, mergeMap, minDeltaE } = readablePalette(rawPalette);
  const mergedAssign = new Int16Array(n);
  for (let i = 0; i < n; i++) mergedAssign[i] = mergeMap[assign[i]];
  return { assign: mergedAssign, palette, minDeltaE };
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
function paintFromTexture(dirs: Float32Array, img: ImageDataLike, k: number, regionTarget: number, seed: number, nbrStart: Int32Array, nbrList: Int32Array): { colorIdx: Int16Array; palette: number[]; minDeltaE: number } {
  const n = dirs.length / 3;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [lon, lat] = dirToLonLat(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
    const [r, g, b] = sampleEquirect(img, lon, lat);
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
  }
  const { assign, palette, minDeltaE } = kmeansQuantize(rgb, n, k, seed);
  const smoothed = majoritySmooth(assign, nbrStart, nbrList, palette.length, 2);
  mergeToRegionTarget(smoothed, nbrStart, nbrList, palette.length, regionTarget);
  return { colorIdx: smoothed, palette, minDeltaE };
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

// Owner requirement (round 3): the ΔE≥20(->30) readability pass must apply to
// every planet, but Venus's "surface" is this fixed constant, not a texture
// run through `readablePalette()`, so it needs the same bar applied by hand.
// The original pair (0xf6ecd2, 0xdcc48a) was only ~23 ΔE apart — both very
// light creams that bloom/tonemap washed into a near-uniform white ball. Now
// 3 tones spanning pale cloud-top yellow through ochre to a dark rust-brown
// (real Venus radar/UV imagery: cloud-top pale yellow/tan swirls over
// ochre/orange-brown lowlands+highlands) — every pair measures ≥30 ΔE.
const VENUS_CLOUD_PALETTE = [0xf5e6b8, 0xcf9a4e, 0x74451a];

/**
 * Venus: procedural cloud-top swirl pattern, always present (no real cloud
 * texture for Venus). Round 3 owner bug report: the original version split
 * purely on `|lat|` (equator vs. poles), so on a typical gameplay framing —
 * camera roughly equatorial, auto-spin turning around the same axis the
 * latitude split is defined on — the second tone almost never rotated into
 * view, reading as a near-uniform ball. This shears longitude by latitude
 * (mimicking the real Y/chevron-shaped cloud bands Venus's fast equatorial
 * winds actually produce) before noise-thresholding into 3 classes, so every
 * latitude band — including whatever's on screen at any spin phase — shows
 * a mix of all 3 tones instead of concentrating one near the poles.
 */
function buildVenusCloudPaint(dirs: Float32Array, seed: number): Int16Array {
  const n = dirs.length / 3;
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = dirs[i * 3], y = dirs[i * 3 + 1], z = dirs[i * 3 + 2];
    const lat = Math.asin(Math.max(-1, Math.min(1, y)));
    const lon = Math.atan2(z, x);
    const shear = lon + lat * 2.4;
    const swirl = fbm3(Math.cos(shear) * 2.2, y * 2.2, Math.sin(shear) * 2.2, seed);
    const fine = fbm3(x * 5, y * 5, z * 5, seed + 11);
    const v = swirl * 0.75 + fine * 0.25;
    // `fbm3`'s multi-octave averaging clusters its output tightly around ~0.485 (empirically
    // sampled: p33≈0.448, p66≈0.52, far from a uniform [0,1] spread), so naive evenly-spaced
    // thresholds (e.g. 0.42/0.68) starved the darkest class down to ~1% of the sphere — visually
    // absent. These thresholds are picked from that empirical distribution instead, so all 3
    // classes stay reasonably present (verified ~25-50% each across several seeds).
    out[i] = v < 0.45 ? 0 : v < 0.515 ? 1 : 2;
  }
  return out;
}

/**
 * Inverse of `computeFootprint`: for each `body` bead, which `covering` bead
 * indices sit above it (i.e. `covering`'s footprint reaches it). Used to wire
 * up the "hidden until the shell above clears" occlusion chain (clouds over
 * the outermost layer, each outer layer over the next one in, down to the
 * real surface).
 */
function buildCoveredBy(coveringDirs: Float32Array, coveringSpacing: number, coveringFactor: number, bodyDirs: Float32Array, bodySpacing: number, bodyFactor: number): Int32Array[] {
  const forward = computeFootprint(coveringDirs, coveringSpacing, coveringFactor, bodyDirs, bodySpacing, bodyFactor); // forward[coveringIdx] -> body indices it covers
  const bodyCount = bodyDirs.length / 3;
  const buckets: number[][] = new Array(bodyCount);
  for (let i = 0; i < bodyCount; i++) buckets[i] = [];
  for (let ci = 0; ci < forward.length; ci++) {
    for (const bi of forward[ci]) buckets[bi].push(ci);
  }
  return buckets.map((arr) => Int32Array.from(arr));
}

/** Rotates a flat (x,y,z)*n direction array around the world Y axis by `angle` radians. */
function rotateDirsY(dirs: Float32Array, angle: number): Float32Array {
  const c = Math.cos(angle), s = Math.sin(angle);
  const out = new Float32Array(dirs.length);
  for (let i = 0; i < dirs.length; i += 3) {
    const x = dirs[i], z = dirs[i + 2];
    out[i] = x * c + z * s;
    out[i + 1] = dirs[i + 1];
    out[i + 2] = -x * s + z * c;
  }
  return out;
}

/**
 * Bucket-based angular coverage: for each `a` bead, which `b` beads lie within its footprint.
 * The threshold is the actual rendered angular half-size of each side's own bead (spacing ×
 * that shell's bead-radius factor — 0.56 normally, 0.72 for clouds, matching `makeShell`'s
 * real geometry) summed together plus a small margin, rather than a flat, factor-blind
 * `max(spacing) * 0.75` guess. The old guess didn't know about the 0.72 cloud factor and only
 * used the larger of the two spacings (not the sum of both halves), so it under-covered
 * exactly where a bead is geometrically still hidden behind a bigger/still-alive covering
 * bead: the game logic called it "exposed" (paintable, hittable, rendered at full opacity)
 * while the covering bead's own sphere still visually overlapped it on screen — read by the
 * owner as "some beads are two-colored" (a still-alive covering bead's color bleeding/z-
 * fighting into a bead the game had already started treating as clear).
 */
function computeFootprint(aDirs: Float32Array, aSpacing: number, aFactor: number, bDirs: Float32Array, bSpacing: number, bFactor: number): Int32Array[] {
  const bCount = bDirs.length / 3;
  const MARGIN = 1.15;
  const cosLimit = Math.cos((aSpacing * aFactor + bSpacing * bFactor) * MARGIN);
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
  /** Item #19: the clouds shell's dedicated material (cloned from the shared bead material), disposed separately. */
  private cloudMaterial: THREE.Material | null = null;
  /** Item #19: static info needed to recompute cloud occlusion as the cloud mesh drifts (see `updateCloudDrift`). */
  private cloudCoverRecalc: { cloudDirs: Float32Array; cloudSpacing: number; bodyShellIndex: number; bodyDirs: Float32Array; bodySpacing: number } | null = null;

  constructor(cfg: LevelConfig, images: TextureMap, material: THREE.Material) {
    const planet = PLANETS[cfg.planet];
    this.geometry = new THREE.SphereGeometry(1, 10, 7);
    this.material = material;

    const surfaceImg = images[planet.surfaceTexture as TextureName];
    if (!surfaceImg) throw new Error(`BeadGlobe: missing surface texture for ${cfg.planet}`);

    // Split the level's region-count budget across every shell (extra coarse
    // layers + surface + clouds), roughly by bead share, so the whole level
    // stays a short mobile session even as layers are added (GDD §3/§13: the
    // shot budget must account for all layers — `GameSession` derives its
    // probe count from `countRegions()`, which sums across every shell here).
    const numExtra = cfg.extraLayers.length;
    const allCounts = [...cfg.extraLayers.map((l) => l.beadCount), cfg.beadCount, ...(cfg.cloudBeadCount > 0 ? [cfg.cloudBeadCount] : [])];
    const totalBeadsAll = allCounts.reduce((a, b) => a + b, 0);
    // Jupiter's procedural bands (`generateJupiterBands`) alternate its 8-color palette
    // across ~2.25 full latitude cycles, so ~18 separate horizontal rings must survive
    // per shell for the planet to actually read as banded (owner bug report: the normal
    // continent-style region floor of 3 collapsed almost all of those rings into one or
    // two blobs). A floor comfortably above that ring count means the merge step below
    // never has anything to do on Jupiter — every natural ring stays intact.
    const regionFloor = cfg.planet === 'jupiter' ? 28 : 3;
    const regionShare = (n: number) => Math.max(regionFloor, Math.round((cfg.regionTarget * n) / totalBeadsAll));
    const RADIUS_STEP = 0.03;

    // Outer coarse layers first (index 0 = outermost, coarsest, biggest beads,
    // fewest colors), each one hiding the layer inside it until it's cleared
    // — reuses the exact same paint/merge/occlusion pipeline as the surface
    // and clouds shells below, just at a bigger radius and a lower K.
    let prevDirs: Float32Array | null = null;
    let prevSpacing = 0;
    let prevShellIndex: number | null = null;
    const paletteMinDeltaEs: number[] = [];
    for (let d = 0; d < numExtra; d++) {
      const layerCfg = cfg.extraLayers[d];
      const radius = 1.0 + RADIUS_STEP * (numExtra - d);
      const dirs = fibonacciSphere(layerCfg.beadCount);
      const spacing = Math.sqrt((4 * Math.PI) / layerCfg.beadCount);
      const { start, list } = buildNeighbors(dirs, spacing * 1.45);
      const seed = cfg.seed + d * 101 + 3;
      const { colorIdx, palette, minDeltaE } = paintFromTexture(dirs, surfaceImg, layerCfg.k, regionShare(layerCfg.beadCount), seed, start, list);
      paletteMinDeltaEs.push(minDeltaE);
      const shell = this.makeShell('layer', dirs, start, list, colorIdx, palette, radius, layerCfg.beadCount, seed);
      if (prevDirs) {
        shell.coveringShellIndex = prevShellIndex!;
        shell.coveredBy = buildCoveredBy(prevDirs, prevSpacing, BEAD_RADIUS_FACTOR, dirs, spacing, BEAD_RADIUS_FACTOR);
      }
      this.shells.push(shell);
      prevDirs = dirs;
      prevSpacing = spacing;
      prevShellIndex = this.shells.length - 1;
    }

    // Surface: the innermost, most-detailed shell — the real planet, revealed once every layer above it is cleared.
    const surfaceDirs = fibonacciSphere(cfg.beadCount);
    const surfaceSpacing = Math.sqrt((4 * Math.PI) / cfg.beadCount);
    const { start: sStart, list: sList } = buildNeighbors(surfaceDirs, surfaceSpacing * 1.45);
    const { colorIdx: sColorIdx, palette: sPalette, minDeltaE: sMinDeltaE } = paintFromTexture(surfaceDirs, surfaceImg, cfg.k, regionShare(cfg.beadCount), cfg.seed, sStart, sList);
    paletteMinDeltaEs.push(sMinDeltaE);
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug(`[BeadGlobe] level ${cfg.level} palette minDeltaE (surface+layers): ${Math.min(...paletteMinDeltaEs).toFixed(1)}`);
    }
    const surface = this.makeShell('surface', surfaceDirs, sStart, sList, sColorIdx, sPalette, 1.0, cfg.beadCount, cfg.seed);
    if (prevDirs) {
      surface.coveringShellIndex = prevShellIndex!;
      surface.coveredBy = buildCoveredBy(prevDirs, prevSpacing, BEAD_RADIUS_FACTOR, surfaceDirs, surfaceSpacing, BEAD_RADIUS_FACTOR);
    }
    this.shells.push(surface);
    const outermostBodyIndex = numExtra > 0 ? 0 : this.shells.length - 1;
    const outermostBodyDirs = numExtra > 0 ? this.shells[0].dirs : surfaceDirs;
    const outermostBodySpacing = numExtra > 0 ? this.shells[0].spacing : surfaceSpacing;

    if (cfg.cloudBeadCount > 0) {
      const cloudRadius = 1.0 + RADIUS_STEP * numExtra + 0.06;
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
      mergeToRegionTarget(cColorIdx, cStart, cList, cPalette.length, regionShare(cfg.cloudBeadCount));

      // Item #19: clouds get their own material, growing softer/fluffier/more translucent
      // (lower opacity, less clearcoat gloss, softer roughness) as the overall level rises —
      // early on they read as plain glossy white beads, matching the shared pearl material.
      const fluff = cfg.cloudFluffiness;
      const cloudMat = (this.material as THREE.MeshPhysicalMaterial).clone();
      cloudMat.transparent = fluff > 0.001;
      cloudMat.opacity = THREE.MathUtils.lerp(1, 0.72, fluff);
      cloudMat.roughness = THREE.MathUtils.lerp(0.4, 0.85, fluff);
      cloudMat.clearcoat = THREE.MathUtils.lerp(0.75, 0.1, fluff);
      cloudMat.depthWrite = fluff <= 0.001;
      if (cfg.planet === 'venus') {
        // Venus's cloud shell *is* its entire visible gameplay surface at every level (unlike
        // Earth, which only shows early-game glossy-pearl clouds briefly before they fluff up) —
        // the shared early-game glossy settings above, stacked with Venus's own bright palette
        // and atmosphere glow, is exactly what blew the globe out to a featureless white blob
        // (owner bug report). Always matte/opaque here regardless of the global fluffiness
        // curve, so individual beads and color classes stay legible at every Venus level.
        cloudMat.clearcoat = 0.12;
        cloudMat.roughness = 0.8;
        cloudMat.transparent = false;
        cloudMat.opacity = 1;
        cloudMat.depthWrite = true;
        cloudMat.envMapIntensity = 0.1;
      }
      this.cloudMaterial = cloudMat;

      const clouds = this.makeShell('clouds', cloudDirs, cStart, cList, cColorIdx, cPalette, cloudRadius, cfg.cloudBeadCount, cfg.seed + 2, cloudMat);
      // Item #19: from CLOUD_DRIFT_LEVEL, clouds drift independently over the surface — the
      // mesh's own rotation carries the drift, on top of whatever the shared globe spin/drag does,
      // so it composes for free through the normal parent/child transform chain.
      if (cfg.cloudDriftEnabled) {
        const driftRng = mulberry32(cfg.seed ^ 0x5b3c1a2f);
        clouds.driftSpeedRad = THREE.MathUtils.degToRad(3 + driftRng() * 4) * (driftRng() < 0.5 ? -1 : 1);
        clouds.driftAccumRad = 0;
      }
      this.shells.push(clouds);
      const cloudShellIndex = this.shells.length - 1;

      const outermostBody = this.shells[outermostBodyIndex];
      outermostBody.coveringShellIndex = cloudShellIndex;
      outermostBody.coveredBy = buildCoveredBy(cloudDirs, cloudSpacing, BEAD_RADIUS_FACTOR_CLOUD, outermostBodyDirs, outermostBodySpacing, BEAD_RADIUS_FACTOR);
      this.cloudCoverRecalc = { cloudDirs, cloudSpacing, bodyShellIndex: outermostBodyIndex, bodyDirs: outermostBodyDirs, bodySpacing: outermostBodySpacing };
    }

    for (const s of this.shells) this.group.add(s.mesh);
  }

  private makeShell(kind: Shell['kind'], dirs: Float32Array, nbrStart: Int32Array, nbrList: Int32Array, colorIdx: Int16Array, palette: number[], radius: number, designCount: number, seed: number, materialOverride?: THREE.Material): Shell {
    const count = dirs.length / 3;
    const spacing = Math.sqrt((4 * Math.PI) / designCount);
    // Clouds overlap more than surface/layer beads so a coherent patch reads as a solid layer, not dots.
    const beadRadius = spacing * radius * beadRadiusFactor(kind);
    const mesh = new THREE.InstancedMesh(this.geometry, materialOverride ?? this.material, Math.max(1, count));
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const shell: Shell = {
      kind, count, radius, spacing, dirs, nbrStart, nbrList, colorIdx, palette,
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

  /**
   * Which concentric bead layer (1 = outermost) the player is currently working through, and how
   * many there are in total (excluding `clouds`, which isn't counted as a "layer" — see GDD §13's
   * `layerCount`). "Current" is the outermost body shell (surface/`layer`, outer-to-inner is this
   * array's own construction order) that still has any alive bead — used for the HUD's own layer
   * indicator (owner bug report: "the layered structure isn't there").
   */
  layerProgress(): { current: number; total: number } {
    const bodyShells = this.shells.filter((s) => s.kind !== 'clouds');
    const total = bodyShells.length;
    for (let idx = 0; idx < bodyShells.length; idx++) {
      const s = bodyShells[idx];
      let alive = 0;
      for (let i = 0; i < s.count; i++) alive += s.alive[i];
      if (alive > 0) return { current: idx + 1, total };
    }
    return { current: total, total };
  }

  /** Read-only per-shell diagnostic (alive vs. exposed-alive counts), for QA only — see `Game.ts`'s dev-only `__wbQA` hook. */
  debugShellBreakdown(): { kind: string; count: number; alive: number; exposedAlive: number }[] {
    return this.shells.map((s) => {
      let alive = 0, exposedAlive = 0;
      for (let i = 0; i < s.count; i++) {
        if (!s.alive[i]) continue;
        alive++;
        if (!this.isCovered(s, i)) exposedAlive++;
      }
      return { kind: s.kind, count: s.count, alive, exposedAlive };
    });
  }

  /**
   * Connected same-color, currently-exposed beads starting at (shellId,
   * startIdx) — i.e. what a player can actually see and would expect to pop
   * together. The BFS stops at any same-color bead that's still `isCovered`
   * (hidden under an intact outer layer/cloud elsewhere on this shell): the
   * neighbor graph only knows adjacency, not visibility, so without this
   * check a same-color patch that happens to also reach under still-alive
   * cover would pop invisibly — the player never sees it happen, and later,
   * once the cover above it finally clears, that patch is already gone
   * instead of being revealed (the reported "layers aren't really there" and
   * beads vanishing without a visible pop). `startIdx` itself is always
   * exposed already (every caller checks that before calling `region`).
   */
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
          if (!seen[j] && shell.alive[j] && shell.colorIdx[j] === color && !this.isCovered(shell, j)) {
            seen[j] = 1;
            next.push(j);
          }
        }
      }
      frontier = next;
    }
    return out;
  }

  /**
   * Same as `region()` but coverage-*blind* — a same-color, same-shell connected patch counts as
   * one region even where part of it is currently `isCovered`. Coverage is a live, temporary state
   * (it clears the moment whatever's above it gets popped), so it must NOT fragment the *budgeting*
   * count `countRegions()` uses: at level start almost every body-shell bead starts covered by an
   * outer layer/cloud that is itself still 100% alive, so the coverage-aware `region()` (correct for
   * an actual `fire()`, see there) would make nearly every alive bead its own singleton "region" —
   * inflating the shot budget from tens to thousands and making a level nearly unfinishable. This is
   * only ever used for that one-time budgeting count, never for what an actual pop touches.
   */
  private rawRegion(shellId: number, startIdx: number): BeadRef[] {
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
        for (const b of this.rawRegion(shellId, i)) seen[b.index] = 1;
      }
    }
    return total;
  }

  private isCovered(shell: Shell, i: number): boolean {
    if (!shell.coveredBy || shell.coveringShellIndex === undefined) return false;
    const covering = this.shells[shell.coveringShellIndex];
    const cov = shell.coveredBy[i];
    for (let k = 0; k < cov.length; k++) if (covering.alive[cov[k]]) return true;
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

  /** Rotates a shell-local (raw `dirs`-space) point into the group's local space, undoing nothing — i.e. applying the shell mesh's own drift rotation (item #19; identity for non-drifting shells). */
  private fromShellLocal(shell: Shell, x: number, y: number, z: number): Vec3 {
    const angle = shell.mesh.rotation.y;
    if (angle === 0) return { x, y, z };
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: x * c + z * s, y, z: -x * s + z * c };
  }

  positionOf(shellId: number, index: number): Vec3 {
    const s = this.shells[shellId];
    return this.fromShellLocal(s, s.dirs[index * 3] * s.radius, s.dirs[index * 3 + 1] * s.radius, s.dirs[index * 3 + 2] * s.radius);
  }

  private forEachExposed(fn: (shellId: number, i: number, x: number, y: number, z: number) => void): void {
    for (let shellId = 0; shellId < this.shells.length; shellId++) {
      const s = this.shells[shellId];
      for (let i = 0; i < s.count; i++) {
        if (!s.alive[i] || this.isCovered(s, i)) continue;
        const p = this.fromShellLocal(s, s.dirs[i * 3] * s.radius, s.dirs[i * 3 + 1] * s.radius, s.dirs[i * 3 + 2] * s.radius);
        fn(shellId, i, p.x, p.y, p.z);
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
      // Query direction arrives in group-local space; undo this shell's own drift rotation (item #19) before comparing against its raw `dirs`.
      const v = this.toShellLocal(s, { x: vx, y: vy, z: vz });
      for (let i = 0; i < s.count; i++) {
        if (!s.alive[i] || this.isCovered(s, i)) continue;
        if (s.palette[s.colorIdx[i]] !== color) continue;
        const dot = s.dirs[i * 3] * v.x + s.dirs[i * 3 + 1] * v.y + s.dirs[i * 3 + 2] * v.z;
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
      const n = this.toShellLocal(s, { x: nx, y: ny, z: nz });
      for (let i = 0; i < s.count; i++) {
        if (!s.alive[i] || this.isCovered(s, i)) continue;
        const dot = s.dirs[i * 3] * n.x + s.dirs[i * 3 + 1] * n.y + s.dirs[i * 3 + 2] * n.z;
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
      this.popEvents.push({ position: pos, color: hex, radius: shell.beadRadius });
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

  // ---------------- alien invasion: fire (see `src/game/invasion.ts`) ----------------

  /** `GlobeAdapter.neighborsOf` — alive neighbors of a bead on that shell's own neighbor graph, regardless of color/coverage. */
  neighborsOf(shellId: number, index: number): BeadRef[] {
    const s = this.shells[shellId];
    const out: BeadRef[] = [];
    for (let p = s.nbrStart[index]; p < s.nbrStart[index + 1]; p++) {
      const j = s.nbrList[p];
      if (s.alive[j]) out.push({ shellId, index: j });
    }
    return out;
  }

  /**
   * `GlobeAdapter.igniteFire` — reassigns each bead's logical color to
   * `colorHex` (a lazily-added, per-shell palette entry so repeated calls
   * don't grow the palette) without popping it, paints it immediately, and
   * records when it caught fire for the ignite-pulse in `updateFireFlicker`.
   */
  igniteFire(beads: BeadRef[], colorHex: number): void {
    const touched = new Set<Shell>();
    for (const b of beads) {
      const shell = this.shells[b.shellId];
      if (!shell.alive[b.index]) continue;
      if (shell.fireColorIdx === undefined) {
        shell.fireColorIdx = shell.palette.length;
        shell.palette.push(colorHex);
      }
      shell.colorIdx[b.index] = shell.fireColorIdx;
      if (!shell.ignitedAt) shell.ignitedAt = new Map();
      shell.ignitedAt.set(b.index, this.animClock);
      tmpC.setHex(colorHex);
      shell.mesh.setColorAt(b.index, tmpC);
      touched.add(shell);
    }
    for (const shell of touched) if (shell.mesh.instanceColor) shell.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * Per-bead ember flicker (two mismatched sine frequencies + per-index
   * phase offset, dim ember red -> hot orange-yellow) plus a brief bright
   * white "just ignited" pulse, for every bead currently on fire. Chosen to
   * read as unmistakably distinct from every planet's own static k-means
   * palette (including Mars's rust/red-orange, the closest hue neighbor):
   * fire is far more saturated, its top flicker tone is near-white-hot
   * (well past any planet palette's max lightness), and — unlike any static
   * bead color — it visibly animates every frame.
   */
  private updateFireFlicker(): void {
    for (const shell of this.shells) {
      if (shell.fireColorIdx === undefined) continue;
      let any = false;
      for (let i = 0; i < shell.colorIdx.length; i++) {
        if (!shell.alive[i] || shell.colorIdx[i] !== shell.fireColorIdx) continue;
        any = true;
        const flick = 0.55 + 0.225 * Math.sin(this.animClock * 9 + i * 0.7) + 0.225 * Math.sin(this.animClock * 21.3 - i * 1.3);
        fireEmber.setHex(FIRE_COLOR).lerp(fireHot, Math.max(0, Math.min(1, flick)));
        fireTmp.copy(fireEmber);
        const t0 = shell.ignitedAt?.get(i);
        if (t0 !== undefined) {
          const age = this.animClock - t0;
          if (age < FIRE_PULSE_DURATION) fireTmp.lerp(fireWhite, (1 - age / FIRE_PULSE_DURATION) * 0.9);
          else shell.ignitedAt!.delete(i);
        }
        shell.mesh.setColorAt(i, fireTmp);
      }
      if (any && shell.mesh.instanceColor) shell.mesh.instanceColor.needsUpdate = true;
    }
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

  /**
   * Resolves a sorted-by-distance intersection list to the first alive,
   * hittable bead. Falls back to snapping to the nearest alive cloud bead
   * when the raycast missed every instance but did land on the globe: a
   * discrete instanced sphere always has small gaps between beads, and at
   * oblique/grazing camera angles those gaps get threaded far more often
   * even though the cloud patch reads as visually solid — without this, a
   * cloud bead could be un-hittable from most angles even though it's
   * clearly on screen (item #9).
   *
   * `fallbackPoint` (a world-space point on the globe's own outer bounding
   * sphere, from an analytic ray/sphere test — see `Game.ts`'s `pickBead`)
   * is used for the same snap when the raycast hit *no* bead instance at
   * all, which is exactly the case at the globe's limb: a grazing ray can
   * thread every instance's gaps at once (not just the cloud shell's), so
   * `hits` comes back empty and there was previously no fallback whatsoever
   * — this is why cloud beads near the limb stayed unhittable from some
   * angles even after item #9 (owner bug report, round 2).
   */
  resolveHit(hits: THREE.Intersection[], fallbackPoint?: THREE.Vector3 | null): { shellId: number; index: number; point: THREE.Vector3 } | null {
    for (const h of hits) {
      if (h.instanceId === undefined) continue;
      const shellId = (h.object as THREE.InstancedMesh).userData.shellId as number;
      const shell = this.shells[shellId];
      const i = h.instanceId;
      if (!shell.alive[i] || this.isCovered(shell, i)) continue;
      return { shellId, index: i, point: h.point.clone() };
    }
    const originPoint = hits.length > 0 ? hits[0].point : fallbackPoint;
    if (!originPoint) return null;
    const cloudShellId = this.shells.findIndex((s) => s.kind === 'clouds');
    if (cloudShellId === -1) return null;
    const cloud = this.shells[cloudShellId];
    const worldLocal = this.group.worldToLocal(originPoint.clone());
    if (worldLocal.lengthSq() < 1e-8) return null;
    worldLocal.normalize();
    // The clouds mesh may be drifting (item #19) — undo its rotation so the query
    // direction lines up with the shell's own raw `dirs` array before scanning.
    const local = this.toShellLocal(cloud, { x: worldLocal.x, y: worldLocal.y, z: worldLocal.z });
    let best = -1;
    let bestDot = -1;
    for (let i = 0; i < cloud.count; i++) {
      if (!cloud.alive[i]) continue;
      const dot = cloud.dirs[i * 3] * local.x + cloud.dirs[i * 3 + 1] * local.y + cloud.dirs[i * 3 + 2] * local.z;
      if (dot > bestDot) { bestDot = dot; best = i; }
    }
    const tolerance = Math.cos(cloud.spacing * 1.6);
    if (best >= 0 && bestDot > tolerance) {
      return { shellId: cloudShellId, index: best, point: hits[0].point.clone() };
    }
    return null;
  }

  beadRadius(shellId = 0): number {
    return this.shells[shellId]?.beadRadius ?? 0.02;
  }

  /** Radius of the outermost shell (clouds, if any, else the outermost layer/surface) — for a fallback ray/sphere test when a raycast hits no bead instance at all. */
  outerRadius(): number {
    let r = 1.0;
    for (const s of this.shells) r = Math.max(r, s.radius);
    return r;
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
    this.updateCloudDrift(dt);
    this.updateFireFlicker();
    for (const s of dirty) s.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Item #19: spins the clouds mesh independently and periodically recomputes what it covers as it drifts. */
  private updateCloudDrift(dt: number): void {
    const clouds = this.shells.find((s) => s.kind === 'clouds');
    if (!clouds || !clouds.driftSpeedRad || !this.cloudCoverRecalc) return;
    clouds.mesh.rotation.y += clouds.driftSpeedRad * dt;
    clouds.driftAccumRad = (clouds.driftAccumRad ?? 0) + Math.abs(clouds.driftSpeedRad * dt);
    // Recompute roughly every ~3 degrees of drift — frequent enough that blocked beads feel
    // like they genuinely track the moving clouds, cheap enough (a bucketed O(n) scan, not a
    // draw call) to run several times a second without affecting frame time.
    if (clouds.driftAccumRad < THREE.MathUtils.degToRad(3)) return;
    clouds.driftAccumRad = 0;
    const { cloudSpacing, bodyShellIndex, bodyDirs, bodySpacing } = this.cloudCoverRecalc;
    const rotatedCloudDirs = rotateDirsY(clouds.dirs, clouds.mesh.rotation.y);
    const body = this.shells[bodyShellIndex];
    body.coveredBy = buildCoveredBy(rotatedCloudDirs, cloudSpacing, BEAD_RADIUS_FACTOR_CLOUD, bodyDirs, bodySpacing, BEAD_RADIUS_FACTOR);
  }

  /** Transforms a group-local point/direction into `shell`'s own local space, undoing its drift rotation (item #19; identity for non-drifting shells). */
  private toShellLocal(shell: Shell, v: Vec3): Vec3 {
    if (!shell.driftSpeedRad && shell.mesh.rotation.y === 0) return v;
    const angle = -shell.mesh.rotation.y;
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
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
    this.cloudMaterial?.dispose();
  }
}
