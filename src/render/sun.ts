import * as THREE from 'three';
import { Lensflare, LensflareElement } from 'three/examples/jsm/objects/Lensflare.js';

export const SUN_DISTANCE = 220;

/** Small emissive sphere textured with sun.jpg, placed far away along the sun direction. */
export function createSunMesh(sunTexture: THREE.Texture): THREE.Mesh {
  sunTexture.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.SphereGeometry(6, 32, 24);
  const mat = new THREE.MeshBasicMaterial({ map: sunTexture, color: 0xffffff, toneMapped: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -8;
  return mesh;
}

function radialTexture(inner: string, outer: string, size = 256): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, inner);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function ringTexture(color: string, size = 128): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.08;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - ctx.lineWidth, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Large soft additive glow sprite around the Sun disc. Lensflare's
 * occlusion query already gives the streak/ghost elements; this sprite
 * guarantees the Sun itself always reads as a radiant light source (its
 * visibility isn't gated on a depth-readback occlusion test), and it
 * blooms naturally since it is bright and unaffected by tone mapping.
 */
export function createSunGlow(): THREE.Sprite {
  const tex = radialTexture('rgba(255,250,235,1)', 'rgba(255,190,90,0)');
  const mat = new THREE.SpriteMaterial({
    map: tex,
    color: 0xffe9c2,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    opacity: 0.9,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.setScalar(34);
  return sprite;
}

/** Procedurally generated lens flare (no external flare textures). */
export function createSunLensflare(): Lensflare {
  const flare = new Lensflare();
  const main = radialTexture('rgba(255,255,240,1)', 'rgba(255,200,120,0)');
  const halo = radialTexture('rgba(255,220,180,0.9)', 'rgba(255,180,80,0)');
  const ring = ringTexture('rgba(180,220,255,0.7)');
  const dot = radialTexture('rgba(200,230,255,1)', 'rgba(120,160,255,0)');

  flare.addElement(new LensflareElement(main, 480, 0, new THREE.Color(0xffffff)));
  flare.addElement(new LensflareElement(halo, 180, 0.05, new THREE.Color(0xffd9a0)));
  flare.addElement(new LensflareElement(dot, 40, 0.35, new THREE.Color(0xbcd8ff)));
  flare.addElement(new LensflareElement(ring, 70, 0.55, new THREE.Color(0x88aaff)));
  flare.addElement(new LensflareElement(dot, 20, 0.7, new THREE.Color(0xffffff)));
  flare.addElement(new LensflareElement(ring, 100, 0.9, new THREE.Color(0x5588ff)));
  flare.addElement(new LensflareElement(dot, 60, 1.0, new THREE.Color(0xaad4ff)));

  return flare;
}
