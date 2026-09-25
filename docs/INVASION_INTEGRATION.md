# Alien invasion — integration notes

Feature owner: Arda. This document is for whoever wires the alien-invasion
feature into `Game.ts`; the feature itself lives entirely in new files and
makes no changes to `Game.ts`, `GameSession.ts`, `BeadGlobe.ts`, `levels.ts`,
`SpaceScene.ts`, `fx.ts`, `gameui.ts`, `ui.css` or `facts.ts`.

## New files

- `src/game/invasion.ts` — pure rules (no THREE, no DOM), mirrors the
  `GameSession` contract: `invasionConfigForLevel(level)`, `InvasionController`.
- `src/render/aliens.ts` — THREE-only ship/laser/explosion visuals:
  `AlienInvasionRenderer`.
- `src/render/fireEmbers.ts` — THREE-only pooled ember-spark + faint-smoke
  particles for burning bead patches: `FireEmberSystem`. Parent its `object`
  under the same rotating frame the beads live in (`scene.globe` in the real
  game) and feed it globe-local unit-sphere positions.
- `src/audio/types.ts` / `src/audio/sfx.ts` — 6 new `SfxName`s and their
  synthesis recipes (`shipArrive`, `laserCharge`, `laserFire`, `fireCrackle`,
  `extinguish`, `shipExplode`). Already wired into the existing
  `buildSfx()` switch; `AudioEngine.play(name, opts)` just works with them,
  no `AudioEngine.ts` changes needed.
- `src/render/aliens-demo.html` + `.ts` — a standalone demo (same pattern as
  `src/render/demo.html`) that runs a real `InvasionController` +
  `AlienInvasionRenderer` against a small self-contained bead globe. Useful
  as a live reference for the exact call sequence below, and as a QA page
  (`?level=N` picks which level's config to preview, buttons let you spawn a
  ship / toggle autoplay / destroy all ships).

## `types.ts` changes (already made, additive only)

`GlobeAdapter` (in `src/game/types.ts`) gained two **optional** members that
`BeadGlobe` does not implement yet:

```ts
neighborsOf?(shellId: number, index: number): BeadRef[];
igniteFire?(beads: BeadRef[], colorHex: number): void;
```

`InvasionController` feature-detects both; without them, ships still
approach/charge/fire but nothing ever ignites (a safe degrade, not a crash).
To make fire actually work in the real game, `BeadGlobe` needs a small,
precise addition — see "BeadGlobe changes needed" below.

Two other `invasion.ts` shapes changed since the first pass (both driven by
review point #1, "lasers must target the visible hemisphere"):

- `InvasionController.tick(dt, viewDir)` now takes a second argument, a
  globe-local `Vec3` — see "Every frame" below for exactly how to compute it.
- The `shipSpawned` event now carries `target: BeadRef | null` — the impact
  bead is chosen at spawn time (not on arrival), specifically so the render
  layer can fly the ship toward, and hover near, a point already known to be
  on the visible hemisphere.

## Call sequence `Game.ts` needs to make

All of this is additive to the existing level-loop/frame-loop/tap-handling
code; nothing here replaces existing logic.

### 1. On level start (in `prepareLevel()`, after building `session`)

```ts
import { invasionConfigForLevel, InvasionController } from '../game/invasion';

const invasionCfg = invasionConfigForLevel(cfg.level);
const invasion = invasionCfg ? new InvasionController(globe, invasionCfg) : null;
```

Keep `invasion` alongside `session`/`globe` in whatever per-level state
`Game.ts` already tracks, and drop it (`invasion = null`) when the level
ends/reloads, same lifetime as `session`.

### 2. Every frame (in the main `requestAnimationFrame` loop, alongside `globe.update(dt)`)

`tick()` takes a second argument now: `viewDir`, a globe-local `Vec3` giving
roughly "which way the camera is currently looking at the globe." It's how
`pickImpactTarget()` keeps every laser impact (and thus every ship, which
spawns already knowing its target — see below) on the hemisphere the player
can actually see, instead of sampling the whole sphere. Compute it exactly
the way `Game.ts`'s Solar Flare power already gets "camera position in
globe-local space" (per `Memory_Bank.md`) — it only needs to be reasonably
fresh, not per-sub-frame accurate:

```ts
const camLocal = scene.globe.worldToLocal(scene.camera.position.clone());
const viewDir: Vec3 = { x: camLocal.x, y: camLocal.y, z: camLocal.z };
```

```ts
if (invasion) {
  const events = invasion.tick(dt, viewDir);
  for (const ev of events) {
    switch (ev.type) {
      case 'shipSpawned': {
        // `ev.target` (a BeadRef, or null if no visible bead could be found)
        // is already chosen — see `computeApproachPath()` in
        // `aliens-demo.ts` for the exact recipe: project the target to NDC,
        // clamp it into a safe on-screen box (extra headroom at the top —
        // ships must never crop against the top edge in portrait), unproject
        // back to a world-space ray from the camera, then place the hover
        // point ~2 units and the approach-start point ~5.5 units from the
        // globe's center along that ray. Because the hover point sits on the
        // camera->target ray, the ship visibly hovers between the camera and
        // its target, and the beam it eventually fires travels from the
        // (always on-screen) ship to the real target.
        const targetWorld = ev.target ? /* globe.positionOf(...) transformed via scene.globe.localToWorld() */ : null;
        const { from, to } = computeApproachPath(scene.camera, targetWorld);
        aliens.spawnShip(ev.id, { fromWorldPos: from, toWorldPos: to, arriveSeconds: /* ship.arriveAt - elapsedSinceInvasionStart */ });
        audio.play('shipArrive');
        break;
      }
      case 'shipArrived':
        audio.play('laserCharge');
        break;
      case 'laserFired': {
        const p = globe.positionOf(ev.target.shellId, ev.target.index);
        // Transform p (globe-local) to world space via scene.globe.localToWorld(...)
        aliens.fireLaser(ev.id, worldPos);
        audio.play('laserFire');
        break;
      }
      case 'fireIgnited':
        audio.play('fireCrackle', { intensity: 0.6 });
        // Feed the same beads (as globe-local positions) to a `FireEmberSystem`
        // for the ignite burst — see "Fire particles" below.
        break;
    }
  }
  for (const ship of invasion.getShips()) {
    if (ship.phase === 'charging') aliens.setCharging(ship.id, invasion.chargeProgress(ship.id));
  }
  // Ambient crackle while any fire remains — a plain retrigger on an
  // interval, not a loop transport (see sfx.ts's fireCrackle doc comment):
  if (invasion.isFireActive() && elapsed - lastFireCrackleAt > 1.6) {
    audio.play('fireCrackle', { intensity: 0.3 });
    lastFireCrackleAt = elapsed;
  }
  fireEmbers.update(dt, /* globe-local positions of every currently-burning bead */);
}
aliens.update(dt);
```

`elapsedSinceInvasionStart` / `lastFireCrackleAt` are just two more small
per-level timers alongside whatever the frame loop already tracks, and
`computeApproachPath()` is a small (~15 line) pure-THREE helper — copy it
verbatim from `aliens-demo.ts`, it needs nothing demo-specific.

### 3. Tap routing — ships before beads

In the existing tap handler, **before** raycasting against
`globe.raycastTargets()`, raycast against ships first:

```ts
if (invasion) {
  const shipIds = aliens.raycastShips(raycaster);
  if (shipIds.length > 0) {
    const id = shipIds[0];
    if (invasion.destroyShip(id)) {
      aliens.destroyShip(id);
      audio.play('shipExplode');
      // consume the tap: do not also fire a probe at a bead this tap
      return;
    }
  }
}
```

This does **not** consume a probe — shooting down a ship is free, per the
GDD-style feel of "tap a ship to destroy it" (a probe is only spent on a
bead tap, same as today).

### 4. Fire spread + extinguish-probe queue override — after every shot

Right after the existing `session.fire(shellId, index)` call (both on a hit
and a miss — `onShotFired()` only actually does anything while fire exists):

```ts
if (invasion) {
  const outcome = invasion.onShotFired();
  if (outcome.spread.length) {
    // optional: a small extra audio/haptic beat; the beads' own instance
    // color already changed inside igniteFire(), so no FX call is required
  }
  if (outcome.queueOverrideColor !== null) {
    // Force the *next* queue slot to the fire color so the player is
    // offered an extinguish probe. `session.queue` is a public, mutable
    // [number|null, number|null] tuple — no GameSession.ts change needed.
    session.queue[1] = outcome.queueOverrideColor;
  }
}
```

Popping a fire patch needs **no new code at all**: the player fires a probe
whose color equals the fire color, taps a fire bead, and
`GameSession.fire()` already does exactly the right thing — `colorAt()`
returns the fire hex for that bead, `region()` BFS-matches the whole
connected fire patch by color, and `pop()` clears it. Play `audio.play('extinguish')`
from the existing "fire() returned a hit" branch when
`event.color === FIRE_COLOR` (import `FIRE_COLOR` from `src/game/invasion.ts`).

### 5. Win condition — no change needed

Fire beads are never popped by `igniteFire()` (they stay `alive`), so
`globe.aliveCount()` / `session`'s existing win check already count them.
Winning a level with unpopped fire is impossible by construction — good,
matches "fire beads count as beads to clear."

### 6. Tutorial for the first invasion level (`INVASION_FIRST_LEVEL` = 80)

Add one `UnlockEntry` to `src/game/unlocks.ts` (small, isolated edit):

```ts
{ level: 80, id: 'invasion', tutorial: 'invasion' },
```

(`UnlockId` needs `'invasion'` added to its union in the same file.) Then a
short forced-tutorial script in `src/ui/tutorial.ts`'s per-`UnlockId` table,
along the lines of the existing `meteor`/`comet` scripts: spotlight the
first ship as it arrives, caption explains tap-to-destroy, `until` resolves
on the first `shipSpawned`→`destroyShip` or `laserFired` event (whichever
comes first — the player doesn't have to succeed, just see it once).

Tutorial copy (EN + TR), for whichever localization/strings setup lands
alongside this:

**English:**
- Caption 1 (ship inbound): "An alien ship is approaching — tap it to destroy it before it fires!"
- Caption 2 (fire started, first time): "Its laser set part of the planet on fire. Look for a fire-colored probe to put it out."

**Turkish:**
- Caption 1: "Bir uzaylı gemisi yaklaşıyor — ateş etmeden önce ona dokunarak yok et!"
- Caption 2: "Lazeri gezegenin bir bölümünü ateşe verdi. Söndürmek için ateş renkli bir mermi ara."

## `BeadGlobe` changes needed (small, precise — not made in this session)

Two additive methods on `BeadGlobe` (`src/game/BeadGlobe.ts`), implementing
the two new optional `GlobeAdapter` members, plus one small addition inside
the existing `update(dt)` loop for the ember flicker. `src/render/aliens-demo.ts`'s
`DemoGlobe` class is a complete, working reference implementation of all
three — copy its logic, adapted to `BeadGlobe`'s multi-shell `Shell[]`
structure:

1. **`neighborsOf(shellId, index): BeadRef[]`** — alive neighbors of a bead
   on that shell's existing `nbrStart`/`nbrList` graph (already built and
   stored per-`Shell`; this just exposes it through the adapter):
   ```ts
   neighborsOf(shellId: number, index: number): BeadRef[] {
     const s = this.shells[shellId];
     const out: BeadRef[] = [];
     for (let p = s.nbrStart[index]; p < s.nbrStart[index + 1]; p++) {
       const j = s.nbrList[p];
       if (s.alive[j]) out.push({ shellId, index: j });
     }
     return out;
   }
   ```

2. **`igniteFire(beads, colorHex): void`** — reassigns each bead's
   `colorIdx` to a (lazily-added) palette entry for `colorHex`, and paints
   its instance color immediately. Each `Shell.palette` is a plain mutable
   `number[]`, so pushing a new entry is safe (matches what
   `makeShell()`/`paintFromTexture()` already produce). Track the fire
   palette index per shell (e.g. a new `Shell.fireColorIdx?: number` field,
   `-1`/`undefined` until first used) so repeated calls reuse the same
   index instead of growing the palette unboundedly:
   ```ts
   igniteFire(beads: BeadRef[], colorHex: number): void {
     for (const b of beads) {
       const shell = this.shells[b.shellId];
       if (!shell.alive[b.index]) continue;
       if (shell.fireColorIdx === undefined) {
         shell.fireColorIdx = shell.palette.length;
         shell.palette.push(colorHex);
       }
       shell.colorIdx[b.index] = shell.fireColorIdx;
       tmpC.setHex(colorHex);
       shell.mesh.setColorAt(b.index, tmpC);
     }
     for (const b of beads) {
       const shell = this.shells[b.shellId];
       if (shell.mesh.instanceColor) shell.mesh.instanceColor.needsUpdate = true;
     }
   }
   ```

3. **Ember flicker + ignite pulse**, inside `update(dt)` (near
   `updatePops`/`updateFlyAnims`): for each shell with a `fireColorIdx`, walk
   its alive beads whose `colorIdx === fireColorIdx` and re-paint their
   instance color with two things layered on top of the flat fire hex — see
   `DemoGlobe.updateFireFlicker()` in `aliens-demo.ts` for the working
   version this is copied from, and `scratchpad/invasion2/05_fire_closeup.png`
   for what it looks like:
   - a **per-bead flicker**, two mismatched sine frequencies plus a per-index
     phase offset (so neighboring beads never pulse in lockstep), pushing the
     color from a dim ember red toward a hot orange-yellow;
   - a **brief bright ignite pulse** on beads that just caught fire: record
     `ignitedAt` (the shell's own animation clock, e.g. `elapsed`) per bead
     index when `igniteFire()` first touches it, then for ~0.45s afterward
     lerp the flickering ember color toward white, fading out — this is what
     makes newly-spread fire visibly announce itself instead of silently
     recoloring (item raised in review).

   ```ts
   // Per-shell state: a `fireColorIdx?: number` (as above) plus
   // `ignitedAt = new Map<number, number>()`, set inside igniteFire():
   //   for (const b of beads) shell.ignitedAt.set(b.index, this.elapsed);

   const PULSE_DURATION = 0.45;
   const ember = new THREE.Color();
   const hot = new THREE.Color(0xffdd88);
   const white = new THREE.Color(0xffffff);
   const c = new THREE.Color();
   for (let i = 0; i < shell.colorIdx.length; i++) {
     if (!shell.alive[i] || shell.colorIdx[i] !== shell.fireColorIdx) continue;
     const flick = 0.55 + 0.225 * Math.sin(this.elapsed * 9 + i * 0.7) + 0.225 * Math.sin(this.elapsed * 21.3 - i * 1.3);
     ember.setHex(FIRE_COLOR).lerp(hot, Math.max(0, Math.min(1, flick)) * 0.6);
     c.copy(ember);
     const t0 = shell.ignitedAt.get(i);
     if (t0 !== undefined) {
       const age = this.elapsed - t0;
       if (age < PULSE_DURATION) c.lerp(white, (1 - age / PULSE_DURATION) * 0.9);
       else shell.ignitedAt.delete(i);
     }
     shell.mesh.setColorAt(i, c);
   }
   if (shell.mesh.instanceColor) shell.mesh.instanceColor.needsUpdate = true;
   ```

   This only touches beads currently on fire — typically a handful per level
   — so the extra per-frame cost is negligible even at the largest bead
   counts.

None of this needs a new `Shell` type field beyond the two optional
`fireColorIdx?: number` / `ignitedAt?: Map<number, number>`, and none of it
changes `colorAt()`/`region()`/`exposedColors()`/`pop()` — they already work
correctly for any `colorIdx`, fire or not.

### Fire particles (`src/render/fireEmbers.ts`)

`FireEmberSystem` is the rising-ember-spark + faint-smoke half of the ember
look (the flicker above is the *bead* half). It's pooled (fixed-capacity
typed arrays, no per-frame GC — same shape as `fx.ts`'s particle systems, not
imported from there to avoid coupling) and entirely THREE-side:

```ts
const fireEmbers = new FireEmberSystem();
scene.globe.add(fireEmbers.object); // same rotating frame the beads live in

// Every frame, alongside the ember-flicker update above:
fireEmbers.update(dt, currentFireLocalPositions); // globe.positionOf(...) for every fireBeadRefs() entry

// On a `fireIgnited` event — a bright burst announcing the new patch:
fireEmbers.spawnIgnite(newlyIgnitedLocalPositions);
```

Dead pool slots are invisible by construction (their vertex color fades to
black under additive blending, which contributes nothing to the framebuffer
regardless of where they're parked), so there's no visibility bookkeeping
needed beyond calling `update()` every frame.

## Difficulty curve (owner's brief: introduce gradually, one thing at a time)

Config function: `invasionConfigForLevel(level)` in `src/game/invasion.ts`.

- **First invasion level: 80** (`INVASION_FIRST_LEVEL`) — always has one
  (guaranteed, for the forced tutorial). Chosen to land well after every
  other GDD unlock (Comet at 60 is the last), so the player has the full
  toolkit before this new difficulty axis appears, and well before the
  Moon chapter (351) so it's established on home turf (Earth) first.
- **Frequency** (probability an eligible level *has* an invasion at all,
  linearly interpolated between control points and then a per-level seeded
  coin flip): 100% at 80 → 30% at 120 → 38% at 200 → 45% at 350 → 52% at
  451 → 65% at 550. Below 80: 0%.
- **Attack delay** (seconds a ship hovers before firing, unless shot down):
  3.0s at 80 → 2.8s at 120 → 2.6s at 200 → 2.4s at 350 → 2.2s at 451 →
  2.0s at 550 (the GDD's "2–3s, shorter on harder levels").
- **Ship count**: 1 at 80–150ish → 2 from ~200 → 3 by 550.
- **Fire spreads** every 4 shots (levels ~80–150) down to every 2 shots
  (level 550), 2→4 beads per spread tick.
- **Extinguish probe offered** after 1 shot (level 80, generous) up to 4
  shots (level 550, fire gets more time to grow before help arrives).

All of the above is seeded per-level (`mulberry32`, same helper as
`levels.ts`/`GameSession`), so a given level's invasion (whether it
happens, ship timings, impact targets, spread order) is fully deterministic
and repeatable.

## Screenshots (scratchpad, not part of the repo)

`aliens-demo.html` running at 390×844, captured with Playwright. The current
set, addressing the coordinator's four review points, lives in
`scratchpad/invasion2/` (the original pass's `scratchpad/invasion/` is kept
for reference, not overwritten):

1. `01_arrival.png` — ship inbound, banking into its approach path; the
   layered saucer silhouette (dome, belt rim, fin pods) reads clearly even
   mid-flight.
2. `02_charging.png` — hovering and charging: cyan→orange belt rim, dome,
   fin pods and underside light ring all visible, ship fully on-screen with
   headroom at the top.
3. `03_laser_fire.png` — the laser beam mid-flight from the (still fully
   on-screen) ship to its target on the near side of the globe.
4. `04_fire_wide.png` — a freshly-ignited patch, wide shot.
5. `05_fire_closeup.png` — camera aimed at the burning patch's centroid:
   per-bead ember flicker (varying orange/tan, not flat red) plus rising
   ember-spark particles are both visible.
6. `06_ship_explosion.png` — a destroyed ship's debris burst.

(Earlier iterations used a burst-capture loop to land exactly on the ~0.2s
laser window — see `dtClamp` in `aliens-demo.ts`'s `frame()`, which shrinks
the per-frame dt clamp specifically while a ship is charging past 80% or has
just fired, so a slow/software-rendered frame can't swallow the whole laser
flash before the next paint.)
