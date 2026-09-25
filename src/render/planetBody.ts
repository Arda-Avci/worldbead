import * as THREE from 'three';
import type { PlanetId } from './types';
import { PLANET_BODY_RADIUS, PLANET_DATA } from './planetData';
import { createPlanetGeometry } from './planetGeometry';
import {
  applyEarthDayNightPatch,
  createAtmosphereMaterial,
  createCloudMaterial,
  createVenusCloudMaterial,
  updateCloudDrift,
  updateEarthSunDir,
} from './shaders';

const loader = new THREE.TextureLoader();

/**
 * Paints the same banded-gas-giant look as `game/texture.ts`'s
 * `generateJupiterBands` (kept as a separate small copy per this module's
 * "no cross-folder imports" contract), but as a `THREE.CanvasTexture` for
 * the revealed 3D body — no network download for the 5th cycle planet.
 */
function generateProceduralBandsTexture(width = 512, height = 256): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // Alternating pale zones / dark rust-brown belts (strong contrast between neighbors,
  // matching the real planet and the bead-painting side's `generateJupiterBands`) rather
  // than a run of similar creams/tans, which read as nearly monochrome (owner feedback).
  const bandColors: [number, number, number][] = [
    [0xed, 0xe0, 0xbe],
    [0x8c, 0x4a, 0x24],
    [0xf4, 0xea, 0xd2],
    [0x5b, 0x2e, 0x15],
    [0xe0, 0xc8, 0x8e],
    [0xa8, 0x50, 0x1f],
    [0xf0, 0xe0, 0xb8],
    [0x3d, 0x20, 0x10],
  ];
  // Cheap deterministic hash noise (no shared noise util across module boundaries).
  const hash = (x: number, y: number): number => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const smoothstep = (edge0: number, edge1: number, x: number): number => {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  };
  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const lat = 1 - (y / (height - 1)) * 2;
    for (let x = 0; x < width; x++) {
      // Warp which band a latitude falls into, so edges are wavy/turbulent, not clean stripes.
      const edgeWarp = hash(x * 0.015, y * 0.05) * 0.5 + hash(x * 0.05, y * 0.02) * 0.5 - 0.5;
      const bandF = (((lat + edgeWarp * 0.35) * 9 + 9) % bandColors.length + bandColors.length) % bandColors.length;
      const bandLo = bandColors[Math.floor(bandF) % bandColors.length];
      const bandHi = bandColors[(Math.floor(bandF) + 1) % bandColors.length];
      const bandT = smoothstep(0.32, 0.68, bandF - Math.floor(bandF));
      const n = hash(x * 0.06, y * 0.18) * 0.5 + hash(x * 0.02, y * 0.4) * 0.5;
      let r = bandLo[0] + (bandHi[0] - bandLo[0]) * bandT;
      let g = bandLo[1] + (bandHi[1] - bandLo[1]) * bandT;
      let b = bandLo[2] + (bandHi[2] - bandLo[2]) * bandT;
      const shade = 1 + (n - 0.5) * 0.26;
      r *= shade; g *= shade; b *= shade;
      const spotDist = Math.hypot(((x / width) * Math.PI * 2 - 4.2) * 1.5, (lat + 0.28) * 2.8);
      if (spotDist < 0.62) {
        const t = smoothstep(0.62, 0, spotDist);
        r = r * (1 - t) + 0xc1 * t;
        g = g * (1 - t) + 0x53 * t;
        b = b * (1 - t) + 0x38 * t;
      }
      const o = (y * width + x) * 4;
      img.data[o] = Math.max(0, Math.min(255, Math.round(r)));
      img.data[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      img.data[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function loadColorTexture(url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

export class PlanetBody {
  readonly group = new THREE.Group();
  private bodyMesh!: THREE.Mesh;
  private bodyMaterial!: THREE.MeshStandardMaterial;
  private cloudMesh: THREE.Mesh | null = null;
  private cloudMaterial: THREE.MeshStandardMaterial | THREE.ShaderMaterial | null = null;
  private atmosphere!: THREE.Mesh;
  private isEarth = false;
  private isVenus = false;
  private baseAtmoIntensity = 1;
  revealed = true;

  async load(id: PlanetId, envMap: THREE.Texture | null): Promise<void> {
    // Clear any previous content.
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeObject(child);
    }

    const def = PLANET_DATA[id];
    const bodyGeo = createPlanetGeometry(PLANET_BODY_RADIUS, 96, 48);
    const dayTex = def.proceduralBands ? generateProceduralBandsTexture() : await loadColorTexture(def.map);

    this.isEarth = id === 'earth';
    this.isVenus = id === 'venus';

    this.bodyMaterial = new THREE.MeshStandardMaterial({
      map: dayTex,
      roughness: 0.92,
      metalness: 0.0,
      envMap,
      envMapIntensity: 0.35,
    });

    if (this.isEarth && def.nightMap) {
      const nightTex = await loadColorTexture(def.nightMap);
      applyEarthDayNightPatch(this.bodyMaterial, nightTex);
      this.bodyMaterial.envMapIntensity = 0.5;
    }

    this.bodyMesh = new THREE.Mesh(bodyGeo, this.bodyMaterial);
    this.group.add(this.bodyMesh);

    if (this.isEarth && def.cloudsMap) {
      const cloudTex = await loadColorTexture(def.cloudsMap);
      const cloudGeo = createPlanetGeometry(PLANET_BODY_RADIUS * 1.012, 96, 48);
      const cloudMat = createCloudMaterial(cloudTex);
      this.cloudMaterial = cloudMat;
      this.cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
      this.group.add(this.cloudMesh);
    } else if (this.isVenus && def.thickClouds) {
      const cloudGeo = createPlanetGeometry(PLANET_BODY_RADIUS * 1.02, 80, 40);
      const cloudMat = createVenusCloudMaterial();
      this.cloudMaterial = cloudMat;
      this.cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
      this.group.add(this.cloudMesh);
    }

    const atmoGeo = createPlanetGeometry(PLANET_BODY_RADIUS * 1.045, 64, 32);
    const atmoMat = createAtmosphereMaterial(def.atmosphereColor, def.atmosphereIntensity);
    this.baseAtmoIntensity = def.atmosphereIntensity;
    this.atmosphere = new THREE.Mesh(atmoGeo, atmoMat);
    this.group.add(this.atmosphere);

    this.setRevealed(this.revealed);
  }

  /** Photoreal clouds and atmosphere intensity for the bead-clear reveal moment. */
  setRevealed(v: boolean): void {
    this.revealed = v;
    if (this.cloudMesh) this.cloudMesh.visible = v;
    // Bug: the additive Fresnel-rim atmosphere shell used to stay visible (just dimmed to 40%)
    // even while hidden, so its rim glow could still peek past the bead shell's silhouette
    // (most visible right at the globe's limb/poles, where gaps between discrete beads are
    // largest) and, stacked with the bloom pass, read as a blown-out white glare blob during
    // ordinary gameplay. It is only meant to be seen for the win/hero photoreal-planet reveal.
    if (this.atmosphere) this.atmosphere.visible = v;
    const atmoMat = this.atmosphere?.material as THREE.ShaderMaterial | undefined;
    if (atmoMat) atmoMat.uniforms.uIntensity.value = this.baseAtmoIntensity * (v ? 1 : 0.4);
  }

  update(dt: number, elapsed: number, sunDirWorld: THREE.Vector3, camera: THREE.Camera): void {
    if (this.isEarth && this.bodyMaterial) updateEarthSunDir(this.bodyMaterial, sunDirWorld, camera);
    if (this.cloudMesh) {
      this.cloudMesh.rotation.y += dt * (this.isVenus ? 0.01 : 0.006);
      if (this.cloudMaterial && !this.isVenus) {
        updateCloudDrift(this.cloudMaterial as THREE.MeshStandardMaterial, elapsed);
      } else if (this.isVenus) {
        const mat = this.cloudMaterial as THREE.ShaderMaterial;
        mat.uniforms.uTime.value = elapsed;
        const v = sunDirWorld.clone().transformDirection(camera.matrixWorldInverse).normalize();
        (mat.uniforms.uSunDirView.value as THREE.Vector3).copy(v);
      }
    }
  }

  dispose(): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeObject(child);
    }
  }
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}
