/** Shared math/event types for `src/game/` — no DOM, no THREE. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface BeadRef {
  shellId: number;
  index: number;
}

export interface PopEvent {
  position: Vec3;
  color: number;
  /** The popped bead's own render radius, so spill/debris FX can be sized to match. */
  radius: number;
}

/**
 * What `GameSession` needs from the bead sphere. `BeadGlobe` implements this
 * structurally so the rules engine never imports THREE.
 */
export interface GlobeAdapter {
  aliveCount(): number;
  countRegions(): number;
  /** hex color -> count of currently hittable (alive, uncovered) beads of that color. */
  exposedColors(): Map<number, number>;
  /** Connected same-color alive beads starting at (shellId, index), in BFS order. */
  region(shellId: number, index: number): BeadRef[];
  /** Hex color of the bead, or null if it isn't alive or isn't currently hittable. */
  colorAt(shellId: number, index: number): number | null;
  isExposed(shellId: number, index: number): boolean;
  /** Local-space position of a bead (unit direction * shell radius). */
  positionOf(shellId: number, index: number): Vec3;
  /** All exposed beads within `radius` of `point`, any color. */
  beadsInRadius(point: Vec3, radius: number): BeadRef[];
  /** All exposed beads of `color` on the hemisphere facing `viewDir`. */
  beadsOfColorInHemisphere(color: number, viewDir: Vec3): BeadRef[];
  /** All exposed beads within `halfWidth` (as |dot(dir, normal)|) of the great circle with pole `normal`. */
  beadsInBand(normal: Vec3, halfWidth: number): BeadRef[];
  /** Marks the given beads popped (dead) and queues their FX events. */
  pop(beads: BeadRef[]): void;
}
