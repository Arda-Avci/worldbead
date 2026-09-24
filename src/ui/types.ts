/** Shared UI-facing types for GameUI and Tutorial. Kept dependency-free (DOM only). */

export type PowerId = 'meteor' | 'prism' | 'solarFlare' | 'comet';

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
}

export interface PowerButtonState {
  id: PowerId;
  /** Charges currently owned. 0 with `locked: false` shows the buy-with-stardust state. */
  charges: number;
  /** Not yet unlocked; shows a lock glyph and a "Lv N" badge instead of a charge count. */
  locked: boolean;
  /** Level at which this power unlocks (shown on the lock badge). Required when `locked`. */
  unlockLevel?: number;
  /** Stardust price to buy one more charge (shown when charges === 0 and not locked). */
  price?: number;
  /** This power is armed — the next tap on the globe will use it. */
  active?: boolean;
}

export interface ProbeState {
  /** 24-bit hex color, e.g. 0x1d5fc4. */
  color: number;
  /** Remaining shots for this probe color (shown on the current orb only). */
  count?: number;
}

export interface LevelCompleteData {
  stars: 0 | 1 | 2 | 3;
  stardustEarned: number;
  factTitle: string;
  factText: string;
  /** When set, renders the "planet complete" variant with a "Next stop: X" line. */
  nextPlanetName?: string;
  primaryLabel?: string;
}

export interface LevelFailedData {
  beadsLeft: number;
}

export interface UnlockData {
  /** Icon key from icons.ts; falls back to 'star' when omitted. */
  icon?: string;
  name: string;
  description: string;
  ctaLabel?: string;
}

export interface GameUIOptions {
  onPower: (id: PowerId) => void;
  onSwap: () => void;
  onSettingsChanged: (settings: Settings) => void;
  onReplayIntro?: () => void;
}
