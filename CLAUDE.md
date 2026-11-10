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
- URL params: `?scenario=name` selects a scenario, exposed as `window.__game.scenario`.
- Scenarios: `default`, `low-water`, `canyon-run`, `stall-test`, `dive-test`, `dummies`.

## Controls
TBD

## Architecture map
TBD

## Hard rules
TBD
