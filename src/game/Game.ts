/**
 * Integration layer: composes `src/render/` (SpaceScene), `src/audio/`
 * (AudioEngine), `src/ui/` (GameUI + Tutorial) and `src/game/`
 * (BeadGlobe + GameSession) into the real game controller, per GDD §2-§6.
 */
import * as THREE from 'three';
import { SpaceScene } from '../render/SpaceScene';
import { AudioEngine } from '../audio/AudioEngine';
import { GameUI } from '../ui/gameui';
import { Tutorial, type ScreenCircle } from '../ui/tutorial';
import { haptic } from '../ui/haptic';
import type { PowerButtonState, Settings } from '../ui/types';
import { BeadGlobe, type TextureMap, type TextureName } from './BeadGlobe';
import { GameSession, type SessionEvent } from './GameSession';
import { getLevel, MAX_LEVEL, type LevelConfig } from './levels';
import { mulberry32 } from './noise';
import { PLANETS, type PlanetId } from './planets';
import { loadProgress, saveProgress, type Progress } from './progress';
import { loadImageData, type ImageDataLike } from './texture';
import {
  FREE_CHARGES_ON_UNLOCK,
  POWER_IDS,
  POWER_PRICES,
  UNLOCKS,
  unlockedPowers,
  unlocksForLevel,
  type PowerId,
  type UnlockEntry,
  type UnlockId,
} from './unlocks';
import { FACTS } from './facts';
import type { BeadRef } from './types';

type FlowState = 'boot' | 'playing' | 'resolving';

interface Flight {
  obj: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  arcHeight: number;
  onArrive: () => void;
}

const TAP_MAX_MOVE = 10; // px
const TAP_MAX_MS = 450;
const ROT_SPEED = 0.0055; // rad per px
const PRISM_PROBE_COLOR = 0xd9c7ff;
const METEOR_RADIUS = 0.3; // globe-local units
const COMET_HALF_WIDTH = 0.12; // |dot| band half-width
const ROTATE_TUTORIAL_DEG = 60;
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);

const UNLOCK_INFO: Partial<Record<UnlockId, { icon: string; name: string; description: string }>> = {
  swap: { icon: 'swap', name: 'Swap Unlocked', description: 'Swap your current and next probe colors.' },
  meteor: { icon: 'meteor', name: 'Meteor Unlocked', description: 'Pops every bead within a radius of the impact point, any color.' },
  prism: { icon: 'prism', name: 'Prism Unlocked', description: 'Your next probe matches any color.' },
  solarFlare: { icon: 'solarFlare', name: 'Solar Flare Unlocked', description: 'Pops all visible-hemisphere beads of the current probe color.' },
  comet: { icon: 'comet', name: 'Comet Unlocked', description: 'Pops a band along a great circle chosen by a swipe.' },
  cloudLayer: { icon: 'star', name: 'Cloud Layer', description: 'Clouds now cover the surface. Pop through them to reach the beads beneath.' },
};

const textureCache = new Map<string, ImageDataLike>();
async function loadTexture(name: TextureName): Promise<ImageDataLike> {
  const cached = textureCache.get(name);
  if (cached) return cached;
  const img = await loadImageData(`textures/${name}.jpg`);
  textureCache.set(name, img);
  return img;
}

export class Game {
  private readonly scene: SpaceScene;
  private readonly audio = new AudioEngine();
  private readonly ui: GameUI;
  private readonly tutorial: Tutorial;
  private readonly raycaster = new THREE.Raycaster();

  private progress: Progress;
  private cfg!: LevelConfig;
  private globe: BeadGlobe | null = null;
  private session: GameSession | null = null;
  private currentPlanetLoaded: PlanetId | null = null;
  private buildToken = 0;
  private levelTotalBeads = 0;

  private state: FlowState = 'boot';
  private acceptInput = false;
  private armedPower: PowerId | null = null;

  // input
  private pointerId: number | null = null;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private downTime = 0;
  private dragging = false;
  private velX = 0;
  private velY = 0;
  private cometStart: THREE.Vector3 | null = null;
  private cumulativeRotationDeg = 0;

  private flights: Flight[] = [];

  // skip (intro)
  private skipRequested = false;
  private skipResolvers: Array<() => void> = [];

  // tutorial hooks
  private resolveLevelEnd: ((ev: Extract<SessionEvent, { type: 'win' } | { type: 'lose' }>) => void) | null = null;
  private pendingHitResolve: (() => void) | null = null;
  private pendingSwapResolve: (() => void) | null = null;
  private rotateTutorialResolve: (() => void) | null = null;
  private pendingPowerArmResolve: { power: PowerId; resolve: () => void } | null = null;
  private pendingPowerUseResolve: { power: PowerId; resolve: () => void } | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.scene = new SpaceScene(canvas);
    this.ui = new GameUI(hudRoot, {
      onPower: (id) => this.onPowerButton(id as PowerId),
      onSwap: () => this.onSwapPressed(),
      onSettingsChanged: (settings) => this.onSettingsChanged(settings),
      onReplayIntro: () => void this.replayIntro(),
    });
    this.tutorial = new Tutorial(hudRoot);

    this.progress = loadProgress();
    this.ui.setSettings(this.progress.settings);

    window.addEventListener('resize', () => this.scene.resize());
    this.bindInput();

    // Dev-only QA hook: exposes a way to find real, hit-testable screen
    // coordinates for the current probe color so a Playwright script can
    // drive the game via genuine pointer events instead of pixel-guessing.
    // `import.meta.env.DEV` is a Vite build-time constant, so this whole
    // branch (and the method it calls) is stripped from production builds.
    if (import.meta.env.DEV) {
      (window as unknown as { __wbQA: unknown }).__wbQA = {
        targetForCurrentProbe: () => this.qaTargetForCurrentProbe(),
      };
    }

    void this.run();
  }

  // =============================================================== boot / flow

  private async run(): Promise<void> {
    this.startRenderLoop();

    const qp = new URLSearchParams(location.search);
    const forced = Number(qp.get('level'));
    if (forced > 0) this.progress.level = Math.min(MAX_LEVEL, Math.max(1, Math.floor(forced)));
    const skipIntroQP = qp.get('skipIntro') === '1' || forced > 0;

    await this.prepareLevel(this.progress.level);

    if (!skipIntroQP) {
      await this.playIntro(!this.progress.introSeen);
    } else {
      this.audio.unlock();
      this.audio.startMusic(this.cfg.planet);
      await this.scene.flyTo('gameplay', 0.01);
      this.globe!.group.visible = true;
      void this.globe!.assemble(0.5);
      await this.wait(550);
      this.ui.setHudVisible(true);
    }

    for (;;) {
      const ev = await this.playLevel();
      if (ev.type === 'lose') {
        this.audio.play('lose');
        await this.ui.showLevelFailed({ beadsLeft: this.globe?.aliveCount() ?? 0 });
        await this.prepareLevel(this.cfg.level);
        await this.scene.flyTo('gameplay', 0.8);
        this.globe!.group.visible = true;
        void this.globe!.assemble(0.8);
        await this.wait(850);
        continue;
      }
      await this.onWin(ev);
    }
  }

  private async onWin(ev: Extract<SessionEvent, { type: 'win' }>): Promise<void> {
    const prevPlanet = this.cfg.planet;

    void this.globe!.burstAway(1.0);
    this.scene.setBodyRevealed(true);
    await this.scene.flyTo('hero', 1.1);
    this.audio.play('win');

    const prevStars = this.progress.starsByLevel[this.cfg.level] ?? 0;
    if (ev.stars > prevStars) this.progress.starsByLevel[this.cfg.level] = ev.stars;
    this.progress.totalWins = this.session?.getWinsSoFar() ?? this.progress.totalWins;
    const nextLevelNum = Math.min(MAX_LEVEL, this.cfg.level + 1);
    this.progress.level = nextLevelNum;
    saveProgress(this.progress);

    if (ev.bonusPower) this.ui.showToast(`Bonus power: ${powerLabel(ev.bonusPower)}!`);

    const nextCfg = getLevel(nextLevelNum);
    const changingPlanet = nextCfg.planet !== prevPlanet;
    const facts = FACTS[prevPlanet];
    const fact = facts[Math.floor(Math.random() * facts.length)];

    await this.ui.showLevelComplete({
      stars: ev.stars,
      stardustEarned: ev.stardustEarned,
      factTitle: 'Did you know?',
      factText: fact,
      nextPlanetName: changingPlanet ? PLANETS[nextCfg.planet].name : undefined,
    });

    if (changingPlanet && nextLevelNum !== this.cfg.level) {
      this.ui.setHudVisible(false);
      await this.scene.warp(1.8);
      this.audio.play('warp');
      this.ui.setHudVisible(true);
    }

    await this.prepareLevel(nextLevelNum);
    await this.scene.flyTo('gameplay', changingPlanet ? 0.2 : 0.9);
    this.globe!.group.visible = true;
    void this.globe!.assemble(0.8);
    await this.wait(850);
  }

  private async playLevel(): Promise<Extract<SessionEvent, { type: 'win' } | { type: 'lose' }>> {
    this.state = 'playing';
    this.acceptInput = true;
    this.cumulativeRotationDeg = 0;
    this.updateHud();
    // A tap forwarded through a forced tutorial's spotlight still runs the real fire pipeline, so the
    // level can win/lose while a tutorial's own gesture is still pending. Set up the end-promise before
    // (not after) running tutorials, and race the two: if the level ends first, cut the tutorial short
    // rather than silently losing the win/lose event (resolveLevelEnd would otherwise still be null).
    const endPromise = new Promise<Extract<SessionEvent, { type: 'win' } | { type: 'lose' }>>((resolve) => {
      this.resolveLevelEnd = resolve;
    });
    await Promise.race([this.runTutorialsForLevel(), endPromise]);
    this.tutorial.stop();
    const ev = await endPromise;
    this.acceptInput = false;
    this.state = 'resolving';
    return ev;
  }

  private async playIntro(full: boolean): Promise<void> {
    this.ui.setHudVisible(false);
    this.skipRequested = false;
    this.skipResolvers = [];
    this.ui.showSkip(() => {
      this.skipRequested = true;
      const resolvers = this.skipResolvers;
      this.skipResolvers = [];
      for (const r of resolvers) r();
    });

    await this.raceSkip(this.scene.flyTo('deepSpace', 0.01));
    if (full) {
      await this.raceSkip(this.scene.flyTo('sunPass', 3.2));
      if (!this.skipRequested) await this.raceSkip(this.ui.showTitleBeat('4.5 billion years in the making.', 2200));
      if (!this.skipRequested) await this.raceSkip(this.scene.flyTo('approach', 3.0));
      if (!this.skipRequested) await this.raceSkip(this.ui.showTitleBeat('Every world is made of countless pieces.', 2200));
    } else if (!this.skipRequested) {
      await this.raceSkip(this.scene.flyTo('approach', 1.6));
    }
    await this.scene.flyTo('gameplay', 1.0);
    this.globe!.group.visible = true;
    await this.globe!.assemble(this.skipRequested ? 0.5 : 1.0);

    this.ui.hideSkip();
    await this.ui.showLogo();
    this.audio.unlock();
    this.audio.startMusic(this.cfg.planet);
    this.progress.introSeen = true;
    saveProgress(this.progress);
    this.ui.setHudVisible(true);
  }

  private async replayIntro(): Promise<void> {
    if (!this.globe) return;
    this.acceptInput = false;
    await this.playIntro(true);
    await this.prepareLevel(this.cfg.level);
    await this.scene.flyTo('gameplay', 0.2);
    this.globe!.group.visible = true;
    void this.globe!.assemble(0.8);
    await this.wait(850);
    this.state = 'playing';
    this.acceptInput = true;
    this.updateHud();
  }

  private async raceSkip(p: Promise<void>): Promise<void> {
    if (this.skipRequested) return;
    await Promise.race([p, new Promise<void>((res) => this.skipResolvers.push(res))]);
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // =============================================================== level build

  private async prepareLevel(levelNumber: number): Promise<void> {
    const token = ++this.buildToken;
    const cfg = getLevel(levelNumber);
    const planetDef = PLANETS[cfg.planet];
    this.ui.showLoading(planetDef.name);

    const images: TextureMap = {};
    images[planetDef.surfaceTexture as TextureName] = await loadTexture(planetDef.surfaceTexture as TextureName);
    if (cfg.cloudBeadCount > 0 && planetDef.cloudTexture) {
      images[planetDef.cloudTexture as TextureName] = await loadTexture(planetDef.cloudTexture as TextureName);
    }
    if (this.currentPlanetLoaded !== cfg.planet) {
      await this.scene.loadPlanet(cfg.planet);
      this.currentPlanetLoaded = cfg.planet;
    }
    if (token !== this.buildToken) return; // a newer level was requested while textures loaded

    if (this.globe) {
      this.scene.globe.remove(this.globe.group);
      this.globe.dispose();
      this.globe = null;
    }
    for (const f of this.flights) this.disposeProbeObj(f.obj);
    this.flights = [];

    const globe = new BeadGlobe(cfg, images, this.scene.beadMaterial);
    this.globe = globe;
    this.scene.globe.add(globe.group);
    // Hidden until the caller's assemble beat (deepSpace/sunPass/approach cinematics show the
    // bare photoreal planet body first; the beads fly in and reveal themselves as a separate beat).
    globe.group.visible = false;
    this.levelTotalBeads = globe.aliveCount();

    this.applyUnlocks(cfg.level);
    const powers = this.buildPowerStates();
    const regions = globe.countRegions();
    this.session = new GameSession(globe, {
      regions,
      shotSlack: cfg.shotSlack,
      seed: cfg.seed,
      stardust: this.progress.stardust,
      powers,
      winsSoFar: this.progress.totalWins,
    });
    this.cfg = cfg;
    this.armedPower = null;
    this.orientToStart(cfg);
    this.updateHud();
    this.ui.hideLoading();
  }

  private orientToStart(cfg: LevelConfig): void {
    const rng = mulberry32(cfg.seed ^ 0x1234abcd);
    const lon = cfg.planet === 'earth' ? 25 + (rng() - 0.5) * 40 : rng() * 360;
    const lat = cfg.planet === 'earth' ? 20 : (rng() - 0.5) * 30;
    const qy = new THREE.Quaternion().setFromAxisAngle(AXIS_Y, THREE.MathUtils.degToRad(-(90 + lon)));
    const qx = new THREE.Quaternion().setFromAxisAngle(AXIS_X, THREE.MathUtils.degToRad(lat * 0.7));
    this.scene.globe.quaternion.copy(qx.multiply(qy));
    this.velX = this.velY = 0;
  }

  private applyUnlocks(level: number): void {
    let changed = false;
    for (const p of unlockedPowers(level)) {
      if (!this.progress.powerUnlocked[p]) {
        this.progress.powerUnlocked[p] = true;
        this.progress.powerCharges[p] += FREE_CHARGES_ON_UNLOCK;
        changed = true;
      }
    }
    if (changed) saveProgress(this.progress);
  }

  private buildPowerStates(): Record<PowerId, { unlocked: boolean; charges: number }> {
    const out = {} as Record<PowerId, { unlocked: boolean; charges: number }>;
    for (const p of POWER_IDS) out[p] = { unlocked: this.progress.powerUnlocked[p], charges: this.progress.powerCharges[p] };
    return out;
  }

  // =============================================================== unlocks & tutorials

  private async runTutorialsForLevel(): Promise<void> {
    for (const entry of unlocksForLevel(this.cfg.level)) {
      const key = `${entry.level}-${entry.id}`;
      if (this.progress.seenTutorials.includes(key)) continue;
      const isL1Basics = entry.level === 1 && (entry.id === 'fire' || entry.id === 'rotate');
      if (!isL1Basics) await this.showUnlockOrPlanetCard(entry);
      await this.runTutorialScript(entry);
      this.progress.seenTutorials.push(key);
      saveProgress(this.progress);
    }
  }

  private async showUnlockOrPlanetCard(entry: UnlockEntry): Promise<void> {
    if (entry.id === 'newPlanet') {
      const planet = PLANETS[this.cfg.planet];
      await this.ui.showUnlock({
        icon: 'star',
        name: `Welcome to ${planet.name}`,
        description: FACTS[this.cfg.planet][0],
        ctaLabel: 'Continue',
      });
      return;
    }
    const info = UNLOCK_INFO[entry.id];
    if (!info) return;
    await this.ui.showUnlock({ icon: info.icon, name: info.name, description: info.description, ctaLabel: 'Try it' });
  }

  private async runTutorialScript(entry: UnlockEntry): Promise<void> {
    switch (entry.id) {
      case 'fire': {
        const color = this.session?.queue[0] ?? null;
        const region = color != null ? this.globe!.findLargestExposedRegionOfColor(color) : null;
        const until = new Promise<void>((res) => (this.pendingHitResolve = res));
        await this.tutorial.run([
          {
            caption: 'Tap the glowing region to pop it.',
            target: () => this.beadScreenCircle(region) ?? this.globeScreenCircle(),
            gesture: 'tap',
            until,
          },
        ]);
        this.pendingHitResolve = null;
        break;
      }
      case 'rotate': {
        this.cumulativeRotationDeg = 0;
        const until = new Promise<void>((res) => (this.rotateTutorialResolve = res));
        await this.tutorial.run([
          { caption: 'Drag to rotate the world.', target: () => this.globeScreenCircle(), gesture: 'drag', until },
        ]);
        this.rotateTutorialResolve = null;
        break;
      }
      case 'swap': {
        const until = new Promise<void>((res) => (this.pendingSwapResolve = res));
        const target = this.canvas.parentElement?.querySelector('[data-swap]') as HTMLElement | null;
        if (target) {
          await this.tutorial.run([{ caption: 'Tap swap to switch probes.', target, gesture: 'tap', until }]);
        }
        this.pendingSwapResolve = null;
        break;
      }
      case 'meteor': {
        await this.runArmThenUseTutorial('meteor', 'Tap Meteor to arm it.', 'Tap the globe to strike.', 'tap');
        break;
      }
      case 'prism': {
        const untilArm = new Promise<void>((res) => (this.pendingPowerArmResolve = { power: 'prism', resolve: res }));
        const armTarget = this.powerButtonEl('prism');
        if (armTarget) await this.tutorial.run([{ caption: 'Tap Prism to arm it.', target: armTarget, gesture: 'tap', until: untilArm }]);
        this.pendingPowerArmResolve = null;

        const untilHit = new Promise<void>((res) => (this.pendingHitResolve = res));
        await this.tutorial.run([{ caption: 'Now pop any region.', target: () => this.globeScreenCircle(), gesture: 'tap', until: untilHit }]);
        this.pendingHitResolve = null;
        break;
      }
      case 'solarFlare': {
        const until = new Promise<void>((res) => (this.pendingPowerUseResolve = { power: 'solarFlare', resolve: res }));
        const target = this.powerButtonEl('solarFlare');
        if (target) await this.tutorial.run([{ caption: 'Tap Solar Flare.', target, gesture: 'tap', until }]);
        this.pendingPowerUseResolve = null;
        break;
      }
      case 'cloudLayer': {
        const region = this.globe!.findLargestExposedCloudRegion();
        const until = new Promise<void>((res) => (this.pendingHitResolve = res));
        await this.tutorial.run([
          {
            caption: 'Clouds now cover the surface. Pop a cloud region.',
            target: () => this.beadScreenCircle(region) ?? this.globeScreenCircle(),
            gesture: 'tap',
            until,
          },
        ]);
        this.pendingHitResolve = null;
        break;
      }
      case 'comet': {
        await this.runArmThenUseTutorial('comet', 'Tap Comet to arm it.', 'Swipe across the world.', 'swipe');
        break;
      }
      case 'newPlanet':
        break;
    }
  }

  private async runArmThenUseTutorial(power: PowerId, armCaption: string, useCaption: string, useGesture: 'tap' | 'swipe'): Promise<void> {
    const untilArm = new Promise<void>((res) => (this.pendingPowerArmResolve = { power, resolve: res }));
    const armTarget = this.powerButtonEl(power);
    if (armTarget) await this.tutorial.run([{ caption: armCaption, target: armTarget, gesture: 'tap', until: untilArm }]);
    this.pendingPowerArmResolve = null;

    const untilUse = new Promise<void>((res) => (this.pendingPowerUseResolve = { power, resolve: res }));
    await this.tutorial.run([{ caption: useCaption, target: () => this.globeScreenCircle(), gesture: useGesture, until: untilUse }]);
    this.pendingPowerUseResolve = null;
  }

  private powerButtonEl(power: PowerId): HTMLElement | null {
    return this.canvas.parentElement?.querySelector(`[data-power="${power}"]`) as HTMLElement | null;
  }

  // =============================================================== input

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== null) return;
      this.pointerId = e.pointerId;
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        // synthetic events forwarded by the tutorial engine may not have a live pointer session
      }
      this.downX = this.lastX = e.clientX;
      this.downY = this.lastY = e.clientY;
      this.downTime = performance.now();
      this.dragging = false;
      this.velX = this.velY = 0;
      if (this.armedPower === 'comet') this.cometStart = this.screenToGlobeDir(e.clientX, e.clientY);
    });
    c.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      if (!this.dragging && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > TAP_MAX_MOVE) this.dragging = true;
      if (this.dragging && this.armedPower !== 'comet') {
        this.rotateBy(dx * ROT_SPEED, dy * ROT_SPEED);
        this.velX = dx * ROT_SPEED;
        this.velY = dy * ROT_SPEED;
      }
      this.lastX = e.clientX;
      this.lastY = e.clientY;
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = null;
      if (this.armedPower === 'comet') {
        const end = this.screenToGlobeDir(e.clientX, e.clientY);
        this.resolveComet(this.cometStart, end);
        this.cometStart = null;
        return;
      }
      const isTap = !this.dragging && performance.now() - this.downTime < TAP_MAX_MS;
      if (isTap && this.acceptInput && this.state === 'playing') this.handleGlobeTap(e.clientX, e.clientY);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', (e) => {
      if (e.pointerId === this.pointerId) {
        this.pointerId = null;
        this.cometStart = null;
      }
    });
  }

  private readonly tmpQ1 = new THREE.Quaternion();
  private readonly tmpQ2 = new THREE.Quaternion();

  private rotateBy(ax: number, ay: number): void {
    this.tmpQ1.setFromAxisAngle(AXIS_Y, ax);
    this.scene.globe.quaternion.premultiply(this.tmpQ1);
    this.tmpQ2.setFromAxisAngle(AXIS_X, ay);
    this.scene.globe.quaternion.premultiply(this.tmpQ2);
    this.cumulativeRotationDeg += (Math.abs(ax) + Math.abs(ay)) * (180 / Math.PI);
    if (this.rotateTutorialResolve && this.cumulativeRotationDeg >= ROTATE_TUTORIAL_DEG) {
      const r = this.rotateTutorialResolve;
      this.rotateTutorialResolve = null;
      r();
    }
  }

  private handleGlobeTap(clientX: number, clientY: number): void {
    if (!this.session || !this.globe || this.session.probes <= 0) return;

    if (this.armedPower === 'meteor') {
      const local = this.pickBeadLocalPoint(clientX, clientY);
      if (!local) return;
      const events = this.session.meteor({ x: local.x, y: local.y, z: local.z }, METEOR_RADIUS);
      if (events.length === 0) return;
      this.audio.play('powerMeteor');
      const worldPt = this.globe.group.localToWorld(local.clone());
      this.scene.burst(worldPt, 0xffb347, 1.5);
      this.scene.shake(0.45);
      this.armedPower = null;
      this.updatePowerButtons();
      this.handleEvents(events);
      return;
    }

    const hit = this.pickBead(clientX, clientY);
    if (!hit) return;
    const color = this.session.prismArmed ? PRISM_PROBE_COLOR : this.session.queue[0];
    if (color == null) return;

    this.audio.play('fire');
    this.launchProbe(color, hit.point, (obj) => {
      if (!this.session || !this.globe) {
        this.disposeProbeObj(obj);
        return;
      }
      const events = this.session.fire(hit.shellId, hit.index);
      const missed = events.some((e) => e.type === 'fire' && e.result === 'miss');
      if (missed) {
        const centerWorld = this.globe.group.getWorldPosition(new THREE.Vector3());
        const outward = hit.point.clone().sub(centerWorld).normalize();
        this.flights.push({
          obj,
          from: hit.point.clone(),
          to: hit.point.clone().addScaledVector(outward, 0.6),
          t: 0,
          dur: 0.22,
          arcHeight: 0,
          onArrive: () => this.disposeProbeObj(obj),
        });
      } else {
        this.disposeProbeObj(obj);
      }
      this.handleEvents(events);
    });
  }

  private onPowerButton(id: PowerId): void {
    if (!this.session) return;
    const st = this.session.powers[id];
    if (!st.unlocked) return;

    if (st.charges === 0) {
      const ev = this.session.purchase(id);
      if (ev.type === 'purchase' && ev.ok) this.audio.play('uiTap');
      this.handleEvents([ev]);
      return;
    }

    switch (id) {
      case 'meteor':
        this.armedPower = this.armedPower === 'meteor' ? null : 'meteor';
        if (this.armedPower === 'meteor' && this.pendingPowerArmResolve?.power === 'meteor') {
          const r = this.pendingPowerArmResolve.resolve;
          this.pendingPowerArmResolve = null;
          r();
        }
        break;
      case 'comet':
        this.armedPower = this.armedPower === 'comet' ? null : 'comet';
        if (this.armedPower === 'comet' && this.pendingPowerArmResolve?.power === 'comet') {
          const r = this.pendingPowerArmResolve.resolve;
          this.pendingPowerArmResolve = null;
          r();
        }
        break;
      case 'prism': {
        const events = this.session.prism();
        if (events.length) this.audio.play('powerPrism');
        this.handleEvents(events);
        break;
      }
      case 'solarFlare': {
        const color = this.session.queue[0];
        if (color == null) break;
        const camLocal = this.globe!.group.worldToLocal(this.scene.camera.position.clone()).normalize();
        const events = this.session.solarFlare(color, { x: camLocal.x, y: camLocal.y, z: camLocal.z });
        if (events.length) this.audio.play('powerFlare');
        this.handleEvents(events);
        break;
      }
    }
    this.updatePowerButtons();
  }

  private onSwapPressed(): void {
    if (!this.session || this.state !== 'playing') return;
    const events = this.session.swap();
    this.handleEvents(events);
    if (this.pendingSwapResolve) {
      const r = this.pendingSwapResolve;
      this.pendingSwapResolve = null;
      r();
    }
  }

  private onSettingsChanged(settings: Settings): void {
    this.progress.settings = settings;
    saveProgress(this.progress);
    this.audio.setSfxEnabled(settings.sound);
    this.audio.setMusicEnabled(settings.music);
  }

  private resolveComet(start: THREE.Vector3 | null, end: THREE.Vector3 | null): void {
    if (!start || !end || !this.session) {
      this.armedPower = null;
      this.updatePowerButtons();
      return;
    }
    const normal = new THREE.Vector3().crossVectors(start, end);
    if (normal.lengthSq() < 1e-6) {
      this.armedPower = null;
      this.updatePowerButtons();
      return;
    }
    normal.normalize();
    const events = this.session.comet({ x: normal.x, y: normal.y, z: normal.z }, COMET_HALF_WIDTH);
    if (events.length) this.audio.play('powerComet');
    this.armedPower = null;
    this.updatePowerButtons();
    this.handleEvents(events);
  }

  // =============================================================== events -> FX/audio/UI

  private handleEvents(events: SessionEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'fire':
          if (ev.result === 'hit') {
            this.burstDrainedPops(ev.poppedCount);
            this.audio.play(ev.combo ? 'bigPop' : 'pop', { intensity: THREE.MathUtils.clamp(ev.poppedCount / 60, 0.2, 1.4) });
            haptic(ev.combo ? 'medium' : 'light');
            if (ev.combo) this.ui.showCombo(ev.poppedCount);
            if (this.pendingHitResolve) {
              const r = this.pendingHitResolve;
              this.pendingHitResolve = null;
              r();
            }
          } else {
            this.audio.play('miss');
            this.scene.shake(0.5);
            haptic('heavy');
          }
          break;
        case 'power':
          this.burstDrainedPops(ev.poppedCount);
          if (ev.poppedCount >= 60) this.ui.showCombo(ev.poppedCount);
          if (this.pendingPowerUseResolve?.power === ev.power) {
            const r = this.pendingPowerUseResolve.resolve;
            this.pendingPowerUseResolve = null;
            r();
          }
          if (this.pendingPowerArmResolve?.power === ev.power) {
            const r = this.pendingPowerArmResolve.resolve;
            this.pendingPowerArmResolve = null;
            r();
          }
          break;
        case 'swap':
          break;
        case 'purchase':
          this.ui.showToast(ev.ok ? 'Purchased!' : 'Not enough stardust');
          break;
        case 'win':
        case 'lose':
          if (this.resolveLevelEnd) {
            const r = this.resolveLevelEnd;
            this.resolveLevelEnd = null;
            r(ev);
          }
          break;
      }
    }
    this.syncProgressFromSession();
    this.updateHud();
  }

  private syncProgressFromSession(): void {
    if (!this.session) return;
    this.progress.stardust = this.session.stardust;
    for (const p of POWER_IDS) this.progress.powerCharges[p] = this.session.powers[p].charges;
    saveProgress(this.progress);
  }

  private burstDrainedPops(poppedCount: number): void {
    if (!this.globe) return;
    const events = this.globe.drainPopEvents();
    if (events.length === 0) return;
    const cap = 24;
    const step = Math.max(1, Math.floor(events.length / cap));
    const intensity = THREE.MathUtils.clamp(0.5 + poppedCount / 80, 0.5, 1.8);
    for (let i = 0; i < events.length; i += step) {
      const ev = events[i];
      const world = this.globe.group.localToWorld(new THREE.Vector3(ev.position.x, ev.position.y, ev.position.z));
      this.scene.burst(world, ev.color, intensity);
    }
  }

  // =============================================================== HUD sync

  private updateHud(): void {
    if (!this.session) return;
    this.ui.setStardust(this.progress.stardust);
    const alive = this.globe?.aliveCount() ?? 0;
    const clearedPct = this.levelTotalBeads > 0 ? 1 - alive / this.levelTotalBeads : 0;
    this.ui.setPlanetBadge(PLANETS[this.cfg.planet].name, this.cfg.level, clearedPct);
    const c0 = this.session.queue[0];
    const c1 = this.session.queue[1];
    this.ui.setProbeDock(c0 != null ? { color: c0, count: this.session.probes } : null, c1 != null ? { color: c1 } : null, this.session.prismArmed);
    this.updatePowerButtons();
  }

  private updatePowerButtons(): void {
    if (!this.session) return;
    const states: PowerButtonState[] = POWER_IDS.map((id) => {
      const st = this.session!.powers[id];
      const unlockEntry = UNLOCKS.find((u) => u.id === id);
      return {
        id,
        charges: st.charges,
        locked: !st.unlocked,
        unlockLevel: unlockEntry?.level,
        price: POWER_PRICES[id],
        active: this.armedPower === id || (id === 'prism' && this.session!.prismArmed),
      };
    });
    this.ui.setPowers(states);
  }

  // =============================================================== picking helpers

  private pickBead(clientX: number, clientY: number): { shellId: number; index: number; point: THREE.Vector3 } | null {
    if (!this.globe) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.scene.camera);
    const hits = this.raycaster.intersectObjects(this.globe.raycastTargets(), false);
    return this.globe.resolveHit(hits);
  }

  private pickBeadLocalPoint(clientX: number, clientY: number): THREE.Vector3 | null {
    const hit = this.pickBead(clientX, clientY);
    if (hit && this.globe) return this.globe.group.worldToLocal(hit.point.clone());
    const dir = this.screenToGlobeDir(clientX, clientY);
    return dir;
  }

  /** Direction (globe-local, unit length) where the ray through (clientX, clientY) meets the bead shell sphere. */
  private screenToGlobeDir(clientX: number, clientY: number): THREE.Vector3 | null {
    if (!this.globe) return null;
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.scene.camera);
    const centerWorld = this.globe.group.getWorldPosition(new THREE.Vector3());
    const scale = this.globe.group.getWorldScale(new THREE.Vector3()).x || 1;
    const sphere = new THREE.Sphere(centerWorld, 1.05 * scale);
    const hitPoint = new THREE.Vector3();
    if (!this.raycaster.ray.intersectSphere(sphere, hitPoint)) return null;
    return this.globe.group.worldToLocal(hitPoint).normalize();
  }

  private globeScreenCircle(): ScreenCircle | null {
    if (!this.globe) return null;
    const rect = this.canvas.getBoundingClientRect();
    const center = this.globe.group.localToWorld(new THREE.Vector3(0, 0, 0));
    const edge = this.globe.group.localToWorld(new THREE.Vector3(1.05, 0, 0));
    const c2 = center.clone().project(this.scene.camera);
    const e2 = edge.clone().project(this.scene.camera);
    if (c2.z > 1) return null;
    const cx = (c2.x * 0.5 + 0.5) * rect.width + rect.left;
    const cy = (1 - (c2.y * 0.5 + 0.5)) * rect.height + rect.top;
    const ex = (e2.x * 0.5 + 0.5) * rect.width + rect.left;
    const ey = (1 - (e2.y * 0.5 + 0.5)) * rect.height + rect.top;
    const r = Math.max(60, Math.hypot(ex - cx, ey - cy));
    return { x: cx, y: cy, r };
  }

  private beadScreenCircle(beads: BeadRef[] | null): ScreenCircle | null {
    if (!this.globe || !beads || beads.length === 0) return null;
    const rect = this.canvas.getBoundingClientRect();
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let cx = 0;
    let cy = 0;
    let n = 0;
    const step = Math.max(1, Math.floor(beads.length / 40));
    for (let i = 0; i < beads.length; i += step) {
      const b = beads[i];
      const p = this.globe.positionOf(b.shellId, b.index);
      const world = this.globe.group.localToWorld(new THREE.Vector3(p.x, p.y, p.z));
      const ndc = world.clone().project(this.scene.camera);
      if (ndc.z > 1) continue;
      const sx = (ndc.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (1 - (ndc.y * 0.5 + 0.5)) * rect.height + rect.top;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
      cx += sx;
      cy += sy;
      n++;
    }
    if (n === 0) return null;
    cx /= n;
    cy /= n;
    const r = Math.max(30, Math.max(maxX - minX, maxY - minY) / 2 + 20);
    return { x: cx, y: cy, r };
  }

  // =============================================================== dev-only QA hook
  //
  // `window.__wbQA` is assigned only under `import.meta.env.DEV` (see the
  // constructor) and is never referenced anywhere else in production code
  // paths, so Vite/Rollup dead-code-eliminates the whole branch — including
  // this method's call site — from a production build; `npm run build` +
  // `grep -r __wbQA dist/` confirms it. It exists purely so a real
  // Playwright script can drive the game through genuine pointer events
  // (never direct session calls) instead of guessing screen colors.

  /**
   * Screen coordinates of a currently-hittable bead matching the color the
   * player would actually pop by firing right now (the armed/queued probe
   * color, or any exposed color while prism is armed), verified by running
   * it back through the same raycast `pickBead` uses for a real tap — so a
   * pointer event dispatched at the returned point is guaranteed to hit that
   * exact bead. Returns null when nothing hittable is available (e.g. between
   * levels, or mid-animation). Read-only: never mutates game/session state.
   */
  private qaTargetForCurrentProbe(): { x: number; y: number } | null {
    if (!this.globe || !this.session || !this.acceptInput || this.state !== 'playing') return null;
    const exposed = this.globe.exposedColors();
    if (exposed.size === 0) return null;
    const wanted = this.session.prismArmed ? null : this.session.queue[0];
    const color = wanted !== null && exposed.has(wanted) ? wanted : (exposed.keys().next().value as number);
    const region = this.globe.findLargestExposedRegionOfColor(color);
    if (!region || region.length === 0) return null;

    const rect = this.canvas.getBoundingClientRect();
    const camPos = this.scene.camera.position;
    const scored = region
      .map((b) => {
        const p = this.globe!.positionOf(b.shellId, b.index);
        const local = new THREE.Vector3(p.x, p.y, p.z);
        const world = this.globe!.group.localToWorld(local.clone());
        const normal = local.clone().normalize().transformDirection(this.globe!.group.matrixWorld);
        const toCam = camPos.clone().sub(world).normalize();
        return { b, world, facing: normal.dot(toCam) };
      })
      .filter((s) => s.facing > 0.05)
      .sort((a, c) => c.facing - a.facing);

    for (const s of scored.slice(0, 60)) {
      const ndc = s.world.clone().project(this.scene.camera);
      if (ndc.z > 1 || ndc.z < -1) continue;
      const x = (ndc.x * 0.5 + 0.5) * rect.width + rect.left;
      const y = (1 - (ndc.y * 0.5 + 0.5)) * rect.height + rect.top;
      if (x < rect.left + 2 || x > rect.right - 2 || y < rect.top + 2 || y > rect.bottom - 2) continue;
      const hit = this.pickBead(x, y);
      if (hit && hit.shellId === s.b.shellId && hit.index === s.b.index) return { x, y };
    }
    return null;
  }

  // =============================================================== probe flights

  private launchProbe(color: number, target: THREE.Vector3, onArrive: (obj: THREE.Object3D) => void): void {
    const obj = this.scene.createProbe(color);
    this.scene.scene.add(obj);
    const from = this.scene.launcherPosition();
    obj.position.copy(from);
    this.flights.push({ obj, from: from.clone(), to: target.clone(), t: 0, dur: 0.25, arcHeight: 0.4, onArrive: () => onArrive(obj) });
  }

  private disposeProbeObj(obj: THREE.Object3D): void {
    this.scene.scene.remove(obj);
    this.scene.disposeProbe(obj);
  }

  private updateFlights(dt: number): void {
    for (let i = this.flights.length - 1; i >= 0; i--) {
      const f = this.flights[i];
      f.t += dt;
      const u = Math.min(1, f.t / f.dur);
      const eu = u * u * (3 - 2 * u);
      f.obj.position.lerpVectors(f.from, f.to, eu);
      if (f.arcHeight > 0) f.obj.position.y += Math.sin(u * Math.PI) * f.arcHeight;
      if (u >= 1) {
        this.flights.splice(i, 1);
        f.onArrive();
      }
    }
  }

  // =============================================================== render loop

  private updateInertia(dt: number): void {
    if (this.pointerId !== null || this.cometStart) return;
    if (Math.abs(this.velX) + Math.abs(this.velY) > 1e-4) {
      this.rotateBy(this.velX, this.velY);
      const decay = Math.pow(0.04, dt);
      this.velX *= decay;
      this.velY *= decay;
    }
  }

  private startRenderLoop(): void {
    let last = performance.now();
    const loop = (now: number) => {
      const rawDt = (now - last) / 1000;
      last = now;
      const dt = Math.min(rawDt, 0.05);
      this.updateInertia(dt);
      this.updateFlights(dt);
      this.scene.update(Math.min(rawDt, 0.1));
      // Bead animations are absolute-time-based; let them catch up in one jump after a stalled frame.
      this.globe?.update(Math.min(rawDt, 2));
      this.scene.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

function powerLabel(id: PowerId): string {
  switch (id) {
    case 'meteor':
      return 'Meteor';
    case 'prism':
      return 'Prism';
    case 'solarFlare':
      return 'Solar Flare';
    case 'comet':
      return 'Comet';
  }
}
