import * as THREE from 'three';

/**
 * Patches a MeshStandardMaterial (Earth's day map) so that:
 *  - the night map (city lights) shows only on the side facing away from
 *    the sun, added on top of the day diffuse rather than replacing it;
 *  - an ocean mask derived at runtime from the day map's blue-dominant
 *    pixels lowers roughness there, giving the oceans a specular sheen
 *    with no dedicated specular texture.
 * `uSunDirView` must be updated every frame with the sun direction
 * transformed into view space (see SpaceScene.update).
 */
export function applyEarthDayNightPatch(material: THREE.MeshStandardMaterial, nightMap: THREE.Texture): void {
  const uniforms = {
    uNightMap: { value: nightMap },
    uSunDirView: { value: new THREE.Vector3(1, 0, 0) },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    (material as any).userData.shaderRef = shader;

    shader.fragmentShader =
      `uniform sampler2D uNightMap;\nuniform vec3 uSunDirView;\nfloat oceanMask;\n` + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#include <map_fragment>
  {
    vec3 nightCol = texture2D( uNightMap, vMapUv ).rgb;
    float cityLuma = dot( nightCol, vec3( 0.299, 0.587, 0.114 ) );
    float sunDot = dot( normalize( vNormal ), normalize( uSunDirView ) );
    float nightMix = smoothstep( 0.2, -0.15, sunDot );
    oceanMask = clamp( diffuseColor.b - max( diffuseColor.r, diffuseColor.g ) * 1.15, 0.0, 1.0 );
    diffuseColor.rgb += nightCol * cityLuma * nightMix * 2.2;
  }`,
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <roughnessmap_fragment>',
      `#include <roughnessmap_fragment>
  roughnessFactor = mix( roughnessFactor, 0.12, oceanMask );`,
    );
  };
  material.customProgramCacheKey = () => 'earth-day-night-ocean';
}

/** Updates the sun-direction-in-view-space uniform used by the Earth shader patch. */
export function updateEarthSunDir(material: THREE.MeshStandardMaterial, sunDirWorld: THREE.Vector3, camera: THREE.Camera): void {
  const shader = (material as any).userData.shaderRef as THREE.WebGLProgramParametersWithUniforms | undefined;
  if (!shader) return;
  const v = sunDirWorld.clone().transformDirection(camera.matrixWorldInverse).normalize();
  (shader.uniforms.uSunDirView.value as THREE.Vector3).copy(v);
}

/** Fresnel rim-glow atmosphere shell, shared by all planets (color/intensity differ per planet). */
export function createAtmosphereMaterial(color: number, intensity: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vViewDirW;
      void main() {
        vec4 worldPos = modelMatrix * vec4(position, 1.0);
        vNormalW = normalize(mat3(modelMatrix) * normal);
        vViewDirW = normalize(cameraPosition - worldPos.xyz);
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec3 vNormalW;
      varying vec3 vViewDirW;
      void main() {
        float fresnel = pow(1.0 - clamp(dot(normalize(vNormalW), normalize(vViewDirW)), 0.0, 1.0), 2.6);
        gl_FragColor = vec4(uColor, fresnel * uIntensity);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.FrontSide,
  });
}

/** Drifting semi-transparent cloud shell (Earth). UV offset animates via uTime. */
export function createCloudMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    map,
    transparent: true,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
    alphaMap: map,
    blending: THREE.NormalBlending,
  });
  const uniforms = { uTime: { value: 0 } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    (mat as any).userData.shaderRef = shader;
    shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
  vMapUv.x += uTime * 0.006;`,
    );
  };
  mat.customProgramCacheKey = () => 'earth-clouds-drift';
  return mat;
}

export function updateCloudDrift(material: THREE.MeshStandardMaterial, t: number): void {
  const shader = (material as any).userData.shaderRef as THREE.WebGLProgramParametersWithUniforms | undefined;
  if (!shader) return;
  shader.uniforms.uTime.value = t;
}

/**
 * Procedural thick cream cloud envelope for Venus (no atmosphere texture
 * was available to download, see report). Uses layered sine noise bands
 * that drift over time, lit by a simple sun-facing term.
 */
export function createVenusCloudMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDirView: { value: new THREE.Vector3(1, 0, 0) },
      uColor: { value: new THREE.Color(0xf5e3b8) },
      uShadeColor: { value: new THREE.Color(0x9c7d4a) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormalV;
      void main() {
        vUv = uv;
        vNormalV = normalize(normalMatrix * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDirView;
      uniform vec3 uColor;
      uniform vec3 uShadeColor;
      varying vec2 vUv;
      varying vec3 vNormalV;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        float a = hash(i), b = hash(i + vec2(1.0, 0.0));
        float c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }
      float fbm(vec2 p) {
        float v = 0.0, amp = 0.5;
        for (int i = 0; i < 5; i++) { v += amp * noise(p); p *= 2.02; amp *= 0.55; }
        return v;
      }
      void main() {
        vec2 p = vec2(vUv.x * 6.0 + uTime * 0.02, vUv.y * 3.0);
        float bands = fbm(p) * 0.7 + fbm(p * 2.3 + 4.0) * 0.3;
        float sunDot = clamp(dot(normalize(vNormalV), normalize(uSunDirView)), 0.0, 1.0);
        vec3 col = mix(uShadeColor, uColor, sunDot * 0.8 + 0.2);
        col = mix(col, col * 1.15, bands);
        float alpha = 0.82 + bands * 0.16;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.98));
      }
    `,
    transparent: true,
    depthWrite: false,
  });
}
