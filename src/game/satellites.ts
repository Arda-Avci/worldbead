/**
 * Real satellites (GDD §5b): pure rules, no THREE/DOM. Decides per level whether
 * one real spacecraft flies a pass, which one, when, and what catching it pays.
 * Rendering lives in `src/render/satellites.ts`, wiring in `Game.ts`.
 */
import { mulberry32 } from './noise';
import type { PlanetId } from './planets';
import type { PowerId } from './unlocks';

export type SatelliteId = 'iss' | 'hubble' | 'lro' | 'mro' | 'marsExpress' | 'akatsuki' | 'juno';

/** First level with a satellite: every level from here rolls `SATELLITE_CHANCE`, this one is guaranteed (and gets the forced tutorial). */
export const SATELLITE_FIRST_LEVEL = 17;
export const SATELLITE_CHANCE = 0.5;
export const SATELLITE_STARDUST_REWARD = 40;
/** Seconds a normal pass takes; the tutorial pass is slower so it is catchable. */
export const SATELLITE_PASS_SECONDS = 9;
export const SATELLITE_TUTORIAL_PASS_SECONDS = 16;

export const SATELLITES_BY_PLANET: Record<PlanetId, SatelliteId[]> = {
  earth: ['iss', 'hubble'],
  moon: ['lro'],
  mars: ['mro', 'marsExpress'],
  venus: ['akatsuki'],
  jupiter: ['juno'],
};

export interface SatellitePass {
  id: SatelliteId;
  /** Seconds of play before the pass starts (4..12). */
  delay: number;
  /** Orbit-plane tilt in radians (signed, 12..40 degrees) and travel direction (+1 / -1). */
  tilt: number;
  dir: 1 | -1;
  /** Seeded reward roll inputs, resolved against the powers unlocked at catch time. */
  rewardRoll: number;
  powerRoll: number;
}

/** The pass planned for `level` on `planet`, or null when this level has none (before level 17, or the chance roll fails). */
export function satellitePassForLevel(level: number, planet: PlanetId): SatellitePass | null {
  if (level < SATELLITE_FIRST_LEVEL) return null;
  const rng = mulberry32((level * 2654435761) ^ 0x5a7e11);
  const roll = rng();
  const roster = SATELLITES_BY_PLANET[planet];
  const id = roster[Math.floor(rng() * roster.length)];
  const delay = 4 + rng() * 8;
  const tilt = (12 + rng() * 28) * (Math.PI / 180) * (rng() < 0.5 ? 1 : -1);
  const dir: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const rewardRoll = rng();
  const powerRoll = rng();
  if (level !== SATELLITE_FIRST_LEVEL && roll >= SATELLITE_CHANCE) return null;
  return { id, delay, tilt, dir, rewardRoll, powerRoll };
}

export type SatelliteReward = { kind: 'stardust'; amount: number } | { kind: 'charge'; power: PowerId };

/** 50/50 +40 stardust or one free charge of a random unlocked power (always stardust when none is unlocked yet). */
export function satelliteReward(pass: SatellitePass, unlocked: PowerId[]): SatelliteReward {
  if (pass.rewardRoll < 0.5 || unlocked.length === 0) return { kind: 'stardust', amount: SATELLITE_STARDUST_REWARD };
  return { kind: 'charge', power: unlocked[Math.min(unlocked.length - 1, Math.floor(pass.powerRoll * unlocked.length))] };
}
