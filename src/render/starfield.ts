import * as THREE from 'three';

/**
 * Large equirect sky sphere showing the Milky Way.
 *
 * The shipped `stars_milky_way.jpg` is authored very dark (the galactic
 * band peaks at only a few percent of full brightness, by design so it
 * doesn't blow out next to bright planets/sun), so a plain diffuse sample
 * renders as nearly solid black. A levels-style stretch (clip a low input
 * white point up to full range) recovers the band and stars the way you'd
 * see them boosted in an image editor, then a gentle overall multiplier
 * keeps it "slightly dimmed" rather than blown out.
 */
export function createSkySphere(texture: THREE.Texture): THREE.Mesh {
  texture.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.SphereGeometry(400, 48, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: texture },
      uBoost: { value: 15.0 },
      uDim: { value: 0.9 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      uniform float uBoost;
      uniform float uDim;
      varying vec2 vUv;
      void main() {
        vec3 col = texture2D(uMap, vUv).rgb;
        col = clamp(col * uBoost, 0.0, 1.0) * uDim;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.BackSide,
    fog: false,
    // Skyboxes are shown as-authored: ACES filmic tonemapping would crush
    // this already-dark starfield further.
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = -10;
  return mesh;
}

/** Subtle procedural twinkling star point layer, in front of the sky sphere. */
export function createTwinklingStars(count = 1400): THREE.Points {
  const positions = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    // Uniform points on a large sphere.
    const u = Math.random();
    const v = Math.random();
    const theta = 2 * Math.PI * u;
    const phi = Math.acos(2 * v - 1);
    const r = 380;
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
    phase[i] = Math.random() * Math.PI * 2;
    sizes[i] = 1.2 + Math.random() * 2.2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aPhase;
      attribute float aSize;
      uniform float uTime;
      varying float vTwinkle;
      void main() {
        vTwinkle = 0.55 + 0.45 * sin(uTime * 1.6 + aPhase);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (300.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vTwinkle;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float d = length(c);
        float alpha = smoothstep(0.5, 0.0, d) * vTwinkle;
        gl_FragColor = vec4(vec3(1.0), alpha * 0.85);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const pts = new THREE.Points(geo, mat);
  pts.renderOrder = -9;
  pts.frustumCulled = false;
  return pts;
}

export function updateTwinklingStars(points: THREE.Points, t: number): void {
  (points.material as THREE.ShaderMaterial).uniforms.uTime.value = t;
}
