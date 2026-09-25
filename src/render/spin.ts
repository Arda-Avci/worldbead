import * as THREE from 'three';
import { mulberry32 } from '../game/noise';

export interface SpinConfig {
  /** 0..1: scales spin speed (and, once enabled, tilt/reversal amount) — same global curve as bead detail. */
  difficulty: number;
  /** Item #18a onboarding: the axis can tilt off pure-horizontal only once this is true. */
  tiltEnabled: boolean;
  /** Item #18a onboarding: a spin phase can reverse direction only once this is true. */
  reverseEnabled: boolean;
}

/**
 * Deterministic-per-level idle spin state machine (item #16, refined by
 * later owner notes): the globe spins for 2-3s, pauses for about a second,
 * then picks a new speed/direction — tilting onto a non-horizontal axis and
 * reversing direction are each introduced on their own onboarding level
 * (`tiltEnabled`/`reverseEnabled`), not from the very first spin, per item
 * #18a's "one new mechanic per level" rule. Speed still scales continuously
 * with `difficulty` (that's intensity, not a new mechanic to learn).
 */
export class SpinDriver {
  private rng: () => number;
  private cfg: SpinConfig = { difficulty: 0, tiltEnabled: false, reverseEnabled: false };
  private phase: 'spin' | 'pause' = 'pause';
  private timeLeft = 0.4;
  private readonly axis = new THREE.Vector3(0, 1, 0);
  private speedDegPerSec = 0;

  constructor(seed: number, cfg: SpinConfig) {
    this.rng = mulberry32(seed >>> 0);
    this.cfg = cfg;
  }

  /** Re-seeds and re-scales for a new level, restarting from a short pause. */
  reset(seed: number, cfg: SpinConfig): void {
    this.rng = mulberry32(seed >>> 0);
    this.cfg = { difficulty: THREE.MathUtils.clamp(cfg.difficulty, 0, 1), tiltEnabled: cfg.tiltEnabled, reverseEnabled: cfg.reverseEnabled };
    this.phase = 'pause';
    this.timeLeft = 0.4;
    this.speedDegPerSec = 0;
  }

  private beginSpin(): void {
    const { difficulty: t, tiltEnabled, reverseEnabled } = this.cfg;
    if (tiltEnabled) {
      const tilt = THREE.MathUtils.lerp(0.3, 1.1, t);
      this.axis.set((this.rng() * 2 - 1) * tilt, 1, (this.rng() * 2 - 1) * tilt).normalize();
    } else {
      this.axis.set(0, 1, 0); // pure horizontal until tilt is unlocked
    }
    const speedMin = THREE.MathUtils.lerp(2.5, 7, t);
    const speedMax = THREE.MathUtils.lerp(7, 20, t);
    let speed = speedMin + this.rng() * (speedMax - speedMin);
    if (reverseEnabled) {
      const reverseChance = THREE.MathUtils.lerp(0.15, 0.55, t);
      if (this.rng() < reverseChance) speed = -speed;
    }
    this.speedDegPerSec = speed;
    this.phase = 'spin';
    this.timeLeft = 2 + this.rng() * 1;
  }

  private beginPause(): void {
    this.phase = 'pause';
    const base = THREE.MathUtils.lerp(1.2, 0.55, this.cfg.difficulty);
    this.timeLeft = base * (0.75 + this.rng() * 0.5);
  }

  /** True while actively spinning (vs. in its ~1s pause between phases). */
  isSpinning(): boolean {
    return this.phase === 'spin';
  }

  /**
   * Advances the state machine and writes the incremental rotation for this
   * frame into `outQuat` (identity while paused or while `active` is false).
   */
  step(dt: number, active: boolean, outQuat: THREE.Quaternion): void {
    outQuat.identity();
    if (!active) return;
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      if (this.phase === 'spin') this.beginPause();
      else this.beginSpin();
    }
    if (this.phase === 'spin') {
      outQuat.setFromAxisAngle(this.axis, THREE.MathUtils.degToRad(this.speedDegPerSec) * dt);
    }
  }
}
