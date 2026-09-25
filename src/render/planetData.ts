import type { PlanetId } from './types';

export interface PlanetDef {
  /** Diffuse/day texture, always present. */
  map: string;
  /** City-light night texture (Earth only). */
  nightMap?: string;
  /** Separate drifting cloud shell texture (Earth only; Venus is procedural). */
  cloudsMap?: string;
  /** Fresnel rim-glow atmosphere color. */
  atmosphereColor: number;
  /** Rim glow strength, 0 = effectively none (Moon). */
  atmosphereIntensity: number;
  /** Venus-style thick procedural cream cloud envelope. */
  thickClouds?: boolean;
  /** True for a planet with no bundled real texture: `map` is ignored and the body is painted in-canvas instead (item #15's 5th cycle body). */
  proceduralBands?: boolean;
}

export const PLANET_DATA: Record<PlanetId, PlanetDef> = {
  earth: {
    map: 'textures/earth_daymap.jpg',
    nightMap: 'textures/earth_nightmap.jpg',
    cloudsMap: 'textures/earth_clouds.jpg',
    atmosphereColor: 0x4da6ff,
    atmosphereIntensity: 1.0,
  },
  moon: {
    map: 'textures/moon.jpg',
    atmosphereColor: 0x9aa4b2,
    atmosphereIntensity: 0.08,
  },
  venus: {
    map: 'textures/venus_surface.jpg',
    atmosphereColor: 0xe0b878,
    // Was 1.1 (the highest of any planet) — stacked with Venus's own bright cream/tan bead
    // palette and shared bloom pass, its Fresnel rim glow was blowing the whole globe out to a
    // featureless white blob (owner bug report). Also darkened the glow color itself a shade
    // (was a near-white f2d9a0) so it contributes less raw brightness on top of the beads.
    atmosphereIntensity: 0.45,
    thickClouds: true,
  },
  mars: {
    map: 'textures/mars.jpg',
    atmosphereColor: 0xe08a5a,
    atmosphereIntensity: 0.45,
  },
  jupiter: {
    map: '', // unused — proceduralBands paints the body in-canvas instead (no bundled texture)
    atmosphereColor: 0xd9b98a,
    atmosphereIntensity: 0.6,
    proceduralBands: true,
  },
};

export const PLANET_BODY_RADIUS = 0.97;
