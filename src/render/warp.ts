import * as THREE from 'three';

const STREAK_COUNT = 260;
const BLOOM_LAYER = 1;

/**
 * Warp-speed star streak effect: a pool of radiating line segments anchored
 * to the camera, plus a transient FOV kick. Each segment's endpoints are
 * computed on the GPU from a per-vertex fixed random direction and a
 * uniform streak length/inner radius, so there is no per-frame CPU buffer
 * rewrite - the geometry is built once and only two uniforms change per
 * frame.
 */
export class WarpEffect {
  readonly object: THREE.LineSegments;
  private readonly material: THREE.ShaderMaterial;
  private active = false;
  private t = 0;
  private duration = 1;
  private baseFov = 50;
  private resolve: (() => void) | null = null;

  constructor(private readonly camera: THREE.PerspectiveCamera) {
    const dirs = new Float32Array(STREAK_COUNT * 2 * 3);
    const ends = new Float32Array(STREAK_COUNT * 2); // 0 = inner point, 1 = outer point
    for (let i = 0; i < STREAK_COUNT; i++) {
      const d = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
      for (let v = 0; v < 2; v++) {
        const idx = (i * 2 + v) * 3;
        dirs[idx + 0] = d.x;
        dirs[idx + 1] = d.y;
        dirs[idx + 2] = d.z;
        ends[i * 2 + v] = v;
      }
    }
    const geo = new THREE.BufferGeometry();
    // A dummy position attribute is required by three.js's render path
    // (e.g. for its bounding-sphere/box computation) even though the vertex
    // shader recomputes the real position from aDir/aEnd/uCamPos each frame.
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAK_COUNT * 2 * 3), 3));
    geo.setAttribute('aDir', new THREE.BufferAttribute(dirs, 3));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCamPos: { value: new THREE.Vector3() },
        uInner: { value: 0.6 },
        uStreakLen: { value: 0 },
        uOpacity: { value: 0 },
        uColor: { value: new THREE.Color(0xf0f8ff) },
      },
      vertexShader: /* glsl */ `
        attribute vec3 aDir;
        attribute float aEnd;
        uniform vec3 uCamPos;
        uniform float uInner;
        uniform float uStreakLen;
        void main() {
          // This object has an identity transform, so its local space is
          // world space and modelViewMatrix alone (mat3(modelViewMatrix) is
          // reliably populated, unlike using the bare viewMatrix uniform)
          // takes a world-space point straight to view space.
          float r = uInner + aEnd * uStreakLen;
          vec3 worldPos = uCamPos + aDir * r;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        void main() {
          gl_FragColor = vec4(uColor, uOpacity);
        }
      `,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: THREE.AdditiveBlending,
    });

    this.object = new THREE.LineSegments(geo, this.material);
    this.object.frustumCulled = false;
    this.object.visible = false;
    this.object.layers.enable(BLOOM_LAYER);
  }

  start(seconds: number): Promise<void> {
    this.active = true;
    this.t = 0;
    this.duration = Math.max(seconds, 0.05);
    this.baseFov = this.camera.fov;
    this.object.visible = true;
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  get isActive(): boolean {
    return this.active;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.t += dt / this.duration;
    const clamped = Math.min(this.t, 1);
    const envelope = Math.sin(Math.PI * clamped); // fade in, peak mid, fade out

    this.material.uniforms.uCamPos.value.copy(this.camera.position);
    this.material.uniforms.uStreakLen.value = 2 + envelope * 20;
    this.material.uniforms.uOpacity.value = envelope;

    this.camera.fov = this.baseFov + envelope * 16;
    this.camera.updateProjectionMatrix();

    if (this.t >= 1) {
      this.active = false;
      this.object.visible = false;
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
      const r = this.resolve;
      this.resolve = null;
      if (r) r();
    }
  }
}
