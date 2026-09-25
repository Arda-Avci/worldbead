import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

import type { PlanetId, ShotName } from './types';
import { createBeadMaterial } from './beadMaterial';
import { PlanetBody } from './planetBody';
import { createSkySphere, createTwinklingStars, updateTwinklingStars } from './starfield';
import { createSunMesh, createSunGlow, createSunLensflare, SUN_DISTANCE } from './sun';
import type { Lensflare } from 'three/examples/jsm/objects/Lensflare.js';
import { CameraRig } from './camera';
import { FxSystem } from './fx';
import { WarpEffect } from './warp';
import { SpinDriver } from './spin';

export type { PlanetId, ShotName };

const TEX_MILKY_WAY = 'textures/stars_milky_way.jpg';
const TEX_SUN = 'textures/sun.jpg';
const SUN_DIRECTION = new THREE.Vector3(0.55, 0.28, 0.78).normalize();

/** Axial tilt (degrees) per planet — a stylistic constant, not to scale. */
const AXIAL_TILT_DEG: Record<PlanetId, number> = {
  earth: 23.4,
  moon: 6.7,
  venus: 2.6,
  mars: 25.2,
  jupiter: 3.1,
};

/**
 * Bloom strength per planet (default 0.85, applied in `loadPlanet`). Venus's own bright
 * cream/tan bead palette plus its atmosphere glow was pushing a huge share of the frame over
 * the bloom threshold, washing both the globe and the background starfield out to a near-white
 * haze (owner bug report) — every other planet's darker average palette never triggers this.
 * Rather than lower the shared bloom pass for every planet (which would dull Jupiter's/Earth's
 * highlights that were never a problem), it's tuned down specifically while Venus is loaded.
 */
const BLOOM_STRENGTH_BY_PLANET: Record<PlanetId, number> = {
  earth: 0.85,
  moon: 0.85,
  venus: 0.4,
  mars: 0.85,
  jupiter: 0.85,
};

export class SpaceScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly globe: THREE.Group;
  /** Child of `globe`: holds the planet body + bead shells, carries the planet's own axial
   *  tilt and idle spin. `globe` itself stays purely the player's drag-controlled aim so the
   *  idle spin never fights a drag (see `setSpinActive`). */
  readonly spin: THREE.Group;
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
  private readonly ambientFloor: THREE.AmbientLight;
  /** False for the first few levels (item #16 supersession): no automatic spin at all, only the player's drag moves the globe. */
  private autoSpinEnabled = false;
  private spinDifficulty = 0;
  private readonly spinDriver = new SpinDriver(1, { difficulty: 0, tiltEnabled: false, reverseEnabled: false });
  private readonly spinDelta = new THREE.Quaternion();
  private sunMesh: THREE.Mesh | null = null;
  private sunGlow: THREE.Sprite | null = null;
  private sunFlare: Lensflare | null = null;
  /** 0 = dramatic fixed sun-direction lighting (intro/hero/sunPass/approach), 1 = flat camera-relative
   *  gameplay lighting. Smoothly tracks whichever shot the camera rig is currently in/flying to. */
  private gameplayBlend = 0;
  /** Outermost radius of the currently loaded bead globe (surface/layers/clouds — whichever
   *  reaches furthest), set by `setBodyRadius()` once per level load. Used by `sunOverlapsGlobe()`
   *  so the Sun-hiding test matches the globe's real visual extent instead of a fixed guess: a
   *  planet with extra layers and a cloud shell can reach well past the bare-surface radius, and
   *  under-estimating it let the Sun glow sit right at the globe's edge without being detected as
   *  "overlapping" and hidden. Defaults to a reasonable bare-surface guess before the first level
   *  loads. */
  private bodyRadius = 0.97 * 1.05;
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
    this.spin = new THREE.Group();
    this.spin.quaternion.setFromEuler(new THREE.Euler(0, 0, THREE.MathUtils.degToRad(AXIAL_TILT_DEG.earth)));
    this.globe.add(this.spin);
    this.planetBody.group.name = 'planetBody';
    this.spin.add(this.planetBody.group);

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
    this.fillLight = new THREE.HemisphereLight(0x3a4d72, 0x0e0e18, 0.24);
    this.scene.add(this.fillLight);
    this.gameplayLight = new THREE.DirectionalLight(0xf3f6ff, 0);
    this.scene.add(this.gameplayLight);
    // Small always-on rim/fill so the gameplay hemisphere never crushes to
    // pure black at its terminator edge; kept subtle so the terminator (a
    // deliberate realism cue) stays visible.
    this.ambientFloor = new THREE.AmbientLight(0xffffff, 0.06);
    this.scene.add(this.ambientFloor);

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

    // Beads get their own brighter studio-style reflection environment
    // (RoomEnvironment) rather than the dark starfield: at bead scale the
    // Milky Way env contributes almost no usable specular energy, so the
    // "glossy pearl" clearcoat/reflection reads as flat matte plastic
    // without a brighter env to catch. The planet body/atmosphere keep the
    // realistic dark-sky environment via `scene.environment`.
    const roomPmrem = new THREE.PMREMGenerator(this.renderer);
    const beadEnv = roomPmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    roomPmrem.dispose();
    (this.beadMaterial as THREE.MeshPhysicalMaterial).envMap = beadEnv;
    (this.beadMaterial as THREE.MeshPhysicalMaterial).needsUpdate = true;

    this.envReady = this.initBackground();

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
    this.spin.quaternion.setFromEuler(new THREE.Euler(0, 0, THREE.MathUtils.degToRad(AXIAL_TILT_DEG[id])));
    this.bloomPass.strength = BLOOM_STRENGTH_BY_PLANET[id];
    const env = await this.envReady;
    await this.planetBody.load(id, env);
  }

  /**
   * Re-seeds the idle spin's deterministic-per-level state machine (item
   * #16, superseded): `autoSpinEnabled` is false for the first few levels —
   * only the player's drag moves the globe — then turns on from its
   * onboarding milestone level. `difficulty` in [0,1] scales speed/tilt/
   * reversal-frequency once it's on. Called once per level.
   */
  configureSpin(seed: number, autoSpinEnabled: boolean, difficulty: number, tiltEnabled: boolean, reverseEnabled: boolean): void {
    this.autoSpinEnabled = autoSpinEnabled;
    this.spinDifficulty = THREE.MathUtils.clamp(difficulty, 0, 1);
    this.spinDriver.reset(seed, { difficulty, tiltEnabled, reverseEnabled });
  }

  /**
   * How much the player's live drag input should be damped right now
   * (0 = full control, capped well below 1 so the globe never becomes
   * uncontrollable): 0 whenever auto-spin is off or currently paused, and a
   * difficulty-scaled amount while it's actively spinning — dragging then
   * "fights" the auto-spin instead of simply overriding it, and the auto-spin
   * resumes seamlessly on release since it never actually stopped.
   */
  spinResistance(): number {
    if (!this.autoSpinEnabled || !this.spinDriver.isSpinning()) return 0;
    return THREE.MathUtils.lerp(0.15, 0.55, this.spinDifficulty);
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

  spillBead(worldPos: THREE.Vector3, color: number, outward: THREE.Vector3, radius: number): void {
    this.fx.spillBead(worldPos, color, outward, radius);
  }

  probeTrailDot(worldPos: THREE.Vector3, color: number): void {
    this.fx.probeTrailDot(worldPos, color);
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
    // Auto-spin keeps running even while the player drags (it's the drag that gets damped, via
    // `spinResistance()`), so it "resumes" after release simply because it never stopped.
    this.spinDriver.step(dt, this.autoSpinEnabled, this.spinDelta);
    if (this.autoSpinEnabled) this.spin.quaternion.premultiply(this.spinDelta);

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
    // 'hero' (the post-win planet reveal, where the level-complete/newPlanet/newLayer
    // cards are shown and the player can linger indefinitely) must read just as bright
    // and vivid as 'gameplay' — owner bug report: with only the fixed dramatic Sun key
    // light active, the reveal looked "dark and dull" on levels where the visible
    // hemisphere didn't happen to face the fixed Sun direction. Only the brief,
    // skippable intro shots (deepSpace/approach/sunPass) keep the moodier fixed-Sun-only
    // look, since nothing there is a screen the player stops and reads.
    const target = this.cameraRig.currentShot === 'gameplay' || this.cameraRig.currentShot === 'hero' ? 1 : 0;
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

    this.sunLight.intensity = THREE.MathUtils.lerp(3.4, 0.4, blend);
    this.fillLight.intensity = THREE.MathUtils.lerp(0.24, 0.5, blend);
    this.gameplayLight.intensity = THREE.MathUtils.lerp(0, 1.6, blend);

    const sunHiddenByBlend = blend >= 0.5;
    const sunOverlap = this.sunOverlapsGlobe();
    const sunHidden = sunHiddenByBlend || sunOverlap;
    if (this.sunMesh) this.sunMesh.visible = !sunHidden;
    if (this.sunFlare) this.sunFlare.visible = !sunHidden;
    if (this.sunGlow) {
      // Bug: this used to floor at 0.08 (lerp(0.9, 0.08, blend), and
      // Math.min(baseOpacity, 0.08) when overlapping) instead of reaching
      // true zero. A 34-unit additive sprite at 0.08 opacity, amplified by
      // the bloom pass, still reads as a large blown-out white glare blob
      // sitting on/behind the globe once the camera settles into the
      // 'gameplay'/'hero' shot (blend -> 1) or whenever the Sun's fixed
      // world direction happens to project near the globe on screen. The
      // Sun disc/flare are correctly fully hidden in that state (their
      // opacity/visible go to 0/false) so the glow sprite must too —
      // fading it all the way to 0 removes the blowout while still letting
      // it read as a soft glow during the non-gameplay shots (blend -> 0,
      // baseOpacity -> 0.9) where it never overlaps the globe.
      const baseOpacity = THREE.MathUtils.lerp(0.9, 0, blend);
      (this.sunGlow.material as THREE.SpriteMaterial).opacity = sunOverlap ? 0 : baseOpacity;
    }
  }

  /**
   * True whenever the Sun's screen-space position falls within (or close to)
   * the bead globe/planet body's angular radius as seen from the camera —
   * i.e. the Sun disc would visually overlap or sit behind the globe. Used
   * to fade the Sun disc/glow/flare out so it never occludes the globe that
   * is the subject of the current shot (gameplay, approach, hero, ...).
   */
  private sunOverlapsGlobe(): boolean {
    const camPos = this.camera.position;
    const toSun = SUN_DIRECTION.clone().multiplyScalar(SUN_DISTANCE).sub(camPos).normalize();
    const toGlobe = new THREE.Vector3(0, 0, 0).sub(camPos);
    const dist = toGlobe.length();
    toGlobe.normalize();
    const bodyRadius = this.bodyRadius;
    const angularRadius = Math.asin(THREE.MathUtils.clamp(bodyRadius / Math.max(dist, bodyRadius + 0.001), 0, 1));
    const angle = Math.acos(THREE.MathUtils.clamp(toSun.dot(toGlobe), -1, 1));
    return angle < angularRadius + THREE.MathUtils.degToRad(4);
  }

  /** Called once per level load with the just-built globe's outermost shell radius (see
   *  `BeadGlobe.outerRadius()`), so `sunOverlapsGlobe()` hides the Sun against this globe's
   *  actual visual size rather than a fixed guess. `margin` widens it slightly (beads themselves
   *  extend a bit past their shell's nominal radius). */
  setBodyRadius(radius: number, margin = 1.05): void {
    this.bodyRadius = radius * margin;
  }

  render(): void {
    this.composer.render();
  }

  /** QA-only diagnostic (see `Game.ts`'s dev-only `__wbQA` hook): current shot/blend/sun visibility state. */
  debugSunState(): { shot: string; blend: number; sunOverlap: boolean; sunMeshVisible: boolean; sunFlareVisible: boolean; sunGlowOpacity: number } {
    return {
      shot: this.cameraRig.currentShot,
      blend: this.gameplayBlend,
      sunOverlap: this.sunOverlapsGlobe(),
      sunMeshVisible: this.sunMesh?.visible ?? false,
      sunFlareVisible: this.sunFlare?.visible ?? false,
      sunGlowOpacity: this.sunGlow ? (this.sunGlow.material as THREE.SpriteMaterial).opacity : 0,
    };
  }
}
