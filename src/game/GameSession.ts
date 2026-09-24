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

export type SessionEvent =
  | { type: 'fire'; result: 'hit'; color: number; poppedCount: number; stardustEarned: number; combo: boolean }
  | { type: 'fire'; result: 'miss'; color: number }
  | { type: 'power'; power: PowerId; poppedCount: number }
  | { type: 'swap' }
  | { type: 'win'; stars: 1 | 2 | 3; stardustEarned: number; bonusPower: PowerId | null }
  | { type: 'lose' }
  | { type: 'purchase'; power: PowerId; ok: boolean };

export interface SessionInit {
  /** Number of connected color regions at level start (`globe.countRegions()`). */
  regions: number;
  /** Probes = ceil(regions * shotSlack), per GDD §2. */
  shotSlack: number;
  seed: number;
  stardust: number;
  /** Power unlock state + charges, mutated in place and readable back for persistence. */
  powers: Record<PowerId, PowerState>;
  /** Total level wins so far (before this level); every 5th grants a bonus power. */
  winsSoFar: number;
}

export class GameSession {
  readonly probesTotal: number;
  probes: number;
  queue: [number | null, number | null] = [null, null];
  prismArmed = false;
  stardust: number;
  readonly powers: Record<PowerId, PowerState>;
  private winsSoFar: number;
  private ended: 'win' | 'lose' | null = null;
  private readonly rng: () => number;

  constructor(private readonly globe: GlobeAdapter, opts: SessionInit) {
    this.probesTotal = Math.max(1, Math.ceil(opts.regions * opts.shotSlack));
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

  swap(): SessionEvent[] {
    if (this.ended) return [];
    this.queue = [this.queue[1], this.queue[0]];
    return [{ type: 'swap' }];
  }

  /** Fire the current probe at an already-picked, currently-hittable bead. */
  fire(shellId: number, index: number): SessionEvent[] {
    if (this.ended || this.probes <= 0) return [];
    const color = this.globe.colorAt(shellId, index);
    if (color === null) return [];
    const current = this.queue[0];
    if (current === null) return [];

    const matches = this.prismArmed || color === current;
    this.probes--;
    const events: SessionEvent[] = [];

    if (matches) {
      const region = this.globe.region(shellId, index);
      this.globe.pop(region);
      this.prismArmed = false;
      const stardustEarned = Math.max(1, Math.ceil(region.length / 12));
      this.stardust += stardustEarned;
      events.push({ type: 'fire', result: 'hit', color, poppedCount: region.length, stardustEarned, combo: region.length >= 60 });
    } else {
      events.push({ type: 'fire', result: 'miss', color: current });
    }
    this.advanceQueue();
    events.push(...this.checkOutcome());
    return events;
  }

  meteor(point: Vec3, radius: number): SessionEvent[] {
    if (!this.consumeCharge('meteor')) return [];
    const beads = this.globe.beadsInRadius(point, radius);
    this.globe.pop(beads);
    return [{ type: 'power', power: 'meteor', poppedCount: beads.length }, ...this.checkOutcome()];
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
    this.globe.pop(beads);
    return [{ type: 'power', power: 'solarFlare', poppedCount: beads.length }, ...this.checkOutcome()];
  }

  comet(normal: Vec3, halfWidth: number): SessionEvent[] {
    if (!this.consumeCharge('comet')) return [];
    const beads = this.globe.beadsInBand(normal, halfWidth);
    this.globe.pop(beads);
    return [{ type: 'power', power: 'comet', poppedCount: beads.length }, ...this.checkOutcome()];
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
}
