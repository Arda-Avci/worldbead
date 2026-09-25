// Generative ambient space music. Each planet has a distinct mood built from
// a slow evolving pad (detuned oscillators through a lowpass filter) and a
// sparse arpeggiated bell line, scheduled in fixed-length chunks.
//
// `scheduleMusicChunk` schedules exactly one chunk worth of notes starting at
// an absolute `startTime` and is the single source of truth for the music:
// - The live `MusicLoop` calls it repeatedly, just-in-time, via a look-ahead
//   timer, so chunks are scheduled back to back with sample-accurate timing
//   and the loop has no audible seam.
// - The offline render test calls it directly (with duration = 20s) against
//   an OfflineAudioContext, with no timers involved at all.
import type { PlanetId } from './types';
import { mulberry32, whiteNoiseBuffer } from './dsp';

interface MoodConfig {
  /** Root note in Hz for the pad. */
  root: number;
  /** Chord progression: each chord is a list of semitone offsets from root. */
  chords: number[][];
  /** Scale used by the arpeggio, semitone offsets from root (one octave up). */
  scale: number[];
  padWave: OscillatorType;
  arpWave: OscillatorType;
  padFilterHz: number;
  padDetuneCents: number;
  arpFilterHz: number;
  /** Seconds between arpeggio steps. */
  arpStep: number;
  padLevel: number;
  arpLevel: number;
  /** Probability [0,1] an arpeggio step is skipped, for a sparser feel. */
  arpRestChance: number;
  /** Quiet filtered-noise texture level (0 disables it). */
  noiseLevel: number;
  noiseFilterHz: number;
}

const semitoneToHz = (root: number, semitones: number): number => root * Math.pow(2, semitones / 12);

export const PLANET_MOODS: Record<PlanetId, MoodConfig> = {
  // Warm, hopeful major pad.
  earth: {
    root: 220, // A3
    chords: [
      [0, 4, 7, 11],
      [5, 9, 12, 16],
      [-3, 0, 4, 7],
      [7, 11, 14, 17],
    ],
    scale: [0, 2, 4, 5, 7, 9, 11, 12],
    padWave: 'triangle',
    arpWave: 'sine',
    padFilterHz: 1400,
    padDetuneCents: 6,
    arpFilterHz: 5000,
    arpStep: 0.85,
    padLevel: 0.075,
    arpLevel: 0.05,
    arpRestChance: 0.35,
    noiseLevel: 0,
    noiseFilterHz: 800,
  },
  // Sparse, cold, mostly open fifths and rests.
  moon: {
    root: 330, // E4
    chords: [
      [0, 7, 12],
      [-5, 0, 7],
      [2, 7, 14],
      [0, 7, 12],
    ],
    scale: [0, 2, 5, 7, 10, 12],
    padWave: 'sine',
    arpWave: 'triangle',
    padFilterHz: 2200,
    padDetuneCents: 3,
    arpFilterHz: 6500,
    arpStep: 1.3,
    padLevel: 0.06,
    arpLevel: 0.045,
    arpRestChance: 0.6,
    noiseLevel: 0.012,
    noiseFilterHz: 3000,
  },
  // Thick, hazy, close clusters through a heavy lowpass.
  venus: {
    root: 196, // G3
    chords: [
      [0, 5, 7, 10],
      [3, 8, 10, 15],
      [-2, 3, 7, 10],
      [5, 10, 12, 15],
    ],
    scale: [0, 2, 3, 5, 7, 9, 10, 12],
    padWave: 'sawtooth',
    arpWave: 'triangle',
    padFilterHz: 650,
    padDetuneCents: 14,
    arpFilterHz: 1800,
    arpStep: 1.0,
    padLevel: 0.07,
    arpLevel: 0.035,
    arpRestChance: 0.5,
    noiseLevel: 0.02,
    noiseFilterHz: 500,
  },
  // Dusty, minor, sparse pentatonic arps over a low drone.
  mars: {
    root: 174.61, // F3
    chords: [
      [0, 3, 7],
      [5, 8, 12],
      [8, 12, 15],
      [3, 7, 10],
    ],
    scale: [0, 3, 5, 7, 10, 12],
    padWave: 'sawtooth',
    arpWave: 'sine',
    padFilterHz: 900,
    padDetuneCents: 8,
    arpFilterHz: 3200,
    arpStep: 1.1,
    padLevel: 0.075,
    arpLevel: 0.04,
    arpRestChance: 0.45,
    noiseLevel: 0.018,
    noiseFilterHz: 700,
  },
  // Deep, majestic, slow-moving drone with a wide sparse arp — the 5th cycle body.
  jupiter: {
    root: 130.81, // C3
    chords: [
      [0, 3, 7, 10],
      [-2, 5, 8, 12],
      [3, 7, 10, 14],
      [0, 5, 8, 12],
    ],
    scale: [0, 2, 3, 5, 7, 8, 10, 12],
    padWave: 'sawtooth',
    arpWave: 'triangle',
    padFilterHz: 750,
    padDetuneCents: 10,
    arpFilterHz: 2400,
    arpStep: 1.4,
    padLevel: 0.08,
    arpLevel: 0.03,
    arpRestChance: 0.55,
    noiseLevel: 0.01,
    noiseFilterHz: 400,
  },
};

function hashPlanet(planet: PlanetId): number {
  let h = 0;
  for (let i = 0; i < planet.length; i++) h = (h * 31 + planet.charCodeAt(i)) | 0;
  return h >>> 0;
}

function schedulePad(
  ctx: BaseAudioContext,
  dest: AudioNode,
  mood: MoodConfig,
  chord: number[],
  startTime: number,
  duration: number,
): void {
  const attack = duration * 0.4;
  const release = duration * 0.5;
  const holdEnd = startTime + duration - duration * 0.1;
  const perNoteLevel = mood.padLevel / chord.length;

  chord.forEach((semitone) => {
    const freq = semitoneToHz(mood.root, semitone);
    [-1, 1].forEach((sign) => {
      const osc = ctx.createOscillator();
      osc.type = mood.padWave;
      osc.frequency.setValueAtTime(freq, startTime);
      osc.detune.setValueAtTime(sign * mood.padDetuneCents, startTime);

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(mood.padFilterHz, startTime);
      filter.Q.setValueAtTime(0.4, startTime);

      const gain = ctx.createGain();
      const peak = perNoteLevel * 0.5;
      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), startTime + attack);
      gain.gain.setValueAtTime(Math.max(0.0001, peak), holdEnd);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration + release);
      gain.gain.setValueAtTime(0, startTime + duration + release + 0.05);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(dest);
      osc.start(startTime);
      osc.stop(startTime + duration + release + 0.1);
    });
  });
}

function scheduleArpeggio(
  ctx: BaseAudioContext,
  dest: AudioNode,
  mood: MoodConfig,
  startTime: number,
  duration: number,
  rng: () => number,
): void {
  const steps = Math.floor(duration / mood.arpStep);
  for (let i = 0; i < steps; i++) {
    if (rng() < mood.arpRestChance) continue;
    const t = startTime + i * mood.arpStep;
    const degree = mood.scale[Math.floor(rng() * mood.scale.length)];
    const freq = semitoneToHz(mood.root * 2, degree);

    const osc = ctx.createOscillator();
    osc.type = mood.arpWave;
    osc.frequency.setValueAtTime(freq, t);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(mood.arpFilterHz, t);
    filter.Q.setValueAtTime(0.3, t);

    const gain = ctx.createGain();
    const decay = mood.arpStep * 1.6;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, mood.arpLevel), t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    gain.gain.setValueAtTime(0, t + decay + 0.02);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    osc.start(t);
    osc.stop(t + decay + 0.05);
  }
}

function scheduleTexture(
  ctx: BaseAudioContext,
  dest: AudioNode,
  mood: MoodConfig,
  startTime: number,
  duration: number,
): void {
  if (mood.noiseLevel <= 0) return;
  const src = ctx.createBufferSource();
  src.buffer = whiteNoiseBuffer(ctx, duration + 0.5);
  src.loop = false;

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(mood.noiseFilterHz, startTime);
  filter.Q.setValueAtTime(0.2, startTime);

  const gain = ctx.createGain();
  const fade = Math.min(2, duration * 0.3);
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, mood.noiseLevel), startTime + fade);
  gain.gain.setValueAtTime(Math.max(0.0001, mood.noiseLevel), startTime + duration - fade);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  gain.gain.setValueAtTime(0, startTime + duration + 0.05);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(dest);
  src.start(startTime);
  src.stop(startTime + duration + 0.1);
}

/**
 * Schedules one chunk of generative music for `planet`, starting exactly at
 * `startTime` and lasting `duration` seconds. Deterministic per
 * (planet, chunkIndex) so a live loop and an offline render agree.
 */
export function scheduleMusicChunk(
  ctx: BaseAudioContext,
  dest: AudioNode,
  planet: PlanetId,
  startTime: number,
  duration: number,
  chunkIndex: number,
): void {
  const mood = PLANET_MOODS[planet];
  const rng = mulberry32(hashPlanet(planet) + chunkIndex * 977 + 1);
  const chord = mood.chords[chunkIndex % mood.chords.length];

  schedulePad(ctx, dest, mood, chord, startTime, duration);
  scheduleArpeggio(ctx, dest, mood, startTime, duration, rng);
  scheduleTexture(ctx, dest, mood, startTime, duration);
}

/** Default chunk length (seconds) used by the live look-ahead loop. */
export const MUSIC_CHUNK_DURATION = 8;

/**
 * Look-ahead scheduler that keeps calling `scheduleMusicChunk` just before
 * audio runs out, producing a seamless, indefinite loop on a live
 * AudioContext. Not used for offline rendering (see offline test harness).
 */
export class MusicLoop {
  private readonly ctx: BaseAudioContext;
  private readonly dest: AudioNode;
  private readonly planet: PlanetId;
  private readonly chunkDuration: number;
  private readonly lookahead = 3;
  private readonly intervalMs = 400;
  private timer: ReturnType<typeof setInterval> | undefined;
  private nextChunkTime = 0;
  private chunkIndex = 0;
  private running = false;

  constructor(ctx: BaseAudioContext, dest: AudioNode, planet: PlanetId, chunkDuration = MUSIC_CHUNK_DURATION) {
    this.ctx = ctx;
    this.dest = dest;
    this.planet = planet;
    this.chunkDuration = chunkDuration;
  }

  start(startTime?: number): void {
    if (this.running) return;
    this.running = true;
    this.nextChunkTime = startTime ?? this.ctx.currentTime + 0.05;
    this.chunkIndex = 0;
    this.tick();
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  private tick(): void {
    if (!this.running) return;
    const horizon = this.ctx.currentTime + this.lookahead;
    while (this.nextChunkTime < horizon) {
      scheduleMusicChunk(this.ctx, this.dest, this.planet, this.nextChunkTime, this.chunkDuration, this.chunkIndex);
      this.nextChunkTime += this.chunkDuration;
      this.chunkIndex += 1;
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
