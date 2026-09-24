# WorldBead: Pop the Planets — Game Design & Module Contracts

## TL;DR
- Real planets (NASA-derived imagery) hide under shells of glossy beads. Clearing beads **reveals the real world** underneath; every win shows the true planet and a real science fact.
- Core loop: drag to rotate, tap a bead to fire the current **probe**; a matching color pops the whole connected region. Limited probes per level.
- Realism grows with level: more beads and more quantized colors sampled from the real texture, so the bead sphere converges to the actual planet.
- Chapters: Earth 1–350 → Moon 351–400 → Venus 401–450 → Mars 451–550.
- New tools unlock as levels progress, each introduced by a **forced interactive tutorial**.
- Cinematic intro (space → Sun → Earth → beads assemble → logo), full FX, procedural audio, space-glass UI.
- Web (GitHub Pages) + Android (Capacitor, CI-built APK). iOS later.
- Engineering rule: **YAGNI**. Build exactly what this document lists.

## 1. Identity (deliberately different from the reference game)
| Aspect | WorldBead |
|---|---|
| Fantasy | You are rebuilding real worlds from space; the beads are a shell over the true planet |
| Setting | Deep space: real Milky Way backdrop, Sun with lens flare, atmospheric rim glow |
| Launcher | Orbital probe cannon, bottom center; fires a glowing probe with a light trail |
| Resources | **Probes** (shots), **Stardust** (currency) |
| Win moment | Remaining beads burst off, the photoreal planet is revealed, camera hero-orbit, fact card |
| Tone | Awe + satisfying tactile pops; "The universe, bead by bead" |

## 2. Core rules
- Beads lie on concentric shells around the planet body. Shells: `surface` (radius 1.00), optional `clouds` (radius 1.06, Earth ≥ L40 and all of Venus).
- A tap raycasts to the first alive, hittable bead. A cloud bead covers surface beads beneath it (occluders).
- Probe color == bead color → pop the connected same-color region (BFS over the shell's neighbor graph). Otherwise the probe bounces off, and the probe is still spent.
- Probe queue: current + next. Colors are drawn only from colors of currently hittable beads. The queue is revalidated after every pop.
- Probes per level = ceil(regions × slack). Slack goes from 1.5 (early) to 1.1 (late).
- Win: all beads cleared. Lose: 0 probes and beads remain → Retry.
- Stars: ≥ 40 % probes left = 3, ≥ 15 % = 2, else 1. Stardust: +1 per 12 beads popped, +5 per unused probe.

## 3. Bead painting (realism progression)
1. Fibonacci-sphere bead directions; bead count from the level config.
2. Sample the planet's equirectangular texture at each bead's lon/lat (bilinear).
3. Quantize to **K colors** with k-means (deterministic seed). K grows with tier.
4. Smooth: 2 passes of a neighbor majority filter. Then merge regions smaller than `minRegion` beads into their dominant neighbor color.
5. Cloud shell: bead exists where cloud alpha > threshold; 2–3 grey/white tones.

| Chapter | Levels | Beads | K (tier 1→4) | Cloud shell |
|---|---|---|---|---|
| Earth | 1–350 | 800 → 6000 | 3 → 5 → 7 → 9 | from L40 |
| Moon | 351–400 | 1500 → 5000 | 3 → 4 → 5 → 6 | no |
| Venus | 401–450 | 1500 → 5000 | 3 → 4 → 5 → 6 | always (procedural cream bands) |
| Mars | 451–550 | 1800 → 6000 | 3 → 5 → 6 → 8 | no |

Direction ↔ lon/lat convention: `x = cos(lat)cos(lon), y = sin(lat), z = -cos(lat)sin(lon)`. Texture u = (lon + 180) / 360, v = (90 − lat) / 180. The planet body mesh must use the same mapping so beads sit exactly over the matching terrain.

## 4. Unlocks & tutorials
Each unlock grants 3 free charges. Extra charges cost Stardust (Meteor 60, Prism 80, Solar Flare 120, Comet 150). Every 5th level win also grants +1 random unlocked power.

| Level | Unlock | Effect | Forced tutorial |
|---|---|---|---|
| 1 | Fire | — | Spotlight a large region matching the probe, hand taps it; player must pop it |
| 1 | Rotate | — | Hand drag gesture; waits until the globe is rotated ≥ 60° |
| 3 | Swap | Swap current/next probe | Spotlight swap button; player must tap it |
| 6 | Meteor | Pops every bead within a radius of the impact point, any color | Tap Meteor, then tap the globe |
| 12 | Prism | Next probe matches any color | Tap Prism, then pop any region |
| 25 | Solar Flare | Pops all visible-hemisphere beads of the current probe color | Tap Solar Flare |
| 40 | Cloud layer | (mechanic) Clouds cover the surface | Explain + pop a cloud region |
| 60 | Comet | Pops a band along a great circle chosen by a swipe | Tap Comet, then swipe across the globe |
| 351/401/451 | New planet | Warp cinematic + planet intro card | Tap to continue |

A tutorial dims the screen, cuts a spotlight around the target, shows an animated hand and a short caption, and **blocks every input outside the target until the required action happens**. Seen tutorials are stored in progress.

## 5. Presentation
- **Intro (first launch ~12 s, later ~3 s, always skippable):** stars fade in with a slow drift → the Sun sweeps in with a flare → camera approaches photoreal Earth (day/night terminator, city lights, clouds, atmosphere). Title beats: "4.5 billion years in the making." / "Every world is made of countless pieces." Then beads fly in from space and assemble over Earth, the WORLDBEAD logo reveals, "Tap to begin".
- **Level start:** beads assemble from space (~0.8 s).
- **Pop:** bead scale-punch + sparks in bead color + shockwave ring + pitch-scaled pop sound. Chains of ≥ 60 beads show a combo banner.
- **Miss:** probe ricochets, globe shake, low thud.
- **Win:** beads burst off, planet reveal, hero orbit, fact card, stars. **Planet complete:** warp streak travel to the next planet.
- **Audio:** fully procedural WebAudio (no audio files). SFX: fire, pop (pitch by size), bigPop, miss, swap, powerMeteor, powerPrism, powerFlare, powerComet, unlock, uiTap, starGain, win, lose, warp. Plus generative ambient music per planet. Sound, music and haptics toggles live in settings.
- **UI:** space-glass panels, Orbitron (display) + Exo 2 (UI). Top: Stardust (left), planet + level + cleared-% ring (center), settings (right). Bottom: probe dock (next, swap, current + probe count), power buttons with lock badges ("Lv 6").
- **Credits** screen in settings: textures © Solar System Scope, CC BY 4.0 (based on NASA data).

## 6. Module ownership & contracts
Each module lives in its own folder. Only the integration step (`src/game/Game.ts`, `src/main.ts`) wires modules together.

### `src/render/` — `SpaceScene`
```ts
constructor(canvas: HTMLCanvasElement)
readonly renderer: THREE.WebGLRenderer; readonly scene: THREE.Scene; readonly camera: THREE.PerspectiveCamera
readonly globe: THREE.Group            // gameplay adds bead meshes here and rotates this group
readonly beadMaterial: THREE.Material  // shared pearl-like PBR material, supports instanceColor
loadPlanet(id: PlanetId): Promise<void> // body, atmosphere, clouds, lighting, background mood
setBodyRevealed(v: boolean): void       // photoreal clouds and atmosphere intensity for the reveal
launcherPosition(): THREE.Vector3       // world position of the probe cannon (bottom center)
createProbe(color: number): THREE.Object3D; disposeProbe(o: THREE.Object3D): void
burst(worldPos: THREE.Vector3, color: number, intensity: number): void // sparks + shockwave
shake(strength: number): void
flyTo(shot: 'deepSpace' | 'sunPass' | 'approach' | 'gameplay' | 'hero', seconds: number): Promise<void>
warp(seconds: number): Promise<void>
resize(): void; update(dt: number): void; render(): void
```
Planet body radius 0.97 in globe-local units. Textures are in `public/textures/`.

### `src/audio/` — `AudioEngine`
```ts
unlock(): void                     // call on the first user gesture
play(name: SfxName, opts?: { intensity?: number }): void
startMusic(planet: PlanetId): void; stopMusic(): void
setSfxEnabled(v: boolean): void; setMusicEnabled(v: boolean): void
```

### `src/game/` — rules and beads (no DOM, no audio)
- `BeadGlobe`: shells, painting per §3, neighbor graph, `region`, `countRegions`, `exposedColors`, `aliveCount`, pop/assemble/burst-away animations in `update(dt)`, emits popped bead world positions for FX.
- `GameSession`: level state, probes, queue, stars and stardust accounting, powers, fire/resolve. Returns event objects that the integration maps to FX, audio and UI.
- `levels.ts`, `unlocks.ts`, `facts.ts` (≥ 10 accurate facts per planet), `progress.ts` (level, stardust, stars per level, power charges, seen tutorials, settings, introSeen).

### `src/ui/` — `GameUI` + `Tutorial` (DOM only)
HUD, probe dock, power bar, toasts/combo, loading, level-complete / failed cards (Promise-based), title beats and logo, settings + credits, tutorial engine: `Tutorial.run(steps)` with a spotlight, hand gesture, caption and an input block that only lets the target through.

## 7. Platforms
- Web: Vite build deployed to GitHub Pages on push to `main`, installable PWA (manifest + icons).
- Android: Capacitor; GitHub Actions builds a debug APK artifact. iOS: later (macOS runner + Apple account).
