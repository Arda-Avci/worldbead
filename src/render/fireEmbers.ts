/**
 * Pooled ember-spark + faint-smoke particles for burning bead patches (see
 * `src/game/invasion.ts`'s fire mechanic and the ember-flicker snippet in
 * `docs/INVASION_INTEGRATION.md`). THREE-only, no game rules; parent
 * `object` under the same rotating frame the beads live in (e.g. `BeadGlobe`'s
 * globe group) and feed it globe-local unit-sphere positions so the
 * particles rotate with the globe instead of sliding across it.
 *
 * Self-contained: doesn't import from `src/render/fx.ts` so it can't
 * conflict with concurrent edits there.
 */
import * as THREE from 'three';

const BLOOM_LAYER = 1;
const EMBER_CAPACITY = 180;
const SMOKE_CAPACITY = 36;

let smokeTexCache: THREE.Texture | null = null;
function smokeTexture(): THREE.Texture {
  if (smokeTexCache) return smokeTexCache;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(210,205,195,0.55)');
  g.addColorStop(0.55, 'rgba(160,150,140,0.28)');
  g.addColorStop(1, 'rgba(160,150,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  smokeTexCache = new THREE.CanvasTexture(c);
  return smokeTexCache;
}

export class FireEmberSystem {
  /** Add this to the same object the burning beads are parented under. */
  readonly object = new THREE.Group();

  private readonly emberGeo = new THREE.BufferGeometry();
  private readonly emberPos = new Float32Array(EMBER_CAPACITY * 3);
  private readonly emberColor = new Float32Array(EMBER_CAPACITY * 3);
  private readonly emberVel = new Float32Array(EMBER_CAPACITY * 3);
  private readonly emberHue = new Float32Array(EMBER_CAPACITY);
  private readonly emberLife = new Float32Array(EMBER_CAPACITY).fill(1);
  private readonly emberMaxLife = new Float32Array(EMBER_CAPACITY).fill(1);
  private readonly emberPoints: THREE.Points;
  private emberCursor = 0;

  private readonly smokeSprites: THREE.Sprite[] = [];
  private readonly smokeDir: THREE.Vector3[] = [];
  private readonly smokeLife = new Float32Array(SMOKE_CAPACITY).fill(1);
  private readonly smokeMaxLife = new Float32Array(SMOKE_CAPACITY).fill(1);
  private smokeCursor = 0;

  private spawnAcc = 0;
  private readonly tmpVec = new THREE.Vector3();

  constructor() {
    this.emberGeo.setAttribute('position', new THREE.BufferAttribute(this.emberPos, 3));
    this.emberGeo.setAttribute('color', new THREE.BufferAttribute(this.emberColor, 3));
    // Colors fade to (0,0,0) as a spark dies; with additive blending a black
    // vertex contributes nothing to the framebuffer, so dead pool slots are
    // simply invisible wherever they're parked — no need to also hide them
    // via visibility or move them off-screen.
    const mat = new THREE.PointsMaterial({ size: 0.013, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true });
    this.emberPoints = new THREE.Points(this.emberGeo, mat);
    this.emberPoints.frustumCulled = false;
    this.emberPoints.layers.enable(BLOOM_LAYER);
    this.object.add(this.emberPoints);

    const tex = smokeTexture();
    for (let i = 0; i < SMOKE_CAPACITY; i++) {
      const mat2 = new THREE.SpriteMaterial({ map: tex, color: 0x9a9a9a, transparent: true, opacity: 0, depthWrite: false });
      const s = new THREE.Sprite(mat2);
      s.visible = false;
      this.object.add(s);
      this.smokeSprites.push(s);
      this.smokeDir.push(new THREE.Vector3(0, 1, 0));
    }
  }

  /** A bright burst of embers at newly-ignited bead positions (local unit-sphere coords) — the "fire just started here" flash. */
  spawnIgnite(localPositions: THREE.Vector3[]): void {
    for (const p of localPositions) {
      for (let k = 0; k < 4; k++) this.spawnEmber(p, 0.6 + Math.random() * 0.6);
      if (Math.random() < 0.6) this.spawnSmoke(p);
    }
  }

  private spawnEmber(origin: THREE.Vector3, speed: number): void {
    const i = this.emberCursor;
    this.emberCursor = (this.emberCursor + 1) % EMBER_CAPACITY;
    this.tmpVec.copy(origin).normalize();
    const jx = (Math.random() - 0.5) * 0.35;
    const jy = (Math.random() - 0.5) * 0.35;
    const jz = (Math.random() - 0.5) * 0.35;
    this.emberPos[i * 3] = origin.x;
    this.emberPos[i * 3 + 1] = origin.y;
    this.emberPos[i * 3 + 2] = origin.z;
    this.emberVel[i * 3] = this.tmpVec.x * speed + jx;
    this.emberVel[i * 3 + 1] = this.tmpVec.y * speed + jy + 0.15; // a bit of extra "rise"
    this.emberVel[i * 3 + 2] = this.tmpVec.z * speed + jz;
    this.emberHue[i] = Math.random();
    this.emberLife[i] = 0;
    this.emberMaxLife[i] = 0.45 + Math.random() * 0.55;
  }

  private spawnSmoke(origin: THREE.Vector3): void {
    const i = this.smokeCursor;
    this.smokeCursor = (this.smokeCursor + 1) % SMOKE_CAPACITY;
    const s = this.smokeSprites[i];
    s.position.copy(origin);
    s.visible = true;
    s.scale.setScalar(0.025);
    (s.material as THREE.SpriteMaterial).opacity = 0;
    this.smokeDir[i].copy(origin).normalize();
    this.smokeLife[i] = 0;
    this.smokeMaxLife[i] = 1.6 + Math.random() * 1.0;
  }

  /**
   * Advances all live particles and, whenever beads are actively burning,
   * probabilistically spawns new rising embers/smoke from among them.
   * `activeLocalPositions` — pass an empty array once no beads are on fire to
   * simply let existing particles finish burning out.
   */
  update(dt: number, activeLocalPositions: THREE.Vector3[]): void {
    if (activeLocalPositions.length > 0) {
      this.spawnAcc += dt * Math.min(activeLocalPositions.length, 20) * 2.6;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        const p = activeLocalPositions[Math.floor(Math.random() * activeLocalPositions.length)];
        this.spawnEmber(p, 0.12 + Math.random() * 0.18);
        if (Math.random() < 0.05) this.spawnSmoke(p);
      }
    }

    for (let i = 0; i < EMBER_CAPACITY; i++) {
      if (this.emberLife[i] >= this.emberMaxLife[i]) continue;
      this.emberLife[i] += dt;
      this.emberPos[i * 3] += this.emberVel[i * 3] * dt;
      this.emberPos[i * 3 + 1] += this.emberVel[i * 3 + 1] * dt;
      this.emberPos[i * 3 + 2] += this.emberVel[i * 3 + 2] * dt;
      const u = Math.min(1, this.emberLife[i] / this.emberMaxLife[i]);
      // Quick bright rise then fade, so newly spawned sparks read as a flicker rather than a flat glow.
      const fade = u < 0.15 ? u / 0.15 : 1 - (u - 0.15) / 0.85;
      const hue = this.emberHue[i];
      this.emberColor[i * 3] = fade;
      this.emberColor[i * 3 + 1] = fade * (0.32 + hue * 0.5);
      this.emberColor[i * 3 + 2] = fade * 0.06;
    }
    (this.emberGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.emberGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;

    for (let i = 0; i < SMOKE_CAPACITY; i++) {
      const s = this.smokeSprites[i];
      if (!s.visible) continue;
      this.smokeLife[i] += dt;
      const u = this.smokeLife[i] / this.smokeMaxLife[i];
      if (u >= 1) {
        s.visible = false;
        continue;
      }
      s.position.addScaledVector(this.smokeDir[i], dt * 0.05);
      s.scale.setScalar(0.025 + u * 0.1);
      (s.material as THREE.SpriteMaterial).opacity = Math.sin(u * Math.PI) * 0.22;
    }
  }

  dispose(): void {
    this.emberGeo.dispose();
    (this.emberPoints.material as THREE.Material).dispose();
    for (const s of this.smokeSprites) (s.material as THREE.Material).dispose();
  }
}
