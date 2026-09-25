// Local type definitions for the audio module.
// Per module contract, this module must not import types from other folders.

/** Chapters/planets the game visits, in play order. */
export type PlanetId = 'earth' | 'moon' | 'venus' | 'mars' | 'jupiter';

/** All sound effect names the game can trigger. */
export type SfxName =
  | 'fire'
  | 'pop'
  | 'bigPop'
  | 'miss'
  | 'swap'
  | 'powerMeteor'
  | 'powerPrism'
  | 'powerFlare'
  | 'powerComet'
  | 'unlock'
  | 'uiTap'
  | 'starGain'
  | 'win'
  | 'lose'
  | 'warp';
