// Synthesis recipes for every SfxName. Each builder takes a BaseAudioContext
// and destination node so it runs identically on a live AudioContext or an
// OfflineAudioContext (used by the headless render test).
import type { PlanetId, SfxName } from './types';
import { playTone, playNoise, jitterCents, stepToHz } from './dsp';
import { PLANET_MOODS } from './music';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Just-intonation ratios reused directly (not via a scale-step) for chordal/arpeggio fx. */
const RATIO_UNISON = 1;
const RATIO_MAJOR_THIRD = 5 / 4;
const RATIO_FIFTH = 3 / 2;
const RATIO_OCTAVE = 2;

/** Picks an ascending scale degree (0 = lowest, 1 = highest) from the current mood's
 * scale, for chain-pop pitches that climb as combos grow. `octave` shifts the whole
 * thing up/down by whole octaves to land in the right register for the effect. */
function moodScaleHz(planet: PlanetId, t: number, octave: number): number {
  const mood = PLANET_MOODS[planet];
  const idx = Math.round(clamp01(t) * (mood.scale.length - 1));
  return stepToHz(mood.root, mood.scale[idx] + octave * 12);
}

function fire(ctx: BaseAudioContext, dest: AudioNode, t: number, intensity: number, planet: PlanetId): number {
  const i = clamp01(intensity);
  const mood = PLANET_MOODS[planet];
  // Airy rising whoosh.
  const d1 = playNoise(ctx, dest, {
    start: t,
    duration: 0.28,
    attack: 0.02,
    decay: 0.24,
    peak: 0.5,
    filterType: 'bandpass',
    freq: 900,
    freqEnd: 3200 + i * 800,
    q: 0.7,
  });
  // Soft laser tone riding underneath, rising an octave from the mood's root.
  const startFreq = stepToHz(mood.root, 12) * (1 + i * 0.15);
  const d2 = playTone(ctx, dest, {
    type: 'sawtooth',
    freq: startFreq,
    freqEnd: startFreq * RATIO_OCTAVE,
    start: t + 0.01,
    attack: 0.01,
    decay: 0.18,
    peak: 0.22,
    release: 0.06,
  });
  return Math.max(d1, d2) + 0.02;
}

function pop(ctx: BaseAudioContext, dest: AudioNode, t: number, intensity: number, planet: PlanetId): number {
  const i = clamp01(intensity);
  // Crisp click transient.
  const d1 = playNoise(ctx, dest, {
    start: t,
    duration: 0.03,
    attack: 0.001,
    decay: 0.025,
    peak: 0.35,
    filterType: 'highpass',
    freq: 2200,
    q: 0.9,
  });
  // Tuned glassy body; climbs the current mood's scale as combos grow.
  const baseFreq = moodScaleHz(planet, i, 2);
  const d2 = playTone(ctx, dest, {
    type: 'triangle',
    freq: baseFreq,
    freqEnd: baseFreq * 0.85,
    start: t,
    attack: 0.003,
    decay: 0.09,
    peak: 0.5,
    detuneCents: jitterCents(18),
    release: 0.03,
  });
  const d3 = playTone(ctx, dest, {
    type: 'sine',
    freq: baseFreq * RATIO_OCTAVE,
    start: t,
    attack: 0.002,
    decay: 0.05,
    peak: 0.18,
    detuneCents: jitterCents(10),
  });
  return Math.max(d1, d2, d3) + 0.02;
}

function bigPop(ctx: BaseAudioContext, dest: AudioNode, t: number, intensity: number, planet: PlanetId): number {
  const i = clamp01(intensity);
  const d1 = playNoise(ctx, dest, {
    start: t,
    duration: 0.05,
    attack: 0.001,
    decay: 0.045,
    peak: 0.32,
    filterType: 'highpass',
    freq: 1500,
    q: 0.8,
  });
  // One octave below `pop`, climbing the same mood scale for combo chains.
  const baseFreq = moodScaleHz(planet, i, 1);
  const d2 = playTone(ctx, dest, {
    type: 'triangle',
    freq: baseFreq,
    freqEnd: baseFreq * 0.7,
    start: t,
    attack: 0.004,
    decay: 0.22,
    peak: 0.38,
    detuneCents: jitterCents(15),
    release: 0.08,
  });
  const d3 = playTone(ctx, dest, {
    type: 'triangle',
    freq: baseFreq * 1.004,
    freqEnd: baseFreq * 0.71,
    start: t,
    attack: 0.004,
    decay: 0.22,
    peak: 0.22,
    detuneCents: jitterCents(15) - 12,
    release: 0.08,
  });
  // Sub thump for weight.
  const d4 = playTone(ctx, dest, {
    type: 'sine',
    freq: 110,
    freqEnd: 60,
    start: t,
    attack: 0.002,
    decay: 0.15,
    peak: 0.25,
  });
  return Math.max(d1, d2, d3, d4) + 0.03;
}

function miss(ctx: BaseAudioContext, dest: AudioNode, t: number): number {
  // Muffled low thud.
  const d1 = playTone(ctx, dest, {
    type: 'sine',
    freq: 130,
    freqEnd: 70,
    start: t,
    attack: 0.004,
    decay: 0.16,
    peak: 0.55,
  });
  const d1b = playNoise(ctx, dest, {
    start: t,
    duration: 0.12,
    attack: 0.005,
    decay: 0.1,
    peak: 0.25,
    filterType: 'lowpass',
    freq: 400,
    q: 0.5,
  });
  // Short ricochet ping.
  const d2 = playTone(ctx, dest, {
    type: 'sine',
    freq: 1900,
    freqEnd: 1400,
    start: t + 0.08,
    attack: 0.002,
    decay: 0.12,
    peak: 0.2,
  });
  return Math.max(d1, d1b, 0.08 + d2) + 0.03;
}

function swap(ctx: BaseAudioContext, dest: AudioNode, t: number, planet: PlanetId): number {
  const mood = PLANET_MOODS[planet];
  const base = mood.root * RATIO_OCTAVE; // one octave up register
  const f1 = base * RATIO_FIFTH;
  const f2 = base * RATIO_MAJOR_THIRD;
  playTone(ctx, dest, {
    type: 'triangle',
    freq: f1,
    freqEnd: f2,
    start: t,
    attack: 0.003,
    decay: 0.07,
    peak: 0.3,
  });
  const d2 = playTone(ctx, dest, {
    type: 'triangle',
    freq: f2,
    freqEnd: base * RATIO_UNISON,
    start: t + 0.05,
    attack: 0.003,
    decay: 0.08,
    peak: 0.28,
  });
  return 0.05 + d2 + 0.02;
}

function powerMeteor(ctx: BaseAudioContext, dest: AudioNode, t: number, intensity: number, planet: PlanetId): number {
  const i = clamp01(intensity);
  const mood = PLANET_MOODS[planet];
  const startFreq = mood.root * 0.5; // sub-bass, half the root
  const d1 = playTone(ctx, dest, {
    type: 'sine',
    freq: startFreq,
    freqEnd: startFreq * (40 / 90),
    start: t,
    attack: 0.01,
    decay: 0.5 + i * 0.2,
    peak: 0.8,
    release: 0.15,
  });
  const d2 = playNoise(ctx, dest, {
    start: t,
    duration: 0.4,
    attack: 0.005,
    decay: 0.35,
    peak: 0.6,
    filterType: 'lowpass',
    freq: 500,
    freqEnd: 120,
    q: 0.6,
  });
  const d3 = playNoise(ctx, dest, {
    start: t,
    duration: 0.02,
    attack: 0.001,
    decay: 0.018,
    peak: 0.3,
    filterType: 'highpass',
    freq: 1800,
  });
  return Math.max(d1, d2, d3) + 0.03;
}

function powerPrism(ctx: BaseAudioContext, dest: AudioNode, t: number, planet: PlanetId): number {
  const mood = PLANET_MOODS[planet];
  // Ascending run through the mood's scale, three octaves up for a bright twinkle.
  const notes = [0, 1, 2, 3, 4, 5].map((i) => {
    const octave = 3 + Math.floor(i / mood.scale.length);
    const degree = mood.scale[i % mood.scale.length];
    return stepToHz(mood.root, degree + octave * 12);
  });
  let maxEnd = 0;
  notes.forEach((f, idx) => {
    const start = t + idx * 0.045;
    const d = playTone(ctx, dest, {
      type: 'sine',
      freq: f,
      start,
      attack: 0.004,
      decay: 0.18,
      peak: 0.18,
      detuneCents: jitterCents(6),
      release: 0.08,
    });
    maxEnd = Math.max(maxEnd, start - t + d);
  });
  return maxEnd + 0.05;
}

function powerFlare(ctx: BaseAudioContext, dest: AudioNode, t: number, planet: PlanetId): number {
  const mood = PLANET_MOODS[planet];
  const d1 = playNoise(ctx, dest, {
    start: t,
    duration: 0.85,
    attack: 0.3,
    decay: 0.5,
    peak: 0.45,
    filterType: 'bandpass',
    freq: 700,
    freqEnd: 2600,
    q: 0.9,
  });
  // Swells one octave up from the mood's root.
  const d2 = playTone(ctx, dest, {
    type: 'sawtooth',
    freq: mood.root,
    freqEnd: mood.root * RATIO_OCTAVE,
    start: t,
    attack: 0.35,
    decay: 0.4,
    peak: 0.3,
    release: 0.15,
  });
  return Math.max(d1, d2) + 0.05;
}

function powerComet(ctx: BaseAudioContext, dest: AudioNode, t: number, planet: PlanetId): number {
  const mood = PLANET_MOODS[planet];
  const d1 = playNoise(ctx, dest, {
    start: t,
    duration: 0.45,
    attack: 0.02,
    decay: 0.4,
    peak: 0.55,
    filterType: 'bandpass',
    freq: 400,
    freqEnd: 4200,
    q: 1.4,
    pan: -0.8,
  });
  // Falling fifth from three octaves up down to one octave up.
  const d2 = playTone(ctx, dest, {
    type: 'sine',
    freq: stepToHz(mood.root, 24 + 7),
    freqEnd: mood.root * RATIO_OCTAVE,
    start: t + 0.03,
    attack: 0.01,
    decay: 0.3,
    peak: 0.2,
    pan: 0.8,
  });
  return Math.max(d1, 0.03 + d2) + 0.03;
}

function unlock(ctx: BaseAudioContext, dest: AudioNode, t: number, planet: PlanetId): number {
  const mood = PLANET_MOODS[planet];
  const base = mood.root * 4; // two octaves up
  const notes = [base * RATIO_UNISON, base * RATIO_MAJOR_THIRD, base * RATIO_FIFTH, base * RATIO_OCTAVE];
  let maxEnd = 0;
  notes.forEach((f, idx) => {
    const start = t + idx * 0.07;
    const d = playTone(ctx, dest, {
      type: 'triangle',
      freq: f,
      start,
      attack: 0.005,
      decay: 0.35,
      peak: 0.22,
      release: 0.15,
      detuneCents: jitterCents(4),
    });
    // Shimmer octave layer.
    playTone(ctx, dest, {
      type: 'sine',
      freq: f * 2,
      start: start + 0.01,
      attack: 0.005,
      decay: 0.3,
      peak: 0.08,
      release: 0.1,
    });
    maxEnd = Math.max(maxEnd, start - t + d);
  });
  return maxEnd + 0.05;
}

function uiTap(ctx: BaseAudioContext, dest: AudioNode, t: number): number {
  const d = playTone(ctx, dest, {
    type: 'triangle',
    freq: 1200,
    freqEnd: 900,
    start: t,
    attack: 0.001,
    decay: 0.045,
    peak: 0.22,
  });
  return d + 0.01;
}

function starGain(ctx: BaseAudioContext, dest: AudioNode, t: number): number {
  const notes = [1318.5, 1760];
  let maxEnd = 0;
  notes.forEach((f, idx) => {
    const start = t + idx * 0.06;
    const d = playTone(ctx, dest, {
      type: 'sine',
      freq: f,
      start,
      attack: 0.003,
      decay: 0.15,
      peak: 0.28,
      release: 0.05,
    });
    maxEnd = Math.max(maxEnd, start - t + d);
  });
  return maxEnd + 0.03;
}

function win(ctx: BaseAudioContext, dest: AudioNode, t: number, planet: PlanetId): number {
  const mood = PLANET_MOODS[planet];
  const base = mood.root * RATIO_OCTAVE;
  const arpeggio = [base * RATIO_UNISON, base * RATIO_MAJOR_THIRD, base * RATIO_FIFTH, base * RATIO_OCTAVE];
  let maxEnd = 0;
  arpeggio.forEach((f, idx) => {
    const start = t + idx * 0.1;
    const d = playTone(ctx, dest, {
      type: 'triangle',
      freq: f,
      start,
      attack: 0.004,
      decay: 0.28,
      peak: 0.32,
      release: 0.12,
    });
    // Shimmer.
    playTone(ctx, dest, {
      type: 'sine',
      freq: f * 2,
      start: start + 0.015,
      attack: 0.004,
      decay: 0.22,
      peak: 0.1,
      release: 0.1,
    });
    maxEnd = Math.max(maxEnd, start - t + d);
  });
  // Final held chord, an octave above the arpeggio's start.
  const chordStart = t + arpeggio.length * 0.1;
  const chordBase = base * RATIO_OCTAVE;
  const chord = [chordBase * RATIO_UNISON, chordBase * RATIO_MAJOR_THIRD, chordBase * RATIO_FIFTH];
  chord.forEach((f) => {
    const d = playTone(ctx, dest, {
      type: 'triangle',
      freq: f,
      start: chordStart,
      attack: 0.01,
      decay: 0.4,
      peak: 0.22,
      release: 0.3,
    });
    maxEnd = Math.max(maxEnd, chordStart - t + d);
  });
  return maxEnd + 0.05;
}

function lose(ctx: BaseAudioContext, dest: AudioNode, t: number, planet: PlanetId): number {
  // Gentle descending phrase, soft timbre, in the current mood's key.
  const mood = PLANET_MOODS[planet];
  const base = mood.root * RATIO_OCTAVE;
  const steps = [0, -2, -4, -7];
  const notes = steps.map((step) => stepToHz(base, step));
  let maxEnd = 0;
  notes.forEach((f, idx) => {
    const start = t + idx * 0.26;
    const d = playTone(ctx, dest, {
      type: 'sine',
      freq: f,
      start,
      attack: 0.05,
      decay: 0.3,
      peak: 0.24,
      release: 0.35,
    });
    maxEnd = Math.max(maxEnd, start - t + d);
  });
  return maxEnd + 0.05;
}

function warp(ctx: BaseAudioContext, dest: AudioNode, t: number): number {
  const d1 = playNoise(ctx, dest, {
    start: t,
    duration: 0.9,
    attack: 0.05,
    decay: 0.8,
    peak: 0.5,
    filterType: 'bandpass',
    freq: 300,
    freqEnd: 5000,
    q: 1.1,
  });
  // Sub drop at the end.
  const d2 = playTone(ctx, dest, {
    type: 'sine',
    freq: 220,
    freqEnd: 35,
    start: t + 0.55,
    attack: 0.02,
    decay: 0.5,
    peak: 0.7,
    release: 0.1,
  });
  return Math.max(d1, 0.55 + d2) + 0.05;
}

/**
 * Builds a sound effect graph starting at `startTime` on `ctx`, connected to
 * `dest`. Works with a live AudioContext or an OfflineAudioContext.
 * Returns the estimated duration in seconds.
 */
export function buildSfx(
  ctx: BaseAudioContext,
  dest: AudioNode,
  name: SfxName,
  startTime: number,
  intensity: number,
  planet: PlanetId = 'earth',
): number {
  switch (name) {
    case 'fire':
      return fire(ctx, dest, startTime, intensity, planet);
    case 'pop':
      return pop(ctx, dest, startTime, intensity, planet);
    case 'bigPop':
      return bigPop(ctx, dest, startTime, intensity, planet);
    case 'miss':
      return miss(ctx, dest, startTime);
    case 'swap':
      return swap(ctx, dest, startTime, planet);
    case 'powerMeteor':
      return powerMeteor(ctx, dest, startTime, intensity, planet);
    case 'powerPrism':
      return powerPrism(ctx, dest, startTime, planet);
    case 'powerFlare':
      return powerFlare(ctx, dest, startTime, planet);
    case 'powerComet':
      return powerComet(ctx, dest, startTime, planet);
    case 'unlock':
      return unlock(ctx, dest, startTime, planet);
    case 'uiTap':
      return uiTap(ctx, dest, startTime);
    case 'starGain':
      return starGain(ctx, dest, startTime);
    case 'win':
      return win(ctx, dest, startTime, planet);
    case 'lose':
      return lose(ctx, dest, startTime, planet);
    case 'warp':
      return warp(ctx, dest, startTime);
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown SfxName: ${exhaustive}`);
    }
  }
}
