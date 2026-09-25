import * as THREE from 'three';

const BLOOM_LAYER = 1;

function softDotTexture(size = 64): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(c);
}

function ringSpriteTexture(size = 128): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.30, size / 2, size / 2, size * 0.5);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  return new THREE.CanvasTexture(c);
}

/** GPU-cheap pooled spark burst (single Points draw call, ring-buffer allocation, no per-frame GC). */
class SparkSystem {
  private readonly capacity: number;
  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly colors: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly sizes: Float32Array;
  private cursor = 0;

  constructor(capacity = 700) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.sizes = new Float32Array(capacity);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    geo.setAttribute('aMaxLife', new THREE.BufferAttribute(this.maxLife, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: { uTex: { value: softDotTexture() } },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aLife;
        attribute float aMaxLife;
        attribute float aSize;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          float t = clamp(aLife / max(aMaxLife, 0.0001), 0.0, 1.0);
          vAlpha = t * t;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * t * (300.0 / max(-mv.z, 0.001));
          gl_Position = (aLife > 0.0) ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uTex;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 tex = texture2D(uTex, gl_PointCoord);
          gl_FragColor = vec4(vColor, tex.a * vAlpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.layers.enable(BLOOM_LAYER);
  }

  get object(): THREE.Object3D {
    return this.points;
  }

  /**
   * A single slow-drifting, short-lived spark at `worldPos` — used every
   * frame by a flying probe to lay down a comet-tail trail (reuses this
   * same pooled buffer/draw call, no new geometry per shot).
   */
  emitTrailDot(worldPos: THREE.Vector3, color: THREE.Color): void {
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const jitter = () => (Math.random() * 2 - 1) * 0.02;
    this.positions[idx * 3 + 0] = worldPos.x + jitter();
    this.positions[idx * 3 + 1] = worldPos.y + jitter();
    this.positions[idx * 3 + 2] = worldPos.z + jitter();
    this.velocities[idx * 3 + 0] = 0;
    this.velocities[idx * 3 + 1] = 0;
    this.velocities[idx * 3 + 2] = 0;
    this.colors[idx * 3 + 0] = color.r;
    this.colors[idx * 3 + 1] = color.g;
    this.colors[idx * 3 + 2] = color.b;
    const ml = 0.22;
    this.maxLife[idx] = ml;
    this.life[idx] = ml;
    this.sizes[idx] = 2.6;
  }

  emit(worldPos: THREE.Vector3, color: THREE.Color, intensity: number): void {
    const count = Math.round(THREE.MathUtils.clamp(18 + intensity * 40, 10, 90));
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % this.capacity;

      const dir = new THREE.Vector3(
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
        Math.random() * 2 - 1,
      ).normalize();
      const speed = (0.6 + Math.random() * 1.2) * (0.6 + intensity * 0.6);

      this.positions[idx * 3 + 0] = worldPos.x;
      this.positions[idx * 3 + 1] = worldPos.y;
      this.positions[idx * 3 + 2] = worldPos.z;
      this.velocities[idx * 3 + 0] = dir.x * speed;
      this.velocities[idx * 3 + 1] = dir.y * speed;
      this.velocities[idx * 3 + 2] = dir.z * speed;
      this.colors[idx * 3 + 0] = color.r;
      this.colors[idx * 3 + 1] = color.g;
      this.colors[idx * 3 + 2] = color.b;
      const ml = 0.45 + Math.random() * 0.4;
      this.maxLife[idx] = ml;
      this.life[idx] = ml;
      this.sizes[idx] = 3 + Math.random() * 4;
    }
  }

  update(dt: number): void {
    const drag = Math.max(0, 1 - dt * 0.6);
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      this.velocities[i * 3 + 0] *= drag;
      this.velocities[i * 3 + 1] *= drag;
      this.velocities[i * 3 + 2] *= drag;
      this.positions[i * 3 + 0] += this.velocities[i * 3 + 0] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
    }
    const geo = this.points.geometry;
    (geo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (geo.getAttribute('aLife') as THREE.BufferAttribute).needsUpdate = true;
  }
}

interface ShockwaveSlot {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  maxScale: number;
}

/** Pool of billboard shockwave rings (no per-burst allocation once warmed up). */
class ShockwaveSystem {
  readonly group = new THREE.Group();
  private readonly pool: ShockwaveSlot[] = [];
  private readonly tex = ringSpriteTexture();

  constructor(size = 10) {
    for (let i = 0; i < size; i++) {
      const mat = new THREE.SpriteMaterial({
        map: this.tex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        opacity: 0,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.layers.enable(BLOOM_LAYER);
      this.group.add(sprite);
      this.pool.push({ sprite, life: 0, maxLife: 0.5, maxScale: 1 });
    }
  }

  spawn(worldPos: THREE.Vector3, color: THREE.Color, scale: number): void {
    const slot = this.pool.find((s) => s.life <= 0) ?? this.pool[0];
    slot.sprite.position.copy(worldPos);
    slot.sprite.scale.setScalar(0.05);
    slot.maxScale = scale;
    slot.maxLife = 0.45;
    slot.life = slot.maxLife;
    slot.sprite.visible = true;
    (slot.sprite.material as THREE.SpriteMaterial).color.copy(color);
    (slot.sprite.material as THREE.SpriteMaterial).opacity = 0.9;
  }

  update(dt: number): void {
    for (const slot of this.pool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      const t = 1 - Math.max(slot.life, 0) / slot.maxLife;
      const s = THREE.MathUtils.lerp(0.05, slot.maxScale, t);
      slot.sprite.scale.setScalar(s);
      (slot.sprite.material as THREE.SpriteMaterial).opacity = (1 - t) * 0.9;
      if (slot.life <= 0) slot.sprite.visible = false;
    }
  }
}

interface ProbeRecord {
  group: THREE.Object3D;
  core: THREE.Mesh;
  halo: THREE.Sprite;
  trail: THREE.Line;
  trailGeo: THREE.BufferGeometry;
  trailPositions: Float32Array;
  trailWrite: number;
  trailFilled: number;
  trailMaxPoints: number;
}

const TRAIL_POINTS = 16;

/** Glowing probe: core sphere + additive halo + a self-updating fading trail. */
class ProbeSystem {
  readonly group = new THREE.Group();
  private readonly records: ProbeRecord[] = [];
  private readonly coreGeo = new THREE.SphereGeometry(0.035, 12, 10);
  private readonly haloTex = softDotTexture();

  create(color: number): THREE.Object3D {
    const c = new THREE.Color(color);
    const root = new THREE.Group();

    const coreMat = new THREE.MeshBasicMaterial({ color: c, toneMapped: false });
    const core = new THREE.Mesh(this.coreGeo, coreMat);
    core.layers.enable(BLOOM_LAYER);
    root.add(core);

    const haloMat = new THREE.SpriteMaterial({
      map: this.haloTex,
      color: c,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      opacity: 0.75,
    });
    const halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(0.18);
    halo.layers.enable(BLOOM_LAYER);
    root.add(halo);

    const trailPositions = new Float32Array(TRAIL_POINTS * 3);
    const trailGeo = new THREE.BufferGeometry();
    trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
    trailGeo.setDrawRange(0, 0);
    const trailMat = new THREE.LineBasicMaterial({
      color: c,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      linewidth: 2,
    });
    const trail = new THREE.Line(trailGeo, trailMat);
    trail.frustumCulled = false;
    trail.layers.enable(BLOOM_LAYER);
    root.add(trail);

    this.group.add(root);
    this.records.push({
      group: root,
      core,
      halo,
      trail,
      trailGeo,
      trailPositions,
      trailWrite: 0,
      trailFilled: 0,
      trailMaxPoints: TRAIL_POINTS,
    });
    return root;
  }

  dispose(o: THREE.Object3D): void {
    const idx = this.records.findIndex((r) => r.group === o);
    if (idx === -1) return;
    const rec = this.records[idx];
    this.group.remove(rec.group);
    rec.trailGeo.dispose();
    (rec.trail.material as THREE.Material).dispose();
    (rec.halo.material as THREE.Material).dispose();
    (rec.core.material as THREE.Material).dispose();
    this.records.splice(idx, 1);
  }

  private pulseClock = 0;

  update(dt: number): void {
    this.pulseClock += dt;
    const pulse = 1 + Math.sin(this.pulseClock * 14) * 0.12;
    for (const rec of this.records) {
      rec.halo.scale.setScalar(0.18 * pulse);
      const p = rec.group.position;
      const w = rec.trailWrite * 3;
      // Shift history back by writing into a ring buffer sampled at head.
      rec.trailPositions[w + 0] = p.x;
      rec.trailPositions[w + 1] = p.y;
      rec.trailPositions[w + 2] = p.z;
      rec.trailWrite = (rec.trailWrite + 1) % rec.trailMaxPoints;
      rec.trailFilled = Math.min(rec.trailFilled + 1, rec.trailMaxPoints);

      // Rebuild the ordered polyline (oldest -> newest) from the ring buffer.
      // trailMaxPoints is tiny (16) so this is cheap and allocation-free.
      const n = rec.trailFilled;
      const arr = rec.trailGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < n; i++) {
        const srcIdx = (rec.trailWrite - n + i + rec.trailMaxPoints) % rec.trailMaxPoints;
        arr.setXYZ(
          i,
          rec.trailPositions[srcIdx * 3 + 0],
          rec.trailPositions[srcIdx * 3 + 1],
          rec.trailPositions[srcIdx * 3 + 2],
        );
      }
      arr.needsUpdate = true;
      rec.trailGeo.setDrawRange(0, n);
    }
  }
}

/**
 * Pooled instanced-mesh debris: popped beads that detach and tumble away
 * rather than just shrinking in place (item #11). One draw call for every
 * spilling bead on screen; slots recycle round-robin so a burst of pops
 * never allocates.
 */
class DebrisSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly capacity: number;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly quat: Float32Array; // xyzw per slot
  private readonly spinAxis: Float32Array; // xyz per slot
  private readonly spinSpeed: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly baseScale: Float32Array;
  private cursor = 0;
  private readonly tmpM = new THREE.Matrix4();
  private readonly tmpQ = new THREE.Quaternion();
  private readonly tmpDQ = new THREE.Quaternion();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpS = new THREE.Vector3();
  private readonly tmpAxis = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();

  constructor(capacity = 160) {
    this.capacity = capacity;
    this.pos = new Float32Array(capacity * 3);
    this.vel = new Float32Array(capacity * 3);
    this.quat = new Float32Array(capacity * 4);
    this.spinAxis = new Float32Array(capacity * 3);
    this.spinSpeed = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.baseScale = new Float32Array(capacity);

    const geo = new THREE.SphereGeometry(1, 7, 5);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.tmpM.makeScale(0, 0, 0);
    for (let i = 0; i < capacity; i++) this.mesh.setMatrixAt(i, this.tmpM);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Detach a popped bead at `worldPos`, tumbling away along `outward` (+ some downward pull), then fading. */
  spawn(worldPos: THREE.Vector3, color: number, outward: THREE.Vector3, radius: number): void {
    const idx = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos[idx * 3] = worldPos.x;
    this.pos[idx * 3 + 1] = worldPos.y;
    this.pos[idx * 3 + 2] = worldPos.z;

    const dir = outward.clone().normalize();
    dir.x += (Math.random() * 2 - 1) * 0.5;
    dir.y += (Math.random() * 2 - 1) * 0.5 - 0.35; // extra pull down the screen, per spec
    dir.z += (Math.random() * 2 - 1) * 0.5;
    dir.normalize();
    const speed = 0.9 + Math.random() * 1.1;
    this.vel[idx * 3] = dir.x * speed;
    this.vel[idx * 3 + 1] = dir.y * speed;
    this.vel[idx * 3 + 2] = dir.z * speed;

    this.tmpAxis.set(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
    this.spinAxis[idx * 3] = this.tmpAxis.x;
    this.spinAxis[idx * 3 + 1] = this.tmpAxis.y;
    this.spinAxis[idx * 3 + 2] = this.tmpAxis.z;
    this.spinSpeed[idx] = 5 + Math.random() * 7;
    this.quat[idx * 4] = 0; this.quat[idx * 4 + 1] = 0; this.quat[idx * 4 + 2] = 0; this.quat[idx * 4 + 3] = 1;

    this.maxLife[idx] = 0.6 + Math.random() * 0.35;
    this.life[idx] = this.maxLife[idx];
    this.baseScale[idx] = Math.max(0.004, radius);
    this.tmpC.setHex(color);
    this.mesh.setColorAt(idx, this.tmpC);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number): void {
    const gravity = -1.8; // pull "down the screen" as the debris tumbles and fades
    let any = false;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.tmpM.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.tmpM);
        continue;
      }
      this.vel[i * 3 + 1] += gravity * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;

      this.tmpAxis.set(this.spinAxis[i * 3], this.spinAxis[i * 3 + 1], this.spinAxis[i * 3 + 2]);
      this.tmpDQ.setFromAxisAngle(this.tmpAxis, this.spinSpeed[i] * dt);
      this.tmpQ.set(this.quat[i * 4], this.quat[i * 4 + 1], this.quat[i * 4 + 2], this.quat[i * 4 + 3]);
      this.tmpQ.premultiply(this.tmpDQ);
      this.quat[i * 4] = this.tmpQ.x; this.quat[i * 4 + 1] = this.tmpQ.y; this.quat[i * 4 + 2] = this.tmpQ.z; this.quat[i * 4 + 3] = this.tmpQ.w;

      const t = this.life[i] / this.maxLife[i];
      const s = this.baseScale[i] * t; // shrink alongside the tumble/fall = the "fade"
      this.tmpV.set(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]);
      this.tmpS.setScalar(s);
      this.tmpM.compose(this.tmpV, this.tmpQ, this.tmpS);
      this.mesh.setMatrixAt(i, this.tmpM);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Owns all pooled FX: sparks, shockwaves, probes and pop debris. */
export class FxSystem {
  readonly root = new THREE.Group();
  private readonly sparks = new SparkSystem();
  private readonly shock = new ShockwaveSystem();
  private readonly probes = new ProbeSystem();
  private readonly debris = new DebrisSystem();
  private shakeStrength = 0;
  private shakeDecay = 4;
  readonly shakeOffset = new THREE.Vector3();

  constructor() {
    this.root.add(this.sparks.object, this.shock.group, this.probes.group, this.debris.mesh);
  }

  burst(worldPos: THREE.Vector3, color: number, intensity: number): void {
    const c = new THREE.Color(color);
    this.sparks.emit(worldPos, c, intensity);
    this.shock.spawn(worldPos, c, 0.35 + intensity * 0.5);
  }

  /** Spill a popped bead off the globe: detach, tumble away and fall, then fade (item #11). */
  spillBead(worldPos: THREE.Vector3, color: number, outward: THREE.Vector3, radius: number): void {
    this.debris.spawn(worldPos, color, outward, radius);
  }

  /** Comet-tail trail dot for a flying probe (see SparkSystem.emitTrailDot). */
  probeTrailDot(worldPos: THREE.Vector3, color: number): void {
    this.sparks.emitTrailDot(worldPos, this.trailColor.set(color));
  }
  private readonly trailColor = new THREE.Color();

  createProbe(color: number): THREE.Object3D {
    return this.probes.create(color);
  }

  disposeProbe(o: THREE.Object3D): void {
    this.probes.dispose(o);
  }

  shake(strength: number): void {
    this.shakeStrength = Math.max(this.shakeStrength, strength);
  }

  update(dt: number): void {
    this.sparks.update(dt);
    this.shock.update(dt);
    this.probes.update(dt);
    this.debris.update(dt);

    if (this.shakeStrength > 0.0001) {
      this.shakeStrength = Math.max(0, this.shakeStrength - this.shakeDecay * dt * this.shakeStrength);
      this.shakeOffset.set(
        (Math.random() * 2 - 1) * this.shakeStrength,
        (Math.random() * 2 - 1) * this.shakeStrength,
        0,
      );
    } else {
      this.shakeOffset.set(0, 0, 0);
    }
  }
}

export { BLOOM_LAYER };
