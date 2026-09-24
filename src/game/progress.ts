/** Local progress persistence, per GDD §4/§6. try/catch throughout: storage may be unavailable. */
import { POWER_IDS, type PowerId } from './unlocks';

export interface Settings {
  sound: boolean;
  music: boolean;
  haptics: boolean;
}

export interface Progress {
  version: number;
  level: number;
  stardust: number;
  /** level -> stars earned (1..3), best result kept. */
  starsByLevel: Record<number, 1 | 2 | 3>;
  powerCharges: Record<PowerId, number>;
  powerUnlocked: Record<PowerId, boolean>;
  /** Total level wins across the game; every 5th grants a bonus power. */
  totalWins: number;
  seenTutorials: string[];
  settings: Settings;
  introSeen: boolean;
}

const KEY = 'worldbead.progress.v2';
const VERSION = 2;

function defaultProgress(): Progress {
  const powerCharges = {} as Record<PowerId, number>;
  const powerUnlocked = {} as Record<PowerId, boolean>;
  for (const p of POWER_IDS) {
    powerCharges[p] = 0;
    powerUnlocked[p] = false;
  }
  return {
    version: VERSION,
    level: 1,
    stardust: 0,
    starsByLevel: {},
    powerCharges,
    powerUnlocked,
    totalWins: 0,
    seenTutorials: [],
    settings: { sound: true, music: true, haptics: true },
    introSeen: false,
  };
}

export function loadProgress(): Progress {
  const fallback = defaultProgress();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fallback;
    const p = JSON.parse(raw) as Partial<Progress>;
    if (p.version !== VERSION) return fallback;
    return {
      version: VERSION,
      level: Math.max(1, p.level ?? 1),
      stardust: Math.max(0, p.stardust ?? 0),
      starsByLevel: { ...(p.starsByLevel ?? {}) },
      powerCharges: { ...fallback.powerCharges, ...(p.powerCharges ?? {}) },
      powerUnlocked: { ...fallback.powerUnlocked, ...(p.powerUnlocked ?? {}) },
      totalWins: Math.max(0, p.totalWins ?? 0),
      seenTutorials: [...(p.seenTutorials ?? [])],
      settings: { ...fallback.settings, ...(p.settings ?? {}) },
      introSeen: p.introSeen ?? false,
    };
  } catch {
    return fallback;
  }
}

export function saveProgress(p: Progress): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable (private mode, sandboxed preview) */
  }
}
