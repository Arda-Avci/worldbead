import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import type { PlanetId, ShotName } from './types';
import { createBeadMaterial } from './beadMaterial';
import { PlanetBody } from './planetBody';
import { createSkySphere, createTwinklingStars, updateTwinklingStars } from './starfield';
import { createSunMesh, createSunGlow, createSunLensflare, SUN_DISTANCE } from './sun';
import type { Lensflare } from 'three/examples/jsm/objects/Lensflare.js';
import { CameraRig } from './camera';
import { FxSystem } from './fx';
import { WarpEffect } from './warp';

export type { PlanetId, ShotName };

const TEX_MILKY_WAY = 'textures/stars_milky_way.jpg';
const TEX_SUN = 'textures/sun.jpg';
const SUN_DIRECTION = new THREE.Vector3(0.55, 0.28, 0.78).normalize();

export class SpaceScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly globe: THREE.Group;
  readonly beadMaterial: THREE.Material;

  private readonly canvas: HTMLCanvasElement;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly cameraRig: CameraRig;
  private readonly fx: FxSystem;
  private readonly warpEffect: WarpEffect;
  private readonly planetBody = new PlanetBody();
  private readonly stars: THREE.Points;
  private readonly sunLight: THREE.DirectionalLight;
  private readonly fillLight: THREE.HemisphereLight;
  private readonly gameplayLight: THREE.DirectionalLight;
  private sunMesh: THREE.Mesh | null = null;
  private sunGlow: THREE.Sprite | null = null;
  private sunFlare: Lensflare | null = null;
  /** 0 = dramatic fixed sun-direction lighting (intro/hero/sunPass/approach), 1 = flat camera-relative
   *  gameplay lighting. Smoothly tracks whichever shot the camera rig is currently in/flying to. */
  private gameplayBlend = 0;
  private readonly envReady: Promise<THREE.Texture | null>;
  private readonly appliedShake = new THREE.Vector3();
  private elapsed = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.globe = new THREE.Group();
    this.scene.add(this.globe);
    this.planetBody.group.name = 'planetBody';
    this.globe.add(this.planetBody.group);

    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, w / Math.max(h, 1), 0.05, 700);

    this.cameraRig = new CameraRig(this.camera, () => SUN_DIRECTION);

    // Lighting: a dramatic fixed-direction "Sun" key light (used for the
    // intro/hero/sunPass/approach shots) plus a faint fill so the unlit
    // night side isn't pure black. A second, camera-relative "gameplay" key
    // light is cross-faded in via `gameplayBlend` whenever the camera rig is
    // in/transitioning to the 'gameplay' shot, so the whole visible
    // hemisphere of the globe stays readable regardless of where the fixed
    // Sun direction happens to fall (see `updateGameplayLighting`).
    this.sunLight = new THREE.DirectionalLight(0xfff2df, 3.4);
    this.sunLight.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE);
    this.scene.add(this.sunLight);
    this.fillLight = new THREE.HemisphereLight(0x334466, 0x0a0a12, 0.18);
    this.scene.add(this.fillLight);
    this.gameplayLight = new THREE.DirectionalLight(0xf3f6ff, 0);
    this.scene.add(this.gameplayLight);

    // Procedural twinkling star layer (in addition to the Milky Way panorama).
    this.stars = createTwinklingStars();
    this.scene.add(this.stars);

    // FX (sparks, shockwaves, probes) and the warp streak effect.
    this.fx = new FxSystem();
    this.scene.add(this.fx.root);
    this.warpEffect = new WarpEffect(this.camera);
    this.scene.add(this.warpEffect.object);

    // Shared bead material; envMap is attached once the Milky Way PMREM is ready.
    this.beadMaterial = createBeadMaterial(null);

    // Postprocessing: one composer chain (RenderPass -> half-res bloom -> OutputPass).
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2))),
      0.85,
      0.45,
      0.82,
    );
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(new OutputPass());

    this.envReady = this.initBackground();
    this.envReady.then((env) => {
      const mat = this.beadMaterial as THREE.MeshPhysicalMaterial;
      mat.envMap = env;
      mat.needsUpdate = true;
    });

    this.resize();
  }

  private async initBackground(): Promise<THREE.Texture | null> {
    const loader = new THREE.TextureLoader();
    const [milkyWay, sunTex] = await Promise.all([
      new Promise<THREE.Texture>((res, rej) => loader.load(TEX_MILKY_WAY, res, undefined, rej)),
      new Promise<THREE.Texture>((res, rej) => loader.load(TEX_SUN, res, undefined, rej)),
    ]);

    const sky = createSkySphere(milkyWay);
    this.scene.add(sky);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envRT = pmrem.fromEquirectangular(milkyWay);
    this.scene.environment = envRT.texture;
    pmrem.dispose();

    const sunMesh = createSunMesh(sunTex);
    sunMesh.position.copy(SUN_DIRECTION).multiplyScalar(SUN_DISTANCE);
    this.scene.add(sunMesh);
    this.sunMesh = sunMesh;

    const glow = createSunGlow();
    glow.position.copy(sunMesh.position);
    this.scene.add(glow);
    this.sunGlow = glow;

    // Parented to the light, at its local origin, so the flare tracks the
    // same world position as the visible Sun mesh.
    const flare = createSunLensflare();
    this.sunLight.add(flare);
    this.sunFlare = flare;

    return envRT.texture;
  }

  async loadPlanet(id: PlanetId): Promise<void> {
    const env = await this.envReady;
    await this.planetBody.load(id, env);
  }

  setBodyRevealed(v: boolean): void {
    this.planetBody.setRevealed(v);
  }

  launcherPosition(): THREE.Vector3 {
    return this.cameraRig.launcherPosition();
  }

  createProbe(color: number): THREE.Object3D {
    return this.fx.createProbe(color);
  }

  disposeProbe(o: THREE.Object3D): void {
    this.fx.disposeProbe(o);
  }

  burst(worldPos: THREE.Vector3, color: number, intensity: number): void {
    this.fx.burst(worldPos, color, intensity);
  }

  shake(strength: number): void {
    this.fx.shake(strength);
  }

  flyTo(shot: ShotName, seconds: number): Promise<void> {
    return this.cameraRig.flyTo(shot, seconds);
  }

  warp(seconds: number): Promise<void> {
    return this.warpEffect.start(seconds);
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.cameraRig.setViewport(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.setSize(Math.max(1, Math.floor(w / 2)), Math.max(1, Math.floor(h / 2)));
  }

  update(dt: number): void {
    this.elapsed += dt;

    updateTwinklingStars(this.stars, this.elapsed);
    this.planetBody.update(dt, this.elapsed, SUN_DIRECTION, this.camera);

    this.camera.position.sub(this.appliedShake);
    this.cameraRig.update(dt);
    this.updateGameplayLighting(dt);
    this.warpEffect.update(dt);
    this.fx.update(dt);
    this.appliedShake.copy(this.fx.shakeOffset);
    this.camera.position.add(this.appliedShake);
  }

  /**
   * Cross-fades between the dramatic fixed-Sun-direction lighting (intro/
   * hero/sunPass/approach) and a soft, camera-relative "gameplay" key light
   * that comes from the camera's upper-front (~30° above, ~25° to the side
   * of the view direction), so the whole visible hemisphere of beads reads
   * clearly no matter which side of the planet the fixed Sun direction
   * happens to be lighting. Also keeps the Sun disc/glow/flare from ever
   * visually overlapping the globe in the 'gameplay' shot: they fade out as
   * the blend goes to 1, leaving only a faint glow.
   */
  private updateGameplayLighting(dt: number): void {
    const target = this.cameraRig.currentShot === 'gameplay' ? 1 : 0;
    const rate = 1 - Math.exp(-dt / 0.35);
    this.gameplayBlend += (target - this.gameplayBlend) * rate;
    const blend = this.gameplayBlend;

    // Camera-relative key light direction: start from "toward the camera"
    // (the reverse of its view direction) and tilt it up/side around the
    // camera's own right/up axes, then place the light there aimed at the
    // globe (which sits at the world origin).
    const camDir = new THREE.Vector3();
    this.camera.getWorldDirection(camDir);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 1);
    const keyDir = camDir.clone().negate();
    keyDir.applyAxisAngle(right, THREE.MathUtils.degToRad(-30));
    keyDir.applyAxisAngle(up, THREE.MathUtils.degToRad(25));
    this.gameplayLight.position.copy(keyDir.multiplyScalar(50));
    this.gameplayLight.target.position.set(0, 0, 0);

    this.sunLight.intensity = THREE.MathUtils.lerp(3.4, 1.8, blend);
    this.fillLight.intensity = THREE.MathUtils.lerp(0.18, 0.5, blend);
    this.gameplayLight.intensity = THREE.MathUtils.lerp(0, 2.5, blend);

    if (this.sunMesh) this.sunMesh.visible = blend < 0.5;
    if (this.sunFlare) this.sunFlare.visible = blend < 0.5;
    if (this.sunGlow) (this.sunGlow.material as THREE.SpriteMaterial).opacity = THREE.MathUtils.lerp(0.9, 0.08, blend);
  }

  render(): void {
    this.composer.render();
  }
}
