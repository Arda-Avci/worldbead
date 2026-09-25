/**
 * Alien invasion events — pure rules, no THREE, no DOM. Mirrors the
 * `GameSession`/`GlobeAdapter` contract: this module never touches a mesh or
 * the page directly, it only reads/writes the bead sphere through the
 * `GlobeAdapter` duck-type (using the two optional fire members documented
 * in `types.ts`) and returns plain event objects for the integration layer
 * (`Game.ts`) to map to render/audio/UI. See `docs/INVASION_INTEGRATION.md`
 * for exactly which calls `Game.ts` must make and when.
 *
 * Difficulty curve (owner's brief: "new difficulty elements come one at a
 * time", introduced gradually):
 * - No invasions before `INVASION_FIRST_LEVEL`. That level always has one
 *   (a guaranteed, gentle first encounter for the forced tutorial); after
 *   it, whether a given level has one at all is a per-level coin flip whose
 *   odds rise slowly with level (see `CURVE` below).
 * - When a level does have an invasion, its ships arrive a little faster,
 *   attack a little sooner, spread fire a little quicker and delay the
 *   helpful "extinguish" probe a little longer as the game progresses —
 *   all driven by the same `CURVE` control points, linearly interpolated by
 *   level and then perturbed by a small amount of seeded jitter so no two
 *   invasion levels play identically.
 */
import { mulberry32 } from './noise';
import { MAX_LEVEL } from './levels';
import type { BeadRef, GlobeAdapter, Vec3 } from './types';

/** Logical + rendered color of a bead on fire (a distinct ember hex, unlikely to collide with a k-means planet palette). */
export const FIRE_COLOR = 0xff5522;

/** First level that can ever have an invasion; always does (the tutorial level). */
export const INVASION_FIRST_LEVEL = 80;

export interface InvasionConfig {
  level: number;
  /** Number of ships this level. */
  shipCount: number;
  /** Seconds from level/invasion start until the first ship arrives. */
  firstArrivalDelayS: number;
  /** Seconds between one ship's arrival and the next ship's arrival. */
  arrivalGapS: number;
  /** Seconds a ship hovers/charges after arriving before it fires, unless destroyed first (2-3s, shorter on harder levels). */
  attackDelayS: number;
  /** Beads ignited by a single laser hit, before any spreading. */
  fireClusterSize: number;
  /** Fire spreads to new neighboring beads once every this many probe shots, while any fire remains. */
  fireSpreadEveryShots: number;
  /** Neighbor beads ignited per spread tick. */
  fireSpreadCount: number;
  /** Probe shots (while fire exists) before the queue is made to offer a fire-colored "extinguish" probe. */
  extinguishOfferAfterShots: number;
  seed: number;
}

interface CurvePoint {
  level: number;
  /** Probability that an eligible level (>= INVASION_FIRST_LEVEL) actually spawns an invasion. */
  chance: number;
  shipCount: number;
  attackDelayS: number;
  fireSpreadEveryShots: number;
  fireSpreadCount: number;
  extinguishOfferAfterShots: number;
}

// Control points; linearly interpolated by level. Aggression (more ships,
// shorter attack delay, faster spread, later extinguish help) rises slowly
// across the whole 80-550 span, not just within one chapter.
const CURVE: CurvePoint[] = [
  { level: INVASION_FIRST_LEVEL, chance: 1.0, shipCount: 1, attackDelayS: 3.0, fireSpreadEveryShots: 4, fireSpreadCount: 2, extinguishOfferAfterShots: 1 },
  { level: 120, chance: 0.3, shipCount: 1, attackDelayS: 2.8, fireSpreadEveryShots: 4, fireSpreadCount: 2, extinguishOfferAfterShots: 2 },
  { level: 200, chance: 0.38, shipCount: 2, attackDelayS: 2.6, fireSpreadEveryShots: 3, fireSpreadCount: 3, extinguishOfferAfterShots: 2 },
  { level: 350, chance: 0.45, shipCount: 2, attackDelayS: 2.4, fireSpreadEveryShots: 3, fireSpreadCount: 3, extinguishOfferAfterShots: 3 },
  { level: 451, chance: 0.52, shipCount: 2, attackDelayS: 2.2, fireSpreadEveryShots: 3, fireSpreadCount: 3, extinguishOfferAfterShots: 3 },
  { level: MAX_LEVEL, chance: 0.65, shipCount: 3, attackDelayS: 2.0, fireSpreadEveryShots: 2, fireSpreadCount: 4, extinguishOfferAfterShots: 4 },
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function interpolate(level: number): Omit<CurvePoint, 'level'> {
  if (level <= CURVE[0].level) return CURVE[0];
  for (let i = 1; i < CURVE.length; i++) {
    if (level <= CURVE[i].level) {
      const a = CURVE[i - 1];
      const b = CURVE[i];
      const t = (level - a.level) / Math.max(1, b.level - a.level);
      return {
        chance: lerp(a.chance, b.chance, t),
        shipCount: Math.round(lerp(a.shipCount, b.shipCount, t)),
        attackDelayS: lerp(a.attackDelayS, b.attackDelayS, t),
        fireSpreadEveryShots: Math.round(lerp(a.fireSpreadEveryShots, b.fireSpreadEveryShots, t)),
        fireSpreadCount: Math.round(lerp(a.fireSpreadCount, b.fireSpreadCount, t)),
        extinguishOfferAfterShots: Math.round(lerp(a.extinguishOfferAfterShots, b.extinguishOfferAfterShots, t)),
      };
    }
  }
  return CURVE[CURVE.length - 1];
}

/**
 * Deterministic per-level config, or null if this level has no invasion.
 * `level === INVASION_FIRST_LEVEL` is always non-null (the tutorial level);
 * every other eligible level rolls a seeded coin flip against the
 * interpolated `chance`.
 */
export function invasionConfigForLevel(level: number): InvasionConfig | null {
  if (level < INVASION_FIRST_LEVEL) return null;
  const params = interpolate(level);
  const rng = mulberry32(level * 104729 + 977);
  const guaranteed = level === INVASION_FIRST_LEVEL;
  if (!guaranteed && rng() >= params.chance) return null;
  return {
    level,
    shipCount: Math.max(1, params.shipCount),
    firstArrivalDelayS: 1.2 + rng() * 0.8,
    arrivalGapS: 2.5 + rng() * 1.5,
    attackDelayS: Math.max(1.2, params.attackDelayS),
    fireClusterSize: 5 + Math.floor(rng() * 3),
    fireSpreadEveryShots: Math.max(1, params.fireSpreadEveryShots),
    fireSpreadCount: Math.max(1, params.fireSpreadCount),
    extinguishOfferAfterShots: Math.max(1, params.extinguishOfferAfterShots),
    seed: (level * 2654435761) >>> 0,
  };
}

export type ShipPhase = 'pending' | 'approaching' | 'charging' | 'fired' | 'destroyed';

export interface ShipState {
  readonly id: number;
  phase: ShipPhase;
  /** Seconds (controller-local clock) at which the ship starts its approach. */
  readonly spawnAt: number;
  /** Seconds at which the approach ends and charging begins. */
  readonly arriveAt: number;
  /** Seconds at which it fires, unless destroyed first. */
  readonly chargeEndAt: number;
  /**
   * Impact bead, chosen at spawn time (not on arrival) so the render layer
   * can fly the ship in toward — and hover near — a point it can already
   * see is on the visible hemisphere; null if no such bead could be found.
   */
  target: BeadRef | null;
}

export type InvasionEvent =
  | { type: 'shipSpawned'; id: number; target: BeadRef | null }
  | { type: 'shipArrived'; id: number }
  | { type: 'laserFired'; id: number; target: BeadRef }
  | { type: 'fireIgnited'; beads: BeadRef[] };

/** Unit dot product / normalize helpers — kept local so this module stays THREE-free. */
function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

/**
 * A random unit direction within `maxAngleRad` of `axis` (uniform over the
 * spherical cap), so target picking can be biased to "wherever the player
 * is currently looking" instead of the whole sphere.
 */
function sampleCone(axis: Vec3, maxAngleRad: number, rng: () => number): Vec3 {
  const forward = normalize(axis);
  const arbitrary: Vec3 = Math.abs(forward.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const right = normalize(cross(arbitrary, forward));
  const up = cross(forward, right);
  const cosMax = Math.cos(maxAngleRad);
  const z = cosMax + (1 - cosMax) * rng(); // uniform in cos(theta) over [cosMax, 1]
  const phi = rng() * Math.PI * 2;
  const sinTheta = Math.sqrt(Math.max(0, 1 - z * z));
  const x = sinTheta * Math.cos(phi);
  const y = sinTheta * Math.sin(phi);
  return {
    x: right.x * x + up.x * y + forward.x * z,
    y: right.y * x + up.y * y + forward.y * z,
    z: right.z * x + up.z * y + forward.z * z,
  };
}

/** How far off the current view direction a target may land — keeps lasers on the visible hemisphere. */
const TARGET_CONE_ANGLE_RAD = (50 * Math.PI) / 180;

/** Result of `onShotFired()`, for the integration layer to act on after every probe shot. */
export interface ShotFireOutcome {
  /** Beads newly ignited by fire spreading this shot (may be empty). */
  spread: BeadRef[];
  /** Non-null on the shot where the queue should be made to offer an extinguish probe (`session.queue[i] = this color`). */
  queueOverrideColor: number | null;
}

/**
 * Runs one level's invasion: schedules ship arrivals/attacks and tracks
 * which beads are on fire. Ticked every frame by `Game.ts`; every rules
 * outcome comes back as plain `InvasionEvent`s or a `ShotFireOutcome`, never
 * by touching the globe's rendering directly.
 */
export class InvasionController {
  private t = 0;
  private readonly ships: ShipState[] = [];
  private nextShipId = 1;
  private readonly fire = new Map<string, BeadRef>();
  private shotsSinceSpread = 0;
  private shotsSinceOffer = 0;
  private readonly rng: () => number;
  /** Globe-local direction the player is currently facing (toward the camera); updated every `tick()`. */
  private viewDir: Vec3 = { x: 0, y: 0, z: 1 };

  constructor(private readonly globe: GlobeAdapter, private readonly cfg: InvasionConfig) {
    this.rng = mulberry32(cfg.seed ^ 0x2545f491);
    let arriveAt = cfg.firstArrivalDelayS;
    for (let i = 0; i < cfg.shipCount; i++) {
      this.ships.push({
        id: this.nextShipId++,
        phase: 'pending',
        // Ships fly in for ~1.6s before arriving; the render layer owns the
        // exact flight timing, this only gates when tick() reports the spawn.
        spawnAt: Math.max(0, arriveAt - 1.6),
        arriveAt,
        chargeEndAt: arriveAt + cfg.attackDelayS,
        target: null,
      });
      arriveAt += cfg.arrivalGapS;
    }
  }

  getShips(): readonly ShipState[] {
    return this.ships;
  }

  isFireActive(): boolean {
    return this.fire.size > 0;
  }

  fireBeadRefs(): BeadRef[] {
    return [...this.fire.values()];
  }

  /** True once every ship has fired or been destroyed and no fire remains — the invasion has nothing left to do. */
  isFinished(): boolean {
    return this.fire.size === 0 && this.ships.every((s) => s.phase === 'fired' || s.phase === 'destroyed');
  }

  /** 0..1 charge progress for a ship, for the render layer's telegraph glow build-up; 0 outside the charging phase. */
  chargeProgress(id: number): number {
    const ship = this.ships.find((s) => s.id === id);
    if (!ship || ship.phase !== 'charging') return 0;
    const span = ship.chargeEndAt - ship.arriveAt;
    return span <= 0 ? 1 : Math.max(0, Math.min(1, (this.t - ship.arriveAt) / span));
  }

  /**
   * Advances all ship timers by `dt` seconds. Call every frame while this
   * level's invasion is active. `viewDir` is the player's current view
   * direction in the globe's own local space (the same "camera position in
   * globe-local space" trick `Game.ts` already uses for Solar Flare's
   * hemisphere, per Memory_Bank.md) — it only needs to be reasonably fresh,
   * since it's read once per ship, right when that ship spawns.
   */
  tick(dt: number, viewDir: Vec3): InvasionEvent[] {
    this.t += dt;
    this.viewDir = viewDir;
    const events: InvasionEvent[] = [];
    for (const ship of this.ships) {
      if (ship.phase === 'pending' && this.t >= ship.spawnAt) {
        ship.phase = 'approaching';
        // Picked now (not on arrival) so the render layer can fly the ship
        // toward, and hover near, a point already known to be on the
        // visible hemisphere — see `pickImpactTarget()`.
        ship.target = this.pickImpactTarget();
        events.push({ type: 'shipSpawned', id: ship.id, target: ship.target });
      }
      if (ship.phase === 'approaching' && this.t >= ship.arriveAt) {
        ship.phase = 'charging';
        events.push({ type: 'shipArrived', id: ship.id });
      }
      if (ship.phase === 'charging' && this.t >= ship.chargeEndAt) {
        ship.phase = 'fired';
        if (ship.target) {
          events.push({ type: 'laserFired', id: ship.id, target: ship.target });
          const ignited = this.igniteAt(ship.target);
          if (ignited.length) events.push({ type: 'fireIgnited', beads: ignited });
        }
      }
    }
    return events;
  }

  /** Shoots this ship down, if it's still shootable (not already fired/destroyed). Returns true if it was destroyed. */
  destroyShip(id: number): boolean {
    const ship = this.ships.find((s) => s.id === id);
    if (!ship || ship.phase === 'fired' || ship.phase === 'destroyed') return false;
    ship.phase = 'destroyed';
    return true;
  }

  /**
   * Call once after every `GameSession.fire()` shot (hit or miss) while this
   * level's invasion is active. Drives the fire-spread cadence and tells the
   * integration layer when to force a fire-colored probe into the queue.
   */
  onShotFired(): ShotFireOutcome {
    this.pruneExtinguished();
    if (this.fire.size === 0) return { spread: [], queueOverrideColor: null };

    this.shotsSinceSpread++;
    let spread: BeadRef[] = [];
    if (this.shotsSinceSpread >= this.cfg.fireSpreadEveryShots) {
      this.shotsSinceSpread = 0;
      spread = this.spreadFire();
    }

    this.shotsSinceOffer++;
    let queueOverrideColor: number | null = null;
    if (this.shotsSinceOffer >= this.cfg.extinguishOfferAfterShots) {
      this.shotsSinceOffer = 0;
      queueOverrideColor = FIRE_COLOR;
    }
    return { spread, queueOverrideColor };
  }

  /** Drops beads from the tracked fire set once they're no longer fire-colored (extinguished, or cleared by another power). */
  private pruneExtinguished(): void {
    for (const [key, ref] of this.fire) {
      if (this.globe.colorAt(ref.shellId, ref.index) !== FIRE_COLOR) this.fire.delete(key);
    }
  }

  /**
   * A bead within `TARGET_CONE_ANGLE_RAD` of the player's current view
   * direction, so the impact — and the ship hovering near it — lands
   * somewhere the player can actually see and react to, not on the far side
   * of the globe. Widens its search radius/cone on repeated misses (a
   * sparsely-populated view direction, e.g. near the end of a level) rather
   * than ever falling back to the whole sphere.
   */
  private pickImpactTarget(): BeadRef | null {
    for (let attempt = 0; attempt < 24; attempt++) {
      const angle = Math.min(Math.PI, TARGET_CONE_ANGLE_RAD + attempt * 0.05);
      const point = sampleCone(this.viewDir, angle, this.rng);
      const radius = 0.12 + attempt * 0.02;
      const beads = this.globe.beadsInRadius(point, radius).filter((b) => this.globe.colorAt(b.shellId, b.index) !== FIRE_COLOR);
      if (beads.length > 0) return beads[Math.floor(this.rng() * beads.length)];
    }
    return null;
  }

  private igniteAt(target: BeadRef): BeadRef[] {
    if (!this.globe.igniteFire) return []; // adapter doesn't support fire — laser still fires, but nothing ignites
    const center = this.globe.positionOf(target.shellId, target.index);
    let cluster = this.globe.beadsInRadius(center, 0.14).filter((b) => this.globe.colorAt(b.shellId, b.index) !== FIRE_COLOR);
    if (cluster.length === 0) cluster = [target];
    cluster = cluster.slice(0, this.cfg.fireClusterSize);
    this.globe.igniteFire(cluster, FIRE_COLOR);
    for (const b of cluster) this.fire.set(`${b.shellId}:${b.index}`, b);
    return cluster;
  }

  private spreadFire(): BeadRef[] {
    // Called through `this.globe.*` (not destructured) so these keep their
    // `this` binding — `DemoGlobe` and any real `BeadGlobe` implementation
    // read their own instance fields inside these methods.
    if (!this.globe.neighborsOf || !this.globe.igniteFire) return [];

    const candidates = new Map<string, BeadRef>();
    for (const ref of this.fire.values()) {
      for (const n of this.globe.neighborsOf(ref.shellId, ref.index)) {
        const key = `${n.shellId}:${n.index}`;
        if (this.fire.has(key) || candidates.has(key)) continue;
        if (this.globe.colorAt(n.shellId, n.index) === null) continue; // popped, or covered by a live cloud
        candidates.set(key, n);
      }
    }

    const pool = [...candidates.values()];
    const picked: BeadRef[] = [];
    for (let i = 0; i < this.cfg.fireSpreadCount && pool.length > 0; i++) {
      const idx = Math.floor(this.rng() * pool.length);
      picked.push(pool.splice(idx, 1)[0]);
    }
    if (picked.length === 0) return [];

    this.globe.igniteFire(picked, FIRE_COLOR);
    for (const b of picked) this.fire.set(`${b.shellId}:${b.index}`, b);
    return picked;
  }
}
