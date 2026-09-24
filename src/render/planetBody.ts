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
    const dayTex = await loadColorTexture(def.map);

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
