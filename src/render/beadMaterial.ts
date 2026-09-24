import * as THREE from 'three';

/**
 * Shared glossy pearl bead material. Colored per-instance via
 * InstancedMesh.setColorAt() (instanceColor) — NOT via a per-vertex
 * geometry `color` attribute, and the bead geometry never defines one.
 *
 * IMPORTANT: `vertexColors` must stay false/omitted here. In three.js's
 * WebGLProgram, the vertex shader's `USE_COLOR` define (which multiplies
 * vColor by the geometry's `color` attribute) is driven purely by
 * `material.vertexColors`, independent of whether the geometry actually
 * has that attribute; the fragment shader's `USE_COLOR` (which applies
 * vColor to diffuseColor) is driven by `vertexColors || instancingColor`.
 * So turning on `vertexColors` here — with no geometry `color` attribute
 * to back it — makes the vertex shader multiply every bead's color by an
 * unbound `color` attribute, which WebGL reads as (0,0,0), zeroing
 * `vColor` before the instanceColor multiply ever runs. Every bead then
 * renders solid black (only the unlit clearcoat/specular highlight
 * survives, since that isn't driven by vColor) no matter what the
 * per-instance colors are. Leaving `vertexColors` unset still lets
 * InstancedMesh's `instanceColor` drive both shader stages correctly
 * (verified by inspecting the compiled GLSL): the vertex shader only
 * defines USE_INSTANCING_COLOR (no bogus USE_COLOR/color-attribute
 * multiply), and the fragment shader still gets USE_COLOR from
 * `instancingColor` alone, so `diffuseColor *= vColor` still happens.
 *
 * Tuning history: an earlier version stacked clearcoat(1.0) + sheen(0.6) +
 * iridescence(0.35) + envMapIntensity(1.1) on top of a low roughness
 * (0.28), which was a red herring — the real bug was the vertexColors
 * flag above. Sheen and iridescence are dropped anyway per YAGNI/mobile
 * perf, since they add no visible benefit at bead scale; clearcoat is
 * kept, dialed back, purely for a glossy pearl highlight.
 */
export function createBeadMaterial(envMap: THREE.Texture | null): THREE.MeshPhysicalMaterial {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0.0,
    roughness: 0.4,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    envMap,
    envMapIntensity: 0.6,
  });
  return mat;
}
