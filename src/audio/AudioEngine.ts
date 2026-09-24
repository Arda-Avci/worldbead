// Public entry point of the audio module. See docs/GDD.md §6 for the
// contract this class implements. Fully procedural WebAudio, no audio files,
// no dependencies.
import type { PlanetId, SfxName } from './types';
import { buildSfx } from './sfx';
import { MusicLoop } from './music';

export type { PlanetId, SfxName };

const MAX_VOICES = 32;
const MUSIC_CROSSFADE_S = 1.5;
const MUSIC_STOP_FADE_S = 1.0;

interface MusicTrack {
  planet: PlanetId;
  loop: MusicLoop;
  gain: GainNode;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;

  private sfxEnabled = true;
  private musicEnabled = true;
  private activeVoices = 0;

  private currentTrack: MusicTrack | null = null;
  private desiredPlanet: PlanetId | null = null;

  private wasRunningBeforeHide = false;

  constructor() {
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => this.handleVisibilityChange());
    }
  }

  /** Creates (once) and resumes the AudioContext. Call on the first user
   * gesture; safe to call repeatedly afterwards. */
  unlock(): void {
    this.ensureContext();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }
    // Nudge iOS/Android WebViews that only unlock audio inside the gesture
    // handler itself by starting and immediately stopping a silent buffer.
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
      src.stop(0);
    } catch {
      // Non-fatal; some environments disallow zero-length buffers.
    }
  }

  play(name: SfxName, opts?: { intensity?: number }): void {
    if (!this.sfxEnabled) return;
    this.ensureContext();
    const ctx = this.ctx;
    const sfxBus = this.sfxBus;
    if (!ctx || !sfxBus) return;
    if (ctx.state === 'suspended') void ctx.resume();
    if (this.activeVoices >= MAX_VOICES) return; // voice limiting to avoid pileup/clipping

    const intensity = opts?.intensity ?? 0.5;
    this.activeVoices += 1;
    const duration = buildSfx(ctx, sfxBus, name, ctx.currentTime, intensity);
    const releaseMs = Math.max(10, duration * 1000 + 60);
    setTimeout(() => {
      this.activeVoices = Math.max(0, this.activeVoices - 1);
    }, releaseMs);
  }

  /** Starts (or crossfades into) generative ambient music for `planet`. */
  startMusic(planet: PlanetId): void {
    this.desiredPlanet = planet;
    if (!this.musicEnabled) return;
    this.ensureContext();
    this.playDesiredTrack();
  }

  /** Fades the current music out over ~1s and stops it. */
  stopMusic(): void {
    this.desiredPlanet = null;
    this.fadeOutTrack(this.currentTrack, MUSIC_STOP_FADE_S);
    this.currentTrack = null;
  }

  setSfxEnabled(v: boolean): void {
    this.sfxEnabled = v;
  }

  setMusicEnabled(v: boolean): void {
    if (this.musicEnabled === v) return;
    this.musicEnabled = v;
    if (!v) {
      this.fadeOutTrack(this.currentTrack, MUSIC_STOP_FADE_S);
      this.currentTrack = null;
    } else if (this.desiredPlanet) {
      this.playDesiredTrack();
    }
  }

  private playDesiredTrack(): void {
    const ctx = this.ctx;
    const musicBus = this.musicBus;
    const planet = this.desiredPlanet;
    if (!ctx || !musicBus || !planet) return;
    if (this.currentTrack && this.currentTrack.planet === planet) return;

    const outgoing = this.currentTrack;
    this.currentTrack = null;
    this.fadeOutTrack(outgoing, MUSIC_CROSSFADE_S);

    const trackGain = ctx.createGain();
    trackGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    trackGain.connect(musicBus);
    const loop = new MusicLoop(ctx, trackGain, planet);
    loop.start(ctx.currentTime + 0.05);
    trackGain.gain.exponentialRampToValueAtTime(1, ctx.currentTime + MUSIC_CROSSFADE_S);

    this.currentTrack = { planet, loop, gain: trackGain };
  }

  private fadeOutTrack(track: MusicTrack | null, seconds: number): void {
    if (!track || !this.ctx) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    try {
      track.gain.gain.cancelScheduledValues(now);
      const current = Math.max(0.0001, track.gain.gain.value);
      track.gain.gain.setValueAtTime(current, now);
      track.gain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
      track.gain.gain.setValueAtTime(0, now + seconds + 0.05);
    } catch {
      // ignore scheduling errors on an already-closed context
    }
    setTimeout(
      () => {
        track.loop.stop();
        track.gain.disconnect();
      },
      seconds * 1000 + 100,
    );
  }

  private ensureContext(): void {
    if (this.ctx) return;
    const AudioContextCtor: typeof AudioContext =
      window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AudioContextCtor();
    this.ctx = ctx;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-8, ctx.currentTime);
    compressor.knee.setValueAtTime(12, ctx.currentTime);
    compressor.ratio.setValueAtTime(14, ctx.currentTime);
    compressor.attack.setValueAtTime(0.002, ctx.currentTime);
    compressor.release.setValueAtTime(0.15, ctx.currentTime);
    compressor.connect(ctx.destination);

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.9, ctx.currentTime);
    masterGain.connect(compressor);

    const sfxBus = ctx.createGain();
    sfxBus.gain.setValueAtTime(1, ctx.currentTime);
    sfxBus.connect(masterGain);

    const musicBus = ctx.createGain();
    musicBus.gain.setValueAtTime(0.55, ctx.currentTime); // music sits under SFX
    musicBus.connect(masterGain);

    this.sfxBus = sfxBus;
    this.musicBus = musicBus;
  }

  private handleVisibilityChange(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (document.hidden) {
      this.wasRunningBeforeHide = ctx.state === 'running';
      if (ctx.state === 'running') void ctx.suspend();
    } else if (this.wasRunningBeforeHide && ctx.state === 'suspended') {
      void ctx.resume();
    }
  }
}
