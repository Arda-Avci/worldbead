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
  const bandColors: [number, number, number][] = [
    [0xd8, 0xb3, 0x83],
    [0xc9, 0x9a, 0x66],
    [0xe6, 0xcf, 0xa8],
    [0xb0, 0x7a, 0x4c],
    [0xe8, 0xd9, 0xbc],
    [0x9c, 0x66, 0x3f],
  ];
  // Cheap deterministic hash noise (no shared noise util across module boundaries).
  const hash = (x: number, y: number): number => {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  };
  const img = ctx.createImageData(width, height);
  for (let y = 0; y < height; y++) {
    const lat = 1 - (y / (height - 1)) * 2;
    const bandF = (lat * 9 + 9) % bandColors.length;
    const bandLo = bandColors[Math.floor(bandF) % bandColors.length];
    const bandHi = bandColors[(Math.floor(bandF) + 1) % bandColors.length];
    const bandT = bandF - Math.floor(bandF);
    for (let x = 0; x < width; x++) {
      const n = hash(x * 0.06, y * 0.18) * 0.5 + hash(x * 0.02, y * 0.4) * 0.5;
      let r = bandLo[0] + (bandHi[0] - bandLo[0]) * bandT;
      let g = bandLo[1] + (bandHi[1] - bandLo[1]) * bandT;
      let b = bandLo[2] + (bandHi[2] - bandLo[2]) * bandT;
      const shade = 1 + (n - 0.5) * 0.22;
      r *= shade; g *= shade; b *= shade;
      const spotDist = Math.hypot(((x / width) * Math.PI * 2 - 4.2) * 1.6, (lat + 0.28) * 3.2);
      if (spotDist < 0.55) {
        const t = 1 - spotDist / 0.55;
        r = r * (1 - t) + 0xc1 * t;
        g = g * (1 - t) + 0x5a * t;
        b = b * (1 - t) + 0x3c * t;
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
