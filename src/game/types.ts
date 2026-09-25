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

  // ---- Optional: alien-invasion "fire" mechanic (see `src/game/invasion.ts`). ----
  // A `GlobeAdapter` that doesn't implement these simply can't host fire
  // beads: `InvasionController` feature-detects them and degrades
  // gracefully (ships still approach/charge/fire, but beads never
  // ignite/spread), so a globe without them is otherwise unaffected.

  /**
   * Alive neighbor beads of (shellId, index) on that shell's own neighbor
   * graph, regardless of current color or cloud coverage. Used only to
   * spread fire to adjacent beads.
   */
  neighborsOf?(shellId: number, index: number): BeadRef[];

  /**
   * Reassigns the given beads' logical color to `colorHex` (adding it to
   * the shell's palette if it isn't already there) without popping them, so
   * they keep counting toward `aliveCount()`/win and `colorAt()` reports
   * `colorHex` for them from then on — a same-colored "extinguish" probe
   * fired at one of them pops the whole connected patch exactly like any
   * other region, through the existing `region()`/`pop()` path. Also
   * updates their rendered instance color to `colorHex`; an ongoing
   * flicker/glow animation on top of that (if any) is the implementation's
   * own concern, not the caller's.
   */
  igniteFire?(beads: BeadRef[], colorHex: number): void;
}
