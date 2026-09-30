/**
 * Pure rules state machine, per GDD §2/§4. No DOM, no THREE — talks to the bead
 * sphere only through `GlobeAdapter`. Every action returns plain event objects
 * for the integration layer to map to FX/audio/UI.
 */
import { mulberry32 } from './noise';
import { POWER_PRICES, type PowerId } from './unlocks';
import type { GlobeAdapter, Vec3 } from './types';

export interface PowerState {
  unlocked: boolean;
  charges: number;
}

/**
 * Fixed stardust prices for the level-failed card's two recovery options
 * (item #17), kept in one place: RETRY restarts the level from scratch;
 * CONTINUE keeps the current board/progress and grants a few extra shots.
 * Not scaled by level, per the owner's explicit "no per-level scaling".
 */
export const RETRY_COST = 100;
export const CONTINUE_COST = 500;
export const CONTINUE_EXTRA_PROBES = 5;

/** Consecutive matching probe hits that earn a streak reward (GDD §5b); unlocked at `STREAK_LEVEL`. */
export const STREAK_TARGET = 5;

/** Level-size tier from the shot budget (GDD §5b "level size label"). */
export type LevelSize = 'small' | 'medium' | 'large' | 'extreme';
export function levelSizeTier(probesTotal: number): LevelSize {
  if (probesTotal <= 10) return 'small';
  if (probesTotal <= 20) return 'medium';
  if (probesTotal <= 35) return 'large';
  return 'extreme';
}

export type SessionEvent =
  | { type: 'fire'; result: 'hit'; color: number; poppedCount: number; stardustEarned: number; combo: boolean }
  | { type: 'fire'; result: 'miss'; color: number }
  | { type: 'fire'; result: 'crack'; color: number; crackedCount: number }
  | { type: 'power'; power: PowerId; poppedCount: number }
  | { type: 'swap' }
  | { type: 'streakReward'; reward: PowerId | 'probe' }
  | { type: 'win'; stars: 1 | 2 | 3; stardustEarned: number; bonusPower: PowerId | null }
  | { type: 'lose' }
  | { type: 'purchase'; power: PowerId; ok: boolean };

export interface SessionInit {
  /** Number of connected color regions at level start (`globe.countRegions()`) — the true minimum number of shots needed to clear the level (one per region, playing optimally). */
  regions: number;
  /** GDD §5b: extra probes for armored regions (sum over armored regions of max armor, `BeadGlobe.armorExtraProbes()`); 0/omitted = no armor. */
  armorProbes?: number;
  seed: number;
  stardust: number;
  /** Power unlock state + charges, mutated in place and readable back for persistence. */
  powers: Record<PowerId, PowerState>;
  /** Total level wins so far (before this level); every 5th grants a bonus power. */
  winsSoFar: number;
  /** Streak rewards active (from `STREAK_LEVEL`, never in a bonus round). */
  streakEnabled?: boolean;
  /** Bonus round: unlimited probes, every popped bead = 1 stardust, no stars/fail/streak. */
  bonus?: boolean;
}

export class GameSession {
  readonly probesTotal: number;
  probes: number;
  /** Current run of consecutive matching probe hits (0..STREAK_TARGET-1). */
  streak = 0;
  private readonly streakEnabled: boolean;
  private readonly bonus: boolean;
  queue: [number | null, number | null] = [null, null];
  prismArmed = false;
  stardust: number;
  readonly powers: Record<PowerId, PowerState>;
  private winsSoFar: number;
  private ended: 'win' | 'lose' | null = null;
  private readonly rng: () => number;

  constructor(private readonly globe: GlobeAdapter, opts: SessionInit) {
    // Owner requirement: give the player exactly 2 more shots than the minimum required to clear
    // the level, where the minimum is one shot per connected color region (playing optimally).
    const EXTRA_SHOTS = 2;
    this.bonus = !!opts.bonus;
    this.streakEnabled = !!opts.streakEnabled && !this.bonus;
    this.probesTotal = this.bonus ? Infinity : Math.max(1, opts.regions) + EXTRA_SHOTS + (opts.armorProbes ?? 0);
    this.probes = this.probesTotal;
    this.stardust = opts.stardust;
    this.powers = opts.powers;
    this.winsSoFar = opts.winsSoFar;
    this.rng = mulberry32(opts.seed);
    this.refillQueue();
  }

  get isOver(): boolean {
    return this.ended !== null;
  }

  private pickColor(): number | null {
    const exposed = this.globe.exposedColors();
    if (exposed.size === 0) return null;
    const colors = [...exposed.keys()];
    return colors[Math.floor(this.rng() * colors.length)];
  }

  /** Keep both queued colors valid: each must belong to a currently hittable bead. */
  private refillQueue(): void {
    for (let k = 0; k < 2; k++) {
      const c = this.queue[k];
      if (c === null || !this.globe.exposedColors().has(c)) this.queue[k] = this.pickColor();
    }
  }

  private advanceQueue(): void {
    this.queue = [this.queue[1], null];
    this.refillQueue();
  }

  /**
   * `refillQueue()` is normally kept up to date by `advanceQueue()` on every `fire()` (hit or
   * miss), but time can pass — and other pops (a power's radius/hemisphere/band sweep, or an
   * unrelated shot) can happen — between when the *back* slot (`queue[1]`) was last validated and
   * when the player swaps it to the front. Re-validating here closes that gap: without it, a swap
   * could bring a color into `queue[0]` that no longer has any exposed bead anywhere (its last
   * region popped by something else while it sat unused in the back slot), and every tap would
   * silently miss — burning probes — until the *next* `fire()`'s own `advanceQueue()` happened to
   * self-correct it.
   */
  swap(): SessionEvent[] {
    if (this.ended) return [];
    this.queue = [this.queue[1], this.queue[0]];
    this.refillQueue();
    return [{ type: 'swap' }];
  }

  /** Tutorial-only: makes `color` the current probe (must be hittable somewhere). */
  setQueueFront(color: number): void {
    if (this.globe.exposedColors().has(color)) this.queue[0] = color;
  }

  /** Fire the current probe at an already-picked, currently-hittable bead. */
  fire(shellId: number, index: number): SessionEvent[] {
    if (this.ended || this.probes <= 0) return [];
    const color = this.globe.colorAt(shellId, index);
    if (color === null) return [];
    const current = this.queue[0];
    if (current === null) return [];

    const viaPrism = this.prismArmed;
    const matches = viaPrism || color === current;
    this.probes--;
    const events: SessionEvent[] = [];

    if (matches) {
      const region = this.globe.region(shellId, index);
      // GDD §5b: a matching hit (prism included) on a region with armored beads cracks it instead of popping.
      const crackedCount = this.globe.crackArmor?.(region) ?? 0;
      if (crackedCount > 0) {
        this.prismArmed = false;
        events.push({ type: 'fire', result: 'crack', color, crackedCount });
        if (!viaPrism) this.registerHit(events);
        this.advanceQueue();
        return [...events, ...this.checkOutcome()];
      }
      const poppedCount = this.globe.pop(region);
      this.prismArmed = false;
      const stardustEarned = this.bonus ? poppedCount : Math.max(1, Math.ceil(poppedCount / 12));
      this.stardust += stardustEarned;
      events.push({ type: 'fire', result: 'hit', color, poppedCount, stardustEarned, combo: poppedCount >= 60 });
      if (!viaPrism) this.registerHit(events);
    } else {
      events.push({ type: 'fire', result: 'miss', color: current });
      this.registerMiss();
    }
    this.advanceQueue();
    events.push(...this.checkOutcome());
    return events;
  }

  /** Streak bookkeeping (GDD §5b): a matching probe hit extends it, a miss resets it; powers and prism-assisted shots are neutral. */
  private registerHit(events: SessionEvent[]): void {
    if (!this.streakEnabled) return;
    this.streak++;
    if (this.streak < STREAK_TARGET) return;
    this.streak = 0;
    const unlocked = (Object.keys(this.powers) as PowerId[]).filter((p) => this.powers[p].unlocked);
    if (unlocked.length > 0) {
      const power = unlocked[Math.floor(this.rng() * unlocked.length)];
      this.powers[power].charges++;
      events.push({ type: 'streakReward', reward: power });
    } else {
      this.probes++;
      events.push({ type: 'streakReward', reward: 'probe' });
    }
  }

  private registerMiss(): void {
    this.streak = 0;
  }

  meteor(point: Vec3, radius: number): SessionEvent[] {
    if (!this.consumeCharge('meteor')) return [];
    const beads = this.globe.beadsInRadius(point, radius);
    const poppedCount = this.globe.pop(beads);
    return [{ type: 'power', power: 'meteor', poppedCount }, ...this.checkOutcome()];
  }

  /** Arms the next `fire()` to pop regardless of color match. */
  prism(): SessionEvent[] {
    if (!this.consumeCharge('prism')) return [];
    this.prismArmed = true;
    return [{ type: 'power', power: 'prism', poppedCount: 0 }];
  }

  solarFlare(color: number, viewDir: Vec3): SessionEvent[] {
    if (!this.consumeCharge('solarFlare')) return [];
    const beads = this.globe.beadsOfColorInHemisphere(color, viewDir);
    const poppedCount = this.globe.pop(beads);
    return [{ type: 'power', power: 'solarFlare', poppedCount }, ...this.checkOutcome()];
  }

  comet(normal: Vec3, halfWidth: number): SessionEvent[] {
    if (!this.consumeCharge('comet')) return [];
    const beads = this.globe.beadsInBand(normal, halfWidth);
    const poppedCount = this.globe.pop(beads);
    return [{ type: 'power', power: 'comet', poppedCount }, ...this.checkOutcome()];
  }

  private consumeCharge(power: PowerId): boolean {
    if (this.ended) return false;
    const st = this.powers[power];
    if (!st || !st.unlocked || st.charges <= 0) return false;
    st.charges--;
    return true;
  }

  purchase(power: PowerId): SessionEvent {
    const price = POWER_PRICES[power];
    const st = this.powers[power];
    if (!st || !st.unlocked || this.stardust < price) return { type: 'purchase', power, ok: false };
    this.stardust -= price;
    st.charges++;
    return { type: 'purchase', power, ok: true };
  }

  private checkOutcome(): SessionEvent[] {
    if (this.ended) return [];
    if (this.globe.aliveCount() === 0) {
      this.ended = 'win';
      if (this.bonus) return [{ type: 'win', stars: 1, stardustEarned: 0, bonusPower: null }];
      const leftFrac = this.probes / this.probesTotal;
      const stars: 1 | 2 | 3 = leftFrac >= 0.4 ? 3 : leftFrac >= 0.15 ? 2 : 1;
      const stardustEarned = this.probes * 5;
      this.stardust += stardustEarned;
      this.winsSoFar++;
      let bonusPower: PowerId | null = null;
      if (this.winsSoFar % 5 === 0) {
        const unlocked = (Object.keys(this.powers) as PowerId[]).filter((p) => this.powers[p].unlocked);
        if (unlocked.length > 0) {
          bonusPower = unlocked[Math.floor(this.rng() * unlocked.length)];
          this.powers[bonusPower].charges++;
        }
      }
      return [{ type: 'win', stars, stardustEarned, bonusPower }];
    }
    if (this.probes <= 0) {
      this.ended = 'lose';
      return [{ type: 'lose' }];
    }
    return [];
  }

  /** Total level wins including this one, once it has ended in a win. For persistence. */
  getWinsSoFar(): number {
    return this.winsSoFar;
  }

  /** Un-ends a just-lost session and grants a few extra shots, keeping the board/progress as-is (item #17's "Continue"). */
  continueAfterLoss(): boolean {
    if (this.ended !== 'lose') return false;
    this.ended = null;
    this.probes += CONTINUE_EXTRA_PROBES;
    return true;
  }
}
