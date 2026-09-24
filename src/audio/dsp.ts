// Small synthesis helpers shared by sfx.ts and music.ts.
// Every helper takes a BaseAudioContext so the exact same code path can run
// against a live AudioContext or an OfflineAudioContext (for headless testing).

export type OscType = OscillatorType; // 'sine' | 'square' | 'sawtooth' | 'triangle'

/** Deterministic 32-bit PRNG (mulberry32). Used only for generative music
 * patterns so a given chunk index always produces the same notes. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const noiseBufferCache = new WeakMap<BaseAudioContext, Map<number, AudioBuffer>>();

/** White noise buffer, cached per-context so repeated clicks/whooshes are cheap. */
export function whiteNoiseBuffer(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const key = Math.ceil(seconds * 1000);
  let cache = noiseBufferCache.get(ctx);
  if (!cache) {
    cache = new Map();
    noiseBufferCache.set(ctx, cache);
  }
  const cached = cache.get(key);
  if (cached) return cached;
  const length = Math.max(1, Math.ceil(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  cache.set(key, buffer);
  return buffer;
}

export interface ToneOpts {
  type: OscType;
  freq: number;
  freqEnd?: number;
  start: number;
  attack?: number;
  decay: number;
  /** Sustain level as a fraction of peak, held between attack and release. */
  sustain?: number;
  sustainTime?: number;
  release?: number;
  peak: number;
  detuneCents?: number;
  pan?: number;
}

/** A single oscillator voice with an attack/decay/sustain/release envelope. */
export function playTone(ctx: BaseAudioContext, dest: AudioNode, opts: ToneOpts): number {
  const attack = opts.attack ?? 0.005;
  const sustain = opts.sustain ?? 0;
  const sustainTime = opts.sustainTime ?? 0;
  const release = opts.release ?? 0;
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.freq, opts.start);
  if (opts.freqEnd !== undefined && opts.freqEnd !== opts.freq) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, opts.freqEnd), opts.start + opts.decay + sustainTime);
  }
  if (opts.detuneCents) osc.detune.setValueAtTime(opts.detuneCents, opts.start);

  const gain = ctx.createGain();
  const peak = opts.peak;
  const t0 = opts.start;
  const tAttackEnd = t0 + attack;
  const tSustainEnd = tAttackEnd + opts.decay + sustainTime;
  const tRelease = tSustainEnd + release;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), tAttackEnd);
  if (sustain > 0 && sustainTime > 0) {
    gain.gain.setValueAtTime(Math.max(0.0001, peak), tAttackEnd + opts.decay);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * sustain), tSustainEnd);
  } else {
    gain.gain.exponentialRampToValueAtTime(0.0001, tSustainEnd);
  }
  if (release > 0) {
    gain.gain.exponentialRampToValueAtTime(0.0001, tRelease);
  }
  gain.gain.setValueAtTime(0, tRelease + 0.02);

  let outNode: AudioNode = gain;
  if (opts.pan !== undefined && 'createStereoPanner' in ctx) {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(opts.pan, t0);
    gain.connect(panner);
    outNode = panner;
  }

  osc.connect(gain);
  outNode.connect(dest);
  osc.start(t0);
  osc.stop(tRelease + 0.05);
  return tRelease - t0;
}

export interface NoiseOpts {
  start: number;
  duration: number;
  attack?: number;
  decay: number;
  peak: number;
  filterType?: BiquadFilterType;
  freq: number;
  freqEnd?: number;
  q?: number;
  pan?: number;
}

/** A filtered noise burst (clicks, whooshes, ricochets, dust). */
export function playNoise(ctx: BaseAudioContext, dest: AudioNode, opts: NoiseOpts): number {
  const src = ctx.createBufferSource();
  src.buffer = whiteNoiseBuffer(ctx, opts.start + opts.duration + 0.5 <= 4 ? 4 : opts.duration + 0.5);
  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType ?? 'bandpass';
  filter.Q.setValueAtTime(opts.q ?? 1, opts.start);
  filter.frequency.setValueAtTime(opts.freq, opts.start);
  if (opts.freqEnd !== undefined && opts.freqEnd !== opts.freq) {
    filter.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), opts.start + opts.duration);
  }

  const gain = ctx.createGain();
  const attack = opts.attack ?? 0.002;
  const t0 = opts.start;
  const tAttackEnd = t0 + attack;
  const tEnd = tAttackEnd + opts.decay;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, opts.peak), tAttackEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, tEnd);
  gain.gain.setValueAtTime(0, tEnd + 0.02);

  let outNode: AudioNode = gain;
  if (opts.pan !== undefined && 'createStereoPanner' in ctx) {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(opts.pan, t0);
    gain.connect(panner);
    outNode = panner;
  }

  src.connect(filter);
  filter.connect(gain);
  outNode.connect(dest);
  src.start(t0);
  src.stop(tEnd + 0.1);
  return tEnd - t0;
}

/** Random detune in cents within +/-range, for "no two pops sound identical". */
export function jitterCents(range = 20): number {
  return (Math.random() * 2 - 1) * range;
}

// Just-intonation ratios for each of the 12 chromatic scale steps, favoring
// low-integer, low-beat consonances (1, 9/8, 5/4, 4/3, 3/2, 5/3, 2, ...) over
// 12-TET semitone ratios (2^(n/12)). Shared by music.ts (pads/arps) and
// sfx.ts (pitched sound effects) so both stay in the same "key" per mood.
export const JUST_RATIOS = [
  1, // 0: unison
  16 / 15, // 1: minor second
  9 / 8, // 2: major second
  6 / 5, // 3: minor third
  5 / 4, // 4: major third
  4 / 3, // 5: perfect fourth
  45 / 32, // 6: tritone
  3 / 2, // 7: perfect fifth
  8 / 5, // 8: minor sixth
  5 / 3, // 9: major sixth
  9 / 5, // 10: minor seventh
  15 / 8, // 11: major seventh
];

/** Converts a scale-step offset (may be negative or span several octaves) to a just-intonation ratio. */
export function stepToRatio(step: number): number {
  const octave = Math.floor(step / 12);
  const rem = ((step % 12) + 12) % 12;
  return JUST_RATIOS[rem] * Math.pow(2, octave);
}

/** Converts a scale-step offset from `root` (Hz) to a just-intonation frequency. */
export function stepToHz(root: number, step: number): number {
  return root * stepToRatio(step);
}
