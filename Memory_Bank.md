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

## Alien invasion module (owner: Arda; merged from a parallel worktree, then wired into `Game.ts` this session)

Built entirely in new files, isolated from a concurrent large edit pass over
`Game.ts`/`BeadGlobe.ts`/`GameSession.ts`/`levels.ts`/`SpaceScene.ts`/`fx.ts`/
`gameui.ts`/`ui.css`/`facts.ts` — see `docs/INVASION_INTEGRATION.md` for the
exact `Game.ts` call sequence a future session should wire up.

- `src/game/invasion.ts` — pure rules (no THREE/DOM), same shape as
  `GameSession`: `invasionConfigForLevel(level)` (deterministic, seeded
  per-level difficulty curve — first invasion at level 80, frequency/ship
  count/attack speed/fire-spread rate/extinguish-probe delay all rise slowly
  through level 550) and `InvasionController` (ship schedule, attack timers,
  fire ignite/spread, tracks which beads are on fire).
- `src/render/aliens.ts` — THREE-only pooled saucer ships (PBR hull +
  emissive rim + cockpit dome + engine glow + charge-telegraph orb + laser
  beam + explosion burst), `AlienInvasionRenderer` with
  `spawnShip`/`setCharging`/`fireLaser`/`destroyShip`/`raycastShips`/`update`.
  Self-contained — doesn't import `src/render/fx.ts` to avoid touching a
  file under concurrent edit.
- `src/audio/types.ts` + `src/audio/sfx.ts` — 6 new procedural SFX
  (`shipArrive`, `laserCharge`, `laserFire`, `fireCrackle`, `extinguish`,
  `shipExplode`), following the existing `playTone`/`playNoise` synthesis
  pattern; `AudioEngine.ts` needed no changes.
- **Fire mechanic**: a fire bead is just a normal bead whose logical color
  is reassigned to a reserved ember hex (`FIRE_COLOR` in `invasion.ts`) via
  two new **optional** `GlobeAdapter` members added to `src/game/types.ts`
  (`neighborsOf`, `igniteFire`) — `BeadGlobe` doesn't implement them yet
  (small, precise addition described in the integration doc; `region()`/
  `pop()`/win-condition all already work correctly for any `colorIdx`
  without change). This means "extinguish" needs **no new game-rules code
  at all**: a probe of the fire color, fired at a fire bead, already pops
  the whole connected patch through the existing `GameSession.fire()` path.
  The integration layer only needs to force that color into
  `session.queue` (a public mutable field) on the right shot.
- `src/render/aliens-demo.html` + `.ts` — standalone demo (same pattern as
  `src/render/demo.html`): a real `InvasionController` + real
  `AlienInvasionRenderer` running against a small self-contained
  `GlobeAdapter` (`DemoGlobe`), since `BeadGlobe` can't yet host fire.
  `DemoGlobe` doubles as a concrete reference implementation for the
  `BeadGlobe` addition. `?level=N` picks which level's config to preview
  (default: the guaranteed first invasion level).
- Verified via headless Playwright screenshots (390×844, SwiftShader) of the
  demo page: ship approach/banking, hover wobble, charge telegraph
  (cyan→orange rim), laser beam, fire ignition (ember-colored beads,
  close-up confirmed), two-ship harder level, and ship destruction
  (explosion burst). One rendering gotcha worth remembering for any future
  headless demo page: **don't `await` a `SpaceScene.flyTo()` before
  starting the `requestAnimationFrame` loop** — the tween only ever
  advances inside `scene.update(dt)`, so awaiting it first deadlocks;
  start the render loop unconditionally, then run `init()` in parallel.
  Also, headless/software rendering frame times are wildly uneven (seen:
  ~500ms-1s per frame with this scene's bead count + bloom), so this demo's
  own dt clamp is
  deliberately loose (0.2s, vs. the real game's ~0.05s) to avoid the
  approach animation looking frozen without also letting one slow frame
  fully consume a short VFX (explosion, laser) between paints. The clamp is
  further tightened to ~0.045s specifically while a ship is charging past
  80% or has just fired (`dtClamp` in `aliens-demo.ts`'s `frame()`), since a
  0.2s clamp alone can still swallow the ~0.22s laser zap whole in one slow
  frame.
- **Round 2 (coordinator review fixes, same session)**: four points raised,
  all addressed in the same worktree without touching `Game.ts` or any
  concurrently-edited file:
  1. *Targeting the visible hemisphere* — `InvasionController.tick(dt, viewDir)`
     now takes a globe-local `Vec3` (same "camera position in globe-local
     space" trick as Solar Flare) and `pickImpactTarget()` samples within a
     widening cone of it (`sampleCone()`, uniform-over-spherical-cap) instead
     of the whole sphere. The `shipSpawned` event now carries `target: BeadRef
     | null`, chosen at spawn (not arrival) so the render layer can plan the
     whole approach around a point already known to be visible.
  2. *Ship visuals* — `aliens.ts`'s hull is now a `LatheGeometry` saucer
     profile (not a squashed sphere) with a procedural canvas panel-line
     texture, two swept fin pods with engine-glow tips, an underside ring of
     8 pulsing glow sprites (cyan→orange with charge, chasing pulse), and a
     glass canopy dome. `aliens-demo.ts`'s `computeApproachPath()` places the
     hover point on the camera→target ray (screen-safe-clamped in NDC space,
     extra headroom at the top edge) so the ship is always fully on-screen
     and visibly hovers between the camera and what it's about to shoot.
  3. *Fire look* — `DemoGlobe.updateFireFlicker()` (the `BeadGlobe`
     reference implementation, and the exact snippet in
     `docs/INVASION_INTEGRATION.md`) now layers a two-frequency per-bead
     flicker (dim ember red → hot orange-yellow) under a fading white ignite
     pulse (~0.45s) on newly-lit beads. `src/render/fireEmbers.ts` (new) is a
     pooled rising-ember-spark + faint-smoke particle system, parented under
     the same rotating frame as the beads; dead pool slots fade their vertex
     color to black under additive blending rather than needing visibility
     bookkeeping.
  4. *Fire-spread visibility* — the ignite pulse above (point 3) doubles as
     the "newly-ignited beads flash" the review asked for.
  Re-verified via a fresh screenshot set in `scratchpad/invasion2/` (kept
  alongside, not replacing, the original `scratchpad/invasion/`).

## Invasion wired into the real game (this session)

Wired the module above into `Game.ts`/`BeadGlobe.ts`/`unlocks.ts`/`strings.ts`
per `docs/INVASION_INTEGRATION.md`'s plan, then fixed the visuals the owner's
review of the demo screenshots rejected. `src/render/aliens-demo.ts`/`.html`
were deleted (YAGNI) once the real game exercised the same code paths.

- **`BeadGlobe` fire support**: added the two `GlobeAdapter` optional members
  exactly as the integration doc specified — `neighborsOf()` (exposes a
  shell's existing `nbrStart`/`nbrList` graph) and `igniteFire()` (lazily
  reserves one palette slot per shell for `FIRE_COLOR`, reassigns
  `colorIdx`, repaints immediately, records `ignitedAt`). A new
  `updateFireFlicker()` runs every `update(dt)` tick: per-bead two-frequency
  sine flicker from ember red toward a hot near-white-hot orange-yellow
  (`0xffee66`), plus the ~0.45s white ignite pulse on newly-lit beads.
- **First invasion level: 80** (`INVASION_FIRST_LEVEL`, unchanged from the
  parallel worktree's own reasoning) — checked against the onboarding
  milestone list (item #18a): the last *interactive/blocking* tutorial
  before it is `cloudDrift` at 33, and the last unlock of any kind is
  `comet` at 60, so level 80 lands after the whole toolkit exists and after
  a real calm stretch, well before the next layer milestone (120). Level 80
  falls in Mars's 7th cycle slot (`getLevel(80).planet === 'mars'`), which
  incidentally forced the fire-vs-Mars-palette distinctness question (item
  #3 below) to be checked on exactly the planet the owner named.
  `unlocks.ts` gained one entry (`{ level: INVASION_FIRST_LEVEL, id:
  'invasion', tutorial: 'invasion' }`) and `UnlockId` gained `'invasion'`.
  Curve beyond 80 is unchanged from `invasion.ts`'s `CURVE`: chance 100%→
  30%→38%→45%→52%→65% at 80/120/200/350/451/550, attack delay 3.0s→2.0s,
  ship count 1→3, fire-spread every 4→2 shots, extinguish offered after
  1→4 shots — see that file's own doc comment for the full table.
- **Tutorial**: a new `'invasion'` case in `Game.ts`'s `runTutorialScript`
  spotlights the first ship (`shipScreenCircle()`, tracking
  `AlienInvasionRenderer.getShipWorldPosition()` every frame — null, and so
  no spotlight yet, until the ship actually spawns) and blocks on the first
  `laserFired` event *or* the player destroying the ship by tapping it
  (`pendingInvasionResolve`, same pattern as every other forced tutorial's
  `pendingXResolve`). If fire is still burning once that resolves, a second,
  non-blocking toast explains the extinguish probe. EN/TR copy added to
  `strings.ts` (`S.tutorial.invasionShip`/`invasionFire`,
  `S.unlockName.invasion`, `S.unlockDescription.invasion`); a small new
  `'ship'` icon was added to `icons.ts` for the unlock card (a plain saucer
  glyph, matching the existing icon style — no product/brand reference).
- **Per-frame wiring**: `Game.ts` owns one persistent `AlienInvasionRenderer`
  (`scene.scene.add(aliens.group)` — ships live in world space, hovering
  between the camera and the globe, independent of the globe's own
  rotation) and one persistent `FireEmberSystem` (`scene.spin.add(...)` —
  the same rotating frame every level's `BeadGlobe.group` is parented
  under, so embers/smoke track the globe's spin/drag like the beads they
  rise from). `prepareLevel()` builds a fresh `InvasionController` from
  `invasionConfigForLevel(cfg.level)` (or none) and calls
  `this.aliens.reset()` first, so a ship left mid-attack from a level exited
  early (a win, or a retry) never carries over onto the next globe. A new
  `updateInvasion(dt)` in the render loop ticks the controller only while
  `state === 'playing'` (never during loading/win/lose) using the same
  "camera position in globe-local space" trick Solar Flare already uses for
  `viewDir`, maps its events to `AlienInvasionRenderer`/`FireEmberSystem`/
  `AudioEngine` calls, and always updates the renderers themselves so an
  in-flight explosion/laser still finishes smoothly the instant a level
  ends. `computeApproachPath()` (copied from the demo per the integration
  doc, then fixed — see below) is now a private Game.ts helper.
- **Tap routing (item #4)**: `handleGlobeTap()` raycasts ships *before*
  beads and *before* the `probes <= 0` guard (destroying a ship is free and
  must work even at 0 probes) — a hit consumes the tap entirely, no probe
  spent, no bead behind the ship also fired at.
- **Extinguish (item #5)**: after every `session.fire()` call,
  `applyInvasionShotOutcome()` calls `InvasionController.onShotFired()` and,
  when it returns a non-null `queueOverrideColor`, writes it into
  `session.queue[1]` (a public mutable field — no `GameSession.ts` change
  needed, exactly as the integration doc predicted). Popping a fire patch
  needed no new rules code; `handleEvents()`'s `'fire'` hit branch now plays
  `'extinguish'` (a hiss) instead of `pop`/`bigPop` when `ev.color ===
  FIRE_COLOR`.

### Visual fixes after the owner's screenshot review

1. **Ship too small ("a small ring at the globe's edge")** — two real bugs,
   not just a scale tweak: (a) `computeApproachPath()`'s spawn point used
   `pointAtRadiusAlongRay(camPos, dir, 5.5)` — "5.5 units from the *world
   origin*" — but the gameplay camera itself sits only ~5.6 units from that
   origin, so the spawn point landed almost on top of the camera (~0.1
   units away), making the ship flash enormous for an instant at the start
   of its approach rather than reading as "arriving from far away". Fixed
   by placing the spawn point a fixed 6 units *behind* the already-computed
   hover point along the same camera ray instead, which is invariant to how
   far the camera happens to sit from the globe. (b) The steady hover size
   itself was measured directly from real in-game screenshots (not
   recomputed from FOV/distance formulas, which had assumed the wrong
   hover-to-camera distance): scale 1.4 measured at ~1/6 screen width as
   intended once (a) was fixed, so an interim overshoot to 2.6 (~32% of
   screen width, confirmed too big) was corrected to a final `1.5`.
   Separately, the hull/fin materials were too dark — `MeshStandardMaterial`
   at `metalness: 0.75` lit only by `scene.environment` (the dim Milky Way
   PMREM, by design realistic for the planet body) read as a near-black
   silhouette against Mars. Fixed with lower metalness (0.4), a lighter
   base color, a small always-on emissive floor, and a small practical
   `PointLight` traveling with the ship (the same problem `BeadMaterial`
   solved with a dedicated `RoomEnvironment` PMREM — a literal light was
   cheaper here for a handful of pooled ship slots).
2. **Laser travel + impact flash** — already correctly implemented in the
   parallel worktree's `aliens.ts` (world-space beam from the ship's
   `chargeOrb` to the real target bead, via `worldToLocal`, plus a fading
   impact-flash sprite); just needed real coordinates from the wired game,
   which `handleInvasionEvent()`'s `'laserFired'` case now supplies
   (`globe.positionOf()` → `globe.group.localToWorld()`).
3. **Fire distinctness (item #3, including vs. Mars)** — level 80's own
   invasion happens to land on Mars, the exact palette the owner asked to
   check. `updateFireFlicker()`'s hot end (`0xffee66`) is a near-white-hot
   yellow-orange well past any k-means-sampled planet palette's max
   lightness (`readablePalette()` caps at `MAX_L = 88`), the base ember red
   is far more saturated than Mars's muted rust tones, and — unlike any
   static bead color — it visibly animates every frame; `FireEmberSystem`
   adds rising ember sparks and faint smoke on top. Confirmed by direct
   screenshot on level 80 (Mars) in `scratchpad/invasion3/`.
4. **Tap hit radius (item #4)** — `AlienInvasionRenderer.raycastShips()` no
   longer raycasts the ship's actual small hull mesh (fussy on a
   touchscreen); it now does a generous fixed-radius (`HIT_RADIUS = 0.2`
   world units) distance-to-ray test against each active ship's real world
   position, sorted nearest-first. Ships-before-beads tap routing (above)
   ensures this never also fires a probe at a bead behind the ship.
5. **Extinguish probes** — see "Per-frame wiring"/"Extinguish" above.
6. **Demo page deleted** — `src/render/aliens-demo.ts`/`.html` removed
   entirely: the real game now exercises every code path the demo existed
   to preview (approach/hover/charge/laser/fire/explosion,
   `computeApproachPath`), so keeping a second, parallel harness around
   would violate YAGNI.

Verified with Playwright (`locale: 'tr-TR'`, SwiftShader) against the real
built game (`npm run build` + `vite preview`) at `?level=80&skipIntro=1`
(guaranteed first invasion, on Mars) and `?level=210&skipIntro=1` (a later,
harder, non-tutorial invasion found by replicating the seeded coin-flip in a
small standalone script) — see `scratchpad/invasion3/` for the full shot set
(tutorial card and spotlight in Turkish, ship approach/hover/charging/laser/
fire-ignite, and the level-210 undimmed view). `npm run build` passes clean
(`tsc --noEmit && vite build`, no new warnings beyond the pre-existing
"chunk larger than 500kB" notice).

(`docs/INVASION_INTEGRATION.md`, the pre-wiring plan referenced above, was
later deleted once its wiring was fully done — see the "deleted (YAGNI)"
section near the end of this file.)

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

## Bead-size bug fix, Jupiter banding, terminology, tutorial-dim readability
## (owner review round)

- **Bead size — real bug found and fixed**: bead radius used to be
  `spacing(beadCount) * shellRadiusScale * factor`, and `beadCount` for
  extra outer layers was `surfaceBeadCount * 0.45^depth` — *fewer* beads
  per layer the farther out, which made outer/coarser layers' beads
  visibly **bigger** than an earlier level's single, finer surface layer
  (e.g. level 55's outer layer was bigger than level 2's only layer) —
  the exact opposite of "beads shrink as levels rise." Root cause: bead
  count was chosen top-down from a per-planet `beadRange` and a coarseness
  *fraction*, with radius as an incidental side effect, rather than radius
  being the thing actually designed. Fixed by inverting the relationship in
  `src/game/levels.ts`: `surfaceBeadRadius(sizeProgress)` and
  `layerBeadRadius(sizeProgress, depthFromSurface)` are now the source of
  truth — two small, purely-numeric, monotonically-decreasing-in-level
  curves (`BEAD_RADIUS_MAX = 0.072` down to `BEAD_RADIUS_MIN = 0.03`,
  saturating by `BEAD_SIZE_SATURATION_LEVEL = 700`), with outer layers only
  ever `BEAD_RADIUS_COARSE_PER_DEPTH = 12%` bigger than the layer just
  inside them at the *same* level, and hard-clamped to never exceed
  `BEAD_RADIUS_MAX` (level 1's own radius) — so no bead, on any layer, at
  any level, can ever be bigger than level 1's. `beadCountForRadius()`
  inverts `BeadGlobe.ts`'s actual `makeShell` formula (`RADIUS_STEP = 0.03`,
  `factor = 0.56`, duplicated as commented constants in `levels.ts` rather
  than cross-imported, matching this codebase's existing module-isolation
  convention) to get the bead count that formula needs to hit each target
  radius. `BEAD_RADIUS_MIN`/`BEAD_SIZE_SATURATION_LEVEL` were chosen so a
  maxed-out level (4 layers, fully saturated) totals ~14k beads and *never
  needs to grow bead size back up* to stay under that budget — satisfying
  the owner's stated priority ("cap total beads for mobile and reduce layer
  count before you ever increase bead size") by construction, since layer
  count is separately hard-capped at 4 by `LAYER_MILESTONES`. Per-planet
  `beadRange` was removed entirely from `CURVES` — bead size is now 100%
  global/planet-independent, which also directly serves the "Earth must
  look more detailed on every revisit" requirement, since every planet
  (including every Earth revisit) draws from the exact same level→radius
  curve. Also revised outer-layer K: was `max(2, k - depth - 1)` (crushed
  outer layers toward near-monochrome, e.g. K=2 at level 55's outer layer —
  itself a big part of why it read as "less detailed than level 2"); now
  `max(3, k - depth)`, never below 3 distinct colors on any layer.
- **Jupiter banding — real bug found and fixed**: the original procedural
  palette (`generateJupiterBands` in `game/texture.ts`, and its render-side
  duplicate `generateProceduralBandsTexture` in `render/planetBody.ts`)
  used six similar cream/tan/brown hues blended with a perfectly smooth
  latitude gradient — visually weak, and after k-means quantization it
  read as nearly one flat beige color. Replaced with an 8-band palette that
  strictly *alternates* pale cream/white "zones" and dark rust-brown/near-
  black "belts" (real Jupiter's actual pattern), added an `fbm3`-driven (own
  hash-noise on the render side, per the module-isolation rule) warp to the
  band-selection latitude so edges are wavy/turbulent instead of clean
  stripes, switched the band blend from linear to a narrow `smoothstep` so
  each band reads as its own solid color class over most of its width, and
  enlarged/reddened the Great Red Spot. Both implementations were updated
  in lockstep (still two independent files, per the existing contract).
- **Terminology consistency**: `strings.ts`'s Turkish `level`/
  `levelComplete`/`nextLevel` used "Bölüm" (chapter) while `nextPlanetIn`
  already used "seviye" (level) — inconsistent on the same HUD. All now use
  "Seviye" consistently in Turkish (English unaffected, already "Level").
- **Tutorial-dim readability**: the tutorial overlay's dim rect
  (`.wb-tutorial-dim`, `z-index: 50`, covering the full viewport) sat above
  the HUD's topbar and probe dock, which have no `z-index` of their own —
  so the current-probe orb (correctly tinted to the queued color the whole
  time — confirmed via a live DOM check, `--c` was always set correctly)
  visually read as dark/grey simply because it was being dimmed along with
  the globe behind it. Fixed by giving `.wb-topbar` and `.wb-dock` a
  `z-index: 55` (above the tutorial layer) so HUD chrome always renders at
  full brightness/true color regardless of an active tutorial spotlight.
  Separately softened `.wb-tutorial-dim` from `rgba(3,5,12,0.72)` to `0.5`
  so the lit globe outside the spotlight circle reads as a dim planet
  rather than a flat near-black disc, while still drawing the eye to the
  spotlighted target.
- Per-level checkpoint table (post owner-review fixes), radius in
  globe-normalized units (`beadRadius` as actually rendered by
  `BeadGlobe.ts`), layers ordered outermost-first:

| Level | Planet (visit) | Layers | Layer radii (outer→inner) | Layer K (outer→inner) |
|---|---|---|---|---|
| 1 | Earth (0) | 1 | 0.0720 | 3 |
| 10 | Earth (0) | 1 | 0.0682 | 3 |
| 20 | Moon (0) | 1 | 0.0662 | 4 |
| 50 | Jupiter (0) | 2 | 0.0697, 0.0622 | 3, 4 |
| 51 | Earth (1) | 2 | 0.0696, 0.0622 | 3, 4 |
| 60 | Earth (1) | 2 | 0.0686, 0.0612 | 3, 4 |
| 101 | Earth (2) | 2 | 0.0645, 0.0576 | 4, 5 |
| 110 | Earth (2) | 2 | 0.0637, 0.0569 | 4, 5 |
| 151 | Earth (3) | 3 | 0.0669, 0.0605, 0.0540 | 4, 5, 6 |
| 200 | Jupiter (3) | 3 | 0.0632, 0.0571, 0.0510 | 4, 5, 6 |
| 349 | Jupiter (6) | 4 | 0.0590, 0.0538, 0.0486, 0.0434 | 5, 6, 7, 8 |

Every column of radii is strictly decreasing top-to-bottom (monotonic
shrink with level) and strictly decreasing left-to-right within a row
(coarser outside, finer inside, same level) — verified by direct
computation from `getLevel()`, not eyeballed from screenshots.

## Jupiter banding + "dark globe on revisit" (owner review round 2)

- **Jupiter still read as one blob, not bands.** The texture
  (`generateJupiterBands`/`generateProceduralBandsTexture`) already painted
  ~2.25 full cycles of its 8-color latitude palette (verified by direct
  computation of `bandF` vs `y`), so the raw texture *was* banded. The bug
  was downstream, in `BeadGlobe.ts`'s bead-painting pipeline:
  `mergeToRegionTarget()` repeatedly merges the smallest connected color
  region into its dominant neighbor until at most `regionTarget` connected
  regions remain, and `regionTarget` is sized for continent-style planets
  (as low as ~7 at Jupiter's first-ever level, 41). Jupiter's bands form
  ~18 separate connected rings (8 colors × ~2.25 cycles, each ring
  physically separated from same-colored rings by a different-colored
  ring in between), so a target of 7 collapsed nearly all of them into one
  or two surviving blobs — exactly the "single rust patch on a cream ball"
  the owner's screenshot showed. Fixed with a planet-aware region floor in
  `BeadGlobe.ts` (`regionFloor = cfg.planet === 'jupiter' ? 28 : 3`, in the
  `regionShare` closure used by every shell): 28 sits comfortably above the
  ~18 natural rings, so the merge step never has anything to do on
  Jupiter — every ring survives at every level/layer, verified by
  screenshots (`after4/level41_jupiter_5s.png`, `_20s.png`,
  `level200_jupiter_5s.png`, `_20s.png`) showing 6+ clearly alternating
  horizontal bands persisting through auto-spin, at both Jupiter's first
  visit and its 4th (level 200, 3 layers). Side effect: Jupiter's shot
  budget (`probes = ceil(regions * shotSlack)`, from `countRegions()`) is
  now honestly higher than before on Jupiter specifically, since it now
  reflects the real ~18-28 regions instead of an artificially-collapsed
  count — flagged here in case a future difficulty pass wants to
  compensate with a lower `shotSlack` specifically for banded planets, but
  left as-is since the owner's ask was about the visual, not difficulty.
- **Earth "dark and dull" on levels 51/151 vs level 2 — was not a bead or
  lighting bug at all.** Instrumented `SpaceScene.ts` with a temporary
  dev-only per-2-second light-state log and confirmed `gameplayBlend`
  converges to ~0.99 (bright, camera-relative lighting) within under a
  second whenever the camera is actually in the `'gameplay'` shot — so the
  cross-fade mechanism itself was already correct. The actual cause: level
  51 and 151 are each the *first level of a new planet slot* (every 10th
  level), which triggers the post-win `'hero'` shot (a deliberately
  moodier, fixed-Sun-only reveal used right after a win, while the
  `newPlanet`/`levelComplete` cards are shown) — and the player can linger
  on that "Welcome to Earth" card indefinitely. `updateGameplayLighting`
  only cross-faded to the bright camera-relative light for `'gameplay'`,
  leaving `'hero'` at the dramatic, fixed-direction-only look for as long
  as the card stayed up. Confirmed directly: a Playwright run that opened
  `?skipIntro=1&level=151`, found and clicked the card's real
  `[data-scrim] [data-primary]` button (my earlier QA script's selector
  wait was too short and silently missed the button, which is why my
  *own* first round of `after3` screenshots also showed the dim look —
  same underlying `'hero'`-shot cause, not a separate bug), then
  screenshotted: before the click, dim/moody; after the click (which just
  advances the shot state, no lighting code touched), instantly bright —
  proving the globe/material/bead code was never the problem. Fixed with
  one line in `updateGameplayLighting`'s `target` calc: cross-fade to the
  bright camera-relative light for `'hero'` too, not just `'gameplay'`
  (`src/render/SpaceScene.ts`). Only the brief, skippable intro-only shots
  (`deepSpace`/`approach`/`sunPass`) keep the moodier fixed-Sun look now,
  since nothing the player stops and reads happens during those. Verified
  with fresh screenshots at both 5s and 20s of auto-spin for levels 51 and
  151 (`after4/level51_5s.png`, `_20s.png`, `level151_5s.png`, `_20s.png`)
  — all four now match level 2's brightness/vividness.
- Both fixes were verified with real screenshots (`scratchpad/after4/`,
  never committed to the repo) rather than assumed from code reading
  alone, per the pattern this project has needed twice now (owner
  screenshots catching things code review missed).

## Color distinguishability on every planet, not just Earth (owner review round 3)

- **Root cause**: `readablePalette()` (`src/game/BeadGlobe.ts`) already
  enforced a ΔE≥20 floor between every pair of a shell's final colors, but
  it only pushed **lightness** apart to get there. A real, low-hue-variance
  photo texture — Mars's rust/ochre surface is the extreme case — produces
  k-means centroids that are already the *same hue*, just at slightly
  different brightness; pushing lightness alone can clear ΔE≥20 between two
  such centroids while a human still reads them as "one brown, some
  darker/lighter" rather than genuinely different classes. Confirmed
  numerically before touching anything: dumped the real in-game palettes at
  levels 25/35/45/80 and saw Mars sitting at minΔE 20.0–20.1 — technically
  passing, but every color in the palette was a shade of the same
  orange-brown.
- **Fix**: `readablePalette()` now also rotates each too-close pair's a/b
  (hue) vector apart in Lab space, in opposite directions, on top of the
  existing lightness push, capped at 45°→55° of cumulative rotation per
  color so a planet never leaves its own hue family (Mars stays warm
  reds/oranges/browns, Venus stays warm creams, Jupiter stays its band
  tones) — it only stops relying on lightness alone. A near-grey color
  (chroma ≈ 0, e.g. Moon regolith/mare) is essentially untouched by hue
  rotation (rotating a near-zero vector is still near-zero), so the Moon
  correctly stays grey, separated only by lightness, exactly matching the
  owner's own "Moon greys" example. The ΔE floor itself was also raised
  from 20 to 30 (`MIN_DELTA_E`), since round 1's target of "technically
  passes 20" was exactly what produced the muddy-Mars complaint; 30 forces
  the separation pass to actually work, and combined with hue rotation
  gives real headroom instead of every palette sitting right at the wire.
  `MIN_L`/`MAX_L` widened slightly (34–84 → 28–90) and the convergence loop
  extended (24 → 48 iterations) since the harder target needs more room and
  more passes to satisfy before the safety-net merge kicks in.
- **Venus needed a separate, manual fix**: Venus's entire visible "surface"
  is a fixed 2-tone constant (`VENUS_CLOUD_PALETTE`), painted procedurally
  by `buildVenusCloudPaint()` — it never goes through `readablePalette()`
  at all, so the ΔE fix above doesn't reach it. The old pair (`0xf6ecd2`,
  `0xdcc48a`) measured only ~23 ΔE apart, both very light creams that
  bloom/tonemap wash toward a near-uniform white ball. Widened by hand to
  (`0xf6ecd2`, `0xb8905a`) — ~38 ΔE, still the same warm-cream family, no
  grey/blue introduced. Flagging honestly rather than overclaiming: this
  numeric fix is real and verified, but the `?level=35` screenshot
  (`after5/level35_venus.png`/`_20s.png`) still reads as a near-uniform
  bright ball at this particular camera framing/auto-spin phase — Venus's
  band pattern is a latitude split (equatorial vs. polar), the gameplay
  camera mostly frames the equatorial band, and auto-spin rotates around
  the same axis the bands are defined on, so the poles where the second
  tone dominates rarely rotate into view; on top of that, bloom/clearcoat
  specular on a light cream bead is naturally close to blown-out white
  regardless of the underlying hex value. Neither of those is something
  this round's ΔE fix could or should have touched (they're camera framing
  and shared bloom/material settings, not a color-readability bug per se,
  and Venus wasn't the planet the owner's own screenshots named) — left as
  an open observation rather than scope-creeping into a lighting/bloom
  change nobody asked for this round.
- Verified per-planet minΔE at the requested checkpoint levels (console
  `[BeadGlobe] level N palette minDeltaE`, direct from the real pipeline,
  not eyeballed):

| Level | Planet | minΔE (before) | minΔE (after) |
|---|---|---|---|
| 25 | Mars | 20.1 | 31.9 |
| 35 | Venus (surface, pre-cloud) | 20.1 | 34.6 |
| 35 | Venus (cloud palette, hand-fixed) | ~23 (not ΔE-checked) | ~38.4 |
| 45 | Jupiter | 20.3 | 30.1 |
| 80 | Mars | 20.0 | 30.5 |

  Sanity-checked no regression on the two planets that were already fine:
  Earth (level 2) 37.9→37.9 unchanged, Moon (level 11) stays grey at 30.4.
  Screenshots in `scratchpad/after5/` (never committed): `level25_mars.png`,
  `level35_venus.png` (+`_20s.png`), `level45_jupiter.png`,
  `level80_mars.png` — Mars now clearly shows dark basalt-brown, rust-red,
  and pale dust/ochre as separate legible classes rather than one brown
  blob, at both its first (25) and post-invasion-tutorial (80) checkpoint.

## `docs/INVASION_INTEGRATION.md` deleted (YAGNI)

Deleted per the owner's instruction once its wiring plan was fully done and
verified (see the two "Alien invasion" sections above) — everything the
plan doc proposed (call sequence, config constants, tutorial copy, visual
fixes) is implemented as described, so the doc had nothing left to say that
this file doesn't already cover.

## Venus was unplayable — blown-out white blob (owner review round 4)

Round 3's Venus ΔE fix (above) was numerically real but visually
insufficient — the owner's own screenshot showed a genuinely unplayable
near-white blob, not just a merely-okay one. Three independent causes, all
fixed together:

1. **Atmosphere glow.** `PLANET_DATA.venus.atmosphereIntensity` was 1.1 —
   the highest of any planet (Earth 1.0, Jupiter 0.6, Mars 0.45, Moon 0.08)
   — with an atmosphere color (`0xf2d9a0`) already close to white. Even
   before the globe is "revealed" this Fresnel rim glow runs at 40% strength
   (`setRevealed`'s unrevealed multiplier), so it was contributing real
   brightness throughout ordinary gameplay, not just at the reveal moment.
   Dropped to 0.45 and darkened the glow color a shade (`0xe0b878`) —
   `src/render/planetData.ts`.
2. **Bloom pass.** The shared `UnrealBloomPass` (strength 0.85 globally) had
   never been a problem on any other planet because no other planet's
   *average* palette brightness pushes so much of the frame over the bloom
   threshold at once. Rather than dim bloom for every planet (which would
   flatten highlights that were fine on Earth/Jupiter/Mars), added a
   per-planet bloom-strength table (`BLOOM_STRENGTH_BY_PLANET`, default
   0.85, Venus 0.4) applied in `SpaceScene.loadPlanet()` — `src/render/SpaceScene.ts`.
3. **Bead/cloud material.** Venus's entire visible gameplay surface *is*
   its cloud shell at every level (`cfg.cloud === 'always'`, unlike Earth
   where the shared "glossy pearl early game -> fluffy late game" curve only
   applies briefly). At Venus's early levels that curve still gives a high
   clearcoat (~0.6+) and near-full opacity — glossy highlights on an already
   bright, always-visible surface. Added a Venus-specific override in
   `BeadGlobe.ts`'s cloud-shell setup that ignores the shared fluffiness
   curve entirely: fixed low clearcoat (0.12), higher roughness (0.8), fully
   opaque/matte, low envMapIntensity (0.1) — regardless of level.
4. **Pattern didn't span the visible disk.** Separately (this is the actual
   *readability* fix, not just brightness): `buildVenusCloudPaint()` used to
   split purely on `|lat|` (an equatorial band vs. everything else). On the
   camera's normal gameplay framing — roughly equatorial, auto-spin turning
   around the same axis that split is defined on — the "everything else"
   tone rarely rotated into view, so with the OLD near-duplicate palette
   this read as a flat ball, and even with round 3's separated 2-tone
   palette it would have read as "one color with an occasional stripe," not
   multiple visible classes. Replaced with a longitude-sheared-by-latitude
   noise pattern (mimicking the real Y/chevron-shaped cloud bands Venus's
   fast equatorial winds produce) so every latitude — including whatever's
   framed at any spin phase — shows a mix of all three tones. Also went
   from 2 tones to 3 (`VENUS_CLOUD_PALETTE = [0xf5e6b8, 0xcf9a4e,
   0x74451a]` — pale cloud-top yellow, ochre-tan, dark rust-brown; every
   pair ≥30 ΔE), matching the owner's "cloud-top pale yellow/tan swirls
   over ochre/orange-brown lowlands+highlands" reference. One numeric trap
   worth remembering: `fbm3`'s multi-octave averaging does *not* spread
   evenly over [0,1] — empirically it clusters tightly around ~0.485 (p33
   ≈ 0.448, p66 ≈ 0.52) — so naive evenly-spaced thresholds (0.42/0.68)
   starved the darkest class down to ~1% of the sphere, invisible in
   practice, even though the palette itself was correct. Fixed by picking
   thresholds from the empirical distribution instead of the nominal
   output range; verified ~25-50% share per class across several seeds
   before touching a screenshot.

Verified with real screenshots this time before reporting (per the
standing lesson in this project: a numeric fix without a screenshot check
is not a verified fix) — `scratchpad/after6/level{31,35,40}_{5s,20s}.png`
all show individually-legible glossy-but-not-blown-out beads in three
clearly distinct classes, against a clean dark starfield background, at
every checkpoint level and both wait times.

## Cloud shells never followed the monotonic bead-radius curve (owner review round 5)

The size-invariant work earlier in this file (the "bead-size bug fix"
section) covered `surface` and every `extraLayers` entry, but never
`cloudBeadCount` — it was still a flat `Math.round(beadCount * 0.55)`,
completely independent of level. Two things compound from that: (1)
`BeadGlobe.ts`'s cloud shell uses a bigger bead-radius factor than every
other shell (0.72 vs. 0.56 — "clouds overlap more so a patch reads as a
solid layer, not dots"), and (2) a smaller design bead count at the same
factor already means a bigger per-bead radius (inverse-square relationship
between count and radius). Both push in the same direction, so cloud beads
rendered meaningfully bigger than the surface/layer beads at the very same
level — most visible on Venus, whose entire gameplay surface *is* its cloud
shell (the owner's own `after6/level35_20s.png` showed it plainly next to
Earth level 2's smaller beads).

Fixed in `src/game/levels.ts`: added `cloudBeadCountForRadius()`, the same
inversion `beadCountForRadius()` already does but with the cloud shell's own
factor (0.72) and its own world-radius scale (`cloudShellScale = 1 +
BEAD_RADIUS_STEP * numExtra + 0.06`, mirroring `BeadGlobe.ts`'s actual
`cloudRadius`). `cloudBeadCount` is now derived by treating the cloud shell
as sitting one depth further out than whatever the current outermost shell
is (`cloudDepthFromSurface = numExtra + 1`) and feeding that into the exact
same `layerBeadRadius()` curve every other shell already uses — same
monotonic shrink with level, same coarser-per-depth curve, same hard cap at
`BEAD_RADIUS_MAX` (level 1's own radius) so a cloud bead can never exceed
it. (`cloudBeadCount`'s computation had to move after `numExtra`/`extraLayers`
are computed in `getLevel()`, since it now depends on them.)

Verified by direct computation (not eyeballed) — bead radius in
globe-normalized units, comparing every shell at each level against level
1's own radius (0.0720, the hard ceiling):

| Level | Planet | Surface/layers (outer→inner) | Clouds |
|---|---|---|---|
| 1 | Earth | 0.0720 (surface only) | — |
| 31 | Venus | 0.0646 | 0.0720 (at the cap — correct: early levels' natural cloud radius exceeds it, so it clamps) |
| 35 | Venus | 0.0640 | 0.0717 (below the cap now that the natural curve has dropped under it) |
| 40 | Venus | 0.0634 | 0.0710 |
| 60 | Earth (2 layers) | 0.0686, 0.0612 | 0.0720 (still at the cap — coarser-per-depth pushes it right back up, so the clamp holds it flat at the ceiling rather than exceeding it) |
| 151 | Earth (3 layers) | 0.0669, 0.0605, 0.0540 | 0.0720 (same clamp) |

Every value is ≤ 0.0720 (level 1's own radius) by construction — the clamp
inside `layerBeadRadius()` guarantees it algebraically, not just at these
sampled levels — and clouds never exceed whatever shell they sit outside of
plus the fixed per-depth coarseness step, exactly like every other layer.
Screenshots confirming the visual fix (`scratchpad/after7/`, never
committed): `level1_5s/20s.png` (the reference size), `level31/35/40_5s/20s.png`
(Venus — bead density now visibly matches level 1, not the noticeably
bigger/sparser beads in the prior round's screenshots), `level60_5s/20s.png`
(an Earth cloud tuft, sized consistently with the surrounding surface/layer
beads rather than as an oversized blob).
