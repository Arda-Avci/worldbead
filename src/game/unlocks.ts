/** Unlock/tutorial table and power pricing, per GDD §4. */

export type PowerId = 'meteor' | 'prism' | 'solarFlare' | 'comet';

import { FIRST_CLOUD_LEVEL } from './levels';
import { INVASION_FIRST_LEVEL } from './invasion';

export type UnlockId = 'fire' | 'rotate' | 'swap' | PowerId | 'cloudLayer' | 'newPlanet' | 'newLayer' | 'cloudDrift' | 'invasion';

export interface UnlockEntry {
  level: number;
  id: UnlockId;
  /** Tutorial script id, run by `src/ui/`'s Tutorial engine. */
  tutorial: string;
}

export const UNLOCKS: UnlockEntry[] = [
  { level: 1, id: 'fire', tutorial: 'fire' },
  { level: 1, id: 'rotate', tutorial: 'rotate' },
  { level: 3, id: 'swap', tutorial: 'swap' },
  { level: 6, id: 'meteor', tutorial: 'meteor' },
  { level: 12, id: 'prism', tutorial: 'prism' },
  { level: 25, id: 'solarFlare', tutorial: 'solarFlare' },
  // Synced to `FIRST_CLOUD_LEVEL` (item #19) rather than a separate hardcoded
  // number, so the tutorial fires exactly when clouds first physically appear.
  { level: FIRST_CLOUD_LEVEL, id: 'cloudLayer', tutorial: 'cloudLayer' },
  { level: 60, id: 'comet', tutorial: 'comet' },
  // Alien invasion (owner: Arda): first guaranteed encounter, synced to `INVASION_FIRST_LEVEL`
  // rather than a separate hardcoded number. Landed well after every other unlock (comet at 60
  // is the last) and well past the last blocking tutorial (cloudDrift at 33), so the player has
  // the full toolkit and a calm stretch before this new difficulty axis appears.
  { level: INVASION_FIRST_LEVEL, id: 'invasion', tutorial: 'invasion' },
  // 'newPlanet' is no longer a fixed level here: with the planet rotating every
  // 10 levels (item #15) it's shown dynamically in `Game.ts` at the start of
  // every planet slot after the first, keyed per-level like everything else.
];

export const FREE_CHARGES_ON_UNLOCK = 3;

export const POWER_PRICES: Record<PowerId, number> = {
  meteor: 60,
  prism: 80,
  solarFlare: 120,
  comet: 150,
};

export const POWER_IDS: PowerId[] = ['meteor', 'prism', 'solarFlare', 'comet'];

export function isPowerId(id: UnlockId): id is PowerId {
  return id === 'meteor' || id === 'prism' || id === 'solarFlare' || id === 'comet';
}

/** All entries that unlock exactly at `level`. */
export function unlocksForLevel(level: number): UnlockEntry[] {
  return UNLOCKS.filter((u) => u.level === level);
}

/** Powers unlocked by the time the player has reached `level` (inclusive). */
export function unlockedPowers(level: number): PowerId[] {
  const out: PowerId[] = [];
  for (const u of UNLOCKS) if (u.level <= level && isPowerId(u.id) && !out.includes(u.id)) out.push(u.id);
  return out;
}
