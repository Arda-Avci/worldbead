/**
 * Level progression per GDD §3: chapters map level ranges to planets; within a
 * chapter, bead count and color tier (K) climb so the bead sphere converges to
 * the real planet as the player progresses.
 */
import type { PlanetId } from './planets';

export interface Chapter {
  planet: PlanetId;
  start: number;
  end: number;
}

export const CHAPTERS: Chapter[] = [
  { planet: 'earth', start: 1, end: 350 },
  { planet: 'moon', start: 351, end: 400 },
  { planet: 'venus', start: 401, end: 450 },
  { planet: 'mars', start: 451, end: 550 },
];

export const MAX_LEVEL = CHAPTERS[CHAPTERS.length - 1].end;

interface ChapterCurve {
  beadRange: [number, number];
  /** K (color count) for detail tiers 1..4, per the GDD table. */
  kByTier: [number, number, number, number];
  cloud: 'none' | 'fromLevel40' | 'always';
}

/** Bead/K ranges straight from the GDD §3 table. */
const CURVES: Record<PlanetId, ChapterCurve> = {
  earth: { beadRange: [800, 6000], kByTier: [3, 5, 7, 9], cloud: 'fromLevel40' },
  moon: { beadRange: [1500, 5000], kByTier: [3, 4, 5, 6], cloud: 'none' },
  venus: { beadRange: [1500, 5000], kByTier: [3, 4, 5, 6], cloud: 'always' },
  mars: { beadRange: [1800, 6000], kByTier: [3, 5, 6, 8], cloud: 'none' },
};

/** Fraction of chapter progress at which detail tiers 2, 3, 4 begin. */
const TIER_BREAKPOINTS: [number, number, number] = [0.15, 0.4, 0.75];

export interface LevelConfig {
  level: number;
  planet: PlanetId;
  chapterIndex: number;
  /** Detail tier 1..4 — drives K (color count). */
  tier: number;
  beadCount: number;
  /** Bead count sampled to build the cloud shell before existence-thresholding; 0 = no clouds. */
  cloudBeadCount: number;
  k: number;
  /**
   * Target connected-region count for this level, summed across all shells
   * (surface + clouds), so the level stays a ~5-50 tap mobile session. ~6 at
   * the start of each chapter, rising to ~40 at the chapter end, hard-capped
   * at 45. `BeadGlobe` merges the smallest region into its dominant neighbor
   * color, repeatedly, until each shell's share of this budget is met.
   */
  regionTarget: number;
  seed: number;
  /** Probes = ceil(regions * shotSlack). 1.5 early game -> 1.1 late game, per GDD §2. */
  shotSlack: number;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function getLevel(level: number): LevelConfig {
  const lv = clamp(Math.floor(level), 1, MAX_LEVEL);
  const chapterIndex = CHAPTERS.findIndex((c) => lv >= c.start && lv <= c.end);
  const chapter = CHAPTERS[chapterIndex];
  const span = Math.max(1, chapter.end - chapter.start);
  const progress = (lv - chapter.start) / span;
  const curve = CURVES[chapter.planet];

  let tier = 1;
  for (const bp of TIER_BREAKPOINTS) if (progress >= bp) tier++;

  const [b0, b1] = curve.beadRange;
  const beadCount = Math.round(b0 + (b1 - b0) * Math.pow(progress, 0.85));

  const cloud = curve.cloud === 'always' || (curve.cloud === 'fromLevel40' && lv >= 40);
  const cloudBeadCount = cloud ? Math.round(beadCount * 0.55) : 0;

  // ~6 regions at the start of a chapter -> ~40 at its end, hard-capped at 45.
  const regionTarget = Math.min(45, Math.round(6 + 34 * progress));

  const globalProgress = (lv - 1) / (MAX_LEVEL - 1);
  const shotSlack = Math.max(1.1, 1.5 - 0.4 * globalProgress);

  return {
    level: lv,
    planet: chapter.planet,
    chapterIndex,
    tier,
    beadCount,
    cloudBeadCount,
    k: curve.kByTier[tier - 1],
    regionTarget,
    seed: lv * 7919 + 13,
    shotSlack,
  };
}
