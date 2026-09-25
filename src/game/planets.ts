/** Planet metadata: display name, HUD background gradient, and source texture files. */

export type PlanetId = 'earth' | 'moon' | 'venus' | 'mars' | 'jupiter';

export interface PlanetDef {
  id: PlanetId;
  name: string;
  /** CSS background gradient [top, bottom]. */
  background: [string, string];
  /** Filename under `public/textures/` (no extension) for the equirectangular surface map. */
  surfaceTexture: string;
  /** Cloud texture filename, if this planet has a cloud shell painted from a real texture. */
  cloudTexture: string | null;
}

export const PLANETS: Record<PlanetId, PlanetDef> = {
  earth: { id: 'earth', name: 'Earth', background: ['#1a6fc9', '#0b2a5a'], surfaceTexture: 'earth_daymap', cloudTexture: 'earth_clouds' },
  moon: { id: 'moon', name: 'Moon', background: ['#2b2f3a', '#07080c'], surfaceTexture: 'moon', cloudTexture: null },
  venus: { id: 'venus', name: 'Venus', background: ['#7a4a12', '#2a1403'], surfaceTexture: 'venus_surface', cloudTexture: null },
  mars: { id: 'mars', name: 'Mars', background: ['#8a2f14', '#2a0b05'], surfaceTexture: 'mars', cloudTexture: null },
  // 5th cycle slot (item #15): no bundled real Jupiter texture, so both the bead
  // surface (`generateJupiterBands` in texture.ts) and the revealed planet body
  // (`planetBody.ts`) paint it procedurally in-canvas — no network download.
  jupiter: { id: 'jupiter', name: 'Jupiter', background: ['#c9a06a', '#4a3216'], surfaceTexture: 'jupiter', cloudTexture: null },
};
