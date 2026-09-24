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

## Open items

- iOS platform (`npx cap add ios`) and its GitHub Actions workflow — needs
  macOS runner, not yet added.
- Release signing (Android keystore, iOS certificates/provisioning).
- App store listings (Play Store, App Store).
- Monetization.
