import * as THREE from 'three';
import { SpaceScene } from './SpaceScene';
import type { PlanetId, ShotName } from './types';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const statusEl = document.querySelector('[data-status]') as HTMLDivElement;
const scene = new SpaceScene(canvas);
const urlParams = new URLSearchParams(window.location.search);

function fibonacciSphere(count: number, radius: number): THREE.Vector3[] {
  const pts: THREE.Vector3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = golden * i;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    pts.push(new THREE.Vector3(x, y, z).multiplyScalar(radius));
  }
  return pts;
}

// ?beads=500 switches to a smaller, larger-radius set for close-up material
// inspection; default matches the ~3000-bead gameplay density.
const BEAD_COUNT = Number(urlParams.get('beads')) || 3000;
const BEAD_RADIUS = BEAD_COUNT <= 800 ? 0.045 : 0.014;
const beadGeo = new THREE.SphereGeometry(BEAD_RADIUS, 12, 9);
const beadMesh = new THREE.InstancedMesh(beadGeo, scene.beadMaterial, BEAD_COUNT);
const dummy = new THREE.Object3D();
const beadDirs = fibonacciSphere(BEAD_COUNT, 1.0);
// 8 clearly distinct hues (no white/black) so instance-color readability is
// easy to judge at a glance.
const palette = [0xff4d4d, 0xff9f1c, 0xffe066, 0x4dd67a, 0x2ec4c4, 0x3d8bff, 0xa06bff, 0xff5cc9];
for (let i = 0; i < BEAD_COUNT; i++) {
  const p = beadDirs[i];
  dummy.position.copy(p);
  dummy.lookAt(p.clone().multiplyScalar(2));
  dummy.updateMatrix();
  beadMesh.setMatrixAt(i, dummy.matrix);
  beadMesh.setColorAt(i, new THREE.Color(palette[i % palette.length]));
}
beadMesh.instanceMatrix.needsUpdate = true;
if (beadMesh.instanceColor) beadMesh.instanceColor.needsUpdate = true;
scene.globe.add(beadMesh);

let shots = 0;
let probesActive = 0;
let bodyRevealed = true;

function setStatus(): void {
  statusEl.textContent = `shots=${shots} probes=${probesActive} shot=${currentShot}`;
}

let currentShot: ShotName = 'deepSpace';

async function goShot(name: ShotName): Promise<void> {
  currentShot = name;
  setStatus();
  await scene.flyTo(name, 1.4);
  shots++;
  setStatus();
}

async function goPlanet(id: PlanetId): Promise<void> {
  statusEl.textContent = `loading ${id}...`;
  await scene.loadPlanet(id);
  setStatus();
}

function doBurst(): void {
  const dir = beadDirs[Math.floor(Math.random() * BEAD_COUNT)];
  const worldPos = scene.globe.localToWorld(dir.clone());
  scene.burst(worldPos, palette[Math.floor(Math.random() * palette.length)], 1.2);
}

function doProbe(): void {
  const color = palette[Math.floor(Math.random() * palette.length)];
  const probe = scene.createProbe(color);
  scene.scene.add(probe);
  const start = scene.launcherPosition();
  const targetDir = beadDirs[Math.floor(Math.random() * BEAD_COUNT)];
  const target = scene.globe.localToWorld(targetDir.clone());
  probe.position.copy(start);
  probesActive++;
  setStatus();
  const duration = 550;
  const t0 = performance.now();
  function step(): void {
    const t = Math.min((performance.now() - t0) / duration, 1);
    probe.position.lerpVectors(start, target, t);
    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      scene.burst(target, color, 1);
      scene.scene.remove(probe);
      scene.disposeProbe(probe);
      probesActive--;
      setStatus();
    }
  }
  requestAnimationFrame(step);
}

function doWarp(): void {
  scene.warp(1.6);
}

function doShake(): void {
  scene.shake(0.06);
}

function doReveal(): void {
  bodyRevealed = !bodyRevealed;
  scene.setBodyRevealed(bodyRevealed);
}

document.querySelectorAll<HTMLButtonElement>('[data-planet]').forEach((b) =>
  b.addEventListener('click', () => goPlanet(b.dataset.planet as PlanetId)),
);
document.querySelectorAll<HTMLButtonElement>('[data-shot]').forEach((b) =>
  b.addEventListener('click', () => goShot(b.dataset.shot as ShotName)),
);
document.querySelector('[data-action="burst"]')?.addEventListener('click', doBurst);
document.querySelector('[data-action="probe"]')?.addEventListener('click', doProbe);
document.querySelector('[data-action="warp"]')?.addEventListener('click', doWarp);
document.querySelector('[data-action="shake"]')?.addEventListener('click', doShake);
document.querySelector('[data-action="reveal"]')?.addEventListener('click', doReveal);

window.addEventListener('resize', () => scene.resize());

async function init(): Promise<void> {
  const params = urlParams;
  const planet = (params.get('planet') as PlanetId) || 'earth';
  await goPlanet(planet);
  const shotParam = params.get('shot');
  if (shotParam === 'closeup') {
    // Debug-only framing (not one of SpaceScene's named shots): parks the
    // camera just above the bead shell for material/color QA screenshots.
    currentShot = 'gameplay';
    const dir = new THREE.Vector3(0.35, 0.45, 1).normalize();
    scene.camera.position.copy(dir.multiplyScalar(2.1));
    scene.camera.lookAt(0, 0, 0);
    scene.camera.fov = 45;
    scene.camera.updateProjectionMatrix();
    shots++;
  } else {
    await goShot((shotParam as ShotName) || 'gameplay');
  }
  if (params.get('burst') === '1') doBurst();
  if (params.get('probe') === '1') doProbe();
  if (params.get('warp') === '1') doWarp();
  if (params.get('shake') === '1') doShake();
  statusEl.setAttribute('data-ready', '1');
  setStatus();
}

let last = performance.now();
function tick(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  scene.update(dt);
  scene.render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

init();
