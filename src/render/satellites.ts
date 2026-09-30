/**
 * Real-satellite visuals (GDD §5b) — THREE only, no game rules (see `src/game/satellites.ts`).
 * Procedural low-poly meshes of seven real spacecraft plus one pass animation: the craft flies
 * a half circular orbit around the globe's centre on the camera's side (so it always passes in
 * front of the planet), scaling in/out at the ends. Tapping is hit-tested by `Game.ts` in screen
 * space against `worldPosition()`.
 *
 *   start(id, opts)  — begin a pass (replaces any running one)
 *   catchNow()       — flash + zip away
 *   update(dt)       — advance the pass / blink / zip
 *   reset()          — hide immediately
 */
import * as THREE from 'three';
import type { SatelliteId } from '../game/satellites';

export interface SatellitePassOptions {
  orbitRadius: number;
  /** Globe diameter in world units; the craft is sized as a fraction of it. */
  globeDiameter: number;
  seconds: number;
  /** Orbit-plane tilt (radians) and travel direction. */
  tilt: number;
  dir: 1 | -1;
}

/** Span of each craft as a fraction of the globe's diameter (spec: roughly 8-14%). */
const SIZE_FRACTION: Record<SatelliteId, number> = {
  iss: 0.14,
  hubble: 0.12,
  lro: 0.12,
  mro: 0.13,
  marsExpress: 0.13,
  akatsuki: 0.11,
  juno: 0.13,
};

const ZIP_SECONDS = 0.55;
const EDGE_SCALE_FRACTION = 0.07;

// ------------------------------------------------------------------ materials

let gridTex: THREE.Texture | null = null;
/** Solar-cell grid texture (dark blue cells with lighter bus-bar seams), shared by every craft. */
function solarGridTexture(): THREE.Texture {
  if (gridTex) return gridTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#16356f';
  g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(150,185,255,0.55)';
  g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 128);
    g.moveTo(0, i);
    g.lineTo(128, i);
    g.stroke();
  }
  gridTex = new THREE.CanvasTexture(c);
  gridTex.colorSpace = THREE.SRGBColorSpace;
  gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
  gridTex.anisotropy = 4;
  return gridTex;
}

let glowTex: THREE.Texture | null = null;
function glowTexture(): THREE.Texture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  return glowTex;
}

const MATS = {
  foil: () => new THREE.MeshStandardMaterial({ color: 0xd9aa3c, metalness: 0.92, roughness: 0.32 }),
  white: () => new THREE.MeshStandardMaterial({ color: 0xbcc3cc, metalness: 0.3, roughness: 0.5 }),
  silver: () => new THREE.MeshStandardMaterial({ color: 0xc4ccd6, metalness: 0.85, roughness: 0.28 }),
  dark: () => new THREE.MeshStandardMaterial({ color: 0x2b2f38, metalness: 0.6, roughness: 0.5 }),
  truss: () => new THREE.MeshStandardMaterial({ color: 0xb9bfc9, metalness: 0.7, roughness: 0.45 }),
  /** `repeatU/V` = how many cell-grid tiles across the panel. */
  panel: (repeatU: number, repeatV: number) => {
    const tex = solarGridTexture().clone();
    tex.needsUpdate = true;
    tex.repeat.set(repeatU, repeatV);
    return new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      metalness: 0.55,
      roughness: 0.28,
      emissive: 0x0a1c44,
      emissiveIntensity: 0.6,
      side: THREE.DoubleSide,
    });
  },
};

// ------------------------------------------------------------------ mesh helpers

function box(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Solar wing lying in the XZ plane (thin in Y). `w` along X, `l` along Z. */
function wing(w: number, l: number, x: number, y: number, z: number): THREE.Mesh {
  return box(w, 0.006, l, MATS.panel(Math.max(1, Math.round(w / 0.05)), Math.max(1, Math.round(l / 0.05))), x, y, z);
}

/** Cylinder along X by default; `axis` rotates it onto Y or Z. */
function cyl(r: number, len: number, mat: THREE.Material, axis: 'x' | 'y' | 'z', x = 0, y = 0, z = 0, seg = 16): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  else if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}

/** Shallow dish opening toward +Y, its rim centred at (x, y, z). */
function dish(radius: number, x: number, y: number, z: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius * 1.6, 20, 8, 0, Math.PI * 2, 0, Math.asin(1 / 1.6));
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xaab2bd, metalness: 0.4, roughness: 0.45, side: THREE.DoubleSide }));
  m.rotation.x = Math.PI; // bowl opens toward +Y
  m.scale.y = 0.5;
  m.position.set(x, y, z);
  return m;
}

// ------------------------------------------------------------------ the craft (span ~1 unit)

function buildISS(): THREE.Group {
  const g = new THREE.Group();
  const truss = MATS.truss();
  const white = MATS.white();
  const foil = MATS.foil();
  g.add(box(1.0, 0.035, 0.035, truss));
  // four solar-array pairs (two at each end of the truss), each pair reaching out to +Z and -Z
  for (const x of [-0.44, -0.3, 0.3, 0.44]) {
    g.add(wing(0.1, 0.4, x, 0, 0.23));
    g.add(wing(0.1, 0.4, x, 0, -0.23));
    g.add(box(0.012, 0.012, 0.06, truss, x, 0, 0));
  }
  // pressurised modules hang off the middle of the truss
  g.add(cyl(0.032, 0.36, white, 'z', 0, -0.02, 0));
  g.add(cyl(0.028, 0.12, foil, 'x', 0.06, -0.02, 0.0));
  g.add(cyl(0.026, 0.14, white, 'x', -0.08, -0.02, 0.1));
  g.add(cyl(0.026, 0.14, white, 'x', -0.08, -0.02, -0.1));
  const node = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), white);
  node.position.set(0, -0.02, 0);
  g.add(node);
  // two white radiator panels
  g.add(box(0.05, 0.004, 0.14, white, 0.17, 0.03, 0.05));
  g.add(box(0.05, 0.004, 0.14, white, -0.17, 0.03, -0.05));
  return g;
}

function buildHubble(): THREE.Group {
  const g = new THREE.Group();
  const silver = MATS.silver();
  g.add(cyl(0.085, 0.56, silver, 'x', 0, 0, 0, 20));
  // darker aft shroud and equipment bay
  g.add(cyl(0.105, 0.2, MATS.foil(), 'x', -0.3, 0, 0, 20));
  g.add(cyl(0.065, 0.06, MATS.dark(), 'x', -0.42, 0, 0, 16));
  // forward light shield lip and the aperture door, swung open
  g.add(cyl(0.092, 0.05, MATS.white(), 'x', 0.3, 0, 0, 20));
  const door = box(0.012, 0.19, 0.17, MATS.white(), 0.36, 0.11, 0);
  door.rotation.z = -0.5;
  g.add(door);
  // the two solar wings
  g.add(wing(0.15, 0.36, -0.22, 0, 0.3));
  g.add(wing(0.15, 0.36, -0.22, 0, -0.3));
  g.add(cyl(0.008, 0.12, MATS.truss(), 'z', -0.22, 0, 0.09));
  g.add(cyl(0.008, 0.12, MATS.truss(), 'z', -0.22, 0, -0.09));
  // high-gain antenna booms
  g.add(cyl(0.006, 0.2, MATS.truss(), 'y', 0.05, 0.14, 0.1));
  g.add(cyl(0.006, 0.2, MATS.truss(), 'y', 0.05, 0.14, -0.1));
  return g;
}

function buildLRO(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.3, 0.2, 0.3, MATS.foil()));
  g.add(box(0.31, 0.04, 0.31, MATS.white(), 0, 0.1, 0));
  // high-gain dish on a boom, pointing up
  g.add(cyl(0.008, 0.16, MATS.truss(), 'y', 0.1, 0.27, 0));
  g.add(dish(0.09, 0.1, 0.36, 0));
  // the single solar wing on a short arm
  g.add(cyl(0.01, 0.12, MATS.truss(), 'x', -0.2, 0, 0));
  g.add(wing(0.3, 0.3, -0.42, 0, 0));
  // camera barrel underneath
  g.add(cyl(0.035, 0.14, MATS.dark(), 'y', 0, -0.17, 0.06, 12));
  return g;
}

function buildMRO(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.26, 0.2, 0.26, MATS.foil()));
  g.add(box(0.27, 0.03, 0.27, MATS.silver(), 0, 0.1, 0));
  // large 3 m high-gain dish
  g.add(cyl(0.008, 0.16, MATS.truss(), 'y', 0, 0.18, 0));
  g.add(dish(0.16, 0, 0.3, 0));
  // two solar wings
  g.add(cyl(0.01, 0.1, MATS.truss(), 'x', -0.18, 0, 0));
  g.add(cyl(0.01, 0.1, MATS.truss(), 'x', 0.18, 0, 0));
  g.add(wing(0.3, 0.4, -0.38, 0, 0));
  g.add(wing(0.3, 0.4, 0.38, 0, 0));
  // HiRISE-style telescope barrel
  g.add(cyl(0.04, 0.16, MATS.dark(), 'y', 0, -0.17, 0, 12));
  return g;
}

function buildMarsExpress(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.26, 0.22, 0.26, MATS.foil()));
  g.add(box(0.27, 0.03, 0.27, MATS.white(), 0, 0.11, 0));
  g.add(cyl(0.008, 0.1, MATS.truss(), 'y', 0.06, 0.17, 0));
  g.add(dish(0.065, 0.06, 0.23, 0));
  // two long solar wings
  g.add(cyl(0.008, 0.12, MATS.truss(), 'x', -0.19, 0, 0));
  g.add(cyl(0.008, 0.12, MATS.truss(), 'x', 0.19, 0, 0));
  g.add(wing(0.36, 0.18, -0.42, 0, 0));
  g.add(wing(0.36, 0.18, 0.42, 0, 0));
  return g;
}

function buildAkatsuki(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(0.24, 0.26, 0.24, MATS.foil()));
  g.add(box(0.25, 0.03, 0.25, MATS.silver(), 0, 0.14, 0));
  g.add(cyl(0.008, 0.08, MATS.truss(), 'y', 0.05, 0.19, 0));
  g.add(dish(0.06, 0.05, 0.25, 0));
  // two flat solar panels
  g.add(wing(0.24, 0.22, -0.26, 0, 0));
  g.add(wing(0.24, 0.22, 0.26, 0, 0));
  // thruster nozzle
  g.add(cyl(0.04, 0.08, MATS.dark(), 'y', 0, -0.17, 0, 12));
  return g;
}

function buildJuno(): THREE.Group {
  const g = new THREE.Group();
  // hexagonal vault body, axis along Y
  const hex = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 6), MATS.silver());
  g.add(hex);
  g.add(cyl(0.03, 0.05, MATS.dark(), 'y', 0, -0.1, 0, 10));
  // large dish on top
  g.add(dish(0.11, 0, 0.1, 0));
  // three long solar arrays in a Y, 120 degrees apart in the XZ plane
  for (let i = 0; i < 3; i++) {
    const a = Math.PI / 2 + (i * 2 * Math.PI) / 3;
    const pivot = new THREE.Group();
    pivot.rotation.y = a;
    pivot.add(box(0.06, 0.012, 0.03, MATS.truss(), 0.15, 0, 0));
    pivot.add(box(0.36, 0.006, 0.15, MATS.panel(7, 3), 0.36, 0, 0));
    g.add(pivot);
  }
  return g;
}

const BUILDERS: Record<SatelliteId, () => THREE.Group> = {
  iss: buildISS,
  hubble: buildHubble,
  lro: buildLRO,
  mro: buildMRO,
  marsExpress: buildMarsExpress,
  akatsuki: buildAkatsuki,
  juno: buildJuno,
};

// ------------------------------------------------------------------ renderer

type Phase = 'idle' | 'flying' | 'zipping';

const TMP_TANGENT = new THREE.Vector3();
const TMP_UP = new THREE.Vector3();
const TMP_X = new THREE.Vector3();
const TMP_Z = new THREE.Vector3();
const TMP_M = new THREE.Matrix4();
const E1 = new THREE.Vector3();
const E2 = new THREE.Vector3();

export class SatelliteRenderer {
  readonly group = new THREE.Group();
  private craft: THREE.Group | null = null;
  private readonly anchor = new THREE.Group();
  private readonly navMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xff5a4d, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  private readonly nav = new THREE.Sprite(this.navMat);
  private readonly flashMat = new THREE.SpriteMaterial({ map: glowTexture(), color: 0xbfe4ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
  private readonly flash = new THREE.Sprite(this.flashMat);
  private phase: Phase = 'idle';
  private opts: SatellitePassOptions | null = null;
  private t = 0;
  private zipT = 0;
  private time = 0;
  private sizeWorld = 0.2;
  private unitScale = 1;
  private readonly pos = new THREE.Vector3();
  private readonly zipDir = new THREE.Vector3();

  constructor() {
    this.group.visible = false;
    this.group.add(this.anchor);
    this.nav.renderOrder = 10;
    this.flash.renderOrder = 11;
    this.group.add(this.flash);
  }

  get active(): boolean {
    return this.phase === 'flying';
  }

  /** World-space size (span) of the current craft, for tap/spotlight sizing. */
  get span(): number {
    return this.sizeWorld;
  }

  /** The craft's current world position, or null when no craft is on screen. */
  worldPosition(): THREE.Vector3 | null {
    return this.phase === 'flying' ? this.pos : null;
  }

  start(id: SatelliteId, opts: SatellitePassOptions): void {
    this.reset();
    this.craft = BUILDERS[id]();
    this.sizeWorld = SIZE_FRACTION[id] * opts.globeDiameter;
    // Normalise the model so its longest dimension equals `sizeWorld`, whatever the craft's shape.
    const dims = new THREE.Box3().setFromObject(this.craft).getSize(new THREE.Vector3());
    this.unitScale = this.sizeWorld / Math.max(dims.x, dims.y, dims.z);
    this.craft.scale.setScalar(this.unitScale);
    // gentle blinking nav light at the craft's "top"
    this.nav.scale.setScalar(0.3);
    this.nav.position.set(0.08, 0.14, 0.04);
    this.craft.add(this.nav);
    this.anchor.add(this.craft);
    this.opts = opts;
    this.t = 0;
    this.phase = 'flying';
    this.group.visible = true;
    this.place(0);
  }

  /** Flash where the craft is and send it zipping away along its heading. */
  catchNow(): void {
    if (this.phase !== 'flying') return;
    this.phase = 'zipping';
    this.zipT = 0;
    this.zipDir.copy(TMP_TANGENT).normalize();
    this.flash.position.copy(this.pos);
    this.flash.scale.setScalar(this.sizeWorld * 0.6);
    this.flashMat.opacity = 1;
  }

  reset(): void {
    this.phase = 'idle';
    this.group.visible = false;
    this.flashMat.opacity = 0;
    if (this.craft) {
      this.nav.removeFromParent();
      this.craft.removeFromParent();
      this.craft.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          const mat = m.material as THREE.Material & { map?: THREE.Texture | null };
          mat.map?.dispose();
          mat.dispose();
        }
      });
      this.craft = null;
    }
  }

  update(dt: number): void {
    if (this.phase === 'idle') return;
    this.time += dt;
    const blink = 0.35 + 0.65 * Math.max(0, Math.sin(this.time * 4.2));
    this.navMat.opacity = blink;
    if (this.phase === 'flying' && this.opts) {
      this.t += dt / this.opts.seconds;
      if (this.t >= 1) {
        this.reset();
        return;
      }
      this.place(this.t);
    } else if (this.phase === 'zipping') {
      this.zipT += dt / ZIP_SECONDS;
      if (this.zipT >= 1) {
        this.reset();
        return;
      }
      const u = this.zipT;
      this.anchor.position.addScaledVector(this.zipDir, dt * (0.6 + 9 * u * u));
      this.craft?.scale.setScalar(this.unitScale * Math.max(0.01, 1 - u * 0.85));
      this.flash.scale.setScalar(this.sizeWorld * (0.6 + 3.2 * u));
      this.flashMat.opacity = Math.max(0, 1 - u * 1.4);
    }
  }

  /** Puts the craft at orbit progress `p` (0..1) and orients it: length along the track, flat panels facing the camera side. */
  private place(p: number): void {
    const o = this.opts!;
    E1.set(Math.cos(o.tilt), Math.sin(o.tilt), 0);
    E2.set(0, 0.22 * Math.sign(o.tilt || 1), 1).normalize();
    const theta = (o.dir === 1 ? p : 1 - p) * Math.PI;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    this.pos.copy(E1).multiplyScalar(c).addScaledVector(E2, s).multiplyScalar(o.orbitRadius);
    TMP_TANGENT.copy(E1).multiplyScalar(-s).addScaledVector(E2, c).multiplyScalar(o.dir);
    this.anchor.position.copy(this.pos);
    // local Y faces the camera side (tilted a little toward the viewer's up), local X follows the track
    TMP_UP.set(0, 0.42, 1).normalize();
    TMP_X.copy(TMP_TANGENT).addScaledVector(TMP_UP, -TMP_TANGENT.dot(TMP_UP)).normalize();
    TMP_Z.crossVectors(TMP_X, TMP_UP);
    TMP_M.makeBasis(TMP_X, TMP_UP, TMP_Z);
    this.anchor.quaternion.setFromRotationMatrix(TMP_M);
    // slow roll about the track so panels catch the light
    this.anchor.rotateX(Math.sin(this.time * 0.9) * 0.22);
    // shrink in/out at the ends of the pass so it appears/leaves rather than popping
    const edge = Math.min(1, p / EDGE_SCALE_FRACTION, (1 - p) / EDGE_SCALE_FRACTION);
    this.craft?.scale.setScalar(this.unitScale * Math.max(0.001, THREE.MathUtils.smoothstep(edge, 0, 1)));
  }
}
