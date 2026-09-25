/**
 * Alien invasion visuals — THREE only, no game rules (see `src/game/invasion.ts`
 * for the timers/attack/fire rules this renders). Owns a small pool of
 * stylized saucer meshes plus their approach/hover/charge/laser/explosion
 * animation, entirely driven by the small API below:
 *
 *   spawnShip(id, opts)      — ship id -> flight path
 *   setCharging(id, t)       — 0..1 telegraph glow build-up (last ~1s before firing)
 *   fireLaser(id, targetPos) — beam + impact flash
 *   destroyShip(id)          — explosion, then the slot is freed
 *   raycastShips(raycaster)  — ship ids under a ray, nearest first
 *   update(dt) / dispose()
 *
 * Self-contained: doesn't import from `src/render/fx.ts` so it can't
 * conflict with concurrent edits there.
 */
import * as THREE from 'three';
import { easeInOutCubic } from './easing';

const BLOOM_LAYER = 1;
const MAX_SHIPS = 6;
const LIGHT_COUNT = 10;
/** Generous, phone-friendly tap radius (world units) around a ship's own position — see `raycastShips`. Roughly matches `SHIP_HIT_RADIUS` in `src/game/Game.ts`, which sizes the invasion tutorial's spotlight to it. */
const HIT_RADIUS = 0.2;

type ShipPhase = 'idle' | 'approaching' | 'hover' | 'charging' | 'firing' | 'exploding';

interface ShipSlot {
  active: boolean;
  id: number;
  phase: ShipPhase;
  group: THREE.Group;
  hull: THREE.Mesh;
  finL: THREE.Mesh;
  finR: THREE.Mesh;
  rim: THREE.Mesh;
  rimMat: THREE.MeshBasicMaterial;
  dome: THREE.Mesh;
  domeMat: THREE.MeshPhysicalMaterial;
  lightRing: THREE.Sprite[];
  engineGlow: THREE.Sprite[];
  chargeOrb: THREE.Sprite;
  chargeOrbMat: THREE.SpriteMaterial;
  chargeLight: THREE.PointLight;
  from: THREE.Vector3;
  to: THREE.Vector3;
  approachT: number;
  approachDur: number;
  hoverSeed: number;
  chargeProgress: number;
  laserT: number;
  laserDur: number;
  laserTarget: THREE.Vector3;
  laser: THREE.Mesh;
  laserMat: THREE.MeshBasicMaterial;
  impactFlash: THREE.Sprite;
  impactFlashMat: THREE.SpriteMaterial;
  explodeT: number;
  explodeDur: number;
  explosionSparks: Float32Array; // n*6: pos xyz + vel xyz, local to group
}

export interface SpawnShipOptions {
  fromWorldPos: THREE.Vector3;
  toWorldPos: THREE.Vector3;
  /** Seconds of flight from `fromWorldPos` to `toWorldPos`. */
  arriveSeconds: number;
}

let glowTexCache: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTexCache) return glowTexCache;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexCache = new THREE.CanvasTexture(c);
  return glowTexCache;
}

// A small procedural panel-line texture (vertical seams + a mid-height belt
// seam + a few rivet dots) so the hull reads as built, not a flat-shaded
// primitive. Cheap, cached once, reused by every pooled ship.
let hullTexCache: THREE.Texture | null = null;
function hullPanelTexture(): THREE.Texture {
  if (hullTexCache) return hullTexCache;
  const w = 256;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#77879c';
  ctx.fillRect(0, 0, w, h);
  // Vertical panel seams (lathe u-direction = around the hull).
  const seams = 16;
  for (let i = 0; i < seams; i++) {
    const x = (i / seams) * w;
    ctx.strokeStyle = 'rgba(18,22,30,0.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    // A brighter highlight just to the right of each seam, like beveled metal.
    ctx.strokeStyle = 'rgba(210,220,235,0.18)';
    ctx.beginPath();
    ctx.moveTo(x + 1.5, 0);
    ctx.lineTo(x + 1.5, h);
    ctx.stroke();
  }
  // Horizontal belt seam roughly where the hull is widest.
  ctx.strokeStyle = 'rgba(18,22,30,0.4)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.42);
  ctx.lineTo(w, h * 0.42);
  ctx.stroke();
  // Rivets.
  ctx.fillStyle = 'rgba(20,24,32,0.5)';
  for (let i = 0; i < seams; i++) {
    const x = (i / seams) * w + w / seams / 2;
    ctx.beginPath();
    ctx.arc(x, h * 0.42, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  hullTexCache = new THREE.CanvasTexture(c);
  hullTexCache.wrapS = THREE.RepeatWrapping;
  hullTexCache.wrapT = THREE.ClampToEdgeWrapping;
  hullTexCache.anisotropy = 4;
  return hullTexCache;
}

/** A saucer profile (radius, y) rotated around the Y axis: flat belly, a raised
 *  belted rim, and a domed upper hull tapering to an apex — one continuous
 *  hull silhouette rather than a squashed sphere. */
function buildHullGeometry(): THREE.LatheGeometry {
  const pts = [
    new THREE.Vector2(0.0, -0.02),
    new THREE.Vector2(0.022, -0.019),
    new THREE.Vector2(0.038, -0.013),
    new THREE.Vector2(0.05, -0.004),
    new THREE.Vector2(0.046, 0.004),
    new THREE.Vector2(0.032, 0.013),
    new THREE.Vector2(0.02, 0.022),
    new THREE.Vector2(0.01, 0.03),
    new THREE.Vector2(0.0, 0.034),
  ];
  const geo = new THREE.LatheGeometry(pts, 28);
  geo.computeVertexNormals();
  return geo;
}

const EXPLOSION_SPARK_COUNT = 24;

/** Builds one pooled saucer: layered hull + belt rim + underside light ring +
 *  fin pods + glass canopy + engine glow + charge orb + laser + explosion sparks. */
function buildShip(): Omit<ShipSlot, 'active' | 'id' | 'phase' | 'from' | 'to' | 'approachT' | 'approachDur' | 'hoverSeed' | 'chargeProgress' | 'laserT' | 'laserDur' | 'laserTarget' | 'explodeT' | 'explodeDur'> {
  const group = new THREE.Group();
  group.visible = false;
  // Ships are built at bead-adjacent scale (~0.05 world units) so their
  // internal proportions read naturally, then blown up here to be legible
  // against a bead globe of radius ~1 seen from a few units away. Tuned
  // empirically against real in-game screenshots (gameplay camera ~5.6
  // world units out, hovering ~2.6 units from the globe's center, i.e.
  // ~3 units from the camera) so a hovering ship reads at roughly 1/6 of
  // the screen width including its fins.
  group.scale.setScalar(1.5);

  // Metalness kept moderate (not near-1): a fully metallic hull only reads bright where a scene
  // light hits it at exactly the specular angle, and against the dark starfield/gameplay lighting
  // that made the ship read as a near-black silhouette. A mixed metal/diffuse response plus a
  // small always-on emissive floor (see below) keeps the panel-line hull legible from any angle.
  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xc7d0dd,
    metalness: 0.4,
    roughness: 0.5,
    emissive: 0x1c2430,
    emissiveIntensity: 0.5,
    map: hullPanelTexture(),
  });
  const hull = new THREE.Mesh(buildHullGeometry(), hullMat);
  hull.userData.isShipHull = true;
  group.add(hull);

  // A small practical light traveling with the ship so its hull reads clearly regardless of the
  // scene's own gameplay lighting angle (the same problem `BeadGlobe`'s pearl material solved with
  // a dedicated envMap — ships get a literal light instead, cheaper for a handful of pooled slots).
  const fillLight = new THREE.PointLight(0xdfe8ff, 1.1, 0.4);
  fillLight.position.set(0, 0.05, 0.05);
  group.add(fillLight);

  // Two swept fin pods flanking the hull's belt line — breaks up the pure
  // disc silhouette and gives the engine glow somewhere to live besides the
  // hull's own rim.
  const finMat = new THREE.MeshStandardMaterial({ color: 0x6b7889, metalness: 0.4, roughness: 0.5, emissive: 0x11161f, emissiveIntensity: 0.4 });
  const finGeo = new THREE.BoxGeometry(0.05, 0.007, 0.02);
  finGeo.translate(0.025, 0, 0); // pivot at the inner edge so it reads as attached to the hull
  const finL = new THREE.Mesh(finGeo, finMat);
  finL.position.set(0.046, -0.006, -0.004);
  finL.rotation.y = 0.22;
  finL.rotation.z = 0.16;
  group.add(finL);
  const finR = finL.clone();
  finR.position.x = -0.046;
  finR.rotation.y = -0.22;
  finR.rotation.z = -0.16;
  group.add(finR);

  const rimMat = new THREE.MeshBasicMaterial({ color: 0x59e0ff, toneMapped: false });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.0035, 8, 28), rimMat);
  rim.rotation.x = Math.PI / 2;
  rim.position.y = -0.004;
  rim.layers.enable(BLOOM_LAYER);
  group.add(rim);

  // Underside ring of small pulsing lights, like a saucer's landing-light
  // array. Small additive-blended glow sprites (same texture/approach as the
  // engine glow below, already proven visible against the hull) rather than
  // unlit mesh instances, which read as flat dark dots at this scale.
  const lightRing: THREE.Sprite[] = [];
  for (let i = 0; i < LIGHT_COUNT; i++) {
    const a = (i / LIGHT_COUNT) * Math.PI * 2;
    const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x59e0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.7 });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(0.011);
    s.position.set(Math.cos(a) * 0.044, -0.015, Math.sin(a) * 0.044);
    s.layers.enable(BLOOM_LAYER);
    group.add(s);
    lightRing.push(s);
  }

  const domeMat = new THREE.MeshPhysicalMaterial({
    color: 0x8fd8ff,
    metalness: 0,
    roughness: 0.08,
    transmission: 0.65,
    thickness: 0.02,
    emissive: 0x1a4a66,
    emissiveIntensity: 0.6,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10, 0, Math.PI * 2, 0, Math.PI / 1.9), domeMat);
  dome.position.y = 0.03;
  group.add(dome);

  const engineGlow: THREE.Sprite[] = [];
  for (const side of [-1, 1]) {
    const mat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0x59e0ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 });
    const s = new THREE.Sprite(mat);
    s.scale.setScalar(0.026);
    // Parked at each fin's trailing tip so the glow reads as an engine nacelle.
    s.position.set(side * 0.07, -0.008, -0.012);
    s.layers.enable(BLOOM_LAYER);
    group.add(s);
    engineGlow.push(s);
  }

  const chargeOrbMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff5522, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const chargeOrb = new THREE.Sprite(chargeOrbMat);
  chargeOrb.scale.setScalar(0.001);
  chargeOrb.position.set(0, -0.02, 0);
  chargeOrb.layers.enable(BLOOM_LAYER);
  group.add(chargeOrb);

  const chargeLight = new THREE.PointLight(0xff5522, 0, 0.6);
  chargeLight.position.copy(chargeOrb.position);
  group.add(chargeLight);

  const laserMat = new THREE.MeshBasicMaterial({ color: 0xff6a33, transparent: true, opacity: 0, toneMapped: false, blending: THREE.AdditiveBlending, depthWrite: false });
  const laser = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1, 8, 1, true), laserMat);
  laser.visible = false;
  laser.layers.enable(BLOOM_LAYER);
  group.add(laser);

  const impactFlashMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffaa55, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  const impactFlash = new THREE.Sprite(impactFlashMat);
  impactFlash.scale.setScalar(0.001);
  impactFlash.layers.enable(BLOOM_LAYER);
  group.add(impactFlash);

  const explosionGeo = new THREE.BufferGeometry();
  const explosionSparks = new Float32Array(EXPLOSION_SPARK_COUNT * 6);
  explosionGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(EXPLOSION_SPARK_COUNT * 3), 3));
  const explosionMat = new THREE.PointsMaterial({ color: 0xffb066, size: 0.05, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
  const explosionPoints = new THREE.Points(explosionGeo, explosionMat);
  explosionPoints.layers.enable(BLOOM_LAYER);
  explosionPoints.visible = false;
  // Positions start at the local origin and are only written per-frame once
  // an explosion starts, so a lazily-cached bounding sphere would freeze at
  // radius 0 the first time three.js computes it; skip frustum culling
  // entirely for this small, short-lived points cloud instead.
  explosionPoints.frustumCulled = false;
  group.add(explosionPoints);
  // Stashed on the group so `resetExplosion`/`updateExplosion` can find it without widening ShipSlot further.
  group.userData.explosionPoints = explosionPoints;

  return {
    group,
    hull,
    finL,
    finR,
    rim,
    rimMat,
    dome,
    domeMat,
    lightRing,
    engineGlow,
    chargeOrb,
    chargeOrbMat,
    chargeLight,
    laser,
    laserMat,
    impactFlash,
    impactFlashMat,
    explosionSparks,
  };
}

export class AlienInvasionRenderer {
  readonly group = new THREE.Group();
  private readonly slots: ShipSlot[] = [];
  private readonly tmpV1 = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpV3 = new THREE.Vector3();
  private readonly tmpV4 = new THREE.Vector3();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();
  private readonly tmpColor = new THREE.Color();

  constructor() {
    for (let i = 0; i < MAX_SHIPS; i++) {
      const built = buildShip();
      const slot: ShipSlot = {
        active: false,
        id: -1,
        phase: 'idle',
        from: new THREE.Vector3(),
        to: new THREE.Vector3(),
        approachT: 0,
        approachDur: 1.6,
        hoverSeed: Math.random() * 1000,
        chargeProgress: 0,
        laserT: 0,
        laserDur: 0.22,
        laserTarget: new THREE.Vector3(),
        explodeT: 0,
        explodeDur: 0.7,
        ...built,
      };
      this.group.add(slot.group);
      this.slots.push(slot);
    }
  }

  private findSlot(id: number): ShipSlot | undefined {
    return this.slots.find((s) => s.active && s.id === id);
  }

  spawnShip(id: number, opts: SpawnShipOptions): void {
    const slot = this.slots.find((s) => !s.active);
    if (!slot) return; // pool exhausted; a level never schedules more than MAX_SHIPS concurrently
    slot.active = true;
    slot.id = id;
    slot.phase = 'approaching';
    slot.from.copy(opts.fromWorldPos);
    slot.to.copy(opts.toWorldPos);
    slot.approachT = 0;
    slot.approachDur = Math.max(0.1, opts.arriveSeconds);
    slot.hoverSeed = Math.random() * 1000;
    slot.chargeProgress = 0;
    slot.chargeOrbMat.opacity = 0;
    slot.chargeOrb.scale.setScalar(0.001);
    slot.chargeLight.intensity = 0;
    slot.laserMat.opacity = 0;
    slot.laser.visible = false;
    slot.impactFlashMat.opacity = 0;
    slot.group.visible = true;
    slot.group.position.copy(opts.fromWorldPos);
    slot.hull.visible = true;
    slot.finL.visible = true;
    slot.finR.visible = true;
    slot.rim.visible = true;
    slot.dome.visible = true;
    for (const l of slot.lightRing) l.visible = true;
    for (const g of slot.engineGlow) g.visible = true;
  }

  /** 0..1 telegraph build-up in the ~1s before this ship fires. Safe to call every frame; no-op if the ship isn't found or isn't charging. */
  setCharging(id: number, progress: number): void {
    const slot = this.findSlot(id);
    if (!slot || slot.phase === 'exploding') return;
    slot.phase = 'charging';
    slot.chargeProgress = Math.max(0, Math.min(1, progress));
  }

  fireLaser(id: number, targetWorldPos: THREE.Vector3): void {
    const slot = this.findSlot(id);
    if (!slot) return;
    slot.phase = 'firing';
    slot.laserT = 0;
    slot.laserTarget.copy(targetWorldPos);
    slot.laser.visible = true;
    slot.laserMat.opacity = 1;
    slot.chargeOrbMat.opacity = 0;
    slot.chargeOrb.scale.setScalar(0.001);
    slot.chargeLight.intensity = 0;
  }

  destroyShip(id: number): void {
    const slot = this.findSlot(id);
    if (!slot) return;
    slot.phase = 'exploding';
    slot.explodeT = 0;
    slot.chargeOrbMat.opacity = 0;
    slot.chargeLight.intensity = 0;
    slot.laser.visible = false;
    slot.laserMat.opacity = 0;
    slot.hull.visible = false;
    slot.finL.visible = false;
    slot.finR.visible = false;
    slot.rim.visible = false;
    slot.dome.visible = false;
    for (const l of slot.lightRing) l.visible = false;
    for (const g of slot.engineGlow) g.visible = false;

    const rng = () => Math.random();
    for (let i = 0; i < EXPLOSION_SPARK_COUNT; i++) {
      const dir = new THREE.Vector3(rng() * 2 - 1, rng() * 2 - 1, rng() * 2 - 1).normalize();
      const speed = 0.4 + rng() * 0.8;
      slot.explosionSparks[i * 6 + 0] = 0;
      slot.explosionSparks[i * 6 + 1] = 0;
      slot.explosionSparks[i * 6 + 2] = 0;
      slot.explosionSparks[i * 6 + 3] = dir.x * speed;
      slot.explosionSparks[i * 6 + 4] = dir.y * speed;
      slot.explosionSparks[i * 6 + 5] = dir.z * speed;
    }
    const explosionPoints = slot.group.userData.explosionPoints as THREE.Points;
    explosionPoints.visible = true;
    (explosionPoints.material as THREE.PointsMaterial).opacity = 1;

    slot.impactFlash.position.set(0, 0, 0);
    slot.impactFlash.scale.setScalar(0.12);
    slot.impactFlashMat.color.setHex(0xffcc77);
    slot.impactFlashMat.opacity = 1;
  }

  /**
   * Ship ids currently hittable (approaching/hover/charging/firing, not mid-explosion) whose
   * distance from the tap ray is within `HIT_RADIUS`, nearest first. A phone tap has to land
   * within the ship's actual small silhouette with a plain mesh raycast, which item #4 flagged as
   * too fussy on a touchscreen — this uses a generous fixed-radius distance-to-ray test around each
   * ship's real world position instead (the ship's own `group.position` *is* its world position:
   * `AlienInvasionRenderer.group` is added directly to `scene.scene` with no transform of its own).
   */
  raycastShips(raycaster: THREE.Raycaster): number[] {
    const hittable = this.slots.filter((s) => s.active && s.phase !== 'exploding');
    const closest = new THREE.Vector3();
    const scored: { id: number; dist: number }[] = [];
    for (const s of hittable) {
      raycaster.ray.closestPointToPoint(s.group.position, closest);
      if (closest.distanceTo(s.group.position) <= HIT_RADIUS) {
        scored.push({ id: s.id, dist: raycaster.ray.origin.distanceTo(closest) });
      }
    }
    scored.sort((a, b) => a.dist - b.dist);
    return scored.map((s) => s.id);
  }

  /** World position of a still-active ship, for the invasion tutorial's spotlight; null if not found. */
  getShipWorldPosition(id: number): THREE.Vector3 | null {
    const slot = this.findSlot(id);
    return slot ? slot.group.position.clone() : null;
  }

  /** Instantly clears every ship (no animation) — used when a level ends/reloads with ships still active. */
  reset(): void {
    for (const slot of this.slots) {
      slot.active = false;
      slot.phase = 'idle';
      slot.group.visible = false;
      const explosionPoints = slot.group.userData.explosionPoints as THREE.Points;
      explosionPoints.visible = false;
    }
  }

  update(dt: number): void {
    for (const slot of this.slots) {
      if (!slot.active) continue;
      switch (slot.phase) {
        case 'approaching':
          this.updateApproach(slot, dt);
          break;
        case 'charging':
          this.updateHover(slot, dt);
          this.updateCharge(slot, dt);
          break;
        case 'firing':
          this.updateHover(slot, dt);
          this.updateLaser(slot, dt);
          break;
        case 'exploding':
          this.updateExplosion(slot, dt);
          break;
        default:
          this.updateHover(slot, dt);
      }
    }
  }

  private updateApproach(slot: ShipSlot, dt: number): void {
    slot.approachT += dt;
    const u = Math.min(1, slot.approachT / slot.approachDur);
    const eased = easeInOutCubic(u);
    this.tmpV1.lerpVectors(slot.from, slot.to, eased);
    // Banking: roll into the direction of travel, easing out near arrival.
    const bank = Math.sin(u * Math.PI) * 0.5;
    slot.group.position.copy(this.tmpV1);
    slot.group.rotation.z = bank;
    slot.group.lookAt(0, 0, 0);
    slot.group.rotateZ(bank);
    this.updateLightRing(slot, 0);
    if (u >= 1) slot.phase = 'hover';
  }

  private updateHover(slot: ShipSlot, dt: number): void {
    slot.hoverSeed += dt;
    const wobble = Math.sin(slot.hoverSeed * 1.6) * 0.006;
    slot.group.position.copy(slot.to);
    slot.group.position.y += wobble;
    slot.group.lookAt(0, 0, 0);
    // Subtle continuous bank while hovering so it doesn't look frozen.
    slot.group.rotateZ(Math.sin(slot.hoverSeed * 0.7) * 0.05);
    const engineFlicker = 0.6 + 0.4 * Math.sin(slot.hoverSeed * 9);
    for (const g of slot.engineGlow) (g.material as THREE.SpriteMaterial).opacity = 0.6 * engineFlicker;
    if (slot.phase !== 'charging' && slot.phase !== 'firing') this.updateLightRing(slot, 0);
  }

  /** Chasing pulse around the underside light ring; blends cyan -> orange with charge progress. */
  private updateLightRing(slot: ShipSlot, chargeProgress: number): void {
    const t = performance.now() * 0.004 + slot.hoverSeed;
    for (let i = 0; i < LIGHT_COUNT; i++) {
      const phase = (i / LIGHT_COUNT) * Math.PI * 2;
      const pulse = 0.3 + 0.7 * Math.max(0, Math.sin(t * 2.4 - phase * 2));
      const mat = slot.lightRing[i].material as THREE.SpriteMaterial;
      this.tmpColor.setHex(0x59e0ff).lerp(new THREE.Color(0xff5522), chargeProgress);
      mat.color.copy(this.tmpColor);
      mat.opacity = 0.25 + pulse * 0.7;
    }
  }

  private updateCharge(slot: ShipSlot, dt: number): void {
    void dt;
    const p = slot.chargeProgress;
    const pulse = 0.75 + 0.25 * Math.sin(performance.now() * 0.02);
    slot.chargeOrbMat.opacity = p * pulse;
    slot.chargeOrb.scale.setScalar(0.008 + p * 0.03);
    slot.chargeLight.intensity = p * 2.2;
    slot.rimMat.color.setHex(p > 0.5 ? 0xff5522 : 0x59e0ff);
    this.updateLightRing(slot, p);
  }

  private updateLaser(slot: ShipSlot, dt: number): void {
    slot.laserT += dt;
    const u = Math.min(1, slot.laserT / slot.laserDur);
    slot.laserMat.opacity = 1 - u;

    // The beam's start (the ship's chargeOrb) and end (the target bead) are
    // naturally known in world space, but `laser`/`impactFlash` are children
    // of this ship's `group` (for pooling/disposal convenience), so their
    // `position`/`quaternion` are local-space — go through `worldToLocal`
    // explicitly rather than assigning world coordinates directly (which
    // only looked right by coincidence when the group sat near the world
    // origin with no rotation; it hovers well away from it now).
    slot.chargeOrb.getWorldPosition(this.tmpV1); // world-space beam start
    const dirWorld = this.tmpV2.subVectors(slot.laserTarget, this.tmpV1);
    const len = Math.max(0.001, dirWorld.length());
    const midWorld = this.tmpV3.copy(this.tmpV1).addScaledVector(dirWorld, 0.5);
    slot.laser.position.copy(slot.group.worldToLocal(midWorld));
    const groupScale = slot.group.getWorldScale(this.tmpV4).x || 1;
    slot.laser.scale.set(1, len / groupScale, 1);
    slot.group.getWorldQuaternion(this.tmpQ2).invert();
    const localDir = dirWorld.clone().normalize().applyQuaternion(this.tmpQ2);
    this.tmpQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), localDir);
    slot.laser.quaternion.copy(this.tmpQ);

    slot.impactFlash.position.copy(slot.group.worldToLocal(slot.laserTarget.clone()));
    const flashU = u < 0.5 ? u / 0.5 : 1 - (u - 0.5) / 0.5;
    slot.impactFlashMat.opacity = flashU;
    slot.impactFlash.scale.setScalar((0.02 + flashU * 0.05) / groupScale);
    this.updateLightRing(slot, 1);

    if (u >= 1) {
      slot.laser.visible = false;
      slot.impactFlashMat.opacity = 0;
      slot.active = false; // mission complete: free the slot (Game.ts has already applied the fire event by now)
      slot.group.visible = false;
    }
  }

  private updateExplosion(slot: ShipSlot, dt: number): void {
    slot.explodeT += dt;
    const u = Math.min(1, slot.explodeT / slot.explodeDur);
    const explosionPoints = slot.group.userData.explosionPoints as THREE.Points;
    const posAttr = explosionPoints.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < EXPLOSION_SPARK_COUNT; i++) {
      slot.explosionSparks[i * 6 + 0] += slot.explosionSparks[i * 6 + 3] * dt;
      slot.explosionSparks[i * 6 + 1] += slot.explosionSparks[i * 6 + 4] * dt;
      slot.explosionSparks[i * 6 + 2] += slot.explosionSparks[i * 6 + 5] * dt;
      posAttr.setXYZ(i, slot.explosionSparks[i * 6 + 0], slot.explosionSparks[i * 6 + 1], slot.explosionSparks[i * 6 + 2]);
    }
    posAttr.needsUpdate = true;
    (explosionPoints.material as THREE.PointsMaterial).opacity = 1 - u;
    slot.impactFlashMat.opacity = Math.max(0, 1 - u * 2.5);
    slot.impactFlash.scale.setScalar(0.12 + u * 0.25);
    if (u >= 1) {
      slot.impactFlashMat.color.setHex(0xffaa55); // restore the laser-impact tint for next use
      slot.active = false;
      slot.group.visible = false;
      explosionPoints.visible = false;
      slot.hull.visible = true;
      slot.finL.visible = true;
      slot.finR.visible = true;
      slot.rim.visible = true;
      slot.dome.visible = true;
      for (const l of slot.lightRing) l.visible = true;
      for (const g of slot.engineGlow) g.visible = true;
    }
  }

  dispose(): void {
    for (const slot of this.slots) {
      slot.hull.geometry.dispose();
      (slot.hull.material as THREE.Material).dispose();
      slot.finL.geometry.dispose();
      (slot.finL.material as THREE.Material).dispose();
      slot.finR.geometry.dispose();
      slot.rim.geometry.dispose();
      slot.rimMat.dispose();
      slot.dome.geometry.dispose();
      slot.domeMat.dispose();
      for (const l of slot.lightRing) (l.material as THREE.Material).dispose();
      for (const g of slot.engineGlow) (g.material as THREE.Material).dispose();
      slot.chargeOrbMat.dispose();
      slot.laser.geometry.dispose();
      slot.laserMat.dispose();
      slot.impactFlashMat.dispose();
      const explosionPoints = slot.group.userData.explosionPoints as THREE.Points;
      explosionPoints.geometry.dispose();
      (explosionPoints.material as THREE.Material).dispose();
    }
  }
}
