import '@fontsource/orbitron/700.css';
import '@fontsource/orbitron/600.css';
import '@fontsource/exo-2/400.css';
import '@fontsource/exo-2/600.css';
import '@fontsource/exo-2/800.css';
import './ui.css';
import { icon } from './icons';
import { haptic, setHapticsEnabled } from './haptic';
import { PLANET_NAMES, POWER_NAMES, S } from './strings';
import type {
  GameUIOptions,
  LevelCompleteData,
  LevelFailedData,
  PowerButtonState,
  PowerId,
  ProbeState,
  Settings,
  UnlockData,
} from './types';

const POWER_ORDER: PowerId[] = ['meteor', 'prism', 'solarFlare', 'comet'];
const hex = (c: number) => `#${(c >>> 0).toString(16).padStart(6, '0')}`;

/**
 * Mounts the whole space-glass HUD into `root`. `root` must sit above a
 * full-screen WebGL canvas; the UI root lets pointer events pass through to
 * that canvas everywhere except on its own interactive elements (buttons).
 */
export class GameUI {
  private readonly opts: GameUIOptions;
  private settings: Settings = { sound: true, music: true, haptics: true };

  private readonly stardustVal: HTMLElement;
  private readonly planetName: HTMLElement;
  private readonly levelNum: HTMLElement;
  private readonly ring: HTMLElement;
  private readonly nextPlanetLine: HTMLElement;
  private readonly layerLine: HTMLElement;
  private readonly gearBtn: HTMLElement;

  private readonly currentOrb: HTMLElement;
  private readonly currentCount: HTMLElement;
  private readonly nextOrb: HTMLElement;
  private readonly swapBtn: HTMLElement;

  private readonly powerBtns: Map<PowerId, HTMLButtonElement> = new Map();

  private readonly streakEl: HTMLElement;
  private streakPips: HTMLElement[] = [];
  private streakShown = 0;
  private streakFlashTimer = 0;
  private streakPending: { count: number | null; target: number } | null = null;
  private readonly bonusTimeEl: HTMLElement;
  private readonly bannerEl: HTMLElement;
  private bannerTimer = 0;

  private readonly toastEl: HTMLElement;
  private readonly comboEl: HTMLElement;
  private toastTimer = 0;

  private readonly loadingEl: HTMLElement;
  private readonly loadingText: HTMLElement;

  private readonly scrimEl: HTMLElement;
  /** Pending `closeScrim()` cleanup (see there) — cancelled if a new card replaces the scrim's content first. */
  private scrimClearTimer: number | null = null;

  private readonly titleBeatLayer: HTMLElement;
  private titleBeatToken = 0;
  private readonly logoLayer: HTMLElement;
  private readonly skipBtn: HTMLElement;

  private readonly hudLayer: HTMLElement;
  private stardustValue = 0;
  private skipHandler: (() => void) | null = null;

  constructor(root: HTMLElement, options: GameUIOptions) {
    this.opts = options;
    root.classList.add('wb-root');
    root.innerHTML = `
      <div class="wb-hud-layer" data-hud>
        <header class="wb-topbar">
          <div class="wb-stardust-pill wb-glass">${icon('stardust')}<span class="wb-num-fast" data-stardust>0</span></div>
          <button class="wb-planet-badge wb-glass" type="button" data-planet-badge aria-label="${S.planetProgressAria}">
            <span class="wb-planet-name" data-planet-name>${PLANET_NAMES.earth}</span>
            <span class="wb-level-line"><span class="wb-ring" data-ring style="--pct:0"></span><span data-level-num>${S.level(1)}</span></span>
            <span class="wb-layer-line wb-hidden" data-layer-line></span>
            <span class="wb-next-planet-line wb-hidden" data-next-planet></span>
          </button>
          <button class="wb-gear-btn wb-glass" type="button" data-gear aria-label="${S.settingsAria}">${icon('gear')}</button>
        </header>

        <div class="wb-toast-wrap" data-toast-wrap>
          <div class="wb-combo" data-combo></div>
          <div class="wb-toast wb-glass" data-toast></div>
        </div>

        <div class="wb-dock" data-dock>
          <div class="wb-orb wb-orb-next" data-next-orb aria-hidden="true"></div>
          <div class="wb-orb wb-orb-current" data-current-orb role="img" aria-label="${S.currentProbeAria}"><span class="wb-num-fast" data-current-count></span></div>
          <button class="wb-swap-btn wb-glass" type="button" data-swap aria-label="${S.swapProbeAria}">${icon('swap')}</button>
        </div>

        <div class="wb-powerbar wb-glass" data-powerbar></div>

        <div class="wb-streak wb-hidden" data-streak role="img" aria-label="${S.streakAria}"></div>
        <div class="wb-bonus-timer wb-glass" data-bonus-timer role="timer" aria-label="${S.bonusTimerAria}"><span data-bonus-time>30</span></div>
        <div class="wb-banner" data-banner><span class="wb-banner-top" data-banner-top></span><span class="wb-banner-main" data-banner-main></span></div>
      </div>

      <div class="wb-loading" data-loading>
        <div class="wb-loading-planet"></div>
        <div class="wb-loading-text wb-loading-dots" data-loading-text>${S.loading(PLANET_NAMES.earth)}</div>
      </div>

      <div class="wb-scrim" data-scrim></div>

      <div class="wb-titlebeat-layer wb-hidden" data-titlebeat-layer>
        <div class="wb-titlebeat" data-titlebeat></div>
      </div>

      <div class="wb-logo-layer wb-hidden" data-logo-layer>
        <div class="wb-logo-word">WORLDBEAD</div>
        <div class="wb-logo-sub">${S.logoSub}</div>
        <div class="wb-logo-tap">${S.tapToBegin}</div>
        <div class="wb-build-label">${__BUILD_LABEL__}</div>
      </div>

      <button class="wb-skip-btn wb-glass wb-hidden" type="button" data-skip>${S.skip}</button>
    `;

    const q = <T extends HTMLElement>(sel: string) => root.querySelector(sel) as T;
    this.hudLayer = q('[data-hud]');
    this.stardustVal = q('[data-stardust]');
    this.planetName = q('[data-planet-name]');
    this.levelNum = q('[data-level-num]');
    this.ring = q('[data-ring]');
    this.nextPlanetLine = q('[data-next-planet]');
    this.layerLine = q('[data-layer-line]');
    this.gearBtn = q('[data-gear]');
    this.currentOrb = q('[data-current-orb]');
    this.currentCount = q('[data-current-count]');
    this.nextOrb = q('[data-next-orb]');
    this.swapBtn = q('[data-swap]');
    this.streakEl = q('[data-streak]');
    this.bonusTimeEl = q('[data-bonus-time]');
    this.bannerEl = q('[data-banner]');
    this.toastEl = q('[data-toast]');
    this.comboEl = q('[data-combo]');
    this.loadingEl = q('[data-loading]');
    this.loadingText = q('[data-loading-text]');
    this.scrimEl = q('[data-scrim]');
    this.titleBeatLayer = q('[data-titlebeat-layer]');
    this.logoLayer = q('[data-logo-layer]');
    this.skipBtn = q('[data-skip]');

    const powerbar = q<HTMLElement>('[data-powerbar]');
    for (const id of POWER_ORDER) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'wb-power-btn';
      btn.dataset.power = id;
      btn.setAttribute('aria-label', powerLabel(id));
      btn.innerHTML = `
        ${icon(id as any).replace('<svg ', '<svg class="wb-power-icon" ')}
        <span class="wb-power-lock">${icon('lock')}</span>
        <span class="wb-power-charge wb-hidden" data-charge></span>
        <span class="wb-power-badge wb-hidden" data-badge></span>
      `;
      btn.addEventListener('click', () => {
        haptic('light');
        this.opts.onPower(id);
      });
      powerbar.appendChild(btn);
      this.powerBtns.set(id, btn);
    }

    this.swapBtn.addEventListener('click', () => {
      haptic('light');
      this.opts.onSwap();
    });
    this.gearBtn.addEventListener('click', () => this.openSettings());
    this.logoLayer.style.display = 'none';
  }

  // ------------------------------------------------------------- top bar

  setStardust(value: number, animate = true): void {
    const from = this.stardustValue;
    this.stardustValue = value;
    if (!animate || from === value) {
      this.stardustVal.textContent = String(value);
      return;
    }
    countUp(this.stardustVal, from, value);
  }

  setPlanetBadge(planetName: string, level: number, clearedPercent: number, nextPlanetIn?: { name: string; levels: number } | null): void {
    this.planetName.textContent = planetName;
    this.levelNum.textContent = S.level(level);
    const pct = Math.round(Math.max(0, Math.min(1, clearedPercent)) * 100);
    this.ring.style.setProperty('--pct', String(pct));
    if (nextPlanetIn && nextPlanetIn.levels > 0) {
      this.nextPlanetLine.textContent = S.nextPlanetIn(nextPlanetIn.name, nextPlanetIn.levels);
      this.nextPlanetLine.classList.remove('wb-hidden');
    } else {
      this.nextPlanetLine.classList.add('wb-hidden');
    }
  }

  /**
   * Owner bug report: "the layered structure isn't there" — a small always-visible cue whenever
   * a level has more than one bead layer, so the player knows up front there's more underneath
   * (not shown at all on single-layer levels, so it stays out of the way most of the game).
   */
  setLayerProgress(current: number, total: number): void {
    if (total <= 1) {
      this.layerLine.classList.add('wb-hidden');
      return;
    }
    this.layerLine.textContent = S.layerProgress(current, total);
    this.layerLine.classList.remove('wb-hidden');
  }

  // ------------------------------------------------------------ probe dock

  setProbeDock(current: ProbeState | null, next: ProbeState | null, prismActive = false): void {
    this.currentOrb.classList.toggle('wb-prism', prismActive);
    if (current && !prismActive) {
      this.currentOrb.style.setProperty('--c', hex(current.color));
      this.currentOrb.style.visibility = 'visible';
    } else if (prismActive) {
      this.currentOrb.style.visibility = 'visible';
    } else {
      this.currentOrb.style.visibility = 'hidden';
    }
    this.currentCount.textContent = current?.count != null ? String(current.count) : '';

    if (next) {
      this.nextOrb.style.setProperty('--c', hex(next.color));
      this.nextOrb.style.visibility = 'visible';
    } else {
      this.nextOrb.style.visibility = 'hidden';
    }
  }

  // ---------------------------------------------------- streak (GDD §5b)

  /** `count` = current run of matching hits; `null` hides the pips (before the streak unlocks, in a bonus round). */
  setStreak(count: number | null, target: number): void {
    // While the reward flash plays, hold the latest real state and apply it when the flash ends.
    if (this.streakFlashTimer) {
      this.streakPending = { count, target };
      return;
    }
    if (count === null) {
      this.streakEl.classList.add('wb-hidden');
      this.streakShown = 0;
      return;
    }
    if (this.streakPips.length !== target) {
      this.streakEl.innerHTML = '';
      this.streakPips = [];
      for (let i = 0; i < target; i++) {
        const pip = document.createElement('span');
        pip.className = 'wb-streak-pip';
        this.streakEl.appendChild(pip);
        this.streakPips.push(pip);
      }
    }
    this.streakEl.classList.remove('wb-hidden');
    const dropped = this.streakShown > 0 && count === 0;
    this.streakPips.forEach((pip, i) => pip.classList.toggle('wb-on', i < count));
    if (dropped) {
      this.streakEl.classList.remove('wb-streak-reset');
      void this.streakEl.offsetWidth;
      this.streakEl.classList.add('wb-streak-reset');
    }
    this.streakShown = count;
  }

  /** Reward reached: fill and flash every pip, then fall back to the real (reset) state. */
  flashStreakReward(): void {
    this.streakPips.forEach((pip) => pip.classList.add('wb-on'));
    this.streakEl.classList.remove('wb-streak-reset', 'wb-streak-flash');
    void this.streakEl.offsetWidth;
    this.streakEl.classList.add('wb-streak-flash');
    window.clearTimeout(this.streakFlashTimer);
    this.streakFlashTimer = window.setTimeout(() => {
      this.streakFlashTimer = 0;
      this.streakEl.classList.remove('wb-streak-flash');
      const p = this.streakPending;
      this.streakPending = null;
      this.streakShown = 0;
      if (p) this.setStreak(p.count, p.target);
      else this.streakPips.forEach((pip) => pip.classList.remove('wb-on'));
    }, 800);
  }

  // ------------------------------------------------- bonus round (GDD §5b)

  /** Bonus round HUD: timer instead of the probe count, power bar and streak pips hidden. */
  setBonusMode(on: boolean): void {
    this.hudLayer.classList.toggle('wb-bonus', on);
  }

  setBonusTime(seconds: number): void {
    this.bonusTimeEl.textContent = String(Math.max(0, Math.ceil(seconds)));
    this.bonusTimeEl.parentElement!.classList.toggle('wb-low', seconds <= 5);
  }

  showBonusResult(stardust: number): Promise<void> {
    return this.showCard((resolve) => {
      const card = document.createElement('div');
      card.className = 'wb-card wb-glass';
      card.innerHTML = `
        <div class="wb-unlock-icon">${icon('stardust')}</div>
        <div class="wb-card-title">${escapeHtml(S.bonusComplete)}</div>
        <div class="wb-card-sub">${escapeHtml(S.bonusStardust)}</div>
        <div class="wb-stardust-earn">${icon('stardust')}<span class="wb-num-fast" data-earn>0</span></div>
        <button class="wb-btn-primary" type="button" data-primary>${escapeHtml(S.continueLabel)}</button>
      `;
      const earnEl = card.querySelector('[data-earn]') as HTMLElement;
      window.setTimeout(() => countUp(earnEl, 0, stardust, 900), 260);
      (card.querySelector('[data-primary]') as HTMLButtonElement).addEventListener('click', () => resolve());
      haptic('medium');
      return card;
    });
  }

  // ----------------------------------------------------------- banner

  /** A short centered banner (level-size label, bonus-round start); `hot` gives it the orange-red "Extreme" accent. */
  showBanner(top: string, main: string, hot = false, ms = 1600): void {
    this.bannerEl.querySelector('[data-banner-top]')!.textContent = top;
    this.bannerEl.querySelector('[data-banner-main]')!.textContent = main;
    this.bannerEl.classList.toggle('wb-hot', hot);
    this.bannerEl.classList.remove('wb-show');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('wb-show');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.bannerEl.classList.remove('wb-show'), ms);
  }

  // ------------------------------------------------------------ power bar

  setPowers(states: PowerButtonState[]): void {
    for (const s of states) {
      const btn = this.powerBtns.get(s.id);
      if (!btn) continue;
      btn.dataset.locked = String(s.locked);
      btn.dataset.active = String(!!s.active);
      btn.dataset.buy = String(!s.locked && s.charges === 0);
      const badge = btn.querySelector('[data-badge]') as HTMLElement;
      const charge = btn.querySelector('[data-charge]') as HTMLElement;
      if (s.locked) {
        badge.textContent = s.unlockLevel != null ? S.lockedLevel(s.unlockLevel) : '?';
        badge.classList.remove('wb-hidden');
        charge.classList.add('wb-hidden');
        btn.disabled = true;
      } else if (s.charges === 0 && s.price != null) {
        charge.textContent = `${s.price}`;
        charge.classList.remove('wb-hidden');
        badge.classList.add('wb-hidden');
        btn.disabled = false;
      } else {
        charge.textContent = String(s.charges);
        charge.classList.remove('wb-hidden');
        badge.classList.add('wb-hidden');
        btn.disabled = false;
      }
    }
  }

  // ---------------------------------------------------------------- toast

  showToast(text: string, ms = 1800): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('wb-show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('wb-show'), ms);
  }

  /** `text` is a celebratory string (see `strings.ts`'s `popWow`/`popGreat`/`popAmazing` — item #7). */
  showCombo(text: string): void {
    this.comboEl.textContent = text;
    this.comboEl.classList.remove('wb-show');
    // Force reflow so the animation restarts on repeated combos.
    void this.comboEl.offsetWidth;
    this.comboEl.classList.add('wb-show');
    haptic('heavy');
  }

  // -------------------------------------------------------------- loading

  showLoading(planetName: string): void {
    this.loadingText.textContent = S.loading(planetName);
    this.loadingEl.classList.remove('wb-fade-out');
    this.loadingEl.style.display = 'grid';
  }

  hideLoading(): void {
    this.loadingEl.classList.add('wb-fade-out');
    window.setTimeout(() => {
      this.loadingEl.style.display = 'none';
    }, 350);
  }

  /**
   * P0 (production review): blocking error card shown when a level's assets fail
   * to load — the alternative was a loading overlay that never went away. Resolves
   * when the player taps retry; the caller then re-attempts the load.
   */
  showLoadError(): Promise<void> {
    return this.showCard((resolve) => {
      const card = document.createElement('div');
      card.className = 'wb-card wb-glass';
      card.innerHTML = `
        <div class="wb-card-title" style="background:none;-webkit-text-fill-color:var(--wb-danger);color:var(--wb-danger)">${S.loadErrorTitle}</div>
        <div class="wb-card-sub">${escapeHtml(S.loadErrorBody)}</div>
        <button class="wb-btn-primary" type="button" data-primary>${escapeHtml(S.retry)}</button>
      `;
      (card.querySelector('[data-primary]') as HTMLButtonElement).addEventListener('click', () => resolve());
      return card;
    });
  }

  /**
   * P1 (production review): WebGL context loss — covers the frozen canvas with a
   * localized "restarting" note while the page reloads on `contextrestored`.
   * Reuses the loading overlay (same visual language), with raw text instead of
   * the `Loading <planet>` format.
   */
  showGraphicsRestart(): void {
    this.loadingText.textContent = S.graphicsRestarting;
    this.loadingEl.classList.remove('wb-fade-out');
    this.loadingEl.style.display = 'grid';
  }

  // ------------------------------------------------------- level complete

  showLevelComplete(data: LevelCompleteData): Promise<void> {
    return this.showCard((resolve) => {
      const starsHtml = [1, 2, 3]
        .map((i) => `<span style="animation-delay:${i * 0.12}s">${icon(i <= data.stars ? 'star' : 'starOutline')}</span>`)
        .join('');
      const card = document.createElement('div');
      card.className = 'wb-card wb-glass';
      card.innerHTML = `
        <div class="wb-card-title">${data.nextPlanetName ? S.planetComplete : S.levelComplete}</div>
        <div class="wb-stars" data-stars>${starsHtml}</div>
        <div class="wb-stardust-earn">${icon('stardust')}<span class="wb-num-fast" data-earn>0</span></div>
        <div class="wb-fact">
          <div class="wb-fact-title">${escapeHtml(data.factTitle || S.didYouKnow)}</div>
          <div class="wb-fact-text">${escapeHtml(data.factText)}</div>
        </div>
        ${data.nextPlanetName ? `<div class="wb-next-stop">${escapeHtml(S.nextStop(''))}<b>${escapeHtml(data.nextPlanetName)}</b></div>` : ''}
        <button class="wb-btn-primary" type="button" data-primary>${escapeHtml(data.primaryLabel ?? (data.nextPlanetName ? S.continueLabel : S.nextLevel))}</button>
      `;
      const stars = card.querySelectorAll('[data-stars] span');
      stars.forEach((s, i) => {
        const svgEl = s.querySelector('svg')!;
        (svgEl as unknown as HTMLElement).style.animationDelay = `${i * 0.12}s`;
        if (i < data.stars) svgEl.classList.add('wb-star-on');
      });
      const earnEl = card.querySelector('[data-earn]') as HTMLElement;
      window.setTimeout(() => countUp(earnEl, 0, data.stardustEarned, 900), 260);
      const primary = card.querySelector('[data-primary]') as HTMLButtonElement;
      primary.addEventListener('click', () => resolve());
      haptic('medium');
      return card;
    });
  }

  showLevelFailed(data: LevelFailedData): Promise<'retry' | 'continue'> {
    return this.showCard<'retry' | 'continue'>((resolve) => {
      const card = document.createElement('div');
      card.className = 'wb-card wb-glass';
      card.innerHTML = `
        <div class="wb-card-title" style="background:none;-webkit-text-fill-color:var(--wb-danger);color:var(--wb-danger)">${S.outOfProbes}</div>
        <div class="wb-beads-left">${S.beadsLeft} <b>${escapeHtml(String(data.beadsLeft))}</b></div>
        <button class="wb-btn-primary wb-btn-retry" type="button" data-retry>${escapeHtml(S.retry)} <span>${data.retryCost}</span> ${icon('stardust')}</button>
        <button class="wb-btn-secondary wb-btn-retry" type="button" data-continue${data.canAffordContinue ? '' : ' disabled'}>${escapeHtml(S.continueLabel)} <span>${data.continueCost}</span> ${icon('stardust')}</button>
      `;
      (card.querySelector('[data-retry]') as HTMLButtonElement).addEventListener('click', () => resolve('retry'));
      const continueBtn = card.querySelector('[data-continue]') as HTMLButtonElement;
      if (data.canAffordContinue) continueBtn.addEventListener('click', () => resolve('continue'));
      haptic('medium');
      return card;
    });
  }

  showUnlock(data: UnlockData): Promise<void> {
    return this.showCard((resolve) => {
      const card = document.createElement('div');
      card.className = 'wb-card wb-glass';
      card.innerHTML = `
        <div class="wb-unlock-icon">${icon((data.icon as any) ?? 'star')}</div>
        <div class="wb-card-title">${escapeHtml(data.name)}</div>
        <div class="wb-card-sub">${escapeHtml(data.description)}</div>
        <button class="wb-btn-primary" type="button" data-primary>${escapeHtml(data.ctaLabel ?? S.tryIt)}</button>
      `;
      const primary = card.querySelector('[data-primary]') as HTMLButtonElement;
      primary.addEventListener('click', () => resolve());
      haptic('medium');
      return card;
    });
  }

  private showCard<T = void>(build: (resolve: (value: T) => void) => HTMLElement): Promise<T> {
    return new Promise((resolve) => {
      // A card shown right after a previous one closes (e.g. `newPlanet` immediately followed by
      // `newLayer` on the same level, item #18a/#13) replaces the scrim's content synchronously
      // here, before the previous card's own `closeScrim()` delayed cleanup below has run — cancel
      // that stale timeout so it doesn't wipe out *this* card's just-inserted content 300ms later.
      if (this.scrimClearTimer != null) {
        window.clearTimeout(this.scrimClearTimer);
        this.scrimClearTimer = null;
      }
      this.scrimEl.innerHTML = '';
      const card = build((value: T) => {
        this.closeScrim();
        resolve(value);
      });
      this.scrimEl.appendChild(card);
      requestAnimationFrame(() => this.scrimEl.classList.add('wb-show'));
    });
  }

  private closeScrim(): void {
    this.scrimEl.classList.remove('wb-show');
    this.scrimClearTimer = window.setTimeout(() => {
      this.scrimClearTimer = null;
      this.scrimEl.innerHTML = '';
    }, 300);
  }

  // ------------------------------------------------------------- settings

  setSettings(settings: Settings): void {
    this.settings = { ...settings };
    setHapticsEnabled(settings.haptics);
  }

  private openSettings(): void {
    haptic('light');
    this.scrimEl.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'wb-card wb-glass';
    card.style.position = 'relative';
    const row = (key: keyof Settings, label: string, iconOn: string, iconOff: string) => `
      <div class="wb-settings-row">
        <span class="wb-settings-label">${icon(this.settings[key] ? (iconOn as any) : (iconOff as any))}<span>${label}</span></span>
        <button class="wb-switch" type="button" data-key="${key}" data-on="${this.settings[key]}" aria-label="${label}"></button>
      </div>`;
    card.innerHTML = `
      <button class="wb-close-btn" type="button" data-close aria-label="${S.closeSettingsAria}">${icon('close')}</button>
      <div class="wb-card-title">${S.settingsTitle}</div>
      <div style="width:100%">
        ${row('sound', S.sound, 'sound', 'soundOff')}
        ${row('music', S.music, 'music', 'musicOff')}
        ${row('haptics', S.haptics, 'haptics', 'hapticsOff')}
      </div>
      <button class="wb-btn-secondary" type="button" data-replay>${S.replayIntro}</button>
      <div class="wb-credits">${escapeHtml(S.credits)}</div>
      <div class="wb-version-label">${__BUILD_LABEL__}</div>
    `;
    card.querySelectorAll<HTMLButtonElement>('[data-key]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key as keyof Settings;
        this.settings = { ...this.settings, [key]: !this.settings[key] };
        btn.dataset.on = String(this.settings[key]);
        const iconSpan = btn.parentElement!.querySelector('.wb-settings-label svg') as SVGElement;
        const onIcon = key === 'sound' ? 'sound' : key === 'music' ? 'music' : 'haptics';
        const offIcon = key === 'sound' ? 'soundOff' : key === 'music' ? 'musicOff' : 'hapticsOff';
        iconSpan.outerHTML = icon((this.settings[key] ? onIcon : offIcon) as any);
        setHapticsEnabled(this.settings.haptics);
        haptic('light');
        this.opts.onSettingsChanged({ ...this.settings });
      });
    });
    card.querySelector('[data-close]')!.addEventListener('click', () => this.closeScrim());
    card.querySelector('[data-replay]')!.addEventListener('click', () => {
      this.closeScrim();
      this.opts.onReplayIntro?.();
    });
    this.scrimEl.appendChild(card);
    requestAnimationFrame(() => this.scrimEl.classList.add('wb-show'));
  }

  // -------------------------------------------------------------- cinema

  /**
   * Shows one title-beat line for `ms`, then fades it out and hides the
   * layer. Guarded by a monotonic token: if a second call starts (or the
   * caller races this against a skip and moves on) before this one's own
   * fade-out/hide timers fire, those stale timers become no-ops instead of
   * stomping the newer beat's text/visibility — otherwise beat 1's delayed
   * `hide` could land after beat 2's text was already set, blanking it.
   */
  showTitleBeat(text: string, ms: number): Promise<void> {
    const token = ++this.titleBeatToken;
    return new Promise((resolve) => {
      this.titleBeatLayer.classList.remove('wb-hidden');
      const el = this.titleBeatLayer.querySelector('[data-titlebeat]') as HTMLElement;
      el.textContent = text;
      el.className = 'wb-titlebeat wb-tb-in';
      window.setTimeout(() => {
        if (this.titleBeatToken !== token) return resolve();
        el.className = 'wb-titlebeat wb-tb-out';
        window.setTimeout(() => {
          if (this.titleBeatToken === token) this.titleBeatLayer.classList.add('wb-hidden');
          resolve();
        }, 820);
      }, Math.max(200, ms));
    });
  }

  showLogo(): Promise<void> {
    return new Promise((resolve) => {
      this.logoLayer.style.display = 'flex';
      this.logoLayer.classList.remove('wb-hidden');
      const onTap = () => {
        haptic('medium');
        this.logoLayer.removeEventListener('click', onTap);
        this.logoLayer.classList.add('wb-hidden');
        this.logoLayer.style.display = 'none';
        resolve();
      };
      this.logoLayer.addEventListener('click', onTap);
    });
  }

  showSkip(onSkip: () => void): void {
    this.skipBtn.classList.remove('wb-hidden');
    if (this.skipHandler) this.skipBtn.removeEventListener('click', this.skipHandler);
    this.skipHandler = () => {
      haptic('light');
      onSkip();
    };
    this.skipBtn.addEventListener('click', this.skipHandler);
    this.skipBtn.textContent = S.skip;
  }

  hideSkip(): void {
    this.skipBtn.classList.add('wb-hidden');
  }

  setHudVisible(visible: boolean): void {
    this.hudLayer.classList.toggle('wb-hidden', !visible);
  }
}

function powerLabel(id: PowerId): string {
  return POWER_NAMES[id];
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function countUp(el: HTMLElement, from: number, to: number, duration = 500): void {
  const start = performance.now();
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    el.textContent = String(to);
    return;
  }
  const step = (t: number) => {
    const p = Math.min(1, (t - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = String(Math.round(from + (to - from) * eased));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export type { GameUIOptions, LevelCompleteData, LevelFailedData, PowerButtonState, PowerId, ProbeState, Settings, UnlockData };
