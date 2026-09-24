// Synthesis recipes for every SfxName. Each builder takes a BaseAudioContext
// and destination node so it runs identically on a live AudioContext or an
// OfflineAudioContext (used by the headless render test).
import type { SfxName } from './types';
import { playTone, playNoise, jitterCents } from './dsp';

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function fire(ctx: BaseAudioContext, dest: AudioNode, t: number, intensity: number): number {
  const i = clamp01(intensity);
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
  // Soft laser tone riding underneath.
  const d2 = playTone(ctx, dest, {
    type: 'sawtooth',
    freq: 520 + i * 120,
    freqEnd: 980 + i * 200,
    start: t + 0.01,
    attack: 0.01,
    decay: 0.18,
    peak: 0.22,
    release: 0.06,
  });
  return Math.max(d1, d2) + 0.02;
}

function pop(ctx: BaseAudioContext, dest: AudioNode, t: number, intensity: number): number {
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
  // Tuned glassy body; pitch rises slightly with region size (intensity).
  const baseFreq = 780 * (1 + i * 0.5);
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
    freq: baseFreq * 2.01,
    start: t,
    attack: 0.002,
    decay: 0.05,
    peak: 0.18,
    detuneCents: jitterCents(10),
  });
  return Math.max(d1, d2, d3) + 0.02;
}

function bigPop(ctx: BaseAudioContext, dest: AudioNode, t: number, intensity: number): number {
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
  const baseFreq = 380 * (1 + i * 0.4);
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

function swap(ctx: BaseAudioContext, dest: AudioNode, t: number): number {
  playTone(ctx, dest, {
    type: 'triangle',
    freq: 500,
    freqEnd: 760,
    start: t,
    attack: 0.003,
    decay: 0.07,
    peak: 0.3,
  });
  const d2 = playTone(ctx, dest, {
    type: 'triangle',
    freq: 760,
    freqEnd: 560,
    start: t + 0.05,
    attack: 0.003,
    decay: 0.08,
    peak: 0.28,
  });
  return 0.05 + d2 + 0.02;
}

function powerMeteor(ctx: BaseAudioContext, dest: AudioNode, t: number, intensity: number): number {
  const i = clamp01(intensity);
  const d1 = playTone(ctx, dest, {
    type: 'sine',
    freq: 90,
    freqEnd: 40,
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

function powerPrism(ctx: BaseAudioContext, dest: AudioNode, t: number): number {
  const notes = [1046.5, 1318.5, 1568, 1864.7, 2093, 2637];
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

function powerFlare(ctx: BaseAudioContext, dest: AudioNode, t: number): number {
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
  const d2 = playTone(ctx, dest, {
    type: 'sawtooth',
    freq: 220,
    freqEnd: 440,
    start: t,
    attack: 0.35,
    decay: 0.4,
    peak: 0.3,
    release: 0.15,
  });
  return Math.max(d1, d2) + 0.05;
}

function powerComet(ctx: BaseAudioContext, dest: AudioNode, t: number): number {
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
  const d2 = playTone(ctx, dest, {
    type: 'sine',
    freq: 1800,
    freqEnd: 500,
    start: t + 0.03,
    attack: 0.01,
    decay: 0.3,
    peak: 0.2,
    pan: 0.8,
  });
  return Math.max(d1, 0.03 + d2) + 0.03;
}

function unlock(ctx: BaseAudioContext, dest: AudioNode, t: number): number {
  const notes = [880, 1108.7, 1318.5, 1760];
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

function win(ctx: BaseAudioContext, dest: AudioNode, t: number): number {
  const arpeggio = [523.25, 659.25, 783.99, 1046.5];
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
  // Final held chord.
  const chordStart = t + arpeggio.length * 0.1;
  const chord = [1046.5, 1318.5, 1568];
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

function lose(ctx: BaseAudioContext, dest: AudioNode, t: number): number {
  // Gentle descending minor phrase, soft timbre.
  const notes = [523.25, 466.16, 415.3, 349.23];
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
): number {
  switch (name) {
    case 'fire':
      return fire(ctx, dest, startTime, intensity);
    case 'pop':
      return pop(ctx, dest, startTime, intensity);
    case 'bigPop':
      return bigPop(ctx, dest, startTime, intensity);
    case 'miss':
      return miss(ctx, dest, startTime);
    case 'swap':
      return swap(ctx, dest, startTime);
    case 'powerMeteor':
      return powerMeteor(ctx, dest, startTime, intensity);
    case 'powerPrism':
      return powerPrism(ctx, dest, startTime);
    case 'powerFlare':
      return powerFlare(ctx, dest, startTime);
    case 'powerComet':
      return powerComet(ctx, dest, startTime);
    case 'unlock':
      return unlock(ctx, dest, startTime);
    case 'uiTap':
      return uiTap(ctx, dest, startTime);
    case 'starGain':
      return starGain(ctx, dest, startTime);
    case 'win':
      return win(ctx, dest, startTime);
    case 'lose':
      return lose(ctx, dest, startTime);
    case 'warp':
      return warp(ctx, dest, startTime);
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown SfxName: ${exhaustive}`);
    }
  }
}
