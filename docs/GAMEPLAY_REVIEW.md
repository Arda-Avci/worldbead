# Gameplay & Level-Design Review

Focus: how the game *plays* — rules-level fairness, level-design logic, and
layered-level integrity. Method: full read of `levels.ts`, `GameSession.ts`,
`invasion.ts`, `camera.ts`, the BeadGlobe region/coverage machinery, and the
`Game.ts` event/HUD pipeline, plus a numeric harness that runs the real
`levels.ts` (tsc-transpiled, unmodified) to compute bead counts, region
targets, star reachability and camera framing per level. Every number below
comes from that harness or from the code path quoted.

Nothing in this document is fixed yet — detection only, per the owner's
request. Each item has a fix direction for the follow-up pass.

## P0 — systemic fairness / broken-by-math

### G1. The star system is mathematically unreachable as designed
`GameSession.checkOutcome`: 3 stars needs ≥40% of `probesTotal` left, 2 stars
≥15%. But `probesTotal = regions + 2` (owner requirement: exactly 2 slack
shots), and optimal play (one shot per region — always achievable, since the
queue only serves exposed colors and swap exists) leaves **exactly 2 probes**.
So the best possible leftover fraction is `2/(regions+2)`:

| Level | regionTarget | best leftover | best stars w/o powers |
|------:|-------------:|--------------:|:---------------------:|
| 1     | 6            | 25%           | 2★ (3★ impossible)    |
| 21    | 11           | 15.4%         | 2★                    |
| 45+   | ≥12          | ≤14.3%        | **1★**                |

Harness result: **3★ is impossible on every level of the game without
powers; 2★ is impossible from ~level 45.** Stars therefore measure power
*spending* (powers pop regions without consuming probes), not skill.
Worse, `continueAfterLoss()` adds +5 probes without raising `probesTotal`,
so losing → continuing → finishing with spare probes can score *better*
than a clean run that barely made it. The whole 1-3★ ladder is incoherent.
*Fix direction:* compute stars from shots-used vs. par (e.g. 3★ = used ≤
regions, 2★ = regions+1, 1★ = regions+2), and score post-continue runs
against the continued probe pool (or cap them at 1★). Product decision.

### G2. Losing at 0 probes disables the powers the player already paid for
The instant the last probe resolves without clearing the board,
`checkOutcome()` sets `ended='lose'`. From that moment `consumeCharge()`
returns false (`if (this.ended)`) and `handleGlobeTap` early-returns at
`probes <= 0` — so a player holding charged meteors/comets/solar flares
(which pop beads **without** consuming probes) cannot use them, and is
funneled into the paid retry (100) / continue (500) card instead. The
natural escape valve — "spend your saved powers to clutch the level" — is
welded shut exactly when it matters.
*Fix direction:* don't end the session at 0 probes while the player holds
≥1 charged, unlocked power (allow power use at 0 probes; declare lose only
when nothing playable remains). This also softens G4 below.

### G3. The gameplay camera frames the bare planet body, not the bead globe — layered levels overflow the screen
`camera.ts computeGameplayShot()` pins the globe to 88% of viewport width
using `PLANET_BODY_RADIUS = 0.97`. But the bead globe grows past the body:
shell radii are `1.0 + 0.17·depth`, clouds add `+0.18`, plus the bead
radius itself. Portrait 390×844 math (from the code's own constants,
camera distance d = 5.60, hFOV ≈ 22.3°):

| Level | layers | outermost radius (incl. bead) | globe width vs screen |
|------:|:------:|------------------------------:|----------------------:|
| 1     | 1      | 1.07                          | **99%** (design: 88%) |
| 21    | 2      | 1.24                          | 115%                  |
| 70    | 3      | 1.41                          | 131%                  |
| 180   | 4      | 1.58                          | 147%                  |
| 181+ (Venus, clouds) | 4+clouds | 1.76              | **165%**              |

So already at level 1 the playable globe spans ~99% of screen width, and
every layer milestone makes it strictly worse; at 4 layers + clouds nearly
half the globe is outside the horizontal frame, and vertically it pushes
under the top HUD and the bottom dock (the band between them is only ~59%
of screen height). Rotation eventually brings side beads into view, so
it's playable — but the framing intent ("globe sits in the band between
HUD and dock") is broken on every multi-layer level. `SpaceScene` already
knows the real radius (`setBodyRadius(globe.outerRadius())`) — it just
isn't fed to the camera rig.
*Fix direction:* give `CameraRig` the live outer radius (incl. bead radius)
and recompute the gameplay shot per level; verify with one portrait
screenshot at L181+ (Venus) before/after. Math here is exact, but take the
screenshot anyway — past rounds eyeball-verified palette questions on
these same framings without flagging the overflow.

## P1 — level-design logic errors

### G4. Invasion fire silently inflates the required shot count beyond the budget
The shot budget is fixed at level start (`countRegions()` + 2). A laser hit
then *recolors* 5-7 alive beads to `FIRE_COLOR`, which (a) creates a brand
new region that needs its own shot, and (b) can split the regions those
beads belonged to into disconnected pieces, each needing its own shot.
Fire then spreads (+2-4 beads every 2-4 shots while any fire remains). On
a mid-game level (~17 regions, 19 probes) one uncontained laser hit can
add 3-8 mandatory shots — more than the +2 slack — making the level
unwinnable by shooting and forcing the paid continue. Ships are free to
destroy, so a attentive player can prevent it — but the budget math
pretends fire doesn't exist, and G2 removes the power-based escape.
*Fix direction:* count fire regions against the budget when they appear
(grant compensating probes per ignition/spread), or cap effective region
growth from fire at the slack. Also see G5.

### G5. Ships keep charging and firing while the player is blocked by a card/tutorial
`updateInvasion` ticks whenever `state === 'playing'`, and `playLevel`
sets that state *before* running the blocking cards/tutorials
(`runTutorialsForLevel`). The scrim/tutorial blocker swallows all pointer
events, so on any invasion level that also opens with a card (planet
change at 81/91/…, `newLayer` at 180, …) a ship spawning at ~1.2-2 s fires
at ~4-5 s while the player literally cannot tap it. The invasion's own
tutorial level (80) is designed around this; every other card isn't.
*Fix direction:* pause the invasion clock while a blocking card/tutorial
overlay is up (the tutorial engine already knows when it's active), or
start `state='playing'` only after `runTutorialsForLevel` resolves.

### G6. Jupiter is opted out of the shot budget — its levels run several times longer than their neighbors
`BeadGlobe`'s `regionFloor = 28` for Jupiter (added so its bands survive
the region merge) sets the *merge target* per shell to ≥28 regardless of
`regionTarget`. Since the merge can only reduce region counts, Jupiter
shells keep their natural ring segmentation while every other planet is
merged down to the budget share. Harness (upper bounds are floor×shells;
actual depends on rings surviving smoothing, but the budget is bypassed
either way):

| Level | planet | budgeted regions | Jupiter floor minimum |
|------:|--------|-----------------:|----------------------:|
| 40    | Venus  | 11               | —                     |
| 41    | Jupiter| 11               | 56                    |
| 90    | Venus  | 17               | —                     |
| 91    | Jupiter| 17               | 84                    |

Every Jupiter slot is a sudden 2-5× marathon, then the next planet snaps
back. The visual goal (bands stay bands) is legitimate; the pacing
side-effect looks unintended.
*Fix direction:* decouple "don't merge Jupiter's rings" from the shot
budget — e.g. count connected rings that share a color and wrap around
the sphere as one region for budgeting, or scale Jupiter's per-pop
stardust/expectations and communicate the longer levels deliberately.

### G7. Mechanic-intro levels are also the biggest difficulty spikes
Harness numbers at the layer milestones:

| Milestone | regions | total beads |
|-----------|--------:|------------:|
| L20 → L21 (2 layers) | 7 → 11 (**+57%**) | 899 → 1 944 (**+116%**) |
| L69 → L70 (3 layers) | 12 → 16 (+33%)    | 1 082 → 3 636 (+236%) |
| L179 → L180 (4 layers)| 20 → 24 (+20%)   | 1 446 → 6 510 (**+350%**) |

The first level with a new layer is the longest/densest level seen so far
— the opposite of onboarding practice (introduce a mechanic on an *easier*
level). L21 additionally lands on a Mars planet-change level, contradicting
`levels.ts`'s own stated rule ("spaced apart … from a planet-change
level") — the code handles the double-card gracefully, but the pacing
spike stands. Bead-count jumps are also perf cliffs (see
PRODUCTION_REVIEW #15).
*Fix direction:* dip `regionTarget` at milestone levels (e.g. subtract the
per-layer bonus on the intro level and ramp it back over the next few), and
move L21's milestone off the planet-change level (e.g. 23).

### G8. The last 300 levels (L700-1000, 30% of the game) barely change
Bead size saturates at `BEAD_SIZE_SATURATION_LEVEL = 700` → identical bead
counts (4 379 surface + ~15 300 total) for L700-1000. Only K (11→13),
regionTarget (42→52) and spin difficulty still move. A third of the
content curve is effectively flat.
*Fix direction:* product decision — accept (endgame = mastery), extend a
curve (cloud fluff/drift/invasion aggression past their saturation), or
cut MAX_LEVEL.

## P2 — consistency / feel

- **G9. Dead field:** `SessionEvent.fire.combo` (`poppedCount >= 60`) is
  never consumed — celebrations use `Game.celebrationTier` (relative to
  `avgRegionSize`). Remove the field or the tiering, not both.
- **G10. Economy inverts over the game.** Per-hit stardust is
  `ceil(popped/12)`: ~73 stardust/level at L1 (760 beads) but ~1 000+ at
  L500 (~12 900 beads, ~370/pop ≈ 31/shot × 35 shots), while prices
  (60-150) and costs (retry 100 / continue 500) are flat. Brutally tight
  early (when powers are few and continue is 7+ levels of savings),
  trivially loose late. Win bonus is `leftover × 5` ≈ 10 by construction.
  *Fix direction:* scale per-pop stardust down with level (or prices up),
  if the early squeeze isn't the intended pressure.
- **G11. The extinguish override silently rewrites the player's queued
  next probe** (`queue[1] = FIRE_COLOR`). Mechanically fine, but "the game
  swapped my probe without asking" is a feel complaint waiting to happen;
  consider a small toast/cue when it happens.
- **G12. Partial-coverage pops can split a region and inflate the true
  shot count.** `region()` BFS stops at covered beads, so popping the
  exposed arc of a partially-uncovered inner-layer region can leave the
  still-covered remainder disconnected → more shots than `countRegions()`
  budgeted. Bounded by the +2 slack and rare in practice (inner colors
  compete with outer ones in the queue), but it's the same budget-blindness
  family as G4.
- **G13. Feel-tuning candidates (need a device, not more static analysis):**
  miss penalty (probe −1 + heavy haptic + shake 0.5 reads harsh for a
  casual loop), `ROT_SPEED`/spin-resistance grip at high difficulty,
  and whether the probe-flight ~0.25 s delay should scale down on later
  levels as targets shrink.

## Verified clean (do not re-litigate)

- No all-covered soft-lock: while any bead is alive, at least one bead is
  exposed (coverage requires a live covering bead, which is itself
  exposed), so the queue can always serve a hittable color.
- Fire can only ignite/spread to exposed beads (`colorAt` returns null for
  covered/popped; `beadsInRadius` filters covered) — no hidden,
  un-put-outable fires under intact layers/clouds.
- Queue invariant after the earlier swap re-validation fix: both slots
  always hold currently-exposed colors.
- Win-before-lose precedence in `checkOutcome` is correct; `probesTotal`
  is derived from the actual post-merge `countRegions()`, so the budget
  always matches the real board at level start (G4/G12 are about what
  happens *after* start).
- `?level=N` jump (post production-fix) no longer perturbs any of this:
  it only picks the starting level.
