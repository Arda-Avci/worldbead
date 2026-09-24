/** Unlock/tutorial table and power pricing, per GDD §4. */

export type PowerId = 'meteor' | 'prism' | 'solarFlare' | 'comet';

export type UnlockId = 'fire' | 'rotate' | 'swap' | PowerId | 'cloudLayer' | 'newPlanet';

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
  { level: 40, id: 'cloudLayer', tutorial: 'cloudLayer' },
  { level: 60, id: 'comet', tutorial: 'comet' },
  { level: 351, id: 'newPlanet', tutorial: 'newPlanet' },
  { level: 401, id: 'newPlanet', tutorial: 'newPlanet' },
  { level: 451, id: 'newPlanet', tutorial: 'newPlanet' },
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
