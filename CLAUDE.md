# Overdrive

## What it is
Overdrive is a wild 3D third-person dogfighter: bullet hell meets Luftrausers. Procedural code-built models, heavy three.js effects. Milestone 1 is a flight-feel sandbox. Plan: /home/ricardo/.claude/plans/we-ll-build-a-wild-synthetic-diffie.md

## Commands
- `npm run dev`: Vite dev server.
- `npm run check`: typecheck, lint (`--max-warnings=0`), vitest, build. Must pass before a stop.
- `npm test`: vitest only. `npm run typecheck`, `npm run lint`, `npm run build`, `npm run preview` do what they say.
- `npm run smoke`: builds, then loads each scenario in headless Chromium and checks it. Flags:
  - Scenario names as positional args. None means all of them.
  - `--no-build`: skip the vite build and use the existing `dist`.
  - `--wait=ms`: settle time after the game reports ready (default 2500).
  - Example: `npm run smoke -- default --no-build --wait=4000`
  - Output: `artifacts/smoke/<scenario>.png` and `artifacts/smoke/summary.json`. Exit code 1 on failure.
- `node scripts/shots.mjs [--no-build] [boost|skim|dive|stall|ram|canyon]`: scripted flights (drives `__game.input.external` on a timeline), saving frames to `artifacts/shots/` and printing in-page fps. For eyeballing feel and FX, not pass/fail.
- URL params: `?shot` hides the click-to-fly gate (smoke and shots use it). `?debug` opens the tuning panel. `?fxdemo` spawns FX in front of the ship.
- URL params: `?scenario=name` selects a scenario, exposed as `window.__game.scenario`.
- Scenarios: `default`, `low-water`, `canyon-run`, `stall-test`, `dive-test`, `dummies`.

## Controls
Click to capture the mouse (pointer lock). **Mouse** = aim (the ship chases the aim, the camera looks along it, and screen center is the aim point). **W** hold to accelerate to max. **S** hold to brake; below stall speed for 1.2 s the ship stalls (nose drops, gravity takes over, dive to recover). **A/D** = hard break turn (aim yaws, 85° bank, drift). **Shift** = boost to 300 (yellow booster pods deploy; the camera pulls back; the meter recharges, and running it dry locks it out until 20%). **Wheel** = camera distance (FOV is fixed at `camera.fov`, 110). **Water:** a dive steeper than `water.minDiveAngle` goes under and launches back out at the mirrored angle with the entry speed (the aim flips up too); shallower contact skims the surface. **Terrain:** bounce with a minimum push-off, a nose probe, and a short recovery where the nose follows the rebound. **E** = missiles (M2). **LMB** = gun (M2). **F3** = debug panel.

## Architecture map (`src/`)
- `main.ts`: wiring only. Fixed-step sim (`config.sim.rate`), variable-rate render, and `window.__game` (`world`, `input`, `config`, `renderer`, `camera`).
- `core/`: `config.ts` (every tunable, split into sections, each owned by one module family), `rng.ts`, `noise.ts` (Simplex3, fbm, ridged).
- `sim/` (pure, no DOM or renderer, runs in vitest):
  - `types.ts` (InputFrame, ShipState, Dummy, SimEvent, Terrain: the **shared contracts**)
  - `flight.ts`, `water.ts`, `waves.ts` (shared CPU/GLSL wave function), `collision.ts`, `shield.ts`, `dummies.ts`
  - `terrainGen.ts`, `world.ts`, `scenarios.ts`
- `render/`: `camera.ts` (mouse-aim chase cam), `sky.ts`, `ocean.ts`, `terrainView.ts`, `post.ts`, `ship/model.ts`, `dummyView.ts`.
- `fx/fx.ts`: particles, trails and glows, driven by SimEvents and ShipState.
- `ui/hud.ts`: DOM HUD. `input/input.ts`: pointer lock plus keys, which produces InputFrames.
- `tests/`: vitest. `helpers.ts` has `fnTerrain`, `flatSea`, and `run(world, seconds, input)` for scripted flights.

## Hard rules
- **Config.** All tunables live in `src/core/config.ts`, read at use time, never cached in module constants. Add fields only to your section.
- **Sim purity.** `src/sim/*` imports three math only. No DOM, no scene objects. Render reads sim state and never writes it.
- **Conventions.** +Y is up, sea level is y=0 plus `waveHeight(x,z,t)`. Ship local forward is -Z, up is +Y, right is +X. Units are meters, seconds and radians.
- **Ocean match.** The ocean shader must use `wavesGLSL()` and `waveUniformData()` from `sim/waves.ts`, so the visual surface equals the physics surface.
- **Events.** The sim emits `SimEvent`s, and render/fx consume them once per frame via `world.drainEvents()` in `main.ts`.
- **Look.** Bright anime sky (concept image 1): saturated blue sky, sunlit ocean, toon or flat shading, magenta and pink glows, heavy bloom. Models are built in code. Effects make up for simple geometry.
- **Perf.** Target 60 fps on Intel Iris Xe at 1080p. Prefer instancing, pooled buffers, and no per-frame allocations in hot loops.
- Contracts (`types.ts`, the public constructor/update signatures of render modules) change only by agreement. Keep them stable.
