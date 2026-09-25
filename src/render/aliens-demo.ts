/**
 * Standalone demo of the alien invasion feature: real `InvasionController`
 * (src/game/invasion.ts) driving a real `AlienInvasionRenderer`
 * (src/render/aliens.ts) over a small bead sphere. The bead sphere here is a
 * self-contained `GlobeAdapter` (not `BeadGlobe`, which doesn't implement the
 * fire-mechanic's optional adapter members yet) — it doubles as a concrete,
 * working reference for exactly what `BeadGlobe` needs to add (see
 * `docs/INVASION_INTEGRATION.md`).
 */
import * as THREE from 'three';
import { SpaceScene } from './SpaceScene';
import { AlienInvasionRenderer } from './aliens';
import { FireEmberSystem } from './fireEmbers';
import { InvasionController, invasionConfigForLevel, INVASION_FIRST_LEVEL, FIRE_COLOR } from '../game/invasion';
import type { BeadRef, GlobeAdapter, Vec3 } from '../game/types';
import { mulberry32 } from '../game/noise';
import { AudioEngine } from '../audio/AudioEngine';

// ---------------- a minimal single-shell bead globe (demo only) ----------------

const BEAD_COUNT = 1400;
const EARTH_PALETTE = [0x1c5fa8, 0x2f7fd1, 0x2e8b4a, 0xd8c27a, 0xffffff]; // ocean/ocean/land/sand/ice

function fibonacciSphere(n: number): Float32Array {
  const out = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = golden * i;
    out[i * 3] = Math.cos(t) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(t) * r;
  }
  return out;
}

function buildNeighbors(dirs: Float32Array, maxDist: number): { start: Int32Array; list: Int32Array } {
  const n = dirs.length / 3;
  const cell = maxDist;
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const grid = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = key(Math.floor(dirs[i * 3] / cell), Math.floor(dirs[i * 3 + 1] / cell), Math.floor(dirs[i * 3 + 2] / cell));
    let arr = grid.get(k);
    if (!arr) grid.set(k, (arr = []));
    arr.push(i);
  }
  const lists: number[][] = new Array(n);
  const md2 = maxDist * maxDist;
  for (let i = 0; i < n; i++) {
    const x = dirs[i * 3], y = dirs[i * 3 + 1], z = dirs[i * 3 + 2];
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), cz = Math.floor(z / cell);
    const nb: number[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const arr = grid.get(key(cx + dx, cy + dy, cz + dz));
      if (!arr) continue;
      for (const j of arr) {
        if (j === i) continue;
        const ex = dirs[j * 3] - x, ey = dirs[j * 3 + 1] - y, ez = dirs[j * 3 + 2] - z;
        if (ex * ex + ey * ey + ez * ez < md2) nb.push(j);
      }
    }
    lists[i] = nb;
  }
  const start = new Int32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + lists[i].length;
  const list = new Int32Array(start[n]);
  for (let i = 0; i < n; i++) list.set(lists[i], start[i]);
  return { start, list };
}

/** A working reference `GlobeAdapter` implementing the invasion fire members, for this demo only. */
class DemoGlobe implements GlobeAdapter {
  readonly mesh: THREE.InstancedMesh;
  private readonly dirs: Float32Array;
  private readonly nbrStart: Int32Array;
  private readonly nbrList: Int32Array;
  private readonly colorIdx: Int16Array;
  private readonly palette: number[] = [...EARTH_PALETTE];
  private readonly alive: Uint8Array;
  private readonly beadRadius: number;
  private fireColorIdx = -1;
  private readonly fireBeads = new Set<number>();
  private readonly ignitedAt = new Map<number, number>();
  private flickerClock = 0;

  constructor(material: THREE.Material) {
    this.dirs = fibonacciSphere(BEAD_COUNT);
    const spacing = Math.sqrt((4 * Math.PI) / BEAD_COUNT);
    const { start, list } = buildNeighbors(this.dirs, spacing * 1.45);
    this.nbrStart = start;
    this.nbrList = list;
    const rng = mulberry32(42);
    this.colorIdx = new Int16Array(BEAD_COUNT);
    for (let i = 0; i < BEAD_COUNT; i++) {
      // A rough continents-and-oceans look: latitude bands + noise-driven land blobs.
      const lat = Math.asin(this.dirs[i * 3 + 1]);
      const landChance = Math.abs(lat) < 1.0 ? 0.45 : 0.15;
      this.colorIdx[i] = rng() < landChance ? (rng() < 0.7 ? 2 : 3) : rng() < 0.9 ? 0 : 1;
      if (Math.abs(lat) > 1.3) this.colorIdx[i] = 4;
    }
    this.alive = new Uint8Array(BEAD_COUNT).fill(1);
    this.beadRadius = spacing * 0.56;

    const geo = new THREE.SphereGeometry(1, 10, 7);
    this.mesh = new THREE.InstancedMesh(geo, material, BEAD_COUNT);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(this.beadRadius, this.beadRadius, this.beadRadius);
    const c = new THREE.Color();
    for (let i = 0; i < BEAD_COUNT; i++) {
      const p = new THREE.Vector3(this.dirs[i * 3], this.dirs[i * 3 + 1], this.dirs[i * 3 + 2]);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
      c.setHex(this.palette[this.colorIdx[i]]);
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  // ---- GlobeAdapter ----

  aliveCount(): number {
    let n = 0;
    for (let i = 0; i < BEAD_COUNT; i++) n += this.alive[i];
    return n;
  }

  region(_shellId: number, startIdx: number): BeadRef[] {
    const color = this.colorIdx[startIdx];
    const seen = new Uint8Array(BEAD_COUNT);
    const out: BeadRef[] = [];
    let frontier = [startIdx];
    seen[startIdx] = 1;
    while (frontier.length) {
      const next: number[] = [];
      for (const i of frontier) {
        out.push({ shellId: 0, index: i });
        for (let p = this.nbrStart[i]; p < this.nbrStart[i + 1]; p++) {
          const j = this.nbrList[p];
          if (!seen[j] && this.alive[j] && this.colorIdx[j] === color) {
            seen[j] = 1;
            next.push(j);
          }
        }
      }
      frontier = next;
    }
    return out;
  }

  countRegions(): number {
    const seen = new Uint8Array(BEAD_COUNT);
    let total = 0;
    for (let i = 0; i < BEAD_COUNT; i++) {
      if (!this.alive[i] || seen[i]) continue;
      total++;
      for (const b of this.region(0, i)) seen[b.index] = 1;
    }
    return total;
  }

  isExposed(_shellId: number, index: number): boolean {
    return !!this.alive[index];
  }

  colorAt(_shellId: number, index: number): number | null {
    if (!this.alive[index]) return null;
    return this.palette[this.colorIdx[index]];
  }

  exposedColors(): Map<number, number> {
    const counts = new Map<number, number>();
    for (let i = 0; i < BEAD_COUNT; i++) {
      if (!this.alive[i]) continue;
      const hex = this.palette[this.colorIdx[i]];
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
    return counts;
  }

  positionOf(_shellId: number, index: number): Vec3 {
    return { x: this.dirs[index * 3], y: this.dirs[index * 3 + 1], z: this.dirs[index * 3 + 2] };
  }

  beadsInRadius(point: Vec3, radius: number): BeadRef[] {
    const out: BeadRef[] = [];
    const r2 = radius * radius;
    for (let i = 0; i < BEAD_COUNT; i++) {
      if (!this.alive[i]) continue;
      const dx = this.dirs[i * 3] - point.x, dy = this.dirs[i * 3 + 1] - point.y, dz = this.dirs[i * 3 + 2] - point.z;
      if (dx * dx + dy * dy + dz * dz <= r2) out.push({ shellId: 0, index: i });
    }
    return out;
  }

  beadsOfColorInHemisphere(color: number, viewDir: Vec3): BeadRef[] {
    const len = Math.hypot(viewDir.x, viewDir.y, viewDir.z) || 1;
    const vx = viewDir.x / len, vy = viewDir.y / len, vz = viewDir.z / len;
    const out: BeadRef[] = [];
    for (let i = 0; i < BEAD_COUNT; i++) {
      if (!this.alive[i] || this.palette[this.colorIdx[i]] !== color) continue;
      if (this.dirs[i * 3] * vx + this.dirs[i * 3 + 1] * vy + this.dirs[i * 3 + 2] * vz > 0) out.push({ shellId: 0, index: i });
    }
    return out;
  }

  beadsInBand(normal: Vec3, halfWidth: number): BeadRef[] {
    const len = Math.hypot(normal.x, normal.y, normal.z) || 1;
    const nx = normal.x / len, ny = normal.y / len, nz = normal.z / len;
    const out: BeadRef[] = [];
    for (let i = 0; i < BEAD_COUNT; i++) {
      if (!this.alive[i]) continue;
      if (Math.abs(this.dirs[i * 3] * nx + this.dirs[i * 3 + 1] * ny + this.dirs[i * 3 + 2] * nz) < halfWidth) out.push({ shellId: 0, index: i });
    }
    return out;
  }

  pop(beads: BeadRef[]): void {
    const c = new THREE.Color(0x000000);
    for (const b of beads) {
      if (!this.alive[b.index]) continue;
      this.alive[b.index] = 0;
      this.fireBeads.delete(b.index);
      this.ignitedAt.delete(b.index);
      this.mesh.setColorAt(b.index, c);
      const m = new THREE.Matrix4();
      m.compose(new THREE.Vector3(0, 0, 0), new THREE.Quaternion(), new THREE.Vector3(0.0001, 0.0001, 0.0001));
      this.mesh.setMatrixAt(b.index, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  // ---- optional invasion fire members ----

  neighborsOf(_shellId: number, index: number): BeadRef[] {
    const out: BeadRef[] = [];
    for (let p = this.nbrStart[index]; p < this.nbrStart[index + 1]; p++) {
      const j = this.nbrList[p];
      if (this.alive[j]) out.push({ shellId: 0, index: j });
    }
    return out;
  }

  igniteFire(beads: BeadRef[], colorHex: number): void {
    if (this.fireColorIdx === -1) {
      this.fireColorIdx = this.palette.length;
      this.palette.push(colorHex);
    }
    const c = new THREE.Color(colorHex);
    for (const b of beads) {
      if (!this.alive[b.index]) continue;
      this.colorIdx[b.index] = this.fireColorIdx;
      this.fireBeads.add(b.index);
      this.ignitedAt.set(b.index, this.flickerClock);
      this.mesh.setColorAt(b.index, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Local (globe-space, unit-sphere) positions of every bead currently on fire — feeds the ember/smoke particle system. */
  firePositions(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const i of this.fireBeads) out.push(new THREE.Vector3(this.dirs[i * 3], this.dirs[i * 3 + 1], this.dirs[i * 3 + 2]));
    return out;
  }

  /**
   * Per-frame ember flicker on fire beads only — a stand-in for the small,
   * precise addition `docs/INVASION_INTEGRATION.md` asks `BeadGlobe.update()`
   * to make: animate the instance color of beads whose logical color is the
   * fire color, without touching `colorIdx`/regioning at all. Two things are
   * layered on top of the flat `FIRE_COLOR`:
   *  - a per-bead flickering emissive glow (two mismatched sine frequencies
   *    plus a per-index phase offset, so neighboring beads never flicker in
   *    lockstep) that swings from a dim ember red toward a hot orange-yellow;
   *  - a brief bright white-hot pulse on beads that just ignited, fading out
   *    over ~0.45s, so newly-spread fire is visibly announced rather than
   *    silently recoloring.
   */
  updateFireFlicker(dt: number): void {
    this.flickerClock += dt;
    if (this.fireBeads.size === 0) return;
    const ember = new THREE.Color();
    const hot = new THREE.Color(0xffdd88);
    const white = new THREE.Color(0xffffff);
    const c = new THREE.Color();
    const PULSE_DURATION = 0.45;
    for (const i of this.fireBeads) {
      const flick = 0.55 + 0.45 * Math.sin(this.flickerClock * 9 + i * 0.7) * 0.5 + 0.45 * 0.5 * Math.sin(this.flickerClock * 21.3 - i * 1.3);
      const heat = Math.max(0, Math.min(1, flick));
      ember.copy(new THREE.Color(FIRE_COLOR)).lerp(hot, heat * 0.6);
      c.copy(ember);
      const ignitedT = this.ignitedAt.get(i);
      if (ignitedT !== undefined) {
        const age = this.flickerClock - ignitedT;
        if (age < PULSE_DURATION) {
          const pulse = 1 - age / PULSE_DURATION;
          c.lerp(white, pulse * 0.9);
        } else {
          this.ignitedAt.delete(i);
        }
      }
      this.mesh.setColorAt(i, c);
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  raycastTargets(): THREE.Object3D[] {
    return [this.mesh];
  }
}

// ---------------- demo wiring ----------------

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const statusEl = document.querySelector('[data-status]') as HTMLDivElement;
const logEl = document.querySelector('[data-log]') as HTMLDivElement;
const probeSwatch = document.querySelector('[data-probe-swatch]') as HTMLSpanElement;
const probeLabel = document.querySelector('[data-probe-label]') as HTMLSpanElement;

const scene = new SpaceScene(canvas);
const aliens = new AlienInvasionRenderer();
scene.scene.add(aliens.group);
const fireEmbers = new FireEmberSystem();
const audio = new AudioEngine();

// QA-only hook (this demo page only) so a screenshot script can zoom in on a
// specific moment without adding throwaway UI buttons for every camera angle.
(window as unknown as Record<string, unknown>).__wbDemo = {
  scene,
  aliens,
  getController: () => controller,
  getDemoGlobe: () => demoGlobe,
  // QA-only: force-fires a specific ship's laser at a world position right
  // now, bypassing the controller's own attack timer. Lets a screenshot
  // script capture the laser mid-flight deterministically instead of racing
  // real-time timers through headless/software rendering's uneven frame
  // pacing (see Memory_Bank.md's note on this demo's dt clamp).
  fireLaserAt: (id: number, pos: { x: number; y: number; z: number }) => aliens.fireLaser(id, new THREE.Vector3(pos.x, pos.y, pos.z)),
};

let demoGlobe: DemoGlobe | null = null;
let controller: InvasionController | null = null;
let ready = false;
let autoplay = true;
const lines: string[] = [];

function log(msg: string): void {
  lines.push(msg);
  if (lines.length > 8) lines.shift();
  logEl.textContent = lines.join('\n');
}

function setProbe(color: number, label: string): void {
  probeSwatch.style.background = `#${(color >>> 0).toString(16).padStart(6, '0')}`;
  probeLabel.textContent = label;
}

// Keeps the ship's hover position fully on-screen in portrait: the target
// bead itself only has to be within ~50deg of the view direction (see
// `InvasionController.pickImpactTarget`), which is far wider than this
// camera's frustum (a 50deg vertical FOV, and a much narrower horizontal FOV
// once portrait aspect is applied) — so we clamp *where the ship hovers* to a
// safe NDC box instead of flying it straight to the target's own screen
// position. The laser still fires at the real target, so the beam visibly
// travels from the (always visible) ship toward it.
const HOVER_NDC_X = 0.62;
const HOVER_NDC_Y_TOP = 0.5; // extra headroom: the coordinator specifically flagged top-edge cropping
const HOVER_NDC_Y_BOTTOM = 0.72;

/** The point at distance `radius` from the origin along the ray from `camPos` through `dir`, nearest the camera. */
function pointAtRadiusAlongRay(camPos: THREE.Vector3, dir: THREE.Vector3, radius: number): THREE.Vector3 {
  const b = camPos.dot(dir);
  const c = camPos.lengthSq() - radius * radius;
  const disc = b * b - c;
  const t = disc >= 0 ? -b - Math.sqrt(disc) : -b; // front intersection, or closest approach if the ray misses the sphere
  return camPos.clone().addScaledVector(dir, Math.max(0.1, t));
}

/**
 * Builds a ship's approach path so that, once hovering, it sits roughly
 * between the camera and its real target (so the beam it eventually fires
 * visibly travels toward that target) while staying fully inside a safe
 * on-screen box the whole time — the ship's own screen position is clamped
 * independently of how far off-axis the target itself is.
 */
function computeApproachPath(camera: THREE.PerspectiveCamera, targetWorld: THREE.Vector3 | null): { from: THREE.Vector3; to: THREE.Vector3 } {
  const camPos = camera.position.clone();
  let dir: THREE.Vector3;
  if (targetWorld) {
    const ndc = targetWorld.clone().project(camera);
    const cx = THREE.MathUtils.clamp(ndc.x, -HOVER_NDC_X, HOVER_NDC_X);
    const cy = THREE.MathUtils.clamp(ndc.y, -HOVER_NDC_Y_BOTTOM, HOVER_NDC_Y_TOP);
    const pt = new THREE.Vector3(cx, cy, 0.5).unproject(camera);
    dir = pt.sub(camPos).normalize();
  } else {
    // No visible target could be found (e.g. a nearly-empty view direction) — hover straight ahead.
    dir = camera.getWorldDirection(new THREE.Vector3());
  }
  const to = pointAtRadiusAlongRay(camPos, dir, 2.3);
  const from = pointAtRadiusAlongRay(camPos, dir, 5.5);
  return { from, to };
}

let invasionStartElapsed = 0;

function startInvasion(level: number): void {
  if (!demoGlobe) return;
  const cfg = invasionConfigForLevel(level);
  if (!cfg) return;
  controller = new InvasionController(demoGlobe, cfg);
  invasionStartElapsed = elapsed;
  log(`invasion started (level ${level}, ${cfg.shipCount} ship(s), attackDelay=${cfg.attackDelayS.toFixed(1)}s)`);
}

function spawnRandomShip(): void {
  if (!demoGlobe) return;
  const cfg = invasionConfigForLevel(INVASION_FIRST_LEVEL)!;
  // Piggy-back a single extra ship onto the running controller's schedule by
  // starting a fresh controller with one ship spawning immediately — simplest
  // way to demo "spawn ship" on demand without exposing a mid-run API that
  // the real game (which schedules everything at level start) never needs.
  controller = new InvasionController(demoGlobe, { ...cfg, shipCount: 1, firstArrivalDelayS: 0.1 });
  invasionStartElapsed = elapsed;
  log('manual ship spawn requested');
}

// The render loop (`frame`, below) starts immediately, independent of this
// promise: `scene.flyTo()` only ever resolves via `scene.update(dt)` ticking
// its tween, so awaiting it here before the loop starts would deadlock.
async function init(): Promise<void> {
  await scene.loadPlanet('earth');
  scene.setBodyRevealed(false);
  await scene.flyTo('gameplay', 0.8);
  demoGlobe = new DemoGlobe(scene.beadMaterial);
  scene.globe.add(demoGlobe.mesh);
  // Parented under the same rotating group as the beads (globe-local unit-sphere
  // coordinates), so embers/smoke turn with the globe instead of sliding across it.
  scene.globe.add(fireEmbers.object);
  // ?level=N (QA-only, same convention as the main game) picks which
  // level's invasion config to demo; defaults to the guaranteed first one.
  const levelParam = Number(new URLSearchParams(window.location.search).get('level'));
  startInvasion(levelParam >= INVASION_FIRST_LEVEL ? levelParam : INVASION_FIRST_LEVEL);
  setProbe(EARTH_PALETTE[0], '(gameplay probe)');
  ready = true;
}

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

function pointerToNdc(e: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
}

canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (!ready || !demoGlobe || !controller) return;
  pointerToNdc(e);
  raycaster.setFromCamera(pointerNdc, scene.camera);

  const shipIds = aliens.raycastShips(raycaster);
  if (shipIds.length > 0) {
    const id = shipIds[0];
    if (controller.destroyShip(id)) {
      aliens.destroyShip(id);
      audio.play('shipExplode');
      log(`ship ${id} destroyed`);
    }
    return;
  }

  const hits = raycaster.intersectObject(demoGlobe.mesh, false);
  if (hits.length > 0 && hits[0].instanceId !== undefined) {
    const index = hits[0].instanceId;
    const color = demoGlobe.colorAt(0, index);
    if (color === FIRE_COLOR) {
      const region = demoGlobe.region(0, index);
      demoGlobe.pop(region);
      audio.play('extinguish');
      log(`extinguished a ${region.length}-bead fire patch`);
    } else if (color !== null) {
      const region = demoGlobe.region(0, index);
      demoGlobe.pop(region);
      audio.play('pop', { intensity: Math.min(1, region.length / 30) });
    }
  }
});

document.querySelector('[data-action="spawn"]')?.addEventListener('click', spawnRandomShip);
document.querySelector('[data-action="autoplay"]')?.addEventListener('click', () => {
  autoplay = !autoplay;
  log(`autoplay ${autoplay ? 'on' : 'off'}`);
});
document.querySelector('[data-action="destroy-all"]')?.addEventListener('click', () => {
  if (!controller) return;
  for (const s of controller.getShips()) {
    if (controller.destroyShip(s.id)) {
      aliens.destroyShip(s.id);
      audio.play('shipExplode');
    }
  }
});

window.addEventListener('resize', () => scene.resize());

let autoTapAcc = 0;
let lastFireCrackleAt = -10;
let elapsed = 0;

function autoTap(): void {
  if (!controller || !demoGlobe) return;
  const outcome = controller.onShotFired();
  if (outcome.spread.length) log(`fire spread to ${outcome.spread.length} more bead(s)`);
  if (outcome.queueOverrideColor !== null) {
    setProbe(outcome.queueOverrideColor, '(extinguish!)');
    const fireBeads = controller.fireBeadRefs();
    if (fireBeads.length > 0) {
      const b = fireBeads[Math.floor(Math.random() * fireBeads.length)];
      const region = demoGlobe.region(b.shellId, b.index);
      demoGlobe.pop(region);
      audio.play('extinguish');
      log(`auto-extinguished a ${region.length}-bead fire patch`);
    }
    setProbe(EARTH_PALETTE[Math.floor(Math.random() * EARTH_PALETTE.length)], '(gameplay probe)');
  } else {
    setProbe(EARTH_PALETTE[Math.floor(Math.random() * EARTH_PALETTE.length)], '(gameplay probe)');
  }
}

let last = performance.now();
// A generous clamp (not the usual ~50ms): headless/software rendering can
// take much longer than 16ms per frame, and this demo would otherwise look
// frozen instead of just slow (see Memory_Bank.md's note on BeadGlobe's own
// animation clock for the same reasoning). Capped well under a second so a
// single slow frame can't fully consume a short VFX (explosion) between one
// paint and the next. Tightened further, right around the ~0.2s laser zap
// specifically (see `dtClamp` below), since that VFX is short enough that
// even the 0.2s clamp could otherwise let one slow frame swallow it whole.
let dtClamp = 0.2;
function frame(now: number): void {
  const dt = Math.min(dtClamp, (now - last) / 1000);
  last = now;
  elapsed += dt;

  scene.update(dt);
  // Sub-step short-lived VFX (laser flash, explosion) so a slow/software-rendered
  // frame can't jump straight through them in one big `dt` — this keeps the
  // total simulated time correct while giving a screenshot (or just the human
  // eye) a real chance of catching them mid-animation.
  let alienRemaining = dt;
  while (alienRemaining > 0) {
    const step = Math.min(0.08, alienRemaining);
    aliens.update(step);
    alienRemaining -= step;
  }

  if (ready && demoGlobe && controller) {
    demoGlobe.updateFireFlicker(dt);
    fireEmbers.update(dt, demoGlobe.firePositions());

    // The globe here never rotates independently of its parent group, but we
    // still go through `worldToLocal` (the same "camera position in
    // globe-local space" trick `Game.ts`'s Solar Flare power uses, per
    // Memory_Bank.md) so this keeps working unchanged if the demo ever adds
    // drag-to-rotate.
    const camLocal = scene.globe.worldToLocal(scene.camera.position.clone());
    const viewDir: Vec3 = { x: camLocal.x, y: camLocal.y, z: camLocal.z };

    const events = controller.tick(dt, viewDir);
    for (const ev of events) {
      if (ev.type === 'shipSpawned') {
        const targetWorld = ev.target ? (() => { const p = demoGlobe!.positionOf(ev.target!.shellId, ev.target!.index); return new THREE.Vector3(p.x, p.y, p.z); })() : null;
        const path = computeApproachPath(scene.camera, targetWorld);
        const ship = controller.getShips().find((s) => s.id === ev.id)!;
        const arriveSeconds = Math.max(0.1, ship.arriveAt - (elapsed - invasionStartElapsed));
        aliens.spawnShip(ev.id, { fromWorldPos: path.from, toWorldPos: path.to, arriveSeconds });
        audio.play('shipArrive');
        log(`ship ${ev.id} inbound`);
      } else if (ev.type === 'shipArrived') {
        audio.play('laserCharge');
        log(`ship ${ev.id} charging weapon`);
      } else if (ev.type === 'laserFired') {
        const p = demoGlobe.positionOf(ev.target.shellId, ev.target.index);
        aliens.fireLaser(ev.id, new THREE.Vector3(p.x, p.y, p.z));
        audio.play('laserFire');
        log(`ship ${ev.id} fired!`);
      } else if (ev.type === 'fireIgnited') {
        log(`fire ignited: ${ev.beads.length} bead(s)`);
        audio.play('fireCrackle', { intensity: 0.6 });
        lastFireCrackleAt = elapsed;
        const positions = ev.beads.map((b) => {
          const p = demoGlobe!.positionOf(b.shellId, b.index);
          return new THREE.Vector3(p.x, p.y, p.z);
        });
        fireEmbers.spawnIgnite(positions);
      }
    }

    for (const ship of controller.getShips()) {
      if (ship.phase === 'charging') aliens.setCharging(ship.id, controller.chargeProgress(ship.id));
    }

    if (controller.isFireActive() && elapsed - lastFireCrackleAt > 1.6) {
      audio.play('fireCrackle', { intensity: 0.3 });
      lastFireCrackleAt = elapsed;
    }

    if (autoplay) {
      autoTapAcc += dt;
      if (autoTapAcc > 0.45) {
        autoTapAcc = 0;
        autoTap();
      }
    }

    if (controller.isFinished() && Math.random() < 0.003) {
      // Keep the demo going: start a fresh invasion once the current one has nothing left to do.
      startInvasion(INVASION_FIRST_LEVEL + Math.floor(Math.random() * 200));
    }

    statusEl.textContent = `ships=${controller.getShips().filter((s) => s.phase !== 'destroyed' && s.phase !== 'fired').length} fire=${controller.fireBeadRefs().length} beadsLeft=${demoGlobe.aliveCount()}`;

    // Shrink the dt clamp right around the moment a ship fires so the brief
    // laser zap gets a few real paints instead of a single slow frame
    // swallowing all of it (same idea as the sub-stepping above, just for the
    // outer per-frame clamp too).
    const activeController = controller;
    const nearFire = activeController.getShips().some((s) => s.phase === 'fired' || (s.phase === 'charging' && activeController.chargeProgress(s.id) > 0.8));
    dtClamp = nearFire ? 0.045 : 0.2;
  }

  scene.render();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
init();
