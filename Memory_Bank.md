# Memory Bank

## Purpose

WorldBead: Pop the Planets — a mobile 3D bead-shooter. Players pop beads off
a sphere to reveal the real planet underneath, progressing Earth → Moon →
Venus → Mars. Built entirely in the cloud (no local Android SDK/Xcode/Unity);
native builds run in GitHub Actions.

## Architecture map

- `src/main.ts` — entry point: creates the canvas/`#hud` root and hands
  them to `Game`. Imports `src/base.css` (minimal page shell only; all
  game chrome styling lives in `src/ui/ui.css`, imported by `gameui.ts`).
- `src/game/Game.ts` — the real integration layer (rewritten; see "Full
  integration" below). Composes `SpaceScene` (render), `AudioEngine`
  (audio), `GameUI` + `Tutorial` (ui) and `BeadGlobe` + `GameSession`
  (game) into the full GDD flow: boot → intro → level loop (load → forced
  tutorials → play → win/lose → next). Reads `?level=N` (jump levels) and
  `?skipIntro=1` (QA) from the URL. `src/ui/hud.ts` and `src/style.css`
  are deleted; `Game.ts` no longer touches them.
- `src/game/BeadGlobe.ts` — instanced-mesh bead sphere: `surface` (r=1.00)
  and optional `clouds` (r=1.06) shells, real-texture painting pipeline
  (sample → deterministic k-means → 2-pass majority smoothing → merge
  small regions, per GDD §3), neighbor graph, region/occlusion queries,
  and pop/assemble/burst-away animations driven by `update(dt)`.
  Implements `GlobeAdapter` (see `types.ts`) so `GameSession` never touches
  THREE.
- `src/game/GameSession.ts` — pure rules state machine (probes, queue,
  powers, stars/stardust, win/lose), per GDD §2/§4. No DOM, no THREE.
- `src/game/types.ts` — `GlobeAdapter`/`Vec3`/`BeadRef` shared between
  `BeadGlobe` and `GameSession`.
- `src/game/texture.ts` — the one DOM-touching file in `src/game/`: fetch +
  `createImageBitmap` + canvas → `ImageData`-like, plus a bilinear
  equirectangular sampler.
- `src/game/planets.ts` — planet metadata (name, HUD background gradient,
  source texture filenames). No painting logic lives here any more.
- `src/game/levels.ts` — chapter table and per-level config (bead/cloud
  counts, K, minRegion, shot slack), per the GDD §3 table.
- `src/game/unlocks.ts` — unlock/tutorial table and power prices, per GDD §4.
- `src/game/facts.ts` — ≥10 real, verifiable per-planet facts.
- `src/game/noise.ts` — seeded RNG (`mulberry32`) and fractal value noise
  (`fbm3`), used for k-means seeding, Venus's procedural cloud bands, and
  assemble/burst animation jitter.
- `src/game/progress.ts` — localStorage save/load (level, stardust, stars
  per level, power charges/unlocks, total wins, seen tutorials, settings,
  introSeen), versioned, try/catch throughout.
- `src/render/`, `src/audio/`, `src/ui/` — render (SpaceScene), audio
  (AudioEngine) and DOM UI (GameUI/Tutorial/haptic) modules, each with its
  own contract in `docs/GDD.md` §6. `Game.ts` is their only consumer.

## Full integration (this session)

`src/game/Game.ts` was rewritten from the old `BeadGlobe`+`GameSession`
+`hud.ts` prototype into the real controller, composing all four reviewed
modules per GDD §2/§4/§5 without changing their internals (two small
additive methods on `BeadGlobe` — see below). Deleted `src/ui/hud.ts` and
`src/style.css`; added `src/base.css` (page shell only — html/body/#app/
#scene/#hud) imported from `src/main.ts`.

- **Boot**: `SpaceScene` on `#scene`, `GameUI`+`Tutorial` mounted on
  `#hud`, progress loaded, settings applied (`ui.setSettings`, which wires
  `setHapticsEnabled`), one `requestAnimationFrame` loop drives
  `scene.update/render` + `globe.update` + probe-flight tweening +
  drag-rotation inertia.
- **Intro**: first launch runs the full ~12s cinematic (deepSpace →
  sunPass → title beat → approach → title beat → gameplay → beads
  assemble → logo, "Tap to begin"); later launches run the short ~3s cut
  (approach → assemble → logo). A skip button (shown throughout) races
  each step via `Promise.race` so a tap immediately cuts to the next
  phase without touching camera/animation timing. First tap calls
  `audio.unlock()` + `startMusic()`. Settings' "Replay intro" reruns the
  full sequence then rebuilds the current level (safe: the in-flight
  `resolveLevelEnd` from the outer level-await still resolves correctly
  once the rebuilt session's own win/lose fires).
- **Level load**: `?level=N` jumps levels, `?skipIntro=1` skips the intro
  (both QA-only). `prepareLevel()` loads textures, calls
  `scene.loadPlanet()` only when the planet actually changes, builds
  `BeadGlobe` with `scene.beadMaterial`, adds its group to `scene.globe`,
  builds `GameSession`, then the caller flies to `'gameplay'` and calls
  `globe.assemble(0.8)`.
- **Input**: drag rotates `scene.globe` (quaternion premultiply, same
  inertia technique as the old prototype) with cumulative-degree tracking
  for the L1 rotate tutorial. Tap raycasts against
  `globe.raycastTargets()` → `globe.resolveHit()`; a probe object
  (`scene.createProbe`) eases from `scene.launcherPosition()` to the hit
  world point (~0.25s), then `session.fire()` runs and a miss gets a
  short outward ricochet before the probe is disposed. Pop FX: after any
  session call that pops beads, `globe.drainPopEvents()` is drained
  immediately and sampled (stride so at most ~24 `scene.burst()` calls
  per pop) with intensity scaled by region size; audio `pop`/`bigPop` +
  haptic + combo banner (≥60) follow the same event.
- **Powers**: a shared `onPowerButton()` buys a charge when at 0 (never
  auto-uses it — matches the GDD's "either arm/use, or buy" wording
  literally), otherwise arms (meteor/comet, consumed by the next tap/swipe
  on the globe) or fires immediately (prism, solar flare — solar flare's
  view direction is computed as the camera's position in globe-local
  space, i.e. "which hemisphere faces the camera"). Comet's swipe normal
  is the cross product of the start/end tap points' globe-local
  directions (via a ray/sphere intersection against the bead shell radius,
  not a raycast against actual bead meshes, so it works even over gaps).
- **Unlocks + tutorials**: `runTutorialsForLevel()` walks
  `unlocksForLevel(cfg.level)`, shows the unlock/planet-intro card (except
  L1's fire/rotate) then runs a per-`UnlockId` `Tutorial` script built
  from small `Promise`s resolved by the real game events (a hit, ≥60° of
  rotation, a swap, a specific power's arm/use event). `seenTutorials` is
  keyed `${level}-${id}` (not just the tutorial name) so the three
  `newPlanet` cards at 351/401/451 each show once, independently.
- **Win/lose**: win → `globe.burstAway` + `scene.setBodyRevealed(true)` +
  `flyTo('hero')` + `audio.win` → `showLevelComplete` (random fact from
  `facts.ts`); on a chapter's last level the card's "Planet Complete"
  variant is used (built into `GameUI` via `nextPlanetName`) and a
  `scene.warp()` + `audio.warp` cinematic plays before the next planet
  loads. Lose → `audio.lose` → `showLevelFailed` → retry (rebuilds the
  same level). Every win persists progress immediately.
- **PWA**: `public/manifest.webmanifest` + `public/icons/*` (192/512 +
  maskable, generated by cropping a Playwright screenshot of the running
  bead-Earth close-up with `sharp`), linked from `index.html` along with
  `theme-color`/`apple-touch-icon`. No service worker (YAGNI, per GDD §7).

### `BeadGlobe` API additions (small, additive — used only by `Game.ts`)

- `findLargestExposedRegionOfColor(color): BeadRef[] | null` — largest
  currently-exposed connected region of a given hex color, across all
  shells. Reuses the existing `region()` BFS. Used to spotlight a
  meaningful target for the L1 "fire" tutorial.
- `findLargestExposedCloudRegion(): BeadRef[] | null` — same, restricted
  to the `clouds` shell, any color. Used for the L40 cloud-layer tutorial.

### Known limitations / open items

- The `Tutorial` engine's swap-button and power-button targets are found
  via `canvas.parentElement.querySelector('[data-swap]'/'[data-power=...]')`
  rather than a typed reference, since `GameUI` doesn't expose its DOM
  nodes — brittle only if `gameui.ts`'s markup structure changes.
- Headless/automated QA (Playwright driving real taps against on-screen
  bead colors) is slow and imprecise under SwiftShader — see the
  session's scratchpad `verify_integration.mjs`/`verify_part2.mjs` for the
  harness; this is a test-tooling limitation, not a gameplay defect (a
  real device renders and hit-tests normally).

## Decisions made

- Engine: Three.js + Capacitor 8, chosen because the owner builds entirely
  in the cloud and Capacitor lets native builds run headlessly in CI.
- **Rewrote bead painting to sample the real planet textures** (`public/
  textures/*.jpg`) instead of procedural/Natural-Earth-polygon painting.
  Removed the molten "core" shell, `geo.ts` (world-atlas country lookup),
  and the `d3-geo`/`topojson-client`/`world-atlas` dependencies — the GDD's
  §3 pipeline (k-means + smoothing + region merge) replaces all of it and
  needs no geometry-in-polygon tests.
  - **Region count is budgeted, not size-thresholded.** `levels.ts` computes
    a deterministic `regionTarget` per level (~6 regions at the start of a
    chapter, rising to ~40 at its end, hard-capped at 45, split between
    surface/clouds by bead share). `BeadGlobe` repeatedly merges the
    *smallest* connected region into its dominant neighbor color until each
    shell is at/under its share — this replaced an earlier `minRegion`
    size-threshold approach that produced unplayable 100-300+ region levels
    (a 300+ tap mobile level is not shippable). Orchestrator review caught
    this; fixed by budgeting regions directly instead of a bead-count
    threshold. Tier breakpoints (15%/40%/75% of each chapter, for K only)
    are still an interpretation — the GDD table gives K per tier but not the
    exact progress fractions where each tier starts.
  - **Cloud existence is majority-smoothed and small-clustered-dropped.**
    The raw per-bead brightness threshold ("exists where luminance ≥ L40")
    produced scattered single-bead "clouds" (orchestrator review, see
    level-349 before/after). Fixed: the existence mask itself is
    majority-smoothed (2 passes) on the cloud shell's neighbor graph before
    compacting, and connected existence-clusters smaller than 12 beads are
    dropped, so clouds render as coherent patches. Cloud tones capped at 2
    (was 3) and cloud bead radius bumped (0.5x → 0.72x spacing) so a patch
    reads as a solid layer with no gaps between beads.
  - Cloud existence threshold is literally "L40" (luminance ≥ 40% of 255 ≈
    102) sampled from `earth_clouds.jpg`; Venus's clouds are always-on and
    procedural (no real Venus cloud texture bundled), banded by latitude +
    seeded noise into 2 cream tones.
- `GameSession` is a pure state machine that only talks to `BeadGlobe`
  through the `GlobeAdapter` interface (duck-typed, no import cycle) —
  keeps rules testable/headless and matches the GDD's "no THREE in the
  session API" contract.
- Bead animations (`BeadGlobe.update(dt)`) use an internal absolute clock
  and are fed an **unclamped-ish** dt from `Game.tick()` (clamped only to
  2s, vs. 0.05s for camera-inertia dt) — otherwise a throttled/backgrounded
  tab (rAF firing rarely) makes the assemble/burst-away animation look
  permanently "frozen mid-explosion" instead of catching up. Confirmed via
  headless Playwright, where rAF fired only ~1×/2s.

## Verification (this session)

Ran a headless-Chromium check (via the Vite dev server + dynamic import of
the real `src/game/` modules — see the session's scratchpad) for levels 1,
20, 40, 60, 150, 349, 351, 401, 451, 550: every level's queue-driven solver
(always fire the current probe color at a matching exposed bead) wins with
probes to spare. After switching to the region-target budget, probes range
8 (level 1) to 50 (level 349) — a 5-50 tap mobile session, per orchestrator
feedback (an earlier `minRegion`-threshold version produced 161-383 probe
levels). BeadGlobe build time stays under ~145ms even at level 349
(regionTarget-capped 6211 total beads, K=9) — well inside the 600ms
budget. Screenshots of levels 1/40/150/349/401/451 confirm Earth is
recognizable (Africa, north up, correct orientation) and gets visibly more
detailed at higher levels; clouds render as coherent white/off-white
patches (not scattered dots); Venus reads as solid cream cloud cover, Mars
as rust with darker basins, matching the GDD.

## Polish pass: lighting, bead realism, intro readability, launcher FX,
## localization (this session)

- **Gameplay lighting**: `SpaceScene`'s existing `gameplayBlend` cross-fade
  (dramatic fixed-Sun lighting ↔ a camera-relative "gameplay" key light) was
  present but too weak/too dark on the camera-facing hemisphere. Rebalanced
  rather than redesigned: `fillLight` (hemisphere) base 0.18→0.24 blending to
  0.5 in gameplay (was 0.5, now reached at a gentler curve), `gameplayLight`
  0→1.9 (was 2.5, tuned down after a first overshoot — see below),
  `sunLight` blends down to 1.0 in gameplay (was 1.8, so the fixed-direction
  dramatic sun doesn't fight the camera-relative key light), plus a new tiny
  always-on `THREE.AmbientLight(0.06)` so the terminator edge stays visible
  but the far side never crushes to pure black. **First attempt overshot
  badly**: bumping the lights *and* adding a bright `RoomEnvironment` PMREM
  to the bead material's `envMap` at once produced a totally blown-out,
  veiled-in-bloom globe (verified via screenshot, reverted numbers down in
  two more passes). Lesson for next time: change either the lights or the
  material's env/clearcoat in one pass and screenshot before stacking the
  other — the two amplify each other through `UnrealBloomPass`.
- **Sun/globe overlap**: added `SpaceScene.sunOverlapsGlobe()` — an
  angular-separation test (Sun direction vs. globe-center direction from the
  camera, against the globe's angular radius) that fades the Sun
  disc/glow/flare out whenever it would visually overlap the globe, on top
  of the existing gameplay-blend fade. This is shot-agnostic (works for
  gameplay, approach, hero, ...) rather than hand-tuning each camera path.
- **Bead material**: `MeshPhysicalMaterial` tuned for a "glossy pearl" look
  without re-blowing the exposure: `roughness 0.4`, `clearcoat 0.75`,
  `clearcoatRoughness 0.18`, `envMapIntensity 0.22` against a **dedicated
  `RoomEnvironment` PMREM** (`SpaceScene` generates it once in the
  constructor and assigns it only to `beadMaterial.envMap`; `scene.environment`
  — used by the planet body/atmosphere — stays the realistic dark-sky PMREM).
  The dark Milky Way env alone gave beads almost no specular energy to
  reflect, reading as flat matte plastic; RoomEnvironment gives a believable
  highlight but needed a much lower `envMapIntensity` than the sky env
  (0.6 before) because its point light is very bright (three.js's
  `RoomEnvironment` uses a `PointLight` intensity of 900).
- **Bead color saturation**: `BeadGlobe.readablePalette()` already
  Lab-adjusted colors for legibility (min lightness/chroma band, min ΔE
  between palette entries); widened that band (`MIN_L` 34→36, `MAX_L`
  84→88, `MIN_CHROMA` 16→24, `MIN_DELTA_E` 18→20) and added a flat
  `CHROMA_BOOST` (×1.18) applied to every non-neutral color, not just weak
  ones, so natural Earth tones read as clearly distinguishable, saturated
  beads at every tier (checked levels 1, 20, 200, 349) instead of the muted
  average color a straight equirectangular sample produces.
- **Intro readability**: `.wb-titlebeat` now sits on its own dark glass
  panel (not just a thin full-screen wash) with a heavier multi-layer
  text-shadow, so both title beats read clearly regardless of what's behind
  them (checked against both the starfield and the lit Earth). The 4.5-
  billion-years beat still shows over a fairly dark Earth (that beat holds
  on the `sunPass` shot, which is deliberately the night-side view before
  the `approach` transition per the GDD's shot list) — the fill/ambient
  bump above turns that into a soft rim-lit dark-blue sphere rather than a
  flat black disc, which reads as intentional ("planet at night") rather
  than broken.
- **Launcher/probe FX**: the HUD dock's current-probe orb already tinted
  itself to the probe's real color via a CSS custom property (not a plain
  grey ball); added a pulsing glow animation (`wb-orb-glow`) for the
  "glowing, pulsing halo" ask. The in-flight 3D probe (`fx.ts`
  `ProbeSystem`) already had a halo + fading line trail; brightened both
  and added `FxSystem.probeTrailDot()` — a comet-tail of short-lived spark
  dots laid down every frame along the flight path, reusing the existing
  pooled `SparkSystem` buffer (no new geometry/draw call per shot).
- **Localization**: `src/ui/strings.ts` is the single source of English/
  Turkish UI strings (`S.*`, `PLANET_NAMES`, `POWER_NAMES`), no i18n
  library. `LANG` is decided once at module load from
  `navigator.language.startsWith('tr')`. `src/game/facts.ts` picks a
  parallel `FACTS_EN`/`FACTS_TR` table via the same `LANG`. Every
  hardcoded string in `gameui.ts` and `Game.ts` (HUD labels, toasts, level
  complete/failed cards, unlock cards, tutorial captions, intro title
  beats, settings, credits) now goes through `strings.ts`. Verified with
  Playwright's `locale: 'tr-TR'` context option (which drives
  `navigator.language`): Turkish characters (ç ğ ı ö ş ü) render correctly
  through the existing Orbitron→Exo 2 font-stack fallback — Orbitron's
  bundled subset is latin-only, but CSS does per-glyph font fallback, so a
  missing Turkish letter in Orbitron silently renders from Exo 2 instead of
  breaking. **Known minor gap**: a few UI elements apply `text-transform:
  uppercase` in CSS for a stylistic all-caps look; the CSS uppercasing is
  locale-unaware, so Turkish "i" → "I" instead of "İ" in a couple of
  headers (e.g. "DÜNYA" is fine, but a lowercase "i" in a translated string
  run through that CSS rule would capitalize wrong). Not fixed this session
  (would need per-element `.toLocaleUpperCase('tr-TR')` in JS instead of
  the CSS rule) — none of the currently-translated strings happen to
  contain a lowercase dotted/dotless i in an all-caps element, so it isn't
  visible today, but flag it if more Turkish copy is added later.

## Planet cycle, spin dynamics v2, retry/continue economy, onboarding,
## clouds v2, color distinguishability, comet fix (this session)

- **Planet cycle (#15)**: `src/game/levels.ts` was rewritten from a fixed
  Earth→Moon→Venus→Mars chapter table to a repeating 5-planet cycle
  (`CYCLE = ['earth','moon','mars','venus','jupiter']`, `SLOT_LENGTH = 10`
  levels per planet, `MAX_LEVEL = 1000` = 20 full cycles). `getLevel(n)`
  derives `planet`, `visitNumber` (0 = first visit, 1 = second, …),
  `nextPlanet` and `levelsUntilNextPlanet` from `n` alone — `?level=N`
  still works unchanged. Every difficulty/detail curve (`k`, `beadCount`,
  `layerCount`, `regionTarget`, `shotSlack`, cloud fluffiness) is a
  function of the *global* level number via a single continuous curve per
  stat, never reset per planet or per cycle, so a later visit to a planet
  (e.g. the 2nd Earth visit at level 51, or the 7th at level 341) is always
  measurably more detailed than the previous visit — verified in the
  per-level table below (Jupiter visit 1 @100 vs visit 6 @349: K 5→8,
  layers 2→4). Jupiter has no bundled real texture, so it's the one planet
  painted procedurally: `game/texture.ts`'s `generateJupiterBands()` (bead
  painting) and `render/planetBody.ts`'s separate
  `generateProceduralBandsTexture()` (the 3D planet body) each implement
  their own canvas-based banded/turbulent noise painter with a Great-Red-
  Spot-like blob, both deterministic and offline (no network fetch) — kept
  as two independent implementations rather than a shared import because
  `src/render` and `src/game` intentionally never import from each other.
- **Spin dynamics v2 (#16, superseding the original "idle spin" of #10)**:
  `render/spin.ts`'s `SpinDriver` is a small deterministic (mulberry32-
  seeded) state machine — spins 2-3s, pauses ~1s, sometimes reverses,
  speed/axis-tilt/reversal all keyed off a 0-1 `difficulty` derived from
  `(level-1)/(MAX_LEVEL-1)`. **Owner refinement**: for the first
  `AUTO_SPIN_LEVEL - 1` levels there is *no* auto-spin at all — only drag
  moves the globe (`SpaceScene.autoSpinEnabled` gates the whole driver).
  Once auto-spin starts, the drag doesn't pause it; instead
  `SpaceScene.spinResistance()` returns 0-0.55 (scaled by difficulty) and
  `Game.ts`'s pointermove handler multiplies the rotation delta by
  `1 - resistance`, so a drag "fights" the spin in proportion to
  difficulty but can never fully lock it out (min grip is always > 0), and
  the spin keeps running underneath uninterrupted so it resumes seamlessly
  the instant the finger lifts — no explicit "resume" logic needed.
- **Retry/continue economy (#17, final version)**: `GameSession.ts`
  exports `RETRY_COST = 100` and `CONTINUE_COST = 500` as the single
  source of truth (no other file hardcodes a price). On loss,
  `GameUI.showLevelFailed()` shows two buttons: **Retry** (always enabled,
  `Math.min(balance, RETRY_COST)` is deducted — it never blocks a broke
  player) and **Continue** (`+CONTINUE_EXTRA_PROBES = 5` shots, keeps the
  current board/progress via the new `GameSession.continueAfterLoss()`
  which un-ends a `'lose'` session; the button is `disabled` and shows its
  price with no click handler when `stardust < CONTINUE_COST`). Both
  buttons show their cost with the stardust icon, localized
  ("Tekrar Dene" / "Devam Et").
- **Onboarding staggering (#18a)**: every discrete new mechanic gets its
  own level, chosen to never collide with another mechanic or with a
  planet-change level (`level ≡ 1 mod 10`): `fire`/`rotate`=1, `swap`=3,
  `meteor`=6, `prism`=12, `autoSpin`=15 (`AUTO_SPIN_LEVEL`),
  `cloudLayer`=8 (`FIRST_CLOUD_LEVEL`, synced from `unlocks.ts` rather
  than a separate hardcoded number), `solarFlare`=25, `spinTilt`=35
  (`SPIN_TILT_LEVEL`), `newLayer`=45/120/260 (`LAYER_MILESTONES`,
  discrete — total layer count only ever changes at these three levels),
  `comet`=60, `spinReverse`=75 (`SPIN_REVERSE_LEVEL`), `cloudDrift`=33
  (`CLOUD_DRIFT_LEVEL`, i.e. "any cloud level from here on drifts and
  blocks" — the *actual* first level this manifests depends on which
  planet has clouds at that point; verified by simulation to be level 33,
  two levels into Venus's slot, deliberately placed *after* Venus's own
  `newPlanet` card at level 31 rather than on the same level, so the
  planet-change and the cloud-drift tutorial never compete for the
  player's attention in one level). `newPlanet` and `newLayer` have no
  fixed level in `unlocks.ts` (impossible with a cycling/curve-driven
  design) — `Game.ts`'s `runTutorialsForLevel()` detects them dynamically
  by diffing `getLevel(cfg.level)` against `getLevel(cfg.level - 1)`.
- **Unskippable tutorials (#18b) — judgment call**: a new *interactive,
  blocking* tutorial (`Tutorial.run()`, cannot be dismissed without doing
  the gesture) is given only to mechanics that change what the player must
  physically do: `autoSpin` (first time the globe moves on its own — drag-
  to-fight-it tutorial) and `cloudDrift` (first time a shot can be blocked
  by something moving — tap-through tutorial, reusing the same
  `findLargestExposedCloudRegion()` targeting as the original `cloudLayer`
  tutorial). Spin **tilt** and **reversal** don't introduce a new input or
  break existing hit-testing (drag still works identically; a shot in
  flight already re-tracks its target's live position every frame
  regardless of axis), so they get a lightweight one-time, non-blocking
  `showToast()` instead of a forced gesture — documented here as a
  deliberate reading of "every newly introduced mechanic" as "every
  mechanic that changes what the player must do," not literally every
  numeric ramp-up.
- **Universal facts (#18c)**: `game/facts.ts` adds `GENERAL_FACTS_EN`/
  `_TR` (Sun, light-year, Solar System, Milky Way, black holes, Proxima
  Centauri, neutron stars, observable universe, Saturn's rings, UY Scuti)
  alongside the existing per-planet fact tables, and `randomFactFor(planet)`
  mixes the two 50/50 so "Did you know" cards cover the whole universe, not
  just the current world, in both languages.
- **Device-language detection (#18d)**: `strings.ts`'s `detectLang()` now
  reads `navigator.languages?.[0] ?? navigator.language` (the former is
  what Capacitor's WebView actually reflects for the OS/app language;
  `navigator.language` is kept only as a fallback for a browser that
  doesn't populate `languages`), defaults to English for anything not
  starting with `tr`. Audit of the whole UI found and fixed one genuine
  leftover hardcoded-English string: `gameui.ts`'s skip button
  (`'Skip'` → `S.skip`) — everything else already routed through `S.*`.
- **Cloud evolution/drift (#19)**: `cloudFluffiness` (0→1, saturating at
  level 150) drives the clouds' material toward softer/more translucent
  as levels rise (a continuous cosmetic curve, not a mechanic — no
  tutorial needed for it by itself). From `CLOUD_DRIFT_LEVEL`, the clouds
  `Shell` gets a `driftSpeedRad`; `BeadGlobe.updateCloudDrift()` spins the
  clouds `InstancedMesh`'s own `.rotation.y` each frame (cheap — the whole
  shell drifts for free through the render transform, no per-instance
  matrix rewrite) and periodically (every ~3° of drift) recomputes what it
  covers via `buildCoveredBy()` on the rotated direction set, so beads
  underneath genuinely go in and out of "blocked" as the clouds pass over.
  Two correctness fixes were needed to keep item #9 ("hittable from every
  angle") true once clouds actually move: (1) `positionOf()`,
  `forEachExposed()`, `beadsOfColorInHemisphere()` and `beadsInBand()` all
  now route the query point/direction through new `toShellLocal()`/
  `fromShellLocal()` helpers that undo/apply a shell's own
  `mesh.rotation.y` before comparing against its raw (un-rotated) `dirs`
  array; (2) `resolveHit()`'s existing cloud-snap fallback (the nearest-
  alive-cloud-bead search used when the raycast hits the sphere but misses
  every instance) now transforms the query point through `toShellLocal`
  too, so it still finds the right bead once the clouds shell is spinning.
- **Color distinguishability (#20) — real bug found and fixed**:
  `readablePalette()`'s union-find merge pass had a genuine bug: it
  recorded a pair's CIE76 ΔE into the reported `minDeltaE` in the same
  loop iteration that decided to merge that pair, so the reported number
  reflected a distance that was about to be merged away and no longer
  existed in the final palette. Fixed by splitting into two passes — merge
  everything under `MIN_DELTA_E = 20` first, *then* measure `minDeltaE`
  only across pairs that ended up in different final groups. This was a
  reporting-only bug (the actual final palette was already correctly
  separated, since the single merge pass visits every raw pair including
  any two final roots directly), but it's worth remembering because a
  future change to that function should keep the two passes separate.
  Verified minΔE per level after the fix: L1 39.3, L10 38.5, L30 20.7,
  L60 24.4, L100 20.1, L200 20.1, L349 20.0 — always ≥ the 20 floor, and K
  is implicitly capped by the merge (`readablePalette` can return fewer
  colors than requested) rather than ever violating the floor.
- **Comet swipe bug (#21) — real bug found and fixed**: `Comet` worked in
  its own tutorial (a short on-globe synthetic swipe) but not in normal
  play. Root cause: `screenToGlobeDir()` used `Ray.intersectSphere()` and
  returned `null` whenever the swipe's start or end point missed the 1.05×
  bead sphere in screen space — which a real "swipe across the world"
  very often does (it naturally starts/ends off the visible globe), while
  the tutorial's synthetic swipe happened to stay on it. Fixed by falling
  back to the closest point *on* the sphere to the ray (`Ray.
  closestPointToPoint(center)`, projected out to the sphere radius) when
  the direct intersection misses, so an edge-to-edge swipe now resolves to
  a real direction on both ends; `resolveComet()`'s existing "directions
  too close together" check still correctly cancels a genuinely too-short
  swipe. Verified live at `?level=60&skipIntro=1`: after the forced
  tutorial, arming Comet again and swiping from near the left screen edge
  to near the right screen edge (well off the globe on both ends) produced
  a real "MEGA POP ×76" and consumed a charge — confirmed broken before
  the fix (screenshots: `after2/comet_after_real_swipe.png`).
- **Win → level-complete → warp → next-planet flow (#14), re-verified
  under the new cycle system**: driven via the dev-only `window.__wbQA`
  hook (real pointer events at QA-computed exact hit coordinates, not
  synthetic state mutation) at `?level=10&skipIntro=1` — level 10 is the
  last level of Earth's first slot, so winning it exercises the exact
  `newPlanet`-card + warp + next-slot transition the cycle system adds.
  26 real fires cleared level 10, the level-complete flow fired, the warp
  cinematic played, and the game landed cleanly on Level 11 (Moon) with
  the correct "Next planet: Mars — 9 levels" badge and a fresh `assemble()`
  intro for the new globe (screenshot: `after2/win_card.png`, taken mid-
  assemble). Level 350 (Jupiter, visit 6, K=8, 4 layers, auto-spin+tilt+
  reverse all active) was also attempted directly per the original ask,
  but a scripted clear stalled: at that difficulty the QA hook's "find the
  current queue color's largest visible region" can legitimately return a
  region that is entirely on the globe's far side while auto-spin is
  mid-cycle, and the script's rotation nudges didn't reliably catch up
  within the time budget — this is the same known limitation already
  logged under Open Items below, not a gameplay bug (a human player just
  keeps rotating until it's in view). The flow itself is level-independent
  code (`Game.ts`'s `for(;;)` loop in `run()`), so the level-10 clear is
  sufficient evidence the mechanism holds at level 350 too.

### Per-level checkpoint table (post items #15-20)

| Level | Planet (visit) | Beads | K | minΔE | Layers | Cloud drift | Auto-spin/tilt/reverse | Region target |
|---|---|---|---|---|---|---|---|---|
| 1 | Earth (0) | 800 | 3 | 39.3 | 1 | no clouds yet | no/no/no | 6 |
| 20 | Moon (0) | 1348 | 4 | (no clouds on Moon) | 1 | n/a | yes/no/no | 7 |
| 60 | Earth (1) | 1360 | 4 | 24.4 | 2 | yes | yes/yes/no | 12 |
| 100 | Jupiter (1) | 2357 | 5 | 20.1 | 2 | no clouds | yes/yes/yes | 13 |
| 150 | — | — | — | — | — | — | — | (cloud fluffiness saturates here) |
| 200 | Jupiter (3) | 2970 | 6 | 20.1 | 3 | no clouds | yes/yes/yes | 21 |
| 349 | Jupiter (6) | 3803 | 8 | 20.0 | 4 | no clouds | yes/yes/yes | 30 |

(10 and 30 also checked: L10 beads 913/K3/minΔE 38.5/clouds present-not-
drifting; L30 beads 1747/K4/no clouds on Mars.) Jupiter never gets clouds
in `CURVES` (`cloud: 'none'`), which is why the high-K late-game rows show
no cloud drift despite being well past `CLOUD_DRIFT_LEVEL` — only Earth
(from level 8) and Venus (`cloud: 'always'`) ever grow a cloud shell.

## Open items

- iOS platform (`npx cap add ios`) and its GitHub Actions workflow — needs
  macOS runner, not yet added.
- Release signing (Android keystore, iOS certificates/provisioning).
- App store listings (Play Store, App Store).
- Monetization.
- Automated win-flow QA via real Playwright taps is confirmed to work but
  needs generous per-shot delays (~700-900ms, to clear the 0.25s probe
  flight before the next poll) and must itself drag-rotate the globe when
  the dev QA hook (`window.__wbQA`, dev-only) reports no reachable target,
  since remaining regions can be on the globe's far side — a real player
  rotates to reach them; a script that doesn't will falsely look "stuck".
  This got noticeably harder to script reliably at very high levels
  (auto-spin + tilt + reversal all active at once, e.g. level 350) since
  the globe keeps moving on its own between polls — a fixed-camera QA mode
  (pause spin under a `?qa=1` flag) would make this much more robust if
  deep-level automated QA becomes a recurring need.
- Cloud "fluffiness" (item #19) is currently an opacity/roughness/
  clearcoat material approximation, not true billowy/volumetric geometry —
  reads well at the bead scale used here, but flag if a future pass wants
  literal cloud-shaped geometry instead.
- `demo.ts`/`demo.html` (a dev-only harness for screenshotting isolated UI
  states like the two-button level-failed card) is not part of the
  production bundle — `demo.html` is created temporarily and deleted after
  use, never left in the tree, since no build entry references it.
