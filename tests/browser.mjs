// Browser checks, run with `npm run test:browser`. They use Playwright's
// Chromium (on a fresh machine: `npx playwright install chromium`) with
// software WebGL, and a small static server over the repository.
//
// What is checked:
//   - the player page (web/player.html) with the three.js backend: the spin
//     example draws, the cube turns, the frame rate over 10 seconds;
//   - the game reacts to real key presses, a mouse drag and a touch drag;
//   - the same programs give the same entity transforms in the browser
//     (three.js backend) as in Node (null backend), and three.js draws each
//     object with our world matrix mirrored into its coordinate system;
//   - the playground: every example runs, an edit changes the picture, a
//     compile error is marked at its line, a share link brings the code back;
//   - no console errors anywhere.
// Screenshots go to docs/screenshots/.

import http from 'node:http';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../src/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = join(ROOT, 'docs', 'screenshots');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pb': 'text/plain; charset=utf-8',
  '.png': 'image/png'
};

function startServer()
{
  const server = http.createServer(async (req, res) =>
  {
    try
    {
      let file = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
      if (!file.startsWith(ROOT))
      {
        res.writeHead(403).end();
        return;
      }
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
      res.end(body);
    }
    catch
    {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

const results = [];
const facts = {};

async function check(name, fn)
{
  const started = Date.now();
  try
  {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name} (${Date.now() - started} ms)`);
  }
  catch (err)
  {
    results.push({ name, ok: false });
    console.log(`FAIL  ${name}\n      ${String(err.stack || err.message).split('\n').join('\n      ')}`);
  }
}

function assert(cond, message)
{
  if (!cond) throw new Error(message);
}

// Opens a page that records console errors and uncaught exceptions.
async function openPage(browser, url, viewport = { width: 1000, height: 750 })
{
  const page = await browser.newPage({ viewport });
  page.consoleErrors = [];
  page.on('console', (m) =>
  {
    if (m.type() === 'error') page.consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => page.consoleErrors.push(e.message));
  await page.goto(url);
  return page;
}

function noConsoleErrors(page)
{
  assert(page.consoleErrors.length === 0, `console errors:\n${page.consoleErrors.join('\n')}`);
}

// Colour statistics of a canvas: how many different colours in a sample of
// its pixels, and a hash of them. Works for WebGL (the renderer keeps its
// drawing buffer) and 2D canvases.
const canvasStats = (canvas) =>
{
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  const ctx = copy.getContext('2d');
  ctx.drawImage(canvas, 0, 0);
  const d = ctx.getImageData(0, 0, copy.width, copy.height).data;
  const colours = new Set();
  let hash = 0;
  for (let i = 0; i < d.length; i += 4 * 61)
  {
    colours.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    hash = (Math.imul(hash, 31) + d[i] + d[i + 1] * 7 + d[i + 2] * 13) | 0;
  }
  return { colours: colours.size, hash, width: copy.width, height: copy.height, corner: Array.from(d.slice(0, 3)) };
};

async function playerStats(page)
{
  return page.evaluate(`(${canvasStats})(window.polybasicPlayer.screen.canvas)`);
}

async function waitRunning(page)
{
  await page.waitForFunction(() => window.polybasicPlayer && window.polybasicPlayer.state.engine && window.polybasicPlayer.state.engine.frames > 5, null, { timeout: 20000 });
}

// World matrices of every entity after a program ran `frames` Updates on
// the headless engine in Node.
async function nodeMatrices(file, frames)
{
  const { js } = compile(readFileSync(join(ROOT, file), 'utf8'), { file });
  const engine = new Engine();
  await runProgram(await loadProgram(js), new CaptureHost(), { engine, maxUpdates: frames });
  return engine.world.entities.map((e) => [e.id, Array.from(e.worldMatrix.e)]);
}

function maxDifference(a, b)
{
  assert(a.length === b.length, `entity counts differ: ${a.length} vs ${b.length}`);
  let worst = 0;
  for (let i = 0; i < a.length; i++)
  {
    assert(a[i][0] === b[i][0], `entity ids differ at ${i}`);
    for (let k = 0; k < 16; k++) worst = Math.max(worst, Math.abs(a[i][1][k] - b[i][1][k]));
  }
  return worst;
}

const server = await startServer();
const base = `http://127.0.0.1:${server.address().port}`;
await mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

try
{
  await check('spin.pb draws with three.js, the cube turns, text on top', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/spin.pb`);
    await waitRunning(page);
    await page.waitForTimeout(500);
    const a = await playerStats(page);
    await page.waitForTimeout(400);
    const b = await playerStats(page);
    assert(a.colours > 50, `too few colours (${a.colours}): blank picture?`);
    assert(a.hash !== b.hash, 'the picture did not change between frames');
    const yaw = await page.evaluate(() =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.kind === 'mesh');
      return e.getRotation(true).yaw;
    });
    assert(yaw !== 0, 'the cube has not turned');
    const overlay = await page.evaluate(`(${canvasStats})(window.polybasicPlayer.screen.overlayCanvas)`);
    assert(overlay.colours > 3, 'no 2D text on the overlay');
    await page.screenshot({ path: join(SHOTS, 'spin.png') });
    noConsoleErrors(page);
    await page.close();
  });

  await check('frame rate over 10 seconds (software WebGL)', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/spin.pb`);
    await waitRunning(page);
    const count = () => page.evaluate(() => window.polybasicPlayer.state.engine.frames);
    const t0 = Date.now();
    const f0 = await count();
    await page.waitForTimeout(10000);
    const f1 = await count();
    const fps = (f1 - f0) / ((Date.now() - t0) / 1000);
    facts.fps = fps.toFixed(1);
    console.log(`      ${f1 - f0} frames in 10 s: ${facts.fps} fps`);
    assert(fps > 5, `only ${fps} fps`);
    noConsoleErrors(page);
    await page.close();
  });

  await check('block-rain.pb responds to real key presses, a mouse drag and a touch drag', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/block-rain.pb`);
    await waitRunning(page);
    const ballX = () => page.evaluate(() => window.polybasicPlayer.state.engine.world.entities.find((e) => e.name === 'ball').getPosition(true).x);
    await page.screenshot({ path: join(SHOTS, 'block-rain-title.png') });
    await page.keyboard.press('Space');
    await page.waitForTimeout(300);
    const x0 = await ballX();
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(600);
    await page.keyboard.up('ArrowLeft');
    const x1 = await ballX();
    assert(x1 < x0 - 1, `ArrowLeft did not move the ball left (${x0} -> ${x1})`);
    facts.keyMove = `${x0.toFixed(2)} -> ${x1.toFixed(2)}`;

    // Mouse: hold on the right of the screen and drag further right.
    const box = await page.locator('canvas').first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.6, { steps: 8 });
    await page.waitForTimeout(700);
    const x2 = await ballX();
    await page.mouse.up();
    assert(x2 > x1 + 2, `the mouse drag did not pull the ball right (${x1} -> ${x2})`);
    facts.mouseMove = `${x1.toFixed(2)} -> ${x2.toFixed(2)}`;
    await page.screenshot({ path: join(SHOTS, 'block-rain-play.png') });

    // Touch through the DevTools protocol: one finger on the left.
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: type === 'touchEnd' ? [] : [{ x: box.x + box.width * x, y: box.y + box.height * 0.6, id: 1 }]
    });
    await touch('touchStart', 0.3);
    for (const x of [0.25, 0.2, 0.15, 0.1]) await touch('touchMove', x);
    await page.waitForTimeout(700);
    const x3 = await ballX();
    await touch('touchEnd', 0.1);
    assert(x3 < x2 - 2, `the touch drag did not pull the ball left (${x2} -> ${x3})`);
    facts.touchMove = `${x2.toFixed(2)} -> ${x3.toFixed(2)}`;
    noConsoleErrors(page);
    await page.close();
  });

  await check('same transforms under three.js in the browser and the null backend in Node', async () =>
  {
    const worst = [];
    for (const [file, frames] of [['examples/spin.pb', 60], ['examples/orbits.pb', 90]])
    {
      const page = await openPage(browser, `${base}/web/player.html?src=../${file}&frames=${frames}`);
      await page.waitForFunction(() => window.polybasicPlayer.state.status === 'stopped', null, { timeout: 30000 });
      const browserSide = await page.evaluate(() => window.polybasicPlayer.state.engine.world.entities.map((e) => [e.id, Array.from(e.worldMatrix.e)]));
      const nodeSide = await nodeMatrices(file, frames);
      const diff = maxDifference(browserSide, nodeSide);
      assert(diff < 1e-12, `${file}: matrices differ by ${diff}`);
      // three.js draws with our matrix mirrored in Z: S * M * S.
      const mirrored = await page.evaluate(() =>
      {
        const { engine } = window.polybasicPlayer.state;
        const backend = window.polybasicPlayer.screen.backend;
        let most = 0;
        let checked = 0;
        for (const e of engine.world.entities)
        {
          const three = backend.objectMatrix(e.id);
          if (!three) continue;
          const m = e.worldMatrix.e;
          const flip = [2, 6, 14, 8, 9, 11];
          for (let k = 0; k < 16; k++)
          {
            const want = flip.includes(k) ? -m[k] : m[k];
            most = Math.max(most, Math.abs(want - three[k]));
          }
          checked++;
        }
        return { most, checked };
      });
      assert(mirrored.checked > 0 && mirrored.most < 1e-5, `${file}: three.js matrices off by ${mirrored.most}`);
      worst.push(`${file} after ${frames} updates: ${browserSide.length} entities, max difference ${diff}, three.js objects checked ${mirrored.checked}`);
      noConsoleErrors(page);
      await page.close();
    }
    facts.swap = worst;
    for (const w of worst) console.log(`      ${w}`);
  });

  // ── Playground ──────────────────────────────────────────────────────

  const playground = await openPage(browser, `${base}/web/`, { width: 1400, height: 850 });
  const pgStats = () => playground.evaluate(`(${canvasStats})(window.polybasicPlayground.getScreen().canvas)`);
  const pgFrames = () => playground.evaluate(() =>
  {
    const s = window.polybasicPlayground.getSession();
    return s ? s.engine.frames : -1;
  });
  const openExample = async (id) =>
  {
    await playground.evaluate((x) => window.polybasicPlayground.openProgram(x), id);
    const start = await pgFrames();
    await playground.waitForFunction((n) =>
    {
      const s = window.polybasicPlayground.getSession();
      return s && s.engine.frames > n + 5;
    }, start < 0 ? 0 : 0, { timeout: 20000 }).catch(() => {});
    await playground.waitForTimeout(600);
  };

  await check('playground: every example runs', async () =>
  {
    await playground.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId(), null, { timeout: 20000 });
    const manifest = JSON.parse(readFileSync(join(ROOT, 'web/programs/manifest.json'), 'utf8'));
    for (const entry of manifest.programs)
    {
      await openExample(entry.id);
      const status = await playground.textContent('#status');
      assert(!/error/i.test(status), `${entry.id}: status "${status}"`);
      const consoleText = await playground.textContent('#console');
      assert(!/error/i.test(consoleText), `${entry.id}: console says ${consoleText}`);
      if (entry.category === '3d')
      {
        const s = await pgStats();
        assert(s.colours > 20, `${entry.id}: blank canvas (${s.colours} colours)`);
      }
      else assert(consoleText.trim().length > 0, `${entry.id}: printed nothing`);
      if (entry.id === 'spin' || entry.id === 'orbits') await playground.screenshot({ path: join(SHOTS, `playground-${entry.id}.png`) });
    }
    noConsoleErrors(playground);
  });

  await check('playground: an edit changes the picture after Run', async () =>
  {
    await openExample('spin');
    const before = await pgStats();
    const text = await playground.evaluate(() => window.polybasicPlayground.getText());
    assert(text.includes('CameraClsColor camera, 24, 28, 40'), 'spin.pb changed?');
    await playground.evaluate((t) => window.polybasicPlayground.setText(t), text.replace('CameraClsColor camera, 24, 28, 40', 'CameraClsColor camera, 200, 40, 40'));
    await playground.click('#runBtn');
    await playground.waitForTimeout(1200);
    const after = await pgStats();
    assert(before.corner[0] < 60 && after.corner[0] > 150, `background did not turn red: ${before.corner} -> ${after.corner}`);
    const edited = await playground.isVisible('button[data-id="spin"] .edited');
    assert(edited, 'the example is not marked as edited');
    noConsoleErrors(playground);
  });

  await check('playground: a compile error is marked at its line', async () =>
  {
    await playground.evaluate(() => window.polybasicPlayground.setText('x = 1\ny = 2\nPrint z$ - 1\n'));
    await playground.click('#runBtn');
    await playground.waitForSelector('.cm-lint-marker-error', { timeout: 5000 });
    const line = await playground.evaluate(() =>
    {
      const marker = document.querySelector('.cm-lint-marker-error').getBoundingClientRect();
      const lines = [...document.querySelectorAll('.cm-content .cm-line')];
      return lines.findIndex((l) =>
      {
        const r = l.getBoundingClientRect();
        return marker.top + marker.height / 2 >= r.top && marker.top + marker.height / 2 <= r.bottom;
      }) + 1;
    });
    assert(line === 3, `marker on line ${line}`);
    const consoleText = await playground.textContent('#console');
    assert(/Compile error: .*\(line 3, column 10\)/.test(consoleText), consoleText);
    assert((await playground.textContent('#status')) === 'Compile error', 'status');
    await playground.screenshot({ path: join(SHOTS, 'playground-error.png') });
  });

  await check('playground: a share link brings the code back', async () =>
  {
    const code = '; shared\nGraphics3D 640, 480\nc = CreateCamera()\nx = CreateTorus()\nPositionEntity x, 0, 0, 4\nPrint "shared " + 42\n';
    await playground.evaluate((t) => window.polybasicPlayground.setText(t), code);
    const url = await playground.evaluate(() => window.polybasicPlayground.buildShareUrl());
    assert(url.includes('#p=spin&code='), url);
    const other = await openPage(browser, url, { width: 1400, height: 850 });
    await other.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    await other.waitForTimeout(800);
    const text = await other.evaluate(() => window.polybasicPlayground.getText());
    assert(text === code, 'shared code differs');
    assert((await other.textContent('#console')).includes('shared 42'), 'shared code did not run');
    noConsoleErrors(other);
    await other.close();
    // Put the example back as it was for anyone looking at the page.
    await playground.evaluate(() => window.localStorage.clear());
  });
}
finally
{
  await browser.close();
  server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
if (facts.fps) console.log(`fps: ${facts.fps}; key: ${facts.keyMove}; mouse: ${facts.mouseMove}; touch: ${facts.touchMove}`);
process.exitCode = failed ? 1 : 0;
