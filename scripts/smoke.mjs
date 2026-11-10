#!/usr/bin/env node
/**
 * Headless visual smoke test.
 *   node scripts/smoke.mjs [scenario ...] [--no-build] [--wait=ms]
 * Builds, serves dist with `vite preview`, loads each scenario (?scenario=<name>) in Chromium, and checks:
 *   - no console errors / page errors
 *   - the frame is not black and not uniform
 *   - the game loop is running (window.__game.frames > 20) and reports ready
 *   - window.__game.errors is empty
 * Screenshots and a summary JSON land in artifacts/smoke/.
 */
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:net';
import { chromium } from 'playwright-core';

const SCENARIOS = ['default', 'low-water', 'canyon-run', 'stall-test', 'dive-test', 'dummies'];

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')).map((a) => a.split('=')[0]));
const waitArg = args.find((a) => a.startsWith('--wait='));
const settleMs = waitArg ? Number(waitArg.split('=')[1]) : 2500;
const only = args.filter((a) => !a.startsWith('--'));
const unknown = only.filter((s) => !SCENARIOS.includes(s));
if (unknown.length) {
  console.error(`Unknown scenario(s): ${unknown.join(', ')}. Known: ${SCENARIOS.join(', ')}`);
  process.exit(1);
}

// Parallel agents run smoke tests at the same time: always use a free port.
const PORT = await new Promise((resolve) => {
  const srv = createServer();
  srv.listen(0, () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});
const OUT = 'artifacts/smoke';
const BROWSER = process.env.CHROMIUM_PATH ?? ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'].find(existsSync);

mkdirSync(OUT, { recursive: true });
if (!flags.has('--no-build')) execSync('npx vite build --logLevel error', { stdio: 'inherit' });

let server;
let serverExited = false;
function startServer() {
  serverExited = false;
  server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
  server.on('exit', () => (serverExited = true));
}
startServer();
const stop = () => server.kill('SIGTERM');
process.on('exit', stop);

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    if (serverExited) throw new Error(`preview server on port ${PORT} exited (port taken?)`);
    try {
      const r = await fetch(`http://localhost:${PORT}/`);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('preview server did not start');
}

const results = [];
let failed = false;

try {
  await waitForServer();
  const launch = () =>
    chromium.launch({
      executablePath: BROWSER,
      headless: true,
      args: ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader'],
    });
  let browser = await launch();
  const page0 = await browser.newPage();
  await page0.goto(`http://localhost:${PORT}/`);
  await page0.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 });
  const renderer = await page0.evaluate(() => {
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  await page0.close();
  console.log(`GPU: ${renderer}`);

  for (const name of only.length ? only : SCENARIOS) {
    // A browser that dies under memory pressure (parallel agents) gets one relaunch and retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!browser.isConnected()) browser = await launch();
      let page;
      try {
        page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      } catch {
        await browser.close().catch(() => {});
        browser = await launch();
        page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      }
      const errors = [];
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(m.text());
      });
      page.on('pageerror', (e) => errors.push(String(e)));
      const res = { scenario: name, ok: true, problems: [] };
      try {
        await page.goto(`http://localhost:${PORT}/?scenario=${name}&shot`);
        await page.waitForFunction(() => window.__game?.ready === true, null, { timeout: 30000 });
        await page.waitForTimeout(settleMs);
        const state = await page.evaluate(() => window.__game);
        // Sample the pixels from the screenshot itself: drawImage on a WebGL canvas reads back blank
        // once the frame is presented (no preserveDrawingBuffer), so the PNG is the reliable source.
        const shotPath = `${OUT}/${name.replace(/[^a-zA-Z0-9]+/g, '_')}.png`;
        const png = await page.screenshot({ path: shotPath });
        const stats = await page.evaluate(async (dataUrl) => {
          const img = new Image();
          img.src = dataUrl;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = 160;
          c.height = 90;
          const g = c.getContext('2d');
          if (!g) return { mean: 0, std: 0 };
          g.drawImage(img, 0, 0, 160, 90);
          const d = g.getImageData(0, 0, 160, 90).data;
          let sum = 0, sum2 = 0;
          const n = d.length / 4;
          for (let i = 0; i < d.length; i += 4) {
            const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
            sum += l;
            sum2 += l * l;
          }
          const mean = sum / n;
          return { mean, std: Math.sqrt(Math.max(0, sum2 / n - mean * mean)) };
        }, `data:image/png;base64,${png.toString('base64')}`);
        Object.assign(res, { state, stats, errors });
        if (errors.length) res.problems.push(`console errors: ${errors.slice(0, 3).join(' | ')}`);
        if (!state.ready) res.problems.push('game not ready');
        if (state.errors?.length) res.problems.push(`game errors: ${state.errors.slice(0, 3).join(' | ')}`);
        if (state.scenario !== name) res.problems.push(`scenario mismatch: expected ${name}, got ${state.scenario}`);
        if (stats.mean < 2) res.problems.push(`frame is black (mean ${stats.mean.toFixed(1)})`);
        if (stats.std < 1.5) res.problems.push(`frame is uniform (std ${stats.std.toFixed(2)})`);
        if (!(state.frames > 20)) res.problems.push(`game loop not running (frames ${state.frames})`);
      } catch (e) {
        res.problems.push(String(e));
      }
      const crashed = !browser.isConnected() || res.problems.some((p) => /has been closed|crash/i.test(p));
      const serverDown = serverExited || res.problems.some((p) => /ERR_CONNECTION_REFUSED/.test(p));
      // A navigation that fails at the HTTP level right after a build is transient: retry once.
      const navFailed = res.problems.some((p) => /page\.goto|ERR_HTTP_RESPONSE_CODE_FAILURE|HTTP 404/.test(p));
      if ((crashed || serverDown || navFailed) && attempt === 0) {
        console.log(`RETRY ${name}: ${serverDown ? 'preview server died, restarting' : crashed ? 'browser crashed, relaunching' : 'page load failed, retrying'}`);
        await page.close().catch(() => {});
        if (serverDown) {
          server.kill('SIGTERM');
          startServer();
          await waitForServer();
        }
        if (crashed) {
          await browser.close().catch(() => {});
          browser = await launch();
        }
        continue;
      }
      res.ok = res.problems.length === 0;
      failed ||= !res.ok;
      results.push(res);
      console.log(`${res.ok ? 'PASS' : 'FAIL'} ${name}` + (res.problems.length ? `\n     ${res.problems.join('\n     ')}` : ''));
      await page.close().catch(() => {});
      break;
    }
  }
  await browser.close();
} catch (e) {
  console.error(e);
  failed = true;
} finally {
  writeFileSync(`${OUT}/summary.json`, JSON.stringify(results, null, 2));
  stop();
}
console.log(`Screenshots: ${OUT}/`);
process.exit(failed ? 1 : 0);
