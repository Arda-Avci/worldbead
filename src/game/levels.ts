/**
 * Level progression (item #15 supersedes the old fixed Earth/Moon/Venus/Mars
 * chapter table): the planet changes every `SLOT_LENGTH` levels in a
 * repeating 5-planet cycle (Earth -> Moon -> Mars -> Venus -> Jupiter ->
 * Earth again, ...), so players don't spend hundreds of levels on one world.
 * Every stat that drives detail/difficulty (bead count, K/color count, layer
 * count, region-target, shot slack) is a function of the *global* level
 * number, not reset per planet or per cycle — so a later visit to a planet
 * (e.g. the 2nd Earth visit, ~level 201) is always visibly more detailed and
 * harder than the previous visit to that same planet.
 */
import type { PlanetId } from './planets';

/** Planets visit in this fixed order, repeating forever; every 5th slot revisits Earth, more detailed each time. */
export const CYCLE: PlanetId[] = ['earth', 'moon', 'mars', 'venus', 'jupiter'];
/** Levels spent on each planet before moving to the next one in the cycle. */
export const SLOT_LENGTH = 10;

/** Total playable levels (20 full cycles of the 5-planet rotation). */
export const MAX_LEVEL = CYCLE.length * SLOT_LENGTH * 20;

/**
 * Whether each planet ever grows a cloud shell — the only thing that still
 * varies by planet. Bead *count* (and therefore bead *size*) used to also
 * vary per planet via a per-planet range, which was the root cause of a bug
 * (owner-reported): a planet with a lower bead-count ceiling could show
 * visibly bigger beads than an earlier, more advanced level on a different
 * planet. Bead size is now derived purely from the global level number and
 * layer depth (see `surfaceBeadRadius`/`layerBeadRadius` below), identically
 * for every planet, so two levels at the same overall progress always show
 * the same bead size regardless of which planet they're on.
 */
const CURVES: Record<PlanetId, { cloud: 'none' | 'earth' | 'always' }> = {
  earth: { cloud: 'earth' },
  moon: { cloud: 'none' },
  venus: { cloud: 'always' },
  mars: { cloud: 'none' },
  jupiter: { cloud: 'none' },
};

/** One extra coarse bead layer sitting outside the (innermost) `surface` shell — item #13. */
export interface ExtraLayerConfig {
  beadCount: number;
  k: number;
}

export interface LevelConfig {
  level: number;
  planet: PlanetId;
  /** How many times this exact planet has been visited before (0 = first visit). */
  visitNumber: number;
  /** Levels remaining on the current planet before the cycle moves to `nextPlanet` (0 = this is the last level here). */
  levelsUntilNextPlanet: number;
  nextPlanet: PlanetId;
  beadCount: number;
  /** Bead count sampled to build the cloud shell before existence-thresholding; 0 = no clouds. */
  cloudBeadCount: number;
  /** Item #19: whether this level's cloud shell (if any) drifts independently and blocks shots until cleared/drifted away. */
  cloudDriftEnabled: boolean;
  /** Item #19: 0 (plain white beads) .. 1 (fluffiest/most translucent) — grows globally, not reset per planet. */
  cloudFluffiness: number;
  /** k-means color count — a single global curve driven by the overall level number, shared by every planet (owner requirement: never resets per planet). */
  k: number;
  /**
   * Extra concentric bead layers outside the innermost `surface` shell,
   * ordered outermost-first: coarser (fewer beads, lower K, bigger beads)
   * the farther out. The player clears them outside-in; the real planet
   * body is revealed once `surface` itself is cleared.
   */
  extraLayers: ExtraLayerConfig[];
  /** Total concentric bead layers this level has (1 + extraLayers.length). */
  layerCount: number;
  /** Item #16 (superseded): whether the idle auto-spin runs at all this level (false = drag-only). */
  autoSpinEnabled: boolean;
  /** Whether the auto-spin's axis can tilt off pure-horizontal this level. */
  spinTiltEnabled: boolean;
  /** Whether the auto-spin can reverse direction between phases this level. */
  spinReverseEnabled: boolean;
  /**
   * Target connected-region count for this level, summed across all shells
   * (every layer + clouds), so the level stays a short mobile session.
   * `BeadGlobe` merges the smallest region into its dominant neighbor color,
   * repeatedly, until each shell's share of this budget is met.
   */
  regionTarget: number;
  seed: number;
  /** Probes = ceil(regions * shotSlack). 1.5 early game -> 1.1 late game. */
  shotSlack: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** k-means color count: a single smooth curve over the *whole* game, identical for every planet (owner requirement). */
function globalK(progress: number): number {
  return Math.round(3 + 10 * Math.pow(progress, 0.7));
}

/**
 * Bead *size* model (owner bug fix): every layer's bead radius is derived
 * purely from the global level number and its depth from the surface, and
 * is GUARANTEED to never exceed `BEAD_RADIUS_MAX` (level 1's own radius) —
 * so no later level, and no outer/coarser layer introduced at a later
 * level, can ever show a bigger bead than an earlier level did. Radius
 * shrinks monotonically with level at every fixed depth, and outer layers
 * are only ever *modestly* bigger than the layer just inside them at the
 * same level (coarser color-wise via a lower K, not dramatically bigger
 * bead-wise). `BEAD_RADIUS_STEP`/`BEAD_RADIUS_FACTOR` mirror the constants
 * `BeadGlobe.ts`'s `makeShell` actually renders with (`RADIUS_STEP` and the
 * non-cloud 0.56 factor) — kept as a duplicated, commented pair rather than
 * a cross-import, per this codebase's convention of not importing between
 * modules that shouldn't depend on each other's internals.
 */
const BEAD_RADIUS_STEP = 0.03; // must match BeadGlobe.ts makeShell's extra-layer geometric radius step
const BEAD_RADIUS_FACTOR = 0.56; // must match BeadGlobe.ts makeShell's non-cloud bead-radius factor
/** Level 1's bead radius — the hard ceiling no bead, on any layer or level, may ever exceed. */
const BEAD_RADIUS_MAX = 0.072;
/**
 * The finest (innermost, most-advanced) bead radius the curve ever reaches.
 * Chosen so that a maxed-out level (4 layers, fully saturated) still totals
 * well under a mobile-safe bead budget (~14k instanced beads) WITHOUT ever
 * needing to grow bead size back up to stay under budget — the owner's
 * explicit priority order ("reduce layer count before you ever increase
 * bead size") is satisfied by construction: layer count is separately
 * capped at 4 by `LAYER_MILESTONES`, and this floor is picked low enough
 * that the two caps together never require a corrective size increase.
 */
const BEAD_RADIUS_MIN = 0.03;
/** Each layer step outward is this much bigger (radius-wise) than the layer just inside it, at the same level. */
const BEAD_RADIUS_COARSE_PER_DEPTH = 0.12;
/** The bead-size shrink curve is fully saturated by this level; later levels keep the same (minimum) bead size rather than continuing to shrink or ever growing back. */
const BEAD_SIZE_SATURATION_LEVEL = 700;

/** Innermost (`surface`, depth 0) bead radius at a given level, decreasing monotonically to `BEAD_RADIUS_MIN`. */
function surfaceBeadRadius(sizeProgress: number): number {
  return BEAD_RADIUS_MAX - (BEAD_RADIUS_MAX - BEAD_RADIUS_MIN) * Math.pow(sizeProgress, 0.55);
}
/** Bead radius for a layer `depthFromSurface` steps outside the surface (0 = surface itself), same level. */
function layerBeadRadius(sizeProgress: number, depthFromSurface: number): number {
  return Math.min(BEAD_RADIUS_MAX, surfaceBeadRadius(sizeProgress) * (1 + BEAD_RADIUS_COARSE_PER_DEPTH * depthFromSurface));
}
/** Inverts `BeadGlobe.ts`'s `beadRadius = spacing(designCount) * shellScale * factor` to find the bead count a target radius needs. */
function beadCountForRadius(radius: number, depthFromSurface: number): number {
  const shellScale = 1 + BEAD_RADIUS_STEP * depthFromSurface;
  return Math.max(60, Math.round(4 * Math.PI * ((shellScale * BEAD_RADIUS_FACTOR) / radius) ** 2));
}

/**
 * Onboarding milestones (item #18a): every new mechanic first appears on its
 * own level, spaced apart from every other mechanic's introduction and from
 * a planet-change level (every `SLOT_LENGTH`th level + 1), so the player is
 * never handed two new things to learn at once. Levels/K/bead-count still
 * climb continuously (that's density, not a new mechanic to learn), but
 * these *discrete* behavior changes are gated to their own level.
 */
export const LAYER_MILESTONES = [45, 120, 260]; // level at which total layer count becomes 2, 3, 4
export const AUTO_SPIN_LEVEL = 15; // idle auto-spin begins here — before it, only the player's drag moves the globe
export const SPIN_TILT_LEVEL = 35; // idle spin can pick a tilted (non-horizontal) axis from here
export const SPIN_REVERSE_LEVEL = 75; // idle spin can reverse direction between spin phases from here
export const FIRST_CLOUD_LEVEL = 8; // first level (Earth's first visit only) with a cloud shell — 2 clear levels after `meteor` (6) and before the planet changes at 11
/**
 * Item #19: from this level, any level with clouds gets an independently-drifting, shot-blocking
 * cloud layer. Deliberately just past 31 (Venus, the first planet after Earth whose clouds are
 * `'always'` on): Venus's slot itself starts at level 31, which already shows the recurring
 * `newPlanet` card (item #15) — landing the *first* drift-cloud tutorial on that very same level
 * would introduce two new things at once (item #18a), so it's pushed two levels later, inside the
 * same Venus slot, once the planet-change moment has already passed.
 */
export const CLOUD_DRIFT_LEVEL = 33;
/** Level by which cloud beads reach their fluffiest/most translucent look (a continuous, non-mechanic visual curve). */
const CLOUD_FLUFF_SATURATION_LEVEL = 150;

/** Total concentric layers (1..4): grows at fixed onboarding milestones, same for every planet — item #13. */
function layerCountForLevel(lv: number): number {
  let n = 1;
  for (const m of LAYER_MILESTONES) if (lv >= m) n++;
  return n;
}

export function getLevel(level: number): LevelConfig {
  const lv = clamp(Math.floor(level), 1, MAX_LEVEL);
  const slotIndex = Math.floor((lv - 1) / SLOT_LENGTH);
  const slotStart = slotIndex * SLOT_LENGTH + 1;
  const slotEnd = slotStart + SLOT_LENGTH - 1;
  const planet = CYCLE[slotIndex % CYCLE.length];
  const visitNumber = Math.floor(slotIndex / CYCLE.length);
  const nextPlanet = CYCLE[(slotIndex + 1) % CYCLE.length];

  const progress = (lv - 1) / (MAX_LEVEL - 1);
  const curve = CURVES[planet];

  // Bead size: a single global, planet-independent curve (see the block above `getLevel`).
  const sizeProgress = Math.min(1, (lv - 1) / (BEAD_SIZE_SATURATION_LEVEL - 1));
  const beadCount = beadCountForRadius(surfaceBeadRadius(sizeProgress), 0);

  const k = globalK(progress);

  const cloud = curve.cloud === 'always' || (curve.cloud === 'earth' && lv >= FIRST_CLOUD_LEVEL);
  const cloudBeadCount = cloud ? Math.round(beadCount * 0.55) : 0;
  const cloudDriftEnabled = cloud && lv >= CLOUD_DRIFT_LEVEL;
  const cloudFluffiness = clamp((lv - FIRST_CLOUD_LEVEL) / (CLOUD_FLUFF_SATURATION_LEVEL - FIRST_CLOUD_LEVEL), 0, 1);

  const layerCount = layerCountForLevel(lv);
  const numExtra = layerCount - 1;
  const extraLayers: ExtraLayerConfig[] = [];
  for (let d = 0; d < numExtra; d++) {
    // d=0 is outermost/coarsest; distFromSurface counts inward from there (1 = just outside `surface`).
    const distFromSurface = numExtra - d;
    const radius = layerBeadRadius(sizeProgress, distFromSurface);
    extraLayers.push({
      beadCount: beadCountForRadius(radius, distFromSurface),
      // Coarser than the surface (fewer colors), but never crushed toward monochrome: at most
      // `distFromSurface` fewer than the surface's own K, floored at 3 distinct colors.
      k: Math.max(3, k - distFromSurface),
    });
  }

  // ~6 regions at the start of the game -> ~40 near the end, hard-capped at 45, plus a
  // little extra per additional layer so the shot budget accounts for all of them.
  const regionTarget = Math.min(45 + 6 * numExtra, Math.round(6 + 34 * progress) + 4 * numExtra);

  const shotSlack = Math.max(1.1, 1.5 - 0.4 * progress);

  return {
    level: lv,
    planet,
    visitNumber,
    levelsUntilNextPlanet: slotEnd - lv,
    nextPlanet,
    beadCount,
    cloudBeadCount,
    cloudDriftEnabled,
    cloudFluffiness,
    k,
    extraLayers,
    layerCount,
    autoSpinEnabled: lv >= AUTO_SPIN_LEVEL,
    spinTiltEnabled: lv >= SPIN_TILT_LEVEL,
    spinReverseEnabled: lv >= SPIN_REVERSE_LEVEL,
    regionTarget,
    seed: lv * 7919 + 13,
    shotSlack,
  };
}
