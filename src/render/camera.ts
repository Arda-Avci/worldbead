import * as THREE from 'three';
import type { ShotName } from './types';
import { easeInOutCubic } from './easing';
import { PLANET_BODY_RADIUS as BODY_RADIUS } from './planetData';

interface ShotParams {
  position: THREE.Vector3;
  lookAt: THREE.Vector3;
  fov: number;
}

interface Tween {
  from: ShotParams;
  to: ShotParams;
  duration: number;
  elapsed: number;
  resolve: () => void;
}

interface Viewport {
  width: number;
  height: number;
}

/** Space reserved by the HUD (top) and probe dock + power bar (bottom), in CSS px. */
const HUD_TOP_PX = 110;
const DOCK_BOTTOM_PX = 240;
/** Globe diameter as a fraction of the dimension that governs its size. */
const GLOBE_FILL_FRACTION = 0.88;

/**
 * 'gameplay' framing: the globe's on-screen diameter and vertical position
 * are pinned to exact pixel margins (not just FOV/aspect fudge factors) so
 * it always sits centered in the band between the top HUD and the bottom
 * dock, regardless of device size.
 *
 * Portrait: diameter = 88% of viewport width (the width is the constraint;
 * height has the HUD/dock margins to spare). Landscape/desktop: the width
 * is comparatively plentiful, so instead the globe is sized to 88% of the
 * band's *height* ("fit to that vertical space instead").
 *
 * Math: at distance d with vertical FOV fov, the world-space frame half
 * height at that depth is d*tan(fov/2), so a sphere of radius R covers a
 * fraction 2R/(d*tan(fov/2)) of the full frame height. Solving that for d
 * against a target pixel diameter gives the distance; the look-at point is
 * then tilted in Y so the globe (which sits at world Y=0) projects to the
 * vertical center of the HUD/dock band instead of the screen center.
 */
function computeGameplayShot(viewport: Viewport): ShotParams {
  const { width, height } = viewport;
  const aspect = width / Math.max(height, 1);
  const fov = THREE.MathUtils.clamp(48 - aspect * 4, 42, 50);
  const vFov = THREE.MathUtils.degToRad(fov);

  const availableHeight = Math.max(height - HUD_TOP_PX - DOCK_BOTTOM_PX, height * 0.2);
  const isPortrait = width < height;
  const diameterPx = isPortrait ? GLOBE_FILL_FRACTION * width : GLOBE_FILL_FRACTION * availableHeight;

  // Frame full height in world units at distance d is 2*d*tan(vFov/2), so a
  // sphere of world diameter 2R covers pixel diameter
  // R*height/(d*tan(vFov/2)) of that frame; solved for d against the target
  // diameterPx. (No factor of 2 here: it cancels between the sphere's own
  // diameter, 2R, and the frame's full height, 2*d*tan(vFov/2).)
  const d = (BODY_RADIUS * height) / (diameterPx * Math.tan(vFov / 2));

  const bandCenterPx = HUD_TOP_PX + availableHeight / 2;
  const ndcYTarget = 1 - (2 * bandCenterPx) / height;
  const tilt = -ndcYTarget * (vFov / 2);

  return {
    position: new THREE.Vector3(0, 0, d),
    lookAt: new THREE.Vector3(0, d * Math.tan(tilt), 0),
    fov,
  };
}

/**
 * Computes the framing for each named shot. Distances are tuned against
 * screenshots (see report) for a planet body of radius ~0.97.
 */
function computeShot(name: ShotName, viewport: Viewport, sunDir: THREE.Vector3, heroAngle: number): ShotParams {
  switch (name) {
    case 'deepSpace':
      return {
        position: new THREE.Vector3(18, 6, 34),
        lookAt: new THREE.Vector3(0, 0, 0),
        fov: 42,
      };
    case 'sunPass': {
      // Camera sits on the opposite side of the globe from the Sun, looking
      // back through it, so the Sun (and its flare) crosses the frame near
      // the planet rather than sitting directly behind the camera. Since
      // the camera-to-globe distance is tiny next to SUN_DISTANCE, parallax
      // is small and the Sun stays close to the view axis.
      const p = sunDir.clone().multiplyScalar(-12).add(new THREE.Vector3(0.6, 4.2, 0));
      return { position: p, lookAt: new THREE.Vector3(0, 0, 0), fov: 50 };
    }
    case 'approach': {
      // Planet fills ~40% of the frame height, terminator visible.
      const fov = 45;
      const d = BODY_RADIUS / Math.sin(THREE.MathUtils.degToRad((0.4 * fov) / 2));
      return {
        position: new THREE.Vector3(d * 0.3, d * 0.12, d * 0.92),
        lookAt: new THREE.Vector3(0, 0, 0),
        fov,
      };
    }
    case 'gameplay':
      return computeGameplayShot(viewport);
    case 'hero': {
      const fov = 36;
      const d = BODY_RADIUS / Math.sin(THREE.MathUtils.degToRad((0.62 * fov) / 2));
      return {
        position: new THREE.Vector3(Math.sin(heroAngle) * d, d * 0.12, Math.cos(heroAngle) * d),
        lookAt: new THREE.Vector3(0, 0, 0),
        fov,
      };
    }
  }
}

export class CameraRig {
  currentShot: ShotName = 'deepSpace';
  private viewport: Viewport = { width: 390, height: 844 };
  private heroAngle = 0;
  private tween: Tween | null = null;
  private midTransition = false;

  constructor(private readonly camera: THREE.PerspectiveCamera, private readonly getSunDir: () => THREE.Vector3) {
    const shot = computeShot('deepSpace', this.viewport, this.getSunDir(), 0);
    this.apply(shot);
  }

  private apply(shot: ShotParams): void {
    this.camera.position.copy(shot.position);
    this.camera.lookAt(shot.lookAt);
    this.camera.fov = shot.fov;
    this.camera.updateProjectionMatrix();
  }

  /** Viewport size in CSS px, used for pixel-accurate 'gameplay' framing and launcherPosition(). */
  setViewport(width: number, height: number): void {
    this.viewport = { width, height };
    if (!this.midTransition) {
      this.apply(computeShot(this.currentShot, this.viewport, this.getSunDir(), this.heroAngle));
    }
  }

  flyTo(shot: ShotName, seconds: number): Promise<void> {
    return new Promise((resolve) => {
      const from: ShotParams = {
        position: this.camera.position.clone(),
        lookAt: this.currentLookAt(),
        fov: this.camera.fov,
      };
      const to = computeShot(shot, this.viewport, this.getSunDir(), this.heroAngle);
      this.tween = { from, to, duration: Math.max(seconds, 0.0001), elapsed: 0, resolve };
      this.midTransition = true;
      this.currentShot = shot;
    });
  }

  private currentLookAt(): THREE.Vector3 {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    return this.camera.position.clone().add(dir);
  }

  /**
   * World position of the bottom-center probe cannon: horizontally
   * centered, positioned just above the bottom dock (the 240px probe
   * dock + power bar strip) regardless of current shot/viewport.
   */
  launcherPosition(): THREE.Vector3 {
    const { height } = this.viewport;
    const py = height - DOCK_BOTTOM_PX - 16; // just above the dock's top edge
    const ndcY = 1 - (2 * py) / height;
    return new THREE.Vector3(0, ndcY, 0.55).unproject(this.camera);
  }

  update(dt: number): void {
    if (this.currentShot === 'hero' && !this.midTransition) {
      this.heroAngle += dt * 0.12;
      this.apply(computeShot('hero', this.viewport, this.getSunDir(), this.heroAngle));
    }

    if (this.tween) {
      this.tween.elapsed += dt;
      const t = Math.min(this.tween.elapsed / this.tween.duration, 1);
      const e = easeInOutCubic(t);
      const pos = this.tween.from.position.clone().lerp(this.tween.to.position, e);
      const look = this.tween.from.lookAt.clone().lerp(this.tween.to.lookAt, e);
      const fov = THREE.MathUtils.lerp(this.tween.from.fov, this.tween.to.fov, e);
      this.apply({ position: pos, lookAt: look, fov });
      if (t >= 1) {
        const resolve = this.tween.resolve;
        this.tween = null;
        this.midTransition = false;
        resolve();
      }
    }
  }
}
