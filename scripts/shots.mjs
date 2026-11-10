#!/usr/bin/env node
/**
 * Scripted flight screenshots for eyeballing feel and FX (not a pass/fail test).
 *   node scripts/shots.mjs [--no-build] [shot ...]
 * Each shot loads a scenario, drives window.__game.input.external on a timeline, and saves
 * artifacts/shots/<shot>-<n>.png at the given times. Also logs fps measured in-page.
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

/** timeline: [atMs, inputOverride | null, snap?] */
const SHOTS = {
  boss: { scenario: 'boss', steps: [[0, {}], [1500, null, true], [3500, { fire: true }], [4500, null, true], [5500, { missile: true }], [6500, null, true], [8000, { boost: true }], [9000, null, true]] },
  gun: { scenario: 'dummies', steps: [[0, { throttle: true }], [2500, { fire: true }], [3000, null, true], [4200, null, true], [5200, { fire: true, right: true }], [5600, null, true]] },
  missiles: { scenario: 'dummies', steps: [[0, { throttle: true }], [2000, { missile: true }], [2400, null, true], [3200, null, true], [4400, {}], [4600, null, true], [5600, null, true]] },
  boost: { scenario: 'default', steps: [[0, {}], [500, { boost: true }], [650, null, true], [1500, null, true], [2300, { boost: true, right: true }], [2700, null, true]] },
  skim: { scenario: 'low-water', steps: [[0, { throttle: true }], [1500, null, true], [2500, { boost: true }], [3500, null, true]] },
  dive: { scenario: 'dive-test', steps: [[0, {}], [2100, null, true], [2500, null, true], [2900, null, true], [3300, null, true], [3700, null, true], [4300, null, true]] },
  stall: { scenario: 'stall-test', steps: [[0, { brake: true }], [200, null, true], [800, null, true], [2600, null, true], [3200, { brake: true, right: true }], [3800, null, true]] },
  ram: { scenario: 'dummies', steps: [[0, { throttle: true }], [2500, null, true]] },
  canyon: { scenario: 'canyon-run', steps: [[0, { throttle: true }], [2500, null, true], [4000, { left: true }], [4800, null, true]] },
};

const args = process.argv.slice(2);
const noBuild = args.includes('--no-build');
const only = args.filter((a) => !a.startsWith('--'));
const OUT = 'artifacts/shots';
mkdirSync(OUT, { recursive: true });
if (!noBuild) execSync('npx vite build --logLevel error', { stdio: 'inherit' });

const PORT = await new Promise((resolve) => {
  const srv = createServer();
  srv.listen(0, () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
process.on('exit', () => server.kill('SIGTERM'));
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {
    /* not up */
  }
  await new Promise((r) => setTimeout(r, 150));
}

const BROWSER = process.env.CHROMIUM_PATH ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);
const browser = await chromium.launch({
  executablePath: BROWSER,
  headless: true,
  args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGE ERROR', e.message));
page.on('console', (m) => m.type() === 'error' && console.log('CONSOLE', m.text()));

for (const [name, shot] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(name)) continue;
  await page.goto(`http://localhost:${PORT}/?scenario=${shot.scenario}&shot`);
  await page.waitForFunction(() => window.__game?.ready && window.__game.frames > 5, null, { timeout: 20000 });
  const f0 = await page.evaluate(() => window.__game.frames);
  const t0 = Date.now();
  let n = 0;
  for (const [at, inp, snap] of shot.steps) {
    const wait = t0 + at - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (inp) await page.evaluate((i) => (window.__game.input.external = i), inp);
    if (snap) await page.screenshot({ path: `${OUT}/${name}-${n++}.png` });
  }
  const fps = ((await page.evaluate(() => window.__game.frames)) - f0) / ((Date.now() - t0) / 1000);
  console.log(`${name}: ${n} shots, ~${fps.toFixed(0)} fps`);
}
await browser.close();
process.exit(0);
