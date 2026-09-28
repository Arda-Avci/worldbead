# Production Readiness Review — bug & risk list

Full-repo audit (static analysis + build verification), 2026-09-28.
Baseline: `npm run build` passes clean (`tsc --noEmit && vite build`,
770 kB JS / 202 kB gzip, pre-existing >500 kB chunk warning).

Every item below was verified by reading the actual code path, not inferred.
Items from `Memory_Bank.md` already fixed (tap-timing race, per-shell limb
hit-test, layer counts, `swap()` queue validation, bloom/glare sources) were
re-checked and are **not** re-listed as open bugs.

## P0 — blocks gameplay / hard failure

1. **Texture-load failure leaves the game permanently stuck on the loading
   screen.** `src/game/Game.ts` `loadTexture()` (~line 134) and
   `prepareLevel()` (~line 467) `await loadImageData('textures/<name>.jpg')`
   with no `try/catch` and no fallback; `texture.ts`'s `loadImageData` throws
   on `!res.ok` / network error / `createImageBitmap` failure. `run()` is
   invoked as `void this.run()` (constructor), so the rejection is unhandled:
   the loading overlay (`ui.showLoading`) never closes and the player gets a
   dead screen with no error message or retry. Matters for the web/PWA build
   (GitHub Pages) on flaky networks; in the Capacitor bundle the files are
   local, but a corrupt/incomplete install fails the same way.
   *Fix direction:* catch in `prepareLevel`, show a localized
   error card with a retry button (retry = call `prepareLevel` again).

## P1 — real defects, should fix before release

2. **No WebGL context-loss handling.** No `webglcontextlost` /
   `webglcontextrestored` listener anywhere in `src/` (grep-verified). On
   Android, a context loss (memory pressure, GPU reset, some
   screen-off/on paths) leaves a frozen black canvas with the HUD still
   interactive on top — looks like a hang. *Fix direction:* listen on the
   canvas, `preventDefault()` the loss event, and reload or rebuild the
   scene on restore.

3. **Planet-body textures leak GPU memory on every planet change.**
   `src/render/planetBody.ts` `disposeObject()` (~line 205) disposes
   geometries and materials but never their textures (`mat.map`, the Earth
   night/cloud textures patched in later, Jupiter's `CanvasTexture`).
   `load()` also re-fetches/re-creates textures on every visit (no cache —
   `THREE.Cache` is off by default), and `Game.prepareLevel` calls
   `loadPlanet` on every planet switch (every 10 levels). Over a long
   session `renderer.info.textures` grows monotonically; on low-end Android
   this is a real memory-pressure driver (and makes #2 more likely).
   *Fix direction:* dispose `mat.map`/etc. in `disposeObject`, or cache one
   texture per planet and reuse.

4. **Cascade ("unsupported outer beads auto-fall") is dead code in real
   play.** Documented in `Memory_Bank.md` and re-confirmed: `BeadGlobe.pop()`'s
   cascade condition can only become true after the bead it would pop is
   already dead (`coveredBy` and `coversFootprint` are exact set inverses from
   the same `buildCoveredBy()` pass). Either remove it (YAGNI) or redesign
   "support" to mean something reachable (e.g. same-shell neighbors) — as-is
   it is a shipped feature that never fires, and it misled a previous
   verification round into reporting it "verified".

5. **`prepareLevel`'s stale-token early return skips `hideLoading()`.**
   `src/game/Game.ts` ~line 482: `if (token !== this.buildToken) return;`
   runs after `ui.showLoading(...)` but before `ui.hideLoading()`. Today the
   newer call that bumped the token also ends in `hideLoading()`, so this is
   only reachable in a narrow interleave (e.g. the newer call itself fails),
   but combined with #1 it turns a recoverable hiccup into a stuck overlay.
   *Fix direction:* `try/finally` around the build body, or move
   `hideLoading` responsibility to the single latest call.

## P2 — quality / robustness, fix soon

6. **Audio voice bookkeeping uses wall-clock `setTimeout`, not WebAudio
   time.** `src/audio/AudioEngine.ts` `play()` (~line 81) decrements
   `activeVoices` via `setTimeout(releaseMs)`. While the tab is hidden the
   context is suspended and timers are throttled, so the counter drifts from
   reality; after resume, voice limiting (`MAX_VOICES = 32`) can wrongly
   reject or admit sounds until timers catch up. *Fix direction:* use
   `source.onended` (or schedule off `ctx.currentTime`).

7. **Per-frame allocations in the render loop.** `SpaceScene.ts`
   `updateGameplayLighting` (~347) and `sunOverlapsGlobe` (~393) allocate
   several `new THREE.Vector3()`/clones every frame; `aliens.ts` update
   allocates `new THREE.Color(...)`/`new THREE.Vector3(...)` per ship per
   frame despite having tmp fields; `planetBody.ts:191` clones per frame for
   Venus. GC churn on a 60 fps mobile loop. *Fix direction:* hoist to
   module/class scratch objects.

8. **Cloud-drift coverage rebuild is heavy.** `BeadGlobe.updateCloudDrift`
   reallocates the direction array and rebuilds `coveredBy`/footprints
   (O(clouds × body-beads)) every ~3° of drift — several times per second on
   drift-enabled levels, plus `updateFireFlicker` runs per-bead trig every
   frame once fire exists. Fine on desktop; on low-end Android at 3.5k+
   beads (already flagged as a possible perf risk in `Memory_Bank.md`,
   unverified on real hardware) this stacks. *Fix direction:* verify
   frame times on a real low-end device first; then consider longer rebuild
   intervals or incremental updates if it's actually hot.

9. **Localization leftovers.**
   - `src/ui/gameui.ts:356`: unlock-card CTA falls back to hardcoded
     `'Try it'` even though `S.tryIt` exists (`strings.ts:89`).
   - `src/ui/gameui.ts:100` and `:73`: initial HUD/loading placeholder is
     hardcoded `'Earth'` instead of `PLANET_NAMES.earth` (visible in Turkish
     until the first level load replaces it).
   - Known open item (Memory Bank): CSS `text-transform: uppercase` is
     locale-unaware (Turkish i→I). Not visible with current strings; fix
     before adding more Turkish copy to all-caps elements.

10. **`?level=N` / `?skipIntro=1` work in production builds.** Anyone can
    jump to level 1000 in the public web build (and it *persists* —
    `this.progress.level` is written). Fine as a QA hook in dev; for
    production either gate behind `import.meta.env.DEV` or accept it as a
    deliberate feature (it's in the README). Product decision needed.

11. **No source maps / no crash reporting for shipped builds.**
    `vite.config.ts` has no `sourcemap` option and there is no
    `window.onerror`/`unhandledrejection` handler anywhere — a field failure
    on a phone is undiagnosable. *Fix direction:* enable hidden sourcemaps
    for CI builds (not uploaded to Pages), and at minimum a global error
    handler that shows a localized "something went wrong — restart" card
    (would also mask #1-class failures gracefully).

12. **Tutorial `run()` promise can stay pending forever after `stop()`.**
    Documented in `src/ui/tutorial.ts` itself (~line 50); `playLevel` races
    it so the game doesn't hang, but the orphaned closures/RAF chain linger
    per level. Low impact (bounded per level, GC'd eventually); noted for
    completeness.

## P3 — visual / product open items (carried over, still open)

13. **Jupiter has no per-planet bloom override.** `BLOOM_STRENGTH_BY_PLANET`
    only special-cases Venus; Jupiter's large pale cream classes wash toward
    white under the shared bloom at some camera framings (Memory Bank
    "ground convergence" section, honestly flagged there as a render-side
    issue, not palette data).

14. **Shot budget counts hidden shells.** `probesTotal = countRegions() + 2`
    includes regions on not-yet-visible inner layers (L100: 26 visible vs 82
    budgeted). Internally consistent, but reads as arbitrary to the player.
    A product decision was explicitly left open in Memory Bank — pick (a)
    communicate "shots for the whole level" or (b) per-layer budgeting
    before launch.

15. **Performance on low-end Android is unverified.** Headless SwiftShader
    numbers (1.3 fps at L151) are known to be dominated by software
    rendering, but no one has measured a real low-end device at 3.5k+ beads
    with bloom + drift + invasion FX combined. Do one real-device pass at
    L150+ before calling it production ready.

16. **iOS platform, release signing, store listings** — tracked in Memory
    Bank "Open items", out of code scope.

## Verified clean (do not re-litigate)

- `GameSession` rules machine: queue invariants, swap re-validation,
  win-before-lose precedence, retry/continue economy — all sound.
- Tap pipeline: `fire()` resolves at tap time (race fixed a5311c7);
  `resolveHit` per-shell ray/sphere fallback verified 0/1095 misses.
- `progress.ts`: all localStorage access wrapped in try/catch, versioned.
- Globe disposal on level change (`BeadGlobe.dispose` + `Game.ts:484-490`)
  including in-flight probes; shared bead material correctly not disposed.
- Resize handling (renderer + camera + composer + bloom) and DPR clamp ≤ 2.
- `index.html` viewport/theme-color, `manifest.webmanifest` validity,
  Capacitor config (no dev-server `server.url` leak), both CI workflows
  (node 22, npm cache, `fetch-depth: 0`).
- QA hooks (`__wbQA`) are `import.meta.env.DEV`-gated; confirmed 0 matches
  in `dist/` after a production build.

---

## Fix status (follow-up session, same day)

All code-fixable items above were addressed in one pass. `npm run build`
passes (`tsc --noEmit && vite build`, same pre-existing >500 kB chunk
warning; sourcemap now emitted). No browser/device runtime verification was
possible in this environment (no Playwright browsers, no Android SDK) —
verification was by code reading + type-check + build, item by item.

| # | Status | What changed |
|---|--------|--------------|
| 1 | **Fixed** | `Game.prepareLevel` wraps loads in try/catch; on failure hides the loading overlay and shows a localized error card (`S.loadErrorTitle/loadErrorBody`) with a retry button (`GameUI.showLoadError`) that re-runs the load. Successful textures are cached, so retry only re-fetches what failed. |
| 2 | **Fixed** | `webglcontextlost` (preventDefault + localized "restarting graphics" overlay) and `webglcontextrestored` → `location.reload()` listeners in the `Game` constructor. Progress survives via localStorage. |
| 3 | **Fixed** | `planetBody.ts` `disposeObject` now disposes material-owned textures too (direct slots like `.map`/`.alphaMap`, plus sampler uniforms patched via `onBeforeCompile` — Earth's night map is only reachable through `userData.shaderRef`). The shared scene `envMap` is explicitly skipped. |
| 4 | **Removed** | The cascade in `BeadGlobe.pop()` was provably unreachable (every bead-killing path filters covered beads, so an outer bead's footprint can never go fully dead while it lives). Removed `findUnsupported`, `coversBodyShellIndex`/`coversFootprint`, and the cascade loop; `pop()` keeps its `number` signature. Not redesigned: any reachable version changes shot-budget/region math — a gameplay-design decision, not a bug fix. **Note:** this feature was once reported "verified" by a previous round; that verification bypassed the coverage rules. |
| 5 | **Fixed** | Covered by #1's restructure: the newest `prepareLevel` call owns the loading UI; stale-token exits (in both try and catch paths) are no-ops for the UI. |
| 6 | **Fixed** | `AudioEngine.play` now tracks voices by scheduled end in context time (`ctx.currentTime`), immune to timer throttling while hidden/suspended. Also made `resume()`/`suspend()` rejections explicitly ignored so they can't trip the new global error handler. |
| 7 | **Fixed** | Hoisted per-frame allocations to scratch objects: `SpaceScene.updateGameplayLighting`/`sunOverlapsGlobe` (5 Vector3), `aliens.updateLightRing` (Color), `aliens.updateLaser` (2 Vector3 clones + up-axis), `planetBody.update` + `updateEarthSunDir` (sun-dir clones). |
| 8 | **Open (by design)** | `updateFireFlicker` already early-exits shells without fire. Cloud-drift rebuild cadence left as-is — changing it blind, with no low-end device to measure, risks regressing a mechanic that may be fine. Needs a real-device frame-time pass (see #15). |
| 9 | **Fixed** | `gameui.ts`: `'Try it'` → `S.tryIt`; both hardcoded `'Earth'` placeholders → `PLANET_NAMES.earth`. Turkish uppercase: no change needed — `main.ts` sets `<html lang>` from the detected locale, and CSS `text-transform: uppercase` is locale-aware (i→İ under `lang="tr"`) in Chromium/WebKit/Firefox, which includes both Capacitor WebViews. (The review itself noted this is not visible with current strings.) |
| 10 | **Fixed (decision: keep the hook)** | `?level=N` still jumps (README-documented QA/review flow on preview builds depends on it) but no longer writes `progress.level` — visiting a link can't overwrite a save. Winning the jumped-to level still advances the save from there, as before. |
| 11 | **Fixed** | `vite.config.ts` emits sourcemaps (repo is open source). `main.ts` now has `error`/`unhandledrejection` handlers showing a standalone, localized fatal overlay with a restart button (inline styles, no dependency on the UI module graph), plus null-guards for the `#scene`/`#hud` roots. |
| 12 | **Fixed** | `Tutorial.stop()` now rejects the in-flight `run()` with a `TutorialAborted` sentinel (raced against each step's `until`, so rAF cleanup still runs) instead of leaving it pending forever. `Game.runTutorialsForLevel` swallows exactly that sentinel; an aborted tutorial is NOT marked as seen. |
| 13 | **Fixed (starting value)** | `BLOOM_STRENGTH_BY_PLANET.jupiter = 0.6`. Not screenshot-verified (no headless browser here) — confirm visually at a Jupiter level (e.g. `?level=100&skipIntro=1`) and tune if still washed out. |
| 14 | **Fixed (decision: communicate)** | `unlockDescription.newLayer` now states the shot count covers every layer (EN+TR). No re-budgeting. |
| 15 | **Open — manual step** | Requires a physical low-end Android device at L150+ (bloom + drift + invasion FX). Headless SwiftShader numbers are known-unrepresentative. This is the one remaining gate before calling it production ready. |
| 16 | **Out of scope** | iOS platform, release signing, store listings — tracked in Memory Bank "Open items". |
