// Browser checks, run with `npm run test:browser`. They use Playwright's
// Chromium (on a fresh machine: `npx playwright install chromium`) with
// software WebGL, and a small static server over the repository.
//
// What is checked:
//   - the player page (web/player.html) with the three.js backend: the spin
//     example draws, the cube turns, the frame rate over 10 seconds;
//   - the games react to real key presses, clicks, a mouse drag and a touch
//     drag;
//   - the same programs give the same entity transforms in the browser
//     (three.js backend) as in Node (null backend), and three.js draws each
//     object with our world matrix mirrored into its coordinate system;
//   - CameraPick and CameraProject agree with the pixels three.js drew;
//   - physics: the Rapier file is fetched only when a program needs it,
//     and the motion is the same as in Node;
//   - glTF models draw textured, with the texture in a PNG file or inside
//     the .glb, and match three.js's own GLTFLoader picture (so nothing is
//     mirrored);
//   - playground projects: saved examples run from their own files,
//     several files with uploads and Include, errors in the right file,
//     everything kept across reloads; .zip out and back in; an exported
//     page that plays alone, from a server or opened from the disk;
//   - the playground: every example runs, an edit changes the picture, a
//     compile error is marked at its line, a share link brings the code back;
//   - no console errors anywhere.
// Screenshots go to tests/output/.

import http from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../src/index.js';
import { nodeEngineOptions } from '../src/node.js';
import { projectPoint } from '../src/engine/collide/camera.js';
import { hear } from '../src/engine/audio/spatial.js';
import { Mat4, Vec3, Quat } from '../src/engine/math/index.js';
import { World } from '../src/engine/scene/world.js';
import { makeWav } from './unit/audio.mjs';
import { projectPage } from '../web/export.js';
import { crc32 } from '../web/zip.js';
import { deflateSync } from 'node:zlib';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Screenshots of every run go to tests/output (not committed); the ones in
// docs/screenshots are copies picked from there.
const SHOTS = join(ROOT, 'tests', 'output');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pb': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.md2': 'application/octet-stream',
  '.wav': 'audio/wav'
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

// ONLY=text runs just the checks whose name has that text in it.
const ONLY = process.env.ONLY || '';

async function check(name, fn)
{
  if (ONLY && !name.includes(ONLY)) return;
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
    // three.js reports what it had to change (a removed setting, a bad
    // texture) as warnings: those are errors of ours too.
    if (m.type() === 'error' || (m.type() === 'warning' && m.text().startsWith('THREE.'))) page.consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => page.consoleErrors.push(e.message));
  await page.goto(url);
  return page;
}

// How loud a screen's sound is, left and right, over `ms` milliseconds:
// the loudest moment of each side (`left`, `right`) and the level over the
// whole time (`leftAll`, `rightAll`, the same moments on both sides, so
// their ratio is the balance even while the sound fades), and `pitch`, the
// strongest frequency in Hz (the median of the readings). `where` is
// 'playground' or 'page' (an exported page).
// A PNG file of a size x size black and white checker.
function checkerPng(size)
{
  const chunk = (type, data) =>
  {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);       // 8 bits, RGB
  const rows = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++)
  {
    for (let x = 0; x < size; x++)
    {
      const v = (x + y) % 2 === 0 ? 0 : 255;
      rows.fill(v, y * (1 + size * 3) + 1 + x * 3, y * (1 + size * 3) + 4 + x * 3);
    }
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

// Each reading covers the last 8192 samples (about 170 ms): wait this long
// after a change before measuring what came after it.
const SETTLE_MS = 250;

async function audioLevels(page, ms = 400, where = 'playground')
{
  return page.evaluate(async ({ ms, where }) =>
  {
    const audio = where === 'page' ? window.polybasicPage.screen.audio : window.polybasicPlayground.getScreen().audio;
    const ctx = audio.context();
    if (!audio.meter)
    {
      const split = ctx.createChannelSplitter(2);
      audio.output.connect(split);
      const left = ctx.createAnalyser();
      const right = ctx.createAnalyser();
      // Each reading on its own: by default an analyser blends every
      // reading with the ones before, and a loud sound that has stopped
      // would outweigh a quiet one playing now.
      for (const analyser of [left, right])
      {
        analyser.fftSize = 8192;
        analyser.smoothingTimeConstant = 0;
      }
      split.connect(left, 0);
      split.connect(right, 1);
      audio.meter = { left, right };
    }
    const data = new Float32Array(8192);
    const bins = new Float32Array(4096);
    const loudest = (analyser) =>
    {
      analyser.getFloatFrequencyData(bins);
      let best = 0;
      for (let i = 1; i < bins.length; i++) if (bins[i] > bins[best]) best = i;
      return best * ctx.sampleRate / analyser.fftSize;
    };
    const pitches = [];
    const energy = (analyser) =>
    {
      analyser.getFloatTimeDomainData(data);
      let sum = 0;
      for (const v of data) sum += v * v;
      return sum / data.length;
    };
    let left = 0;
    let right = 0;
    let leftSum = 0;
    let rightSum = 0;
    let n = 0;
    const until = performance.now() + ms;
    while (performance.now() < until)
    {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const l = energy(audio.meter.left);
      const r = energy(audio.meter.right);
      left = Math.max(left, Math.sqrt(l));
      right = Math.max(right, Math.sqrt(r));
      leftSum += l;
      rightSum += r;
      n++;
      if (l > 1e-10) pitches.push(loudest(audio.meter.left));
    }
    pitches.sort((a, b) => a - b);
    const pitch = pitches.length ? pitches[pitches.length >> 1] : 0;
    return { left, right, leftAll: Math.sqrt(leftSum / n), rightAll: Math.sqrt(rightSum / n), pitch, state: ctx.state, stats: { ...audio.stats } };
  }, { ms, where });
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
  // Pixels not of the corner's colour: a small thing drawn on a plain
  // background shows here when the sampled colours miss it.
  let drawn = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2]) drawn++;
  return { colours: colours.size, drawn, hash, width: copy.width, height: copy.height, corner: Array.from(d.slice(0, 3)) };
};

// All the pixels of a canvas (RGBA bytes), found by a selector or the
// player's screen. Sent as base64: a plain array of numbers is slow.
async function canvasPixels(page, selector = null)
{
  const encoded = await page.evaluate((sel) =>
  {
    const canvas = sel ? document.querySelector(sel) : window.polybasicPlayer.screen.canvas;
    const copy = document.createElement('canvas');
    copy.width = canvas.width;
    copy.height = canvas.height;
    const ctx = copy.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    const bytes = ctx.getImageData(0, 0, copy.width, copy.height).data;
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return { width: copy.width, height: copy.height, data: btoa(text) };
  }, selector);
  return { width: encoded.width, height: encoded.height, data: Buffer.from(encoded.data, 'base64') };
}

// Colour statistics of the playground's screen.
async function pgStatsOf(page)
{
  return page.evaluate(`(${canvasStats})(window.polybasicPlayground.getScreen().canvas)`);
}

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
  const engine = new Engine(nodeEngineOptions(join(ROOT, file)));
  await runProgram(await loadProgram(js), new CaptureHost(), { engine, maxUpdates: frames });
  return engine.world.entities.map((e) => [e.id, Array.from(e.worldMatrix.e)]);
}

// The Kenney character as a .glb with its PNG stored inside (the image
// moves from a separate file into the binary chunk), to check both ways a
// model can carry its textures.
async function embeddedCharacter()
{
  const glb = await readFile(join(ROOT, 'examples/assets/kenney/character.glb'));
  const png = await readFile(join(ROOT, 'examples/assets/kenney/Textures/colormap.png'));
  const jsonLength = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLength).toString('utf8'));
  const binStart = 20 + jsonLength;
  const bin = glb.subarray(binStart + 8, binStart + 8 + glb.readUInt32LE(binStart));
  const pad4 = (n) => Math.ceil(n / 4) * 4;
  const imageOffset = pad4(bin.length);
  const newBin = Buffer.alloc(pad4(imageOffset + png.length));
  bin.copy(newBin, 0);
  png.copy(newBin, imageOffset);
  json.bufferViews.push({ buffer: 0, byteOffset: imageOffset, byteLength: png.length });
  json.images = [{ bufferView: json.bufferViews.length - 1, mimeType: 'image/png' }];
  json.buffers[0].byteLength = newBin.length;
  const text = Buffer.from(JSON.stringify(json));
  const jsonChunk = Buffer.alloc(pad4(text.length), 0x20);
  text.copy(jsonChunk);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + newBin.length, 8);
  const chunk = (type, body) =>
  {
    const h = Buffer.alloc(8);
    h.writeUInt32LE(body.length, 0);
    h.writeUInt32LE(type, 4);
    return Buffer.concat([h, body]);
  };
  await writeFile(join(SHOTS, 'character-embedded.glb'), Buffer.concat([header, chunk(0x4e4f534a, jsonChunk), chunk(0x004e4942, newBin)]));
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
await embeddedCharacter();
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

  await check('CameraPick names the entity three.js drew at each pixel; CameraProject lands on it', async () =>
  {
    // An 800 x 600 page shows the 800 x 600 program at one pixel per pixel.
    const page = await openPage(browser, `${base}/web/player.html?src=../tests/browser/picking.pb`, { width: 800, height: 600 });
    await page.waitForFunction(() => window.polybasicPlayer.state.output.includes('done'), null, { timeout: 20000 });
    const lines = (await page.evaluate(() => window.polybasicPlayer.state.output)).trim().split('\n');
    const pixels = await canvasPixels(page);
    assert(pixels.width === 800 && pixels.height === 600, `canvas is ${pixels.width} x ${pixels.height}`);
    // Handles in picking.pb: the camera is 1, the shapes 2 to 6.
    const colours = { 0: [0, 0, 0], 2: [255, 0, 0], 3: [0, 255, 0], 4: [0, 0, 255], 5: [255, 255, 0], 6: [255, 0, 255] };
    const classAt = (x, y) =>
    {
      const i = (y * pixels.width + x) * 4;
      const c = pixels.data.subarray(i, i + 3);
      for (const [id, rgb] of Object.entries(colours))
      {
        if (Math.abs(c[0] - rgb[0]) + Math.abs(c[1] - rgb[1]) + Math.abs(c[2] - rgb[2]) < 30) return Number(id);
      }
      return -1;   // a blend at an edge
    };
    const nearby = (x, y, id) =>
    {
      for (let dy = -2; dy <= 2; dy++)
      {
        for (let dx = -2; dx <= 2; dx++)
        {
          if (classAt(x + dx, y + dy) === id) return true;
        }
      }
      return false;
    };
    let samples = 0;
    let exact = 0;
    const wrong = [];
    for (const line of lines)
    {
      const m = /^(\d+) (\d+) (\d+)$/.exec(line);
      if (!m) continue;
      const [x, y, id] = [Number(m[1]), Number(m[2]), Number(m[3])];
      samples++;
      const drawn = classAt(x, y);
      if (drawn === id) exact++;
      // Anti-aliased edges may differ by a pixel or two, nothing more.
      else if (!nearby(x, y, id)) wrong.push(`(${x}, ${y}): picked ${id}, drawn ${drawn}`);
    }
    assert(samples > 3000, `only ${samples} samples`);
    assert(wrong.length === 0, `${wrong.length} picks disagree with the picture:\n${wrong.slice(0, 10).join('\n')}`);
    const projections = lines.filter((l) => l.startsWith('project '));
    const onShape = [];
    for (const line of projections)
    {
      const [, id, px, py] = line.split(' ').map(Number);
      // The cube, sphere and cylinder centres are on their visible faces.
      if (id > 4) continue;
      const drawn = classAt(Math.floor(px), Math.floor(py));
      assert(drawn === id, `entity ${id} projects to (${px}, ${py}) where ${drawn} is drawn`);
      onShape.push(id);
    }
    assert(onShape.length === 3, `projections checked: ${onShape}`);
    facts.picking = `${samples} samples, ${exact} exact, ${samples - exact} on anti-aliased edges, 0 wrong`;
    console.log(`      ${facts.picking}`);
    await page.screenshot({ path: join(SHOTS, 'picking.png') });
    noConsoleErrors(page);
    await page.close();
  });

  await check('physics: dist/physics.js only for programs that use it, the same motion as in Node', async () =>
  {
    const fetched = (page) =>
    {
      page.physicsRequests = [];
      page.on('request', (r) =>
      {
        if (r.url().endsWith('/dist/physics.js')) page.physicsRequests.push(r.url());
      });
    };
    // A program without physics does not fetch it.
    const plain = await browser.newPage({ viewport: { width: 800, height: 600 } });
    fetched(plain);
    await plain.goto(`${base}/web/player.html?src=../examples/spin.pb&frames=10`);
    await plain.waitForFunction(() => window.polybasicPlayer.state.status === 'stopped', null, { timeout: 20000 });
    assert(plain.physicsRequests.length === 0, 'spin.pb fetched the physics engine');
    await plain.close();

    const frames = 150;
    const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
    fetched(page);
    const messages = [];
    page.on('console', (m) =>
    {
      if (m.type() === 'error' || m.type() === 'warning') messages.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
    await page.goto(`${base}/web/player.html?src=../tests/browser/physics.pb&frames=${frames}`);
    await page.waitForFunction(() => ['stopped', 'error'].includes(window.polybasicPlayer.state.status), null, { timeout: 30000 });
    assert(await page.evaluate(() => window.polybasicPlayer.state.status) === 'stopped', await page.evaluate(() => window.polybasicPlayer.state.output));
    assert(page.physicsRequests.length === 1, `physics.js fetched ${page.physicsRequests.length} times`);
    const browserSide = await page.evaluate(() => window.polybasicPlayer.state.engine.world.entities.map((e) => [e.id, Array.from(e.worldMatrix.e)]));
    const nodeSide = await nodeMatrices('tests/browser/physics.pb', frames);
    const diff = maxDifference(browserSide, nodeSide);
    // The things fell and came to rest on the floor or the ramp.
    const heights = await page.evaluate(() => window.polybasicPlayer.state.engine.world.entities.filter((e) => e.kind === 'mesh').map((e) => e.worldPosition().y));
    assert(Math.max(...heights) < 5, `nothing fell: ${heights}`);
    facts.physics = `${browserSide.length} entities after ${frames} updates, max difference from Node ${diff}`;
    console.log(`      ${facts.physics}`);
    assert(diff === 0, `browser and Node differ by ${diff}`);
    assert(messages.length === 0, `console:\n${messages.join('\n')}`);
    await page.screenshot({ path: join(SHOTS, 'physics.png') });
    await page.close();
  });

  await check('glTF models draw with their textures, from a separate PNG or from inside the .glb', async () =>
  {
    const pictures = {};
    for (const variant of ['external', 'embedded'])
    {
      const page = await openPage(browser, `${base}/web/player.html?src=../tests/browser/models-${variant}.pb`, { width: 800, height: 600 });
      await page.waitForFunction(() => window.polybasicPlayer.state.output.includes('ready'), null, { timeout: 20000 });
      const textures = await page.evaluate(() =>
      {
        const seen = new Set();
        for (const e of window.polybasicPlayer.state.engine.world.entities)
        {
          for (const m of e.materials) if (m.texture) seen.add(m.texture);
        }
        return [...seen].map((t) => ({ loaded: t.loaded, failed: t.failed, width: t.width, height: t.height, kind: t.image ? t.image.constructor.name : null }));
      });
      assert(textures.length >= 2 && textures.every((t) => t.loaded && !t.failed && t.width === 512 && t.height === 512), `${variant}: textures ${JSON.stringify(textures)}`);
      // The character's image: the embedded one is decoded to an ImageBitmap.
      if (variant === 'embedded') assert(textures.some((t) => t.kind === 'ImageBitmap'), `embedded image decoded as ${JSON.stringify(textures)}`);
      await page.waitForTimeout(300);
      pictures[variant] = (await canvasPixels(page)).data;
      await page.screenshot({ path: join(SHOTS, `models-${variant}.png`) });
      noConsoleErrors(page);
      await page.close();
    }
    const a = pictures.external;
    const b = pictures.embedded;
    let different = 0;
    const colours = new Set();
    for (let i = 0; i < a.length; i += 4)
    {
      if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 6) different++;
      colours.add((a[i] << 16) | (a[i + 1] << 8) | a[i + 2]);
    }
    facts.models = `${colours.size} colours, ${different} pixels differ between the two ways of storing the texture`;
    console.log(`      ${facts.models}`);
    assert(colours.size > 200, `only ${colours.size} colours: texture missing?`);
    assert(different === 0, `${different} pixels differ`);
  });

  await check('a glTF scene looks as it does in three.js on its own (not mirrored)', async () =>
  {
    const ref = await openPage(browser, `${base}/tests/browser/three-reference.html`, { width: 800, height: 600 });
    await ref.waitForFunction(() => window.referenceReady, null, { timeout: 20000 });
    const theirs = (await canvasPixels(ref, 'canvas')).data;
    await ref.screenshot({ path: join(SHOTS, 'models-three-reference.png') });
    noConsoleErrors(ref);
    await ref.close();

    const page = await openPage(browser, `${base}/web/player.html?src=../tests/browser/models-external.pb`, { width: 800, height: 600 });
    await page.waitForFunction(() => window.polybasicPlayer.state.output.includes('ready'), null, { timeout: 20000 });
    // Unlit like the reference: lights shade differently there (PBR).
    await page.evaluate(() =>
    {
      for (const e of window.polybasicPlayer.state.engine.world.entities)
      {
        for (const m of e.materials)
        {
          m.fullbright = true;
          m.changed();
        }
      }
    });
    await page.waitForTimeout(300);
    const ours = (await canvasPixels(page)).data;
    await page.screenshot({ path: join(SHOTS, 'models-unlit.png') });
    noConsoleErrors(page);
    await page.close();

    assert(ours.length === theirs.length, 'sizes differ');
    let differ = 0;
    const colours = new Set();
    for (let i = 0; i < ours.length; i += 4)
    {
      if (Math.abs(ours[i] - theirs[i]) + Math.abs(ours[i + 1] - theirs[i + 1]) + Math.abs(ours[i + 2] - theirs[i + 2]) > 24) differ++;
      colours.add((theirs[i] << 16) | (theirs[i + 1] << 8) | theirs[i + 2]);
    }
    // Two empty pictures would agree too.
    assert(colours.size > 200, `the reference has only ${colours.size} colours`);
    const share = differ / (ours.length / 4);
    facts.reference = `${differ} of ${ours.length / 4} pixels differ from three.js on its own (${(share * 100).toFixed(3)}%)`;
    console.log(`      ${facts.reference}`);
    assert(share < 0.002, facts.reference);
  });

  await check('the phase 3 examples respond to real input: Coin Hop, Crate Tower, Paint Shapes', async () =>
  {
    // Coin Hop: run forward, jump onto the next platform, pick up a coin.
    let page = await openPage(browser, `${base}/web/player.html?src=../examples/coin-hop.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    await page.waitForTimeout(800);
    const player = () => page.evaluate(() =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.kind === 'pivot' && x.radiusY === 0.55);
      const p = e.worldPosition();
      return { x: p.x, y: p.y, z: p.z };
    });
    const start = await player();
    // Wait on the game, not the clock: a slow machine runs fewer frames.
    const until = async (what, test) =>
    {
      try
      {
        await page.waitForFunction(test, start, { timeout: 15000 });
      }
      catch
      {
        const keys = await page.evaluate(() => [...window.polybasicPlayer.state.engine.input.down]);
        throw new Error(`${what}: player ${JSON.stringify(await player())}, keys held ${JSON.stringify(keys)}`);
      }
    };
    await page.keyboard.down('ArrowUp');
    await until('running forward', (s) =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.kind === 'pivot' && x.radiusY === 0.55);
      return e.worldPosition().z > s.z + 1;
    });
    await page.keyboard.press('Space');
    await until('jumping onto the next platform', (s) =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.kind === 'pivot' && x.radiusY === 0.55);
      const p = e.worldPosition();
      return p.z > s.z + 2 && p.y > s.y + 0.5;
    });
    await page.keyboard.up('ArrowUp');
    const after = await player();
    const coins = await page.evaluate(() => window.polybasicPlayer.state.engine.world.entities.filter((e) => e.model && e.visible && e.parent === null && e.model.loaded && e.children.length && e.children[0].name === 'coin').length);
    assert(after.z > start.z + 2 && after.y > start.y + 0.5, `the player did not run and jump up: ${JSON.stringify(start)} -> ${JSON.stringify(after)}`);
    facts.coinHop = `player ${start.z.toFixed(2)},${start.y.toFixed(2)} -> ${after.z.toFixed(2)},${after.y.toFixed(2)}, ${coins} coins left`;
    await page.screenshot({ path: join(SHOTS, 'coin-hop.png') });
    noConsoleErrors(page);
    await page.close();

    // Crate Tower: click on the tower a few times.
    page = await openPage(browser, `${base}/web/player.html?src=../examples/crates.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    await page.waitForTimeout(500);
    const box = await page.locator('canvas').first().boundingBox();
    for (let i = 0; i < 3; i++)
    {
      await page.mouse.click(box.x + box.width * (0.45 + i * 0.05), box.y + box.height * 0.5);
      await page.waitForTimeout(700);
    }
    await page.waitForTimeout(1500);
    const moved = await page.evaluate(() =>
    {
      let n = 0;
      for (const e of window.polybasicPlayer.state.engine.world.entities)
      {
        if (e.kind !== 'mesh' || !e.materials[0].texture) continue;
        const p = e.worldPosition();
        if (p.y < 0.2 || Math.abs(p.z - 1.5) > 0.5) n++;
      }
      return n;
    });
    assert(moved > 3, `only ${moved} crates moved after three throws`);
    facts.crates = `${moved} crates knocked by three clicks`;
    await page.screenshot({ path: join(SHOTS, 'crates.png') });
    noConsoleErrors(page);
    await page.close();

    // Paint Shapes: point at the middle shape, click it.
    page = await openPage(browser, `${base}/web/player.html?src=../examples/paint-shapes.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const shapeBox = await page.locator('canvas').first().boundingBox();
    // Where the torus is on the screen: the same scene in Node, projected
    // with the engine's own camera maths.
    const scene = new Engine(nodeEngineOptions(join(ROOT, 'examples/paint-shapes.pb')));
    const { js: paintJs } = compile(readFileSync(join(ROOT, 'examples/paint-shapes.pb'), 'utf8'), { file: 'paint-shapes.pb' });
    await runProgram(await loadProgram(paintJs), new CaptureHost(), { engine: scene, maxUpdates: 1 });
    const torus = scene.world.entities.find((e) => e.name === 'torus');
    const target = projectPoint(scene.world.entities.find((e) => e.kind === 'camera'), torus.worldPosition(), 800, 600);
    // The ring's centre is a hole: aim at its front rim.
    const rim = projectPoint(scene.world.entities.find((e) => e.kind === 'camera'), torus.worldPosition().add({ x: 0, y: 0, z: -0.55 }), 800, 600);
    await page.mouse.move(shapeBox.x + rim.x * shapeBox.width / 800, shapeBox.y + rim.y * shapeBox.height / 600);
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => window.polybasicPlayer.state.engine.world.entities.find((e) => e.name === 'torus').materials[0].color.join());
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(400);
    const colourAfter = await page.evaluate(() => window.polybasicPlayer.state.engine.world.entities.find((e) => e.name === 'torus').materials[0].color.join());
    assert(before !== colourAfter, `the torus at ${JSON.stringify(target)} was not painted (${before})`);
    const overlay = await page.evaluate(`(${canvasStats})(window.polybasicPlayer.screen.overlayCanvas)`);
    assert(overlay.colours > 3, 'no label on the 2D layer');
    facts.paint = 'pointed at and painted the torus';
    await page.screenshot({ path: join(SHOTS, 'paint-shapes.png') });
    noConsoleErrors(page);
    await page.close();
    console.log(`      ${facts.coinHop}; ${facts.crates}; ${facts.paint}`);
  });

  await check('playground projects are kept in IndexedDB across page loads', async () =>
  {
    const page = await openPage(browser, `${base}/web/programs/manifest.json`);
    const made = await page.evaluate(async () =>
    {
      const { ProjectStore } = await import('/web/projects.js');
      const store = await ProjectStore.open();
      const p = await store.create('Kept', { 'main.pb': 'Print 1\n', 'assets/a.bin': new Uint8Array([7, 8, 9]) });
      await store.writeFile(p.id, 'lib/util.pb', 'Function F()\nEnd Function\n');
      await store.renameFile(p.id, 'main.pb', 'game.pb');
      return { id: p.id, persistent: store.persistent };
    });
    assert(made.persistent, 'IndexedDB was not used');
    await page.reload();
    const back = await page.evaluate(async (id) =>
    {
      const { ProjectStore } = await import('/web/projects.js');
      const store = await ProjectStore.open();
      const p = await store.get(id);
      const files = await store.readAll(id);
      const result = { name: p.name, main: p.main, paths: p.paths, bin: Array.from(files.get('assets/a.bin')), game: new TextDecoder().decode(files.get('game.pb')) };
      await store.remove(id);
      result.afterRemove = (await store.get(id)) === null && (await store.readAll(id)).size === 0;
      return result;
    }, made.id);
    assert(back.name === 'Kept' && back.main === 'game.pb', JSON.stringify(back));
    assert(back.paths.join() === 'assets/a.bin,game.pb,lib/util.pb', back.paths.join());
    assert(back.bin.join() === '7,8,9' && back.game === 'Print 1\n', JSON.stringify(back));
    assert(back.afterRemove, 'the project was not removed');
    noConsoleErrors(page);
    await page.close();
  });

  // ── Playground ──────────────────────────────────────────────────────

  const playground = await openPage(browser, `${base}/web/`, { width: 1400, height: 850 });
  const pgStats = () => playground.evaluate(`(${canvasStats})(window.polybasicPlayground.getScreen().canvas)`);
  const openExample = async (id) =>
  {
    await playground.evaluate((x) => window.polybasicPlayground.openProgram(x), id);
    // A few frames of the new run, and for console programs their output.
    await playground.waitForFunction(() =>
    {
      const s = window.polybasicPlayground.getSession();
      return !s || s.engine.frames > 5 || document.getElementById('status').textContent !== 'Running';
    }, null, { timeout: 20000 });
    await playground.waitForTimeout(600);
  };

  // ── Playground projects ────────────────────────────────────────────

  // Answers the page's prompt() and confirm() dialogs in order.
  const answering = (page) =>
  {
    const answers = [];
    // A string answers a prompt; anything else just accepts (a confirm).
    page.on('dialog', (d) =>
    {
      const value = answers.length ? answers.shift() : undefined;
      d.accept(typeof value === 'string' ? value : undefined);
    });
    return (...values) => answers.push(...values);
  };
  const project = (page, fn, arg) => page.evaluate(fn, arg);
  const consoleText = (page) => page.textContent('#console');

  await check('playground: an example saved as a project runs from its own files', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=coin-hop`, { width: 1400, height: 850 });
    const answer = answering(page);
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'coin-hop', null, { timeout: 20000 });
    answer('Hop copy');
    await page.click('#saveAsProjectBtn');
    await page.waitForFunction(() => window.polybasicPlayground.getProjectId(), null, { timeout: 20000 });
    const info = await project(page, () => window.polybasicPlayground.getProject());
    assert(info.name === 'Hop copy' && info.main === 'coin-hop.pb', JSON.stringify(info));
    assert(info.paths.includes('assets/kenney/character.glb') && info.paths.includes('assets/kenney/Textures/colormap.png'), info.paths.join());
    // From now on the site's example files are out of reach.
    const blocked = [];
    await page.route('**/examples/**', (route) =>
    {
      blocked.push(route.request().url());
      route.abort();
    });
    await page.reload();
    await page.waitForFunction((id) => window.polybasicPlayground && window.polybasicPlayground.getProjectId() === id, info.id, { timeout: 20000 });
    await page.waitForFunction(() =>
    {
      const s = window.polybasicPlayground.getSession();
      return s && s.engine.frames > 10;
    }, null, { timeout: 20000 });
    const models = await page.evaluate(() => window.polybasicPlayground.getSession().engine.world.entities.filter((e) => e.model && e.model.loaded).length);
    assert(models > 10, `only ${models} models loaded`);
    assert(blocked.length === 0, `the project fetched site files: ${blocked.join(', ')}`);
    const text = await consoleText(page);
    assert(!/error|could not/i.test(text), `console: ${text}`);
    const pixels = await pgStatsOf(page);
    assert(pixels.colours > 50, `blank screen (${pixels.colours} colours)`);
    await page.screenshot({ path: join(SHOTS, 'playground-project.png') });
    await project(page, (id) => window.polybasicPlayground.getStore().remove(id), info.id);
    noConsoleErrors(page);
    await page.close();
  });

  await check('playground: a project with several files, an upload, Include and errors in the right file', async () =>
  {
    const page = await openPage(browser, `${base}/web/`, { width: 1400, height: 850 });
    const answer = answering(page);
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId(), null, { timeout: 20000 });
    answer('Files test');
    await page.click('#newBtn');
    await page.waitForFunction(() => window.polybasicPlayground.getProjectId(), null, { timeout: 20000 });
    const id = await project(page, () => window.polybasicPlayground.getProjectId());

    // An image and a program file, as if chosen with Upload. The program
    // loads the image: a path relative to the main program, not to itself.
    const TILE = 'Function Tile()\n  Return LoadTexture("assets/tile.png")\nEnd Function\n';
    const tile = Array.from(readFileSync(join(ROOT, 'examples/assets/tile.png')));
    await project(page, ({ bytes, helpers }) => window.polybasicPlayground.upload([
      { name: 'tile.png', bytes: new Uint8Array(bytes) },
      { name: 'helpers.pb', bytes: new TextEncoder().encode(helpers) }
    ]), { bytes: tile, helpers: 'Function Twice(x)\n  Return x * 2\nEnd Function\n' + TILE });
    let info = await project(page, () => window.polybasicPlayground.getProject());
    assert(info.paths.join() === 'assets/tile.png,helpers.pb,main.pb', info.paths.join());
    // The image is shown with how to use it.
    const asset = await page.textContent('#assetView');
    assert(asset.includes('LoadTexture("assets/tile.png")') && await page.isVisible('#assetView img'), asset);

    // Move helpers.pb into a folder with the Rename button.
    await project(page, () => window.polybasicPlayground.openFile('helpers.pb'));
    answer('lib/helpers.pb');
    await page.click('#renameFileBtn');
    await page.waitForFunction(() => window.polybasicPlayground.getOpenPath() === 'lib/helpers.pb', null, { timeout: 5000 });

    // The main program includes it and uses the uploaded image.
    await project(page, () => window.polybasicPlayground.openFile('main.pb'));
    await project(page, () => window.polybasicPlayground.setText(`Include "lib/helpers.pb"
Global tex, cube
cube = CreateCube()
camera = CreateCamera()
PositionEntity camera, 0, 0, -4
tex = Tile()
EntityTexture cube, tex
Print "twice 21 = " + Twice(21)
Function Update()
  ; Files started in the main body are in by the first Update.
  If FrameCount() = 1 Then Print "texture loaded " + TextureLoaded(tex)
  TurnEntity cube, 0, 1, 0
End Function
`));
    await page.click('#runBtn');
    await page.waitForFunction(() => document.getElementById('console').textContent.includes('texture loaded'), null, { timeout: 10000 });
    assert(/twice 21 = 42\s*texture loaded 1/.test(await consoleText(page)), await consoleText(page));

    // An error in the included file opens that file and marks the line.
    await project(page, () => window.polybasicPlayground.openFile('lib/helpers.pb'));
    await project(page, (text) => window.polybasicPlayground.setText(text), 'Function Twice(x)\n  Return x * \nEnd Function\n' + TILE);
    await project(page, () => window.polybasicPlayground.openFile('main.pb'));
    await page.click('#runBtn');
    await page.waitForFunction(() => window.polybasicPlayground.getOpenPath() === 'lib/helpers.pb', null, { timeout: 5000 });
    await page.waitForSelector('.cm-lint-marker-error', { timeout: 5000 });
    assert(/Compile error: .*\(lib\/helpers\.pb, line 2/.test(await consoleText(page)), await consoleText(page));
    await project(page, (text) => window.polybasicPlayground.setText(text), 'Function Twice(x)\n  Return x * 2\nEnd Function\n' + TILE);

    // Make another program the main one, then delete the old main.
    answer('other.pb');
    await page.click('#newFileBtn');
    await page.waitForFunction(() => window.polybasicPlayground.getOpenPath() === 'other.pb', null, { timeout: 5000 });
    await project(page, () => window.polybasicPlayground.setText('Print "other runs"\n'));
    await page.click('#mainFileBtn');
    await page.waitForFunction(() => window.polybasicPlayground.getProject().main === 'other.pb', null, { timeout: 5000 });
    await page.click('#runBtn');
    await page.waitForFunction(() => document.getElementById('console').textContent.includes('other runs'), null, { timeout: 5000 });
    await project(page, () => window.polybasicPlayground.openFile('main.pb'));
    answer(true);
    await page.click('#deleteFileBtn');
    await page.waitForFunction(() => !window.polybasicPlayground.getProject().paths.includes('main.pb'), null, { timeout: 5000 });

    // Everything is still there after a reload.
    await project(page, () => window.polybasicPlayground.saveNow());
    await page.goto(`${base}/web/#project=${id}`);
    await page.waitForFunction((pid) => window.polybasicPlayground && window.polybasicPlayground.getProjectId() === pid, id, { timeout: 20000 });
    info = await project(page, () => window.polybasicPlayground.getProject());
    assert(info.main === 'other.pb' && info.paths.join() === 'assets/tile.png,lib/helpers.pb,other.pb', JSON.stringify(info));
    const helpers = await project(page, async () =>
    {
      await window.polybasicPlayground.openFile('lib/helpers.pb');
      return window.polybasicPlayground.getText();
    });
    assert(helpers.includes('Return x * 2'), helpers);
    await page.screenshot({ path: join(SHOTS, 'playground-files.png') });

    answer(true);
    await page.click('#deleteProjectBtn');
    await page.waitForFunction(() => window.polybasicPlayground.getProgramId(), null, { timeout: 10000 });
    assert(await project(page, async (pid) => (await window.polybasicPlayground.getStore().get(pid)) === null, id), 'the project was not deleted');
    noConsoleErrors(page);
    await page.close();
  });

  await check('playground: a project downloads as .zip and comes back as the same project', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    const answer = answering(page);
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    answer('Spin to zip');
    await page.click('#saveAsProjectBtn');
    await page.waitForFunction(() => window.polybasicPlayground.getProjectId(), null, { timeout: 20000 });
    const first = await project(page, () => window.polybasicPlayground.getProject());
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportZipBtn')]);
    assert(download.suggestedFilename() === 'spin-to-zip.zip', download.suggestedFilename());
    const zipPath = join(SHOTS, 'spin-to-zip.zip');
    await download.saveAs(zipPath);
    const bytes = Array.from(readFileSync(zipPath));
    const secondId = await project(page, (b) => window.polybasicPlayground.importZip('spin-to-zip.zip', new Uint8Array(b)), bytes);
    const second = await project(page, () => window.polybasicPlayground.getProject());
    assert(secondId && second.id !== first.id && second.name === 'Spin to zip' && second.main === first.main, JSON.stringify(second));
    assert(second.paths.join() === first.paths.join(), `${second.paths} vs ${first.paths}`);
    const same = await project(page, async ([a, b]) =>
    {
      const store = window.polybasicPlayground.getStore();
      const fa = await store.readAll(a);
      const fb = await store.readAll(b);
      return [...fa].every(([p, d]) => fb.get(p) && fb.get(p).join() === d.join());
    }, [first.id, second.id]);
    assert(same, 'the imported files differ');
    await page.waitForFunction(() =>
    {
      const s = window.polybasicPlayground.getSession();
      return s && s.engine.frames > 5;
    }, null, { timeout: 20000 });
    for (const id of [first.id, second.id]) await project(page, (x) => window.polybasicPlayground.getStore().remove(x), id);
    noConsoleErrors(page);
    await page.close();
  });

  await check('playground: an exported page plays on its own, from a server or from the disk, physics included', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=crates`, { width: 1400, height: 850 });
    const answer = answering(page);
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'crates', null, { timeout: 20000 });
    answer('Crates page');
    await page.click('#saveAsProjectBtn');
    await page.waitForFunction(() => window.polybasicPlayground.getProjectId(), null, { timeout: 20000 });
    const id = await project(page, () => window.polybasicPlayground.getProjectId());
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportPageBtn')]);
    assert(download.suggestedFilename() === 'crates-page.html', download.suggestedFilename());
    const htmlPath = join(SHOTS, 'crates-page.html');
    await download.saveAs(htmlPath);
    await project(page, (x) => window.polybasicPlayground.getStore().remove(x), id);
    noConsoleErrors(page);
    await page.close();
    const size = readFileSync(htmlPath).length;

    const results = [];
    for (const url of [`${base}/tests/output/crates-page.html`, `file://${htmlPath}`])
    {
      const game = await browser.newPage({ viewport: { width: 800, height: 600 } });
      const problems = [];
      game.on('console', (m) =>
      {
        if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`);
      });
      game.on('pageerror', (e) => problems.push(e.message));
      // Only the page itself may be fetched.
      const fetched = [];
      await game.route('**/*', (route) =>
      {
        const u = route.request().url();
        if (u === url) return route.continue();
        if (u.startsWith('blob:') || u.startsWith('data:')) return route.continue();
        fetched.push(u);
        return route.abort();
      });
      await game.goto(url);
      await game.waitForFunction(() => window.polybasicPage && window.polybasicPage.engine && window.polybasicPage.engine.frames > 30, null, { timeout: 30000 });
      const state = await game.evaluate(() => ({
        status: window.polybasicPage.status,
        bodies: window.polybasicPage.engine.physics.bodies.size,
        colours: 0
      }));
      const stats = await game.evaluate(`(${canvasStats})(window.polybasicPage.screen.canvas)`);
      await game.screenshot({ path: join(SHOTS, url.startsWith('file:') ? 'exported-page-file.png' : 'exported-page.png') });
      assert(state.status === 'running', `status ${state.status} at ${url}`);
      assert(state.bodies > 20, `${state.bodies} bodies at ${url}`);
      assert(stats.colours > 30, `blank page at ${url}`);
      assert(fetched.length === 0, `fetched: ${fetched.join(', ')}`);
      assert(problems.length === 0, `console at ${url}:\n${problems.join('\n')}`);
      results.push(url.startsWith('file:') ? 'from the disk' : 'from a server');
      await game.close();
    }
    facts.exportedPage = `${(size / 1024 / 1024).toFixed(2)} MB page with physics, plays ${results.join(' and ')}`;
    console.log(`      ${facts.exportedPage}`);
  });

  await check('playground: a program kept by an earlier playground becomes a project', async () =>
  {
    const page = await openPage(browser, `${base}/web/programs/manifest.json`);
    await page.evaluate(() => window.localStorage.setItem('polybasic.playground.source.new', 'Print "from before"\n'));
    await page.goto(`${base}/web/`);
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId(), null, { timeout: 20000 });
    const found = await page.evaluate(async () =>
    {
      const store = window.polybasicPlayground.getStore();
      const list = await store.list();
      const p = list.find((x) => x.name === 'My program');
      const text = p ? new TextDecoder().decode((await store.readAll(p.id)).get('main.pb')) : null;
      if (p) await store.remove(p.id);
      return { text, left: window.localStorage.getItem('polybasic.playground.source.new') };
    });
    assert(found.text === 'Print "from before"\n', JSON.stringify(found));
    assert(found.left === null, 'the old copy was not removed');
    noConsoleErrors(page);
    await page.close();
  });

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
      // The language examples print to the console; all the others draw.
      if (entry.category === 'language')
      {
        await playground.waitForFunction(() => document.getElementById('console').textContent.trim().length > 0, null, { timeout: 10000 });
      }
      else
      {
        const s = await pgStats();
        assert(s.colours > 20 || s.drawn > 1000, `${entry.id}: blank canvas (${s.colours} colours, ${s.drawn} pixels drawn)`);
      }
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
    await playground.waitForTimeout(300);
    const blank = await pgStats();
    assert(blank.colours <= 2, `the previous picture is still on screen (${blank.colours} colours)`);
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

  await check('texture flags: masked leaves out black pixels, alpha blends with what is behind', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    // A camera looking straight down at a textured square, over red.
    const scene = (texture) => `Graphics3D 640, 480
cam = CreateCamera()
CameraClsColor cam, 255, 0, 0
PositionEntity cam, 0, 6, 0
RotateEntity cam, 90, 0, 0
square = CreatePlane()
ScaleEntity square, 3, 1, 3
EntityFX square, FX_FULLBRIGHT
${texture}
EntityTexture square, tex
Function Update()
  If FrameCount() = 1 Then Print "drawn"
End Function
`;
    const checker = (flags) => `tex = CreateTexture(8, 8, 255, 255, 255, ${flags})
For y = 0 To 7 : For x = 0 To 7
  If (x + y) Mod 2 = 0 Then TexturePixel tex, x, y, 0, 0, 0
Next : Next`;
    const half = (flags) => `tex = CreateTexture(4, 4, 255, 255, 255, ${flags})
For y = 0 To 3 : For x = 0 To 3 : TexturePixel tex, x, y, 255, 255, 255, 128 : Next : Next`;
    // How many pixels are black, white, red (the background) and pink (white
    // half over red).
    const count = async (texture) =>
    {
      await project(page, (x) => window.polybasicPlayground.setText(x), scene(texture));
      await project(page, () => window.polybasicPlayground.run());
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('drawn'), null, { timeout: 10000 });
      await page.waitForTimeout(300);
      return page.evaluate(() =>
      {
        const canvas = window.polybasicPlayground.getScreen().canvas;
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        const d = ctx.getImageData(0, 0, copy.width, copy.height).data;
        const n = { black: 0, dark: 0, white: 0, red: 0, pink: 0 };
        for (let i = 0; i < d.length; i += 4)
        {
          const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
          if (r < 60 && g < 60 && b < 60) n.dark++;
          if (r < 20 && g < 20 && b < 20) n.black++;
          else if (r > 235 && g > 235 && b > 235) n.white++;
          else if (r > 235 && g < 20 && b < 20) n.red++;
          else if (r > 235 && g > 100 && g < 215 && Math.abs(g - b) < 12) n.pink++;
        }
        const total = d.length / 4;
        for (const k of Object.keys(n)) n[k] = n[k] / total;
        return n;
      });
    };
    const plain = await count(checker('TEX_COLOR'));
    const masked = await count(checker('TEX_MASKED'));
    await page.locator('.polybasic-screen').screenshot({ path: join(SHOTS, 'texture-masked.png') });
    // The same checker as a loaded PNG file.
    const png = `data:image/png;base64,${checkerPng(8).toString('base64')}`;
    const loadedPlain = await count(`tex = LoadTexture("${png}")`);
    const loadedMasked = await count(`tex = LoadTexture("${png}", TEX_MASKED)`);
    const alpha = await count(half('TEX_ALPHA'));
    const opaque = await count(half('TEX_COLOR'));
    const text = JSON.stringify({ plain, masked, loadedPlain, loadedMasked, alpha, opaque }, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v));
    // A loaded image is smoothed (its black squares shade to grey), and all
    // of it is drawn; masked, its black squares are holes, with no dark rim
    // around them.
    assert(Math.abs(loadedPlain.red - plain.red) < 0.01, `a loaded texture is not drawn whole: ${text}`);
    assert(loadedMasked.red > loadedPlain.red + 0.1 && loadedMasked.dark < 0.005, `a loaded masked texture: ${text}`);
    assert(plain.black > 0.1 && plain.white > 0.1, `the checker is not drawn: ${text}`);
    assert(masked.black < 0.005 && masked.white > 0.1 && masked.red > plain.red + 0.1, `masked black pixels still drawn: ${text}`);
    assert(alpha.pink > 0.2 && alpha.white < 0.01, `alpha does not blend: ${text}`);
    assert(opaque.white > 0.2 && opaque.pink < 0.01, `without TEX_ALPHA the texture is not solid: ${text}`);
    await page.click('#stopBtn');
    noConsoleErrors(page);
    await page.close();
  });

  await check('EntityAlpha 0: not drawn, hides nothing behind it, still picked', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    // Looking down on a see-through green floor, with an invisible square
    // above it, drawn first (EntityOrder): were the square drawn at all, its
    // depth would hide the floor.
    const scene = (alpha) => `Graphics3D 640, 480
Global cam, square
cam = CreateCamera()
CameraClsColor cam, 0, 0, 255
PositionEntity cam, 0, 6, 0
RotateEntity cam, 90, 0, 0
floor = CreatePlane()
ScaleEntity floor, 3, 1, 3
EntityColor floor, 0, 255, 0
EntityFX floor, FX_FULLBRIGHT
EntityAlpha floor, 0.9
square = CreatePlane()
PositionEntity square, 0, 2, 0
ScaleEntity square, 3, 1, 3
EntityColor square, 255, 0, 0
EntityFX square, FX_FULLBRIGHT
EntityAlpha square, ${alpha}
EntityOrder square, -1
EntityPickMode square, PICK_POLYGON
Function Update()
  If FrameCount() = 1 Then Print "picked " + (CameraPick(cam, 320, 240) = square)
End Function
`;
    const look = async (alpha) =>
    {
      await project(page, (x) => window.polybasicPlayground.setText(x), scene(alpha));
      await project(page, () => window.polybasicPlayground.run());
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('picked'), null, { timeout: 10000 });
      await page.waitForTimeout(300);
      const picked = (await page.textContent('#console')).includes('picked 1');
      const colours = await page.evaluate(() =>
      {
        const canvas = window.polybasicPlayground.getScreen().canvas;
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        const d = ctx.getImageData(0, 0, copy.width, copy.height).data;
        const n = { green: 0, red: 0, blue: 0 };
        for (let i = 0; i < d.length; i += 4)
        {
          const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
          if (g > 180 && r < 60 && b < 60) n.green++;
          else if (r > 100 && g < 60) n.red++;
          else if (b > 200 && r < 40 && g < 40) n.blue++;
        }
        const total = d.length / 4;
        for (const k of Object.keys(n)) n[k] = n[k] / total;
        return n;
      });
      return { picked, ...colours };
    };
    const faded = await look(0);
    await page.locator('.polybasic-screen').screenshot({ path: join(SHOTS, 'alpha-zero.png') });
    const half = await look(0.5);
    const text = JSON.stringify({ faded, half }, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v));
    assert(faded.picked && half.picked, `the square is not picked: ${text}`);
    assert(faded.green > 0.3 && faded.red === 0, `alpha 0 still covers the floor: ${text}`);
    assert(half.red > 0.3, `alpha 0.5 is not drawn: ${text}`);
    await page.click('#stopBtn');
    noConsoleErrors(page);
    await page.close();
    console.log(`      alpha 0: green ${(faded.green * 100).toFixed(1)}%, red ${(faded.red * 100).toFixed(1)}%; alpha 0.5: red ${(half.red * 100).toFixed(1)}%`);
  });

  await check('sprites: they face the camera by view mode, and a loaded one glows', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    const png = `data:image/png;base64,${checkerPng(8).toString('base64')}`;
    // A sprite 6 units ahead of a camera turned by `turn`, over grey.
    const scene = (turn, lines, grey = 128) => `Graphics3D 640, 480
cam = CreateCamera()
CameraClsColor cam, ${grey}, ${grey}, ${grey}
RotateEntity cam, ${turn}
s = CreateSprite()
PositionEntity s, 0, 0, 6
${lines}
Function Update()
  If FrameCount() = 1 Then Print "drawn"
End Function
`;
    // The white pixels: how many, and how much of their bounding box they
    // fill (a square facing the screen fills all of it). Also black ones.
    const look = async (text) =>
    {
      await project(page, (x) => window.polybasicPlayground.setText(x), text);
      await project(page, () => window.polybasicPlayground.run());
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('drawn'), null, { timeout: 10000 });
      await page.waitForTimeout(300);
      return page.evaluate(() =>
      {
        const canvas = window.polybasicPlayground.getScreen().canvas;
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        const d = ctx.getImageData(0, 0, copy.width, copy.height).data;
        let n = 0;
        let black = 0;
        let x0 = Infinity;
        let y0 = Infinity;
        let x1 = -1;
        let y1 = -1;
        for (let y = 0; y < copy.height; y++)
        {
          for (let x = 0; x < copy.width; x++)
          {
            const i = (y * copy.width + x) * 4;
            if (d[i] < 20 && d[i + 1] < 20 && d[i + 2] < 20) black++;
            if (d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245) continue;
            n++;
            x0 = Math.min(x0, x);
            y0 = Math.min(y0, y);
            x1 = Math.max(x1, x);
            y1 = Math.max(y1, y);
          }
        }
        const box = n ? (x1 - x0 + 1) * (y1 - y0 + 1) : 1;
        // The middle of the screen, inside a sprite 6 units ahead: its
        // darkest pixel and its mean brightness.
        let min = 255;
        let sum = 0;
        let count = 0;
        for (let y = Math.round(copy.height * 0.42); y < copy.height * 0.58; y++)
        {
          for (let x = Math.round(copy.width * 0.44); x < copy.width * 0.56; x++)
          {
            const i = (y * copy.width + x) * 4;
            const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
            min = Math.min(min, v);
            sum += v;
            count++;
          }
        }
        return { white: n / (d.length / 4), fill: n / box, black: black / (d.length / 4), min, mean: sum / count };
      });
    };
    // Turned camera: the sprite is put where the camera looks.
    const ahead = (turn) => `cam2 = CreatePivot()
RotateEntity cam2, ${turn}
MoveEntity cam2, 0, 0, 6
PositionEntity s, EntityX(cam2), EntityY(cam2), EntityZ(cam2)`;
    const tilted = await look(scene('30, 20, 25', ahead('30, 20, 25')));
    const upright = await look(scene('40, 0, 0', ahead('40, 0, 0') + '\nSpriteViewMode s, 4'));
    const facing = await look(scene('40, 0, 0', ahead('40, 0, 0')));
    const behind1 = await look(scene('0, 180, 0', 'PositionEntity s, 0, 0, -6'));
    const behind2 = await look(scene('0, 180, 0', 'PositionEntity s, 0, 0, -6\nSpriteViewMode s, 2'));
    const glow = await look(scene('0, 0, 0', `FreeEntity s\ns = LoadSprite("${png}")\nPositionEntity s, 0, 0, 6`, 60));
    await page.locator('.polybasic-screen').screenshot({ path: join(SHOTS, 'sprite-glow.png') });
    const plain = await look(scene('0, 0, 0', `FreeEntity s\ns = LoadSprite("${png}")\nPositionEntity s, 0, 0, 6\nEntityBlend s, 1`, 60));
    const text = JSON.stringify({ tilted, upright, facing, behind1, behind2, glow, plain }, (k, v) => (typeof v === 'number' ? +v.toFixed(3) : v));
    assert(tilted.white > 0.02 && tilted.fill > 0.97, `mode 1 is not a square facing the screen: ${text}`);
    assert(facing.fill > 0.97 && upright.white > 0.02 && upright.fill < 0.95, `mode 4 does not stand upright: ${text}`);
    assert(behind1.white > 0.02 && behind2.white < 0.001, `seen from behind, mode 1 shows and mode 2 does not: ${text}`);
    // Adding: black adds nothing, so nothing is darker than the grey behind;
    // blending normally, the black squares are drawn.
    assert(glow.min >= 55 && plain.min < 50 && glow.mean > plain.mean + 30, `a loaded sprite does not glow: ${text}`);
    await page.click('#stopBtn');
    noConsoleErrors(page);
    await page.close();
  });

  await check('built meshes: vertex colours with FX_VERTEXCOLOR, and changes show on the next frame', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    // A square 5 units ahead filling most of the view; its corners red,
    // green, blue and white. At frame 20 its top-left corner moves away.
    const scene = (fx) => `Graphics3D 640, 480
cam = CreateCamera()
CameraClsColor cam, 0, 0, 0
Global m, s
m = CreateMesh()
s = CreateSurface(m)
AddVertex s, -2, 2, 5 : AddVertex s, 2, 2, 5 : AddVertex s, 2, -2, 5 : AddVertex s, -2, -2, 5
AddTriangle s, 0, 1, 2 : AddTriangle s, 0, 2, 3
VertexColor s, 0, 255, 0, 0
VertexColor s, 1, 0, 255, 0
VertexColor s, 2, 0, 0, 255
VertexColor s, 3, 255, 255, 255
EntityFX m, ${fx}
Function Update()
  If FrameCount() = 1 Then Print "first"
  If FrameCount() = 20
    VertexCoords s, 0, -2, 2, 50
    Print "moved"
  EndIf
End Function
`;
    // The colour a little inside each corner of the square on screen.
    const corners = () => page.evaluate(() =>
    {
      const canvas = window.polybasicPlayground.getScreen().canvas;
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const at = (fx, fy) => Array.from(ctx.getImageData(Math.round(canvas.width * fx), Math.round(canvas.height * fy), 1, 1).data.slice(0, 3));
      // 4 units wide at 5 ahead, with 60 degrees of view up and down and a
      // 4:3 screen: the square spans x 0.24..0.76 and y 0.154..0.846.
      return { tl: at(0.255, 0.17), tr: at(0.745, 0.17), br: at(0.745, 0.83), bl: at(0.255, 0.83) };
    });
    const run = async (text, mark) =>
    {
      await project(page, (x) => window.polybasicPlayground.setText(x), text);
      await project(page, () => window.polybasicPlayground.run());
      await page.waitForFunction((t) => document.getElementById('console').textContent.includes(t), mark, { timeout: 10000 });
      await page.waitForTimeout(250);
    };
    await run(scene('FX_FULLBRIGHT Or FX_VERTEXCOLOR'), 'first');
    const coloured = await corners();
    await page.locator('.polybasic-screen').screenshot({ path: join(SHOTS, 'mesh-colours.png') });
    await page.waitForFunction(() => document.getElementById('console').textContent.includes('moved'), null, { timeout: 10000 });
    await page.waitForTimeout(250);
    const moved = await corners();
    await run(scene('FX_FULLBRIGHT'), 'first');
    const plain = await corners();
    const text = JSON.stringify({ coloured, moved, plain });
    const is = (c, r, g, b) => Math.abs(c[0] - r) < 60 && Math.abs(c[1] - g) < 60 && Math.abs(c[2] - b) < 60;
    assert(is(coloured.tl, 255, 0, 0) && is(coloured.tr, 0, 255, 0) && is(coloured.br, 0, 0, 255) && is(coloured.bl, 255, 255, 255), `vertex colours: ${text}`);
    assert(Object.values(plain).every((c) => is(c, 255, 255, 255)), `without FX_VERTEXCOLOR the square is white: ${text}`);
    // The moved corner is 50 ahead now: the top-left is no longer covered.
    assert(is(moved.tl, 0, 0, 0) && is(moved.br, 0, 0, 255), `the change did not show: ${text}`);
    await page.click('#stopBtn');
    noConsoleErrors(page);
    await page.close();
  });

  await check('decals: drawn on the surface, near and far, with no flicker', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    // A red decal on a grey floor, seen from `distance` away at a low
    // angle; the camera circles, so the depth changes every frame.
    const scene = (distance, pitch) => `Graphics3D 640, 480
Global cam, pivot
floor = CreatePlane(4)
ScaleEntity floor, 200, 1, 200
EntityColor floor, 120, 120, 120
EntityFX floor, FX_FULLBRIGHT
size# = ${distance} / 2.5
d = CreateDecal(0, 0, 0, 0, 0, 1, 0, size)
EntityColor d, 255, 0, 0
EntityFX d, FX_FULLBRIGHT
pivot = CreatePivot()
cam = CreateCamera(pivot)
CameraRange cam, 0.1, 1000
RotateEntity cam, ${pitch}, 0, 0
MoveEntity cam, 0, 0, -${distance}
Function Update()
  TurnEntity pivot, 0, 1, 0
  If FrameCount() = 1 Then Print "drawn"
End Function
`;
    // The middle of the screen, over several frames: every reading must be
    // the decal's red (flicker shows as grey floor breaking through).
    const middle = async (distance, pitch) =>
    {
      await project(page, (x) => window.polybasicPlayground.setText(x), scene(distance, pitch));
      await project(page, () => window.polybasicPlayground.run());
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('drawn'), null, { timeout: 10000 });
      const readings = [];
      for (let i = 0; i < 12; i++)
      {
        await page.waitForTimeout(60);
        readings.push(await page.evaluate(() =>
        {
          const canvas = window.polybasicPlayground.getScreen().canvas;
          const copy = document.createElement('canvas');
          copy.width = canvas.width;
          copy.height = canvas.height;
          const ctx = copy.getContext('2d');
          ctx.drawImage(canvas, 0, 0);
          const d = ctx.getImageData(Math.round(canvas.width * 0.49), Math.round(canvas.height * 0.49), Math.round(canvas.width * 0.02), Math.round(canvas.height * 0.02)).data;
          let red = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++;
          return red / (d.length / 4);
        }));
      }
      return Math.min(...readings);
    };
    const near = await middle(8, 30);
    await page.locator('.polybasic-screen').screenshot({ path: join(SHOTS, 'decal.png') });
    const far = await middle(300, 12);
    await page.locator('.polybasic-screen').screenshot({ path: join(SHOTS, 'decal-far.png') });
    assert(near > 0.99 && far > 0.99, `decal not solid over the floor: near ${near}, far ${far}`);
    await page.click('#stopBtn');
    noConsoleErrors(page);
    await page.close();
  });

  await check('trails: a swung blade leaves a glowing ribbon that fades away', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    await project(page, (x) => window.polybasicPlayground.setText(x), `Graphics3D 640, 480
cam = CreateCamera()
CameraClsColor cam, 0, 0, 0
PositionEntity cam, 0, 0, -6
Global hilt, tip, t
hilt = CreatePivot()
tip = CreatePivot(hilt)
PositionEntity tip, 0, 2.5, 0
base = CreatePivot(hilt)
PositionEntity base, 0, 1, 0
t = CreateTrail(base, tip)
TrailLife t, 0.4
TrailColor t, 60, 200, 255
Function Update()
  TurnEntity hilt, 0, 0, 8
  If FrameCount() = 60 Then Print "swinging"
  If FrameCount() = 90
    TrailEmit t, False
    Print "stopped"
  EndIf
End Function
`);
    const cyan = () => page.evaluate(() =>
    {
      const canvas = window.polybasicPlayground.getScreen().canvas;
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const d = ctx.getImageData(0, 0, copy.width, copy.height).data;
      let n = 0;
      let bright = 0;
      for (let i = 0; i < d.length; i += 4)
      {
        if (d[i + 2] > 40 && d[i + 2] > d[i]) n++;
        if (d[i + 2] > 200 && d[i + 1] > 150) bright++;
      }
      return { lit: n / (d.length / 4), bright: bright / (d.length / 4) };
    });
    await project(page, () => window.polybasicPlayground.run());
    await page.waitForFunction(() => document.getElementById('console').textContent.includes('swinging'), null, { timeout: 10000 });
    const swinging = await cyan();
    await page.locator('.polybasic-screen').screenshot({ path: join(SHOTS, 'trail.png') });
    await page.waitForFunction(() => document.getElementById('console').textContent.includes('stopped'), null, { timeout: 10000 });
    await page.waitForTimeout(800);
    const faded = await cyan();
    assert(swinging.lit > 0.02 && swinging.bright > 0.002, `no ribbon: ${JSON.stringify(swinging)}`);
    assert(faded.lit < 0.0005, `the ribbon did not fade: ${JSON.stringify(faded)}`);
    await page.click('#stopBtn');
    noConsoleErrors(page);
    await page.close();
    console.log(`      ribbon covers ${(swinging.lit * 100).toFixed(1)}% of the screen while swinging, ${(faded.lit * 100).toFixed(2)}% after`);
  });

  await check('trees: bark and cut-out leaves drawn, with their shadows on the ground', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    const scene = (shadows) => `Graphics3D 800, 600
cam = CreateCamera()
CameraClsColor cam, 150, 190, 230
PositionEntity cam, 0, 4, -14
RotateEntity cam, 8, 0, 0
ground = CreatePlane(4)
ScaleEntity ground, 40, 1, 40
EntityColor ground, 110, 150, 80
sun = CreateLight()
RotateEntity sun, 50, -30, 0
LightShadows sun, ${shadows}, 40
AmbientLight 110, 110, 120
oak = CreateTree(TREE_OAK)
PositionEntity oak, -6, 0, 2
willow = CreateTree(TREE_WILLOW)
PositionEntity willow, 0, 0, 2
beech = CreateTree(TREE_BEECH)
PositionEntity beech, 6, 0, 2
Function Update()
  If FrameCount() = 1 Then Print "grown"
End Function
`;
    const look = async (shadows) =>
    {
      await project(page, (x) => window.polybasicPlayground.setText(x), scene(shadows));
      await project(page, () => window.polybasicPlayground.run());
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('grown'), null, { timeout: 20000 });
      await page.waitForTimeout(400);
      return page.evaluate(() =>
      {
        const canvas = window.polybasicPlayground.getScreen().canvas;
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        const d = ctx.getImageData(0, 0, copy.width, copy.height).data;
        const n = { leaves: 0, bark: 0, shade: 0 };
        for (let y = 0; y < copy.height; y++)
        {
          for (let x = 0; x < copy.width; x++)
          {
            const i = (y * copy.width + x) * 4;
            const [r, g, b] = [d[i], d[i + 1], d[i + 2]];
            // Leaves above the horizon (against the sky), bark brown,
            // shaded ground below it much darker than the lit green.
            if (y < copy.height * 0.44 && g > r + 15 && g > b + 15) n.leaves++;
            if (r > g && g > b && r - b > 15 && r < 140) n.bark++;
            if (y > copy.height * 0.46 && g > r && g < 120 && r < 90) n.shade++;
          }
        }
        const total = d.length / 4;
        for (const k of Object.keys(n)) n[k] = n[k] / total;
        return n;
      });
    };
    const lit = await look('True');
    await page.locator('.polybasic-screen').screenshot({ path: join(SHOTS, 'trees.png') });
    const flat = await look('False');
    const text = JSON.stringify({ lit, flat }, (k, v) => (typeof v === 'number' ? +v.toFixed(4) : v));
    assert(lit.leaves > 0.02 && lit.bark > 0.003, `no trees: ${text}`);
    assert(lit.shade > flat.shade + 0.005, `no tree shadows: ${text}`);
    await page.click('#stopBtn');
    noConsoleErrors(page);
    await page.close();
    console.log(`      leaves ${(lit.leaves * 100).toFixed(1)}%, bark ${(lit.bark * 100).toFixed(2)}%, shade ${(lit.shade * 100).toFixed(2)}% (without shadows ${(flat.shade * 100).toFixed(2)}%)`);
  });

  await check('grass: the wind moves it, and it leans away from what pushes through it', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    const scene = (wind, push) => `Graphics3D 640, 480
cam = CreateCamera()
CameraClsColor cam, 150, 190, 230
PositionEntity cam, 0, 2.5, -5
RotateEntity cam, 25, 0, 0
ground = CreatePlane()
ScaleEntity ground, 20, 1, 20
EntityColor ground, 90, 120, 60
EntityFX ground, FX_FULLBRIGHT
meadow = CreateGrass()
GrassSize meadow, 0.8
EntityFX meadow, FX_FULLBRIGHT
PaintGrass meadow, 0, 1, 4, 600
GrassWind meadow, ${wind}
stone = CreatePivot()
PositionEntity stone, 0, 0, 1
GrassPush meadow, stone, ${push}
Function Update()
  If FrameCount() = 20 Then Print "first"
  If FrameCount() = 50 Then Print "second"
End Function
`;
    const pixels = () => page.evaluate(() =>
    {
      const canvas = window.polybasicPlayground.getScreen().canvas;
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      return Array.from(ctx.getImageData(0, 0, copy.width, copy.height).data);
    });
    const differ = (a, b) =>
    {
      let n = 0;
      for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++;
      return n / (a.length / 4);
    };
    // Two moments of one run.
    const twice = async (wind, push) =>
    {
      await project(page, (x) => window.polybasicPlayground.setText(x), scene(wind, push));
      await project(page, () => window.polybasicPlayground.run());
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('first'), null, { timeout: 60000 });
      const a = await pixels();
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('second'), null, { timeout: 60000 });
      const b = await pixels();
      return [a, b];
    };
    const [windA, windB] = await twice(1, 0);
    const [stillA, stillB] = await twice(0, 0);
    const [pushed] = await twice(0, 2.5);
    await page.locator('.polybasic-screen').screenshot({ path: join(SHOTS, 'grass-pushed.png') });
    const moved = differ(windA, windB);
    const calm = differ(stillA, stillB);
    const push = differ(stillB, pushed);
    const text = `wind moved ${(moved * 100).toFixed(2)}%, still ${(calm * 100).toFixed(3)}%, pushing changed ${(push * 100).toFixed(2)}%`;
    assert(moved > 0.01 && calm < 0.0005, `the wind: ${text}`);
    assert(push > 0.01, `the push: ${text}`);
    await page.click('#stopBtn');
    noConsoleErrors(page);
    await page.close();
    console.log(`      ${text}`);
  });

  await check('shadows: a lamp\'s shadow starts at its object (not a unit away) and reaches far lamps', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    // A cube on the ground seen from above, a lamp to the right of it: its
    // shadow runs left from the cube's far side. The ground half a unit beyond that
    // side must be in it: a bias in the lamp's (perspective) depth moved the
    // shadow a unit off the cube, or lost it at a long range.
    const scene = (range, height, lampX, shadows) => `Graphics3D 640, 480
Global cam
cam = CreateCamera()
PositionEntity cam, 0, 30, 0
RotateEntity cam, 90, 0, 0
CameraRange cam, 0.5, 200
lamp = CreateLight(LIGHT_POINT)
PositionEntity lamp, ${lampX}, ${height}, 0
LightRange lamp, ${range}
${shadows ? 'LightShadows lamp, True' : ''}
AmbientLight 30, 30, 30
ground = CreatePlane(1)
ScaleEntity ground, 50, 1, 50
EntityColor ground, 200, 200, 200
cube = CreateCube()
PositionEntity cube, 0, 1, 0
EntityColor cube, 255, 0, 0
Function Update()
  If FrameCount() = 1
    CameraProject cam, -1.5, 0, 0
    Print "near " + ProjectedX() + " " + ProjectedY()
    CameraProject cam, -2.5, 0, 0
    Print "far " + ProjectedX() + " " + ProjectedY()
  EndIf
End Function
`;
    const level = async (text) =>
    {
      await project(page, (x) => window.polybasicPlayground.setText(x), text);
      await project(page, () => window.polybasicPlayground.run());
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('far'), null, { timeout: 10000 });
      await page.waitForTimeout(300);
      const log = await consoleText(page);
      const point = (name) => /(-?[\d.]+) (-?[\d.]+)/.exec(log.slice(log.indexOf(name) + name.length)).slice(1).map(Number);
      return page.evaluate(([a, b]) =>
      {
        const canvas = window.polybasicPlayground.getScreen().canvas;
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        const at = ([x, y]) =>
        {
          const px = ctx.getImageData(Math.round(x * canvas.width / 640), Math.round(y * canvas.height / 480), 1, 1).data;
          return (px[0] + px[1] + px[2]) / 3;
        };
        return [at(a), at(b)];
      }, [point('near'), point('far')]);
    };
    const facts = [];
    for (const [range, height, lampX] of [[9, 4, 3], [20, 5, 6], [60, 8, 6]])
    {
      const open = await level(scene(range, height, lampX, false));
      const shaded = await level(scene(range, height, lampX, true));
      facts.push(`range ${range}: ${shaded.map((v, i) => `${(v / open[i]).toFixed(2)}`).join(' ')}`);
      assert(shaded[0] / open[0] < 0.4, `range ${range}: the ground next to the cube is not in its shadow (${shaded[0]} of ${open[0]})`);
      assert(shaded[1] / open[1] < 0.4, `range ${range}: the ground further along is not in its shadow (${shaded[1]} of ${open[1]})`);
    }
    await page.close();
    console.log(`      shadowed / open brightness at 0.5 and 1.5 beyond the cube: ${facts.join('; ')}`);
  });

  await check('shadows: a box shades the ground where the light says, and the FX flags turn it off', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    // Where the box's shadow falls: from its centre along the sun's
    // forward axis down to the ground.
    const sunEntity = new World().createEntity('light');
    sunEntity.setRotation(60, -35, 0, false);
    const d = sunEntity.worldMatrix.e;
    const t = -3 / d[9];
    const spot = [d[8] * t, 0, 5 + d[10] * t];
    const scene = (lighting, extra) => `Graphics3D 640, 480
Global cam, box, ground
cam = CreateCamera()
PositionEntity cam, 0, 7, -5
target = CreatePivot()
PositionEntity target, 0, 0, 5
PointEntity cam, target
ground = CreatePlane(8)
ScaleEntity ground, 12, 1, 12
EntityColor ground, 210, 210, 210
box = CreateCube()
PositionEntity box, 0, 3, 5
EntityColor box, 230, 80, 60
AmbientLight 50, 50, 50
${lighting}
${extra}
Function Update()
  If FrameCount() = 1
    CameraProject cam, ${spot.join(', ')}
    Print "shade " + ProjectedX() + " " + ProjectedY()
    CameraProject cam, 0, 0, 5
    Print "under " + ProjectedX() + " " + ProjectedY()
    CameraProject cam, 4, 0, 1
    Print "lit " + ProjectedX() + " " + ProjectedY()
  EndIf
End Function
`;
    const sun = 'sun = CreateLight()\nRotateEntity sun, 60, -35, 0';
    const lamp = 'lamp = CreateLight(LIGHT_POINT)\nPositionEntity lamp, 0, 8, 5\nLightRange lamp, 40';
    // Brightness of the ground at two points: in the shadow and in the open.
    const measure = async (text, where) =>
    {
      await project(page, (x) => window.polybasicPlayground.setText(x), text);
      await project(page, () => window.polybasicPlayground.run());
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('lit'), null, { timeout: 10000 });
      await page.waitForTimeout(300);
      const log = await consoleText(page);
      const point = (name) => /(-?[\d.]+) (-?[\d.]+)/.exec(log.slice(log.indexOf(name) + name.length)).slice(1).map(Number);
      const levels = await page.evaluate(([a, b]) =>
      {
        const canvas = window.polybasicPlayground.getScreen().canvas;
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        const at = ([x, y]) =>
        {
          const px = ctx.getImageData(Math.round(x * canvas.width / 640), Math.round(y * canvas.height / 480), 1, 1).data;
          return (px[0] + px[1] + px[2]) / 3;
        };
        return [at(a), at(b)];
      }, [point(where), point('lit')]);
      return levels[0] / levels[1];
    };
    const ratios = {
      sun: await measure(scene(sun, 'LightShadows sun'), 'shade'),
      off: await measure(scene(sun, ''), 'shade'),
      noCast: await measure(scene(sun, 'LightShadows sun\nEntityFX box, FX_NOSHADOWCAST'), 'shade'),
      noReceive: await measure(scene(sun, 'LightShadows sun\nEntityFX ground, FX_NOSHADOWRECV'), 'shade'),
      lamp: await measure(scene(lamp, 'LightShadows lamp'), 'under'),
      lampOff: await measure(scene(lamp, ''), 'under')
    };
    await measure(scene(sun, 'LightShadows sun'), 'shade');
    await page.locator('.polybasic-screen').screenshot({ path: join(SHOTS, 'shadows.png') });

    // A masked card's shadow has its holes: less of the ground is shaded
    // than under the same card solid.
    const card = (flags) => `Graphics3D 640, 480
cam = CreateCamera()
PositionEntity cam, 0, 7, -4
target = CreatePivot()
PositionEntity target, 0, 0, 3
PointEntity cam, target
ground = CreatePlane(8)
ScaleEntity ground, 10, 1, 10
EntityColor ground, 220, 220, 220
tex = CreateTexture(8, 8, 60, 160, 60, ${flags})
For y = 0 To 7 : For x = 0 To 7
  If (x + y) Mod 2 = 0 Then TexturePixel tex, x, y, 0, 0, 0
Next : Next
card = CreatePlane()
ScaleEntity card, 2, 1, 2
PositionEntity card, 0, 2.5, 3
EntityTexture card, tex
EntityFX card, FX_TWOSIDED
sun = CreateLight()
RotateEntity sun, 70, -20, 0
LightShadows sun, True, 20
AmbientLight 70, 70, 70
Function Update()
  If FrameCount() = 1 Then Print "lit"
End Function
`;
    const shaded = async (flags) =>
    {
      await project(page, (x) => window.polybasicPlayground.setText(x), card(flags));
      await project(page, () => window.polybasicPlayground.run());
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('lit'), null, { timeout: 10000 });
      await page.waitForTimeout(300);
      // Grey ground in shadow: the same on all three channels, and dark.
      return page.evaluate(() =>
      {
        const canvas = window.polybasicPlayground.getScreen().canvas;
        const copy = document.createElement('canvas');
        copy.width = canvas.width;
        copy.height = canvas.height;
        const ctx = copy.getContext('2d');
        ctx.drawImage(canvas, 0, 0);
        const d = ctx.getImageData(0, 0, copy.width, copy.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4)
        {
          if (d[i] > 30 && d[i] < 120 && Math.abs(d[i] - d[i + 1]) < 6 && Math.abs(d[i] - d[i + 2]) < 6) n++;
        }
        return n / (d.length / 4);
      });
    };
    const solidShadow = await shaded('TEX_COLOR');
    const maskedShadow = await shaded('TEX_MASKED');
    ratios.cutOut = maskedShadow / solidShadow;
    const text = Object.entries(ratios).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ');
    assert(ratios.sun < 0.6 && ratios.lamp < 0.6, `no shadow where it should fall: ${text}`);
    assert(ratios.cutOut > 0.3 && ratios.cutOut < 0.8, `a masked card's shadow is not cut out (masked / solid shaded ground): ${text}`);
    for (const name of ['off', 'noCast', 'noReceive'])
    {
      assert(ratios[name] > 0.9, `a shadow that should not be there (${name}): ${text}`);
    }
    // The point light is right above the spot, the open ground further off:
    // without shadows the spot is at least as bright.
    assert(ratios.lampOff > 0.9, `lamp without shadows: ${text}`);
    await page.click('#stopBtn');
    noConsoleErrors(page);
    await page.close();
    facts.shadows = `shadow / open ground: ${text}`;
    console.log(`      ${facts.shadows}`);
  });

  await check('tutorials respond: the tank drives, a jump plays once, dragging looks round, N shows the next model', async () =>
  {
    const facts = [];
    // 1. Up drives the tank forward, along its own +Z (it starts facing +Z).
    let page = await openPage(browser, `${base}/web/player.html?src=../examples/t01-move.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const tankZ = () => page.evaluate(() =>
    {
      const t = window.polybasicPlayer.state.engine.world.entities.find((e) => e.kind === 'mesh' && e.children.some((c) => c.mesh && c.mesh.primitive === 'cylinder'));
      return t.worldPosition().z;
    });
    const z0 = await tankZ();
    await page.keyboard.down('ArrowUp');
    await page.waitForFunction((z) =>
    {
      const t = window.polybasicPlayer.state.engine.world.entities.find((e) => e.kind === 'mesh' && e.children.some((c) => c.mesh && c.mesh.primitive === 'cylinder'));
      return t.worldPosition().z > z + 1;
    }, z0, { timeout: 20000 });
    await page.keyboard.up('ArrowUp');
    facts.push(`tank z ${z0.toFixed(1)} -> ${(await tankZ()).toFixed(1)}`);
    noConsoleErrors(page);
    await page.close();

    // 2. Space plays the jump once, then the idle loop again.
    page = await openPage(browser, `${base}/web/player.html?src=../examples/t02-animation.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    // Layer 0 of the model's animator: which clip (numbered from 1), how
    // and whether it plays.
    const layerZero = `(() =>
    {
      const m = window.polybasicPlayer.state.engine.world.entities.find((e) => e.model && e.model.animator);
      const l = m && m.model.animator.layers[0];
      return l && l.current ? { index: m.model.clips.indexOf(l.current.clip) + 1, mode: l.current.mode, playing: l.playing } : null;
    })()`;
    const anim = () => page.evaluate(layerZero);
    await page.keyboard.press('Space');
    await page.waitForFunction(`(${layerZero} || {}).index === 4`, null, { timeout: 20000 });
    const jumping = await anim();
    await page.waitForFunction(`(() => { const l = ${layerZero}; return l && l.index === 2 && l.playing; })()`, null, { timeout: 20000 });
    assert(jumping.mode === 3, `the jump did not play once: ${JSON.stringify(jumping)}`);
    facts.push('jump played once, then idle');
    noConsoleErrors(page);
    await page.close();

    // 4. Dragging turns the first-person view (without taking the mouse).
    page = await openPage(browser, `${base}/web/player.html?src=../examples/t04-fps.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const yaw = () => page.evaluate(() =>
    {
      const b = window.polybasicPlayer.state.engine.world.entities.find((e) => e.kind === 'pivot' && e.radiusY === 0.85);
      return b.rotation.toEuler().yaw;
    });
    const box = await page.locator('canvas').first().boundingBox();
    // Moving over the page without a button does not turn it.
    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5, { steps: 5 });
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.5, { steps: 5 });
    await page.waitForTimeout(300);
    const still = await yaw();
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.5, { steps: 10 });
    await page.waitForTimeout(300);
    await page.mouse.up();
    const turned = await yaw();
    assert(Math.abs(still) < 0.01, `the view turned without a drag: yaw ${still}`);
    assert(turned < -5, `dragging right did not turn the view right: yaw ${turned}`);
    facts.push(`drag turned the view to ${turned.toFixed(0)} degrees`);
    noConsoleErrors(page);
    await page.close();

    // 6. N shows the next model, and the camera stands back by its size.
    page = await openPage(browser, `${base}/web/player.html?src=../examples/t06-orbit.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const distance = () => page.evaluate(() =>
    {
      const cam = window.polybasicPlayer.state.engine.world.entities.find((e) => e.kind === 'camera');
      return -cam.position.z;
    });
    await page.waitForTimeout(500);
    const first = await distance();
    await page.keyboard.press('KeyN');
    await page.waitForFunction((d) =>
    {
      const cam = window.polybasicPlayer.state.engine.world.entities.find((e) => e.kind === 'camera');
      return Math.abs(-cam.position.z - d) > 0.3;
    }, first, { timeout: 20000 });
    const second = await distance();
    // The coin (0.41 across) is seen from closer than the character (1.2).
    assert(second < first, `the camera did not come closer for the smaller model: ${first} -> ${second}`);
    facts.push(`orbit distance ${first.toFixed(2)} -> ${second.toFixed(2)}`);
    noConsoleErrors(page);
    await page.close();
    console.log(`      ${facts.join('; ')}`);
  });

  await check('terrain.pb: a heightmap drawn and textured, raised under the pointer, shading off makes every normal point up', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/terrain.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const state = () => page.evaluate(() =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.terrain);
      const n = e.terrain.mesh.normals;
      let up = 0;
      for (let i = 1; i < n.length; i += 3) if (n[i] === 1) up++;
      return { size: e.terrain.size, sum: e.terrain.heights.reduce((a, b) => a + b, 0), up, vertices: n.length / 3 };
    });
    await page.waitForTimeout(500);
    const before = await state();
    const colours = await playerStats(page);
    const box = await page.locator('canvas').first().boundingBox();
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.6);
    await page.mouse.down();
    await page.waitForFunction((sum) =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.terrain);
      return e.terrain.heights.reduce((a, b) => a + b, 0) > sum + 200;
    }, before.sum, { timeout: 20000 });
    await page.mouse.up();
    const raised = await state();
    await page.keyboard.press('KeyL');
    await page.waitForFunction(() =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.terrain);
      const n = e.terrain.mesh.normals;
      for (let i = 1; i < n.length; i += 3) if (n[i] !== 1) return false;
      return true;
    }, null, { timeout: 20000 });
    await page.screenshot({ path: join(SHOTS, 'terrain.png') });
    assert(before.size === 256, `size ${before.size}`);
    assert(before.up < before.vertices / 2, `shading on, yet ${before.up} of ${before.vertices} normals point straight up`);
    assert(colours.colours > 200, `the terrain is not textured: ${colours.colours} colours`);
    noConsoleErrors(page);
    await page.close();
    console.log(`      heights ${before.sum} -> ${raised.sum}; ${colours.colours} colours; with shading ${before.up} of ${before.vertices} normals straight up, without all`);
  });

  await check('driver.pb: the car lands on the terrain, drives with Up, stays on the ground, wears its brush', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/driver.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const car = () => page.evaluate(() =>
    {
      const world = window.polybasicPlayer.state.engine.world;
      const e = world.entities.find((x) => x.model);
      const t = world.entities.find((x) => x.terrain);
      const p = e.worldPosition();
      const cell = Math.floor(1000 / t.terrain.size);
      const ground = t.terrain.heightAt((p.x + 500) / cell, (p.z + 500) / cell) * 70;
      const parts = e.model.nodes.filter((n) => n && n.surfaces);
      const shiny = parts.every((n) => n.materials.every((m) => m.shininess === 1));
      return { x: p.x, y: p.y, z: p.z, ground, parts: parts.length, shiny };
    });
    await page.waitForFunction(() =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.model);
      return e && e.collisions.length > 0;
    }, null, { timeout: 20000 });
    await page.waitForTimeout(300);
    const landed = await car();
    await page.keyboard.down('ArrowUp');
    await page.waitForTimeout(2500);
    await page.keyboard.up('ArrowUp');
    const driven = await car();
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(SHOTS, 'driver.png') });
    const colours = await playerStats(page);
    assert(Math.abs(landed.y - landed.ground - 1) < 0.3, `landed at ${landed.y}, ground ${landed.ground}`);
    const travelled = Math.hypot(driven.x - landed.x, driven.z - landed.z);
    assert(travelled > 40, `drove only ${travelled.toFixed(1)} units`);
    assert(driven.y > driven.ground && driven.y < driven.ground + 3, `after driving at ${driven.y}, ground ${driven.ground}`);
    assert(landed.parts > 0 && landed.shiny, `EntityShininess did not reach the car's ${landed.parts} parts`);
    assert(colours.colours > 200, `the scene is not textured: ${colours.colours} colours`);
    noConsoleErrors(page);
    await page.close();
    console.log(`      landed at ${landed.y.toFixed(2)} over ${landed.ground.toFixed(2)}; drove ${travelled.toFixed(1)} units; ${landed.parts} parts; ${colours.colours} colours`);
  });

  await check('md2.pb: a hundred MD2 flags wave, each posed in place in its own buffers; ping-pong, once and stop', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/md2.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const flags = () => page.evaluate(() =>
    {
      const engine = window.polybasicPlayer.state.engine;
      const shown = engine.world.entities.filter((e) => e.md2 && e.visible);
      const backend = engine.backend;
      const first = shown[0];
      const known = backend.geometries.get(first.mesh.id);
      return {
        count: shown.length,
        playing: shown.filter((e) => e.md2.animating).length,
        meshes: new Set(shown.map((e) => e.mesh.id)).size,
        pose: first.mesh.pose,
        drawnPose: known ? known.pose : -1,
        buffer: known ? known.geometry.getAttribute('position').array.length : 0,
        y: first.mesh.positions[3 * 60 + 2],
        time: first.md2.time,
        mode: first.md2.mode
      };
    });
    await page.waitForTimeout(600);
    const a = await flags();
    const geometryA = await page.evaluate(() =>
    {
      const engine = window.polybasicPlayer.state.engine;
      const e = engine.world.entities.find((x) => x.md2 && x.visible);
      window.__flagGeometry = engine.backend.geometries.get(e.mesh.id).geometry;
      return true;
    });
    await page.waitForTimeout(400);
    const b = await flags();
    const same = await page.evaluate(() =>
    {
      const engine = window.polybasicPlayer.state.engine;
      const e = engine.world.entities.find((x) => x.md2 && x.visible);
      return engine.backend.geometries.get(e.mesh.id).geometry === window.__flagGeometry;
    });
    await page.screenshot({ path: join(SHOTS, 'md2.png') });
    const colours = await playerStats(page);
    await page.keyboard.press('Digit2');
    await page.waitForTimeout(300);
    const pingpong = await flags();
    await page.keyboard.press('Digit3');
    await page.waitForFunction(() => window.polybasicPlayer.state.engine.world.entities.filter((e) => e.md2 && e.visible && e.md2.animating).length === 0, null, { timeout: 20000 });
    const once = await flags();
    // Stopping with the blend on first blends back to the first frame.
    // (12 steps, 0.2 s).
    await page.keyboard.press('Digit0');
    await page.waitForTimeout(700);
    const stopped = await flags();
    await page.waitForTimeout(300);
    const still = await flags();
    assert(geometryA && a.count === 99 && a.playing === 99, `${a.count} flags, ${a.playing} playing`);
    assert(a.meshes === 99, `the flags share ${a.meshes} meshes: each needs its own pose`);
    assert(b.pose > a.pose && b.drawnPose === b.pose, `pose ${a.pose} -> ${b.pose}, drawn ${b.drawnPose}`);
    assert(same, 'the geometry was built again instead of posed in place');
    assert(b.y !== a.y, 'the flag did not move');
    assert(pingpong.mode === 2, `mode after 2: ${pingpong.mode}`);
    assert(once.time === 20, `once stopped at frame ${once.time}`);
    assert(stopped.playing === 0 && stopped.mode === 0 && still.pose === stopped.pose, `stopped yet posed again: ${stopped.pose} -> ${still.pose}`);
    assert(stopped.time === 0, `stop did not go back to the first frame: ${stopped.time}`);
    assert(colours.colours > 200, `the flags are not textured: ${colours.colours} colours`);
    noConsoleErrors(page);
    await page.close();
    console.log(`      ${a.count} flags, ${a.buffer / 3} vertices each; pose ${a.pose} -> ${b.pose} in the same buffers; once ended at frame ${once.time}; ${colours.colours} colours`);
  });

  await check('dragon.pb: the MD2 dragon idles, textured, and shows in the mirror floor', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/dragon.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const dragon = () => page.evaluate(() =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.md2);
      return { time: e.md2.time, animating: e.md2.animating, frames: e.md2.frameCount, textured: !!(e.material.texture && e.material.texture.loaded) };
    });
    await page.waitForTimeout(700);
    const a = await dragon();
    await page.waitForTimeout(500);
    const b = await dragon();
    await page.screenshot({ path: join(SHOTS, 'dragon.png') });
    // The mirror: a column of pixels under the dragon's feet, seen with the
    // mirror and without it.
    const column = () => page.evaluate(() =>
    {
      const canvas = document.querySelector('canvas');
      const copy = document.createElement('canvas');
      copy.width = canvas.width;
      copy.height = canvas.height;
      const ctx = copy.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const x = Math.round(canvas.width / 2);
      return Array.from(ctx.getImageData(x, Math.round(canvas.height * 0.55), 1, Math.round(canvas.height * 0.4)).data);
    });
    const withMirror = await column();
    await page.evaluate(() =>
    {
      const engine = window.polybasicPlayer.state.engine;
      for (const e of engine.world.entities) if (e.kind === 'mirror') e.visible = false;
    });
    await page.waitForTimeout(300);
    const without = await column();
    let differ = 0;
    for (let i = 0; i < withMirror.length; i += 4)
    {
      if (Math.abs(withMirror[i] - without[i]) + Math.abs(withMirror[i + 1] - without[i + 1]) + Math.abs(withMirror[i + 2] - without[i + 2]) > 30) differ++;
    }
    assert(a.frames === 200 && a.animating && b.time !== a.time && b.time >= 0 && b.time < 40, `dragon ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    assert(a.textured, 'the dragon has no texture');
    assert(differ > 20, `the mirror changes only ${differ} pixels under the dragon`);
    noConsoleErrors(page);
    await page.close();
    console.log(`      frame ${a.time.toFixed(2)} -> ${b.time.toFixed(2)} of ${a.frames}; the reflection changes ${differ} pixels under the dragon`);
  });

  await check('bird.pb: two MD2 birds and the camera fly their paths over a canyon from a binary .x file, under a sky box', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/bird.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const look = () => page.evaluate(() =>
    {
      const all = window.polybasicPlayer.state.engine.world.entities;
      const at = (e) => Array.from(e.worldMatrix.e.slice(12, 15));
      const textured = (list) => list.filter((e) => e.material && e.material.texture && e.material.texture.loaded).length;
      const birds = all.filter((e) => e.md2);
      const camera = all.find((e) => e.kind === 'camera');
      const meshes = all.filter((e) => e.kind === 'mesh' && !e.md2);
      return {
        birds: birds.map((e) => ({ time: e.md2.time, animating: e.md2.animating, at: at(e) })),
        camera: at(camera),
        yaw: camera.rotation,
        meshes: meshes.length,
        birdsSkinned: textured(birds),
        textured: textured(meshes)
      };
    });
    await page.waitForTimeout(800);
    const a = await look();
    await page.waitForTimeout(1500);
    const b = await look();
    await page.screenshot({ path: join(SHOTS, 'bird.png') });
    assert(a.birds.length === 2 && a.birds.every((x) => x.animating), `birds: ${JSON.stringify(a.birds)}`);
    assert(a.birdsSkinned === 2, 'the birds wear their texture');
    // The canyon (one mesh of four materials) and the 5 faces of the sky,
    // all textured.
    assert(a.meshes >= 6 && a.textured >= 6, `${a.meshes} meshes, ${a.textured} textured: the canyon and the sky box`);
    const moved = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    assert(moved(a.camera, b.camera) > 20, `the camera moved ${moved(a.camera, b.camera)}`);
    a.birds.forEach((x, i) => assert(moved(x.at, b.birds[i].at) > 20, `bird ${i} did not fly`));
    assert(b.birds[0].time !== a.birds[0].time, 'the wings do not flap');
    noConsoleErrors(page);
    await page.close();
    console.log(`      camera moved ${moved(a.camera, b.camera).toFixed(0)} units, ${a.meshes} meshes of which ${a.textured} textured`);
  });

  await check('zombies.pb: the field loads with its models and sounds, Enter starts a game with props, no errors', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/zombies.pb`, { width: 960, height: 600 });
    await waitRunning(page);
    const count = () => page.evaluate(() => window.polybasicPlayer.state.engine.world.entities.length);
    const before = await count();
    await page.screenshot({ path: join(SHOTS, 'zombies-intro.png') });
    await page.keyboard.press('Enter');
    // A new game puts out its barrels and crates (bodies) and the first
    // wave's zombies start to climb out of the ground.
    await page.waitForFunction((n) => window.polybasicPlayer.state.engine.world.entities.length > n + 15, before, { timeout: 40000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() =>
    {
      const world = window.polybasicPlayer.state.engine.world;
      return { entities: world.entities.length };
    });
    await page.screenshot({ path: join(SHOTS, 'zombies.png') });
    assert(info.entities > before + 15, `${info.entities} entities after the start, ${before} before`);
    noConsoleErrors(page);
    await page.close();
    console.log(`      ${before} entities in the field, ${info.entities} once the game started`);
  });

  await check('zombies.pb: a click starts the game even when the browser refuses to capture the pointer', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/zombies.pb`, { width: 960, height: 600 });
    await waitRunning(page);
    const count = () => page.evaluate(() => window.polybasicPlayer.state.engine.world.entities.length);
    const before = await count();
    // A pointer that is not active: setPointerCapture throws for it.
    await page.evaluate(() =>
    {
      const canvas = document.querySelector('canvas');
      canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 987654, pointerType: 'mouse', button: 0, buttons: 1, clientX: 400, clientY: 300, bubbles: true }));
    });
    await page.waitForFunction((n) => window.polybasicPlayer.state.engine.world.entities.length > n + 15, before, { timeout: 40000 });
    noConsoleErrors(page);
    await page.close();
  });

  await check('gcuk-animation.pb: the gargoyle walks with frames 32 to 46, towards the camera', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/gcuk-animation.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const man = () => page.evaluate(() =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.md2);
      return { time: e.md2.time, first: e.md2.first, last: e.md2.last, z: e.worldPosition().z };
    });
    await page.waitForTimeout(500);
    const a = await man();
    await page.waitForTimeout(1500);
    const b = await man();
    await page.screenshot({ path: join(SHOTS, 'gcuk-animation.png') });
    const colours = await playerStats(page);
    assert(a.first === 32 && a.last === 46 && a.time >= 32 && a.time < 46, `walking frames ${JSON.stringify(a)}`);
    assert(b.z < a.z - 20, `it did not come closer: z ${a.z} -> ${b.z}`);
    assert(colours.colours > 20, `nothing drawn: ${colours.colours} colours`);
    noConsoleErrors(page);
    await page.close();
    console.log(`      frame ${a.time.toFixed(1)} of 32-46; z ${a.z.toFixed(0)} -> ${b.z.toFixed(0)}`);
  });

  await check('skinning.pb: the fox bends on its skeleton, blends into Run from another file, a head layer and a one-shot', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/skinning.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const fox = () => page.evaluate(() =>
    {
      const fox = window.polybasicPlayer.state.engine.world.entities.find((e) => e.model && e.model.animator);
      const part = fox.model.nodes.find((n) => n && n.skin);
      const layers = fox.model.animator.layers.map((l) => ({
        clip: l.current ? l.current.clip.name : null,
        playing: l.playing,
        blending: !!l.previous,
        masked: l.mask ? Array.from(l.mask).filter((w) => w > 0).length : -1
      }));
      return { palette: Array.from(part.skin.palette.slice(16 * 5, 16 * 5 + 16)), layers, clips: fox.model.clips.length };
    });
    await page.waitForTimeout(400);
    const a = await fox();
    await page.waitForTimeout(300);
    const b = await fox();
    await page.keyboard.press('Digit3');
    await page.waitForTimeout(80);
    const blending = await fox();
    await page.waitForTimeout(600);
    const running = await fox();
    await page.keyboard.press('KeyH');
    await page.waitForTimeout(200);
    const head = await fox();
    await page.screenshot({ path: join(SHOTS, 'skinning.png') });
    const colours = await playerStats(page);
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    const once = await fox();
    await page.waitForFunction(() =>
    {
      const fox = window.polybasicPlayer.state.engine.world.entities.find((e) => e.model && e.model.animator);
      const l = fox.model.animator.layers[0];
      return l.current && l.current.clip.name === 'Run' && l.playing;
    }, null, { timeout: 20000 });
    assert(a.clips === 4, `${a.clips} animations: Run was not added`);
    assert(a.palette.some((v, i) => Math.abs(v - b.palette[i]) > 1e-4), 'the skeleton does not move');
    assert(blending.layers[0].clip === 'Run' && blending.layers[0].blending, `pressing 3: ${JSON.stringify(blending.layers[0])}`);
    assert(running.layers[0].clip === 'Run' && !running.layers[0].blending, `after the blend: ${JSON.stringify(running.layers[0])}`);
    // b_Neck_04 and the one node below it, b_Head_05.
    assert(head.layers[1] && head.layers[1].clip === 'Survey' && head.layers[1].masked === 2, `head layer: ${JSON.stringify(head.layers[1])}`);
    assert(once.layers[0].clip === 'Survey' && once.layers[0].playing, `space: ${JSON.stringify(once.layers[0])}`);
    assert(colours.colours > 50, `${colours.colours} colours`);
    noConsoleErrors(page);
    await page.close();
    console.log(`      Run blended in and out of a one-shot; the head layer moves ${head.layers[1].masked} nodes; ${colours.colours} colours`);
  });

  await check('meadow.pb: the walker goes through the grass, a click plants a flower, fireflies leave trails', async () =>
  {
    const page = await openPage(browser, `${base}/web/player.html?src=../examples/meadow.pb`, { width: 800, height: 600 });
    await waitRunning(page);
    const walker = () => page.evaluate(() =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.kind === 'pivot' && x.radiusY === 0.55);
      const p = e.worldPosition();
      return { x: p.x, y: p.y, z: p.z };
    });
    const start = await walker();
    const scene = await page.evaluate(() =>
    {
      const world = window.polybasicPlayer.state.engine.world;
      const grass = world.entities.find((e) => e.grass);
      return {
        tufts: grass.grass.count,
        pushers: grass.grass.pushers.length,
        trees: world.entities.filter((e) => e.name === 'twigs').length,
        shadows: world.entities.filter((e) => e.kind === 'light' && e.light.shadows > 0).length
      };
    });
    assert(scene.tufts === 5000 && scene.pushers === 1, `grass: ${JSON.stringify(scene)}`);
    assert(scene.trees === 11 && scene.shadows === 1, `trees and sun: ${JSON.stringify(scene)}`);

    // Walk forward, on the ground, over the hills. Wait on the game, not
    // the clock: software WebGL draws this scene slowly.
    await page.keyboard.down('ArrowUp');
    try
    {
      await page.waitForFunction((s) =>
      {
        const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.kind === 'pivot' && x.radiusY === 0.55);
        return e.worldPosition().z > s.z + 1;
      }, start, { timeout: 60000 });
    }
    finally
    {
      await page.keyboard.up('ArrowUp');
    }
    const after = await walker();
    // Standing on the hills: the ellipsoid's centre 0.55 over the ground.
    const ground = (x, z) => 1.2 * Math.sin(x * 14 * Math.PI / 180) * Math.cos(z * 11.5 * Math.PI / 180) + 0.6 * Math.sin((x + z) * 7.5 * Math.PI / 180);
    assert(Math.abs(after.y - 0.55 - ground(after.x, after.z)) < 0.1, `the walker is not on the ground: ${JSON.stringify(after)}, ground ${ground(after.x, after.z).toFixed(3)}`);

    // A click on the ground below the walker plants a flower there.
    const box = await page.locator('canvas').first().boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.8);
    await page.waitForFunction(() => window.polybasicPlayer.state.engine.world.entities.some((e) => e.decal), null, { timeout: 20000 });
    const flower = await page.evaluate(() =>
    {
      const e = window.polybasicPlayer.state.engine.world.entities.find((x) => x.decal);
      return { triangles: e.mesh.indices.length / 3, y: e.worldPosition().y };
    });
    assert(flower.triangles > 0, `the flower has no triangles: ${JSON.stringify(flower)}`);

    const trails = await page.evaluate(() => window.polybasicPlayer.state.engine.world.entities.filter((e) => e.trail).map((e) => e.trail.samples.length));
    assert(trails.length === 8 && trails.every((n) => n > 1), `firefly trails: ${JSON.stringify(trails)}`);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(SHOTS, 'meadow.png') });
    noConsoleErrors(page);
    await page.close();
    console.log(`      walked ${start.z.toFixed(2)} -> ${after.z.toFixed(2)} at y ${after.y.toFixed(2)}, flower of ${flower.triangles} triangles, trail samples ${trails.join(' ')}`);
  });

  await check('sound: Web Audio plays made sounds and songs; a 3D sound comes from the side it is drawn on', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    const text = (x) => `Graphics3D 640, 480
Global cam, tone, box
cam = CreateCamera()
CreateListener cam
box = CreateCube()
PositionEntity box, ${x}, 0, 5
tone = CreateTone(WAVE_SINE, 440, 440, 3000, 0.8)
Function Update()
  If FrameCount() = 1
    EmitSound tone, box
    CameraProject cam, EntityX(box), EntityY(box), EntityZ(box)
    Print "drawn at x " + Int(ProjectedX())
  EndIf
End Function
`;
    // The Web Audio stereo panner shares a mono sound between the sides
    // with equal power: at pan p, right / left = tan((p + 1) * pi / 4).
    const origin = new Mat4();
    const place = (x) => new Mat4().compose(new Vec3(x, 0, 5), new Quat(), new Vec3(1, 1, 1));
    const balance = [];
    for (const x of [3, -3])
    {
      await project(page, (t) => window.polybasicPlayground.setText(t), text(x));
      await page.click('#runBtn');
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('drawn at x'), null, { timeout: 10000 });
      const drawnAt = Number(/drawn at x (-?\d+)/.exec(await consoleText(page))[1]);
      await page.waitForTimeout(SETTLE_MS);
      const level = await audioLevels(page, 600);
      const pan = hear(origin, place(x), [0, 0, 0], [0, 0, 0], { rolloff: 1, doppler: 1, distance: 1 }).pan;
      const expected = Math.tan((pan + 1) * Math.PI / 4);
      const measured = level.rightAll / level.leftAll;
      assert(level.state === 'running' && level.right + level.left > 0.01, `silent: ${JSON.stringify(level)}`);
      assert(Math.abs(measured / expected - 1) < 0.05, `x ${x}: right / left ${measured.toFixed(3)}, expected ${expected.toFixed(3)}`);
      assert((drawnAt > 320) === (measured > 1), `drawn at x ${drawnAt} of 640 but louder on the ${measured > 1 ? 'right' : 'left'}`);
      balance.push(`x ${x}: drawn at ${drawnAt}, right/left ${measured.toFixed(2)} (expected ${expected.toFixed(2)})`);
    }

    // A song: notes on the audio clock, and the program sees where it is.
    await project(page, (t) => window.polybasicPlayground.setText(t), `Global song
song = CreateSong(140)
SongTrack song, INST_PAD, "C4 - - - E4 - - - G4 - - - E4 - - -"
SongTrack song, INST_DRUMS, "k . h . s . h . k k h . s . h ."
SongTrack song, INST_BASS, "C3 . . . C3 . . . G2 . . . G2 . . ."
PlaySong song
Function Update()
  If FrameCount() = 90 Then Print "playing " + (SongPlaying() = song) + " step " + SongStep() + " time " + SongTime()
End Function
`);
    const notesBefore = (await audioLevels(page, 50)).stats.notes;
    await page.click('#runBtn');
    await page.waitForFunction(() => document.getElementById('console').textContent.includes('time'), null, { timeout: 10000 });
    const song = await audioLevels(page, 500);
    const [, playing, step, time] = /playing (\d) step (-?\d+) time ([\d.]+)/.exec(await consoleText(page));
    assert(playing === '1' && Number(step) >= 0 && Number(step) < 16, `playing ${playing} step ${step}`);
    assert(Number(time) > 1 && Number(time) < 2, `song time ${time} after 90 updates (1.5 s)`);
    assert(song.stats.notes > notesBefore + 10 && song.left > 0.005, `song: ${JSON.stringify(song)}`);

    // A hidden page is silent, and comes back.
    const hide = (hidden) => page.evaluate((h) =>
    {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
      document.dispatchEvent(new Event('visibilitychange'));
    }, hidden);
    await hide(true);
    await page.waitForTimeout(200);
    const hidden = await audioLevels(page, 50);
    await hide(false);
    await page.waitForTimeout(200);
    const shown = await audioLevels(page, 300);
    assert(hidden.state === 'suspended' && shown.state === 'running' && shown.left > 0.005, `hidden ${hidden.state}, shown ${shown.state} ${shown.left}`);

    // Stop silences everything.
    await page.click('#stopBtn');
    await page.waitForTimeout(250);
    const stopped = await audioLevels(page, 300);
    assert(stopped.left < 1e-4 && stopped.right < 1e-4, `still sounding after Stop: ${JSON.stringify(stopped)}`);
    noConsoleErrors(page);
    await page.close();
    facts.sound3d = balance.join('; ');
    console.log(`      ${facts.sound3d}`);
  });

  await check('sound: pause, resume, pitch and the Doppler effect, heard in the browser', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=spin`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'spin', null, { timeout: 20000 });
    const waitFor = (text) => page.waitForFunction((t) => document.getElementById('console').textContent.includes(t), text, { timeout: 10000 });
    // One bin of the analysis is ctx.sampleRate / 8192 Hz wide (about 6).
    const close = (measured, expected) => Math.abs(measured - expected) <= 8;
    await project(page, (t) => window.polybasicPlayground.setText(t), `Global tone, ch
tone = CreateTone(WAVE_SINE, 440, 440, 30000, 0.8)
ch = PlaySound(tone)
Function Update()
  f = FrameCount()
  If f = 20 Then Print "plain"
  If f = 80
    ChannelPitch ch, 88200    ; twice the rate it was made at
    Print "doubled"
  EndIf
  If f = 140
    PauseChannel ch
    Print "paused"
  EndIf
  If f = 200
    ResumeChannel ch
    Print "resumed " + ChannelPlaying(ch)
  EndIf
End Function
`);
    await page.click('#runBtn');
    const heard = {};
    for (const mark of ['plain', 'doubled', 'paused', 'resumed'])
    {
      await waitFor(mark);
      await page.waitForTimeout(SETTLE_MS);
      heard[mark] = await audioLevels(page, 400);
    }
    assert(close(heard.plain.pitch, 440), `plain: ${heard.plain.pitch} Hz`);
    assert(close(heard.doubled.pitch, 880), `doubled: ${heard.doubled.pitch} Hz`);
    assert(heard.paused.left < 1e-4, `paused: level ${heard.paused.left}`);
    assert(close(heard.resumed.pitch, 880) && heard.resumed.left > 0.05, `resumed: ${heard.resumed.pitch} Hz, level ${heard.resumed.left}`);
    assert((await consoleText(page)).includes('resumed 1'), await consoleText(page));

    // Something coming at the listener at 60 units a second (30 m/s: a
    // unit is half a metre) sounds higher by 343 / (343 - 30), and lower
    // going away, by 343 / (343 + 30).
    await project(page, (t) => window.polybasicPlayground.setText(t), `Graphics3D 640, 480
Global cam, car, tone, speed#
cam = CreateCamera()
CreateListener cam
car = CreatePivot()
PositionEntity car, 0, 0, 200
tone = CreateTone(WAVE_SINE, 440, 440, 30000, 0.8)
EmitSound tone, car
speed = -1
Function Update()
  MoveEntity car, 0, 0, speed   ; 60 units a second
  If FrameCount() = 30 Then Print "coming"
  If FrameCount() = 120
    speed = 1
    Print "going"
  EndIf
End Function
`);
    await page.click('#runBtn');
    await waitFor('coming');
    await page.waitForTimeout(SETTLE_MS);
    const coming = await audioLevels(page, 400);
    await waitFor('going');
    await page.waitForTimeout(SETTLE_MS);
    const going = await audioLevels(page, 400);
    const up = 440 * 343 / (343 - 30);
    const down = 440 * 343 / (343 + 30);
    assert(close(coming.pitch, up), `coming: ${coming.pitch.toFixed(1)} Hz, expected ${up.toFixed(1)}`);
    assert(close(going.pitch, down), `going: ${going.pitch.toFixed(1)} Hz, expected ${down.toFixed(1)}`);
    await page.click('#stopBtn');
    noConsoleErrors(page);
    await page.close();
    facts.pitch = `pitch 440 -> ${heard.doubled.pitch.toFixed(0)} Hz; Doppler ${coming.pitch.toFixed(0)} Hz coming (${up.toFixed(0)}), ${going.pitch.toFixed(0)} Hz going (${down.toFixed(0)})`;
    console.log(`      ${facts.pitch}`);
  });

  await check('sound: nothing sounds before the player clicks; the first click starts it', async () =>
  {
    // Browsers keep a page quiet until the player interacts with it. This
    // page starts its program by itself, and nothing from the test touches
    // it before the first reading (Playwright's evaluate counts as the
    // player's doing, so the reading looks at the state before it acts).
    const source = `Graphics3D 640, 480
Global blip, song
blip = CreateSfx(SFX_BLIP)
song = CreateSong(120)
SongTrack song, INST_SQUARE, "C5 E5 G5 C6"
PlaySong song
Function Update()
  If FrameCount() Mod 20 = 1 Then PlaySound blip
End Function
`;
    const { js } = compile(source, { file: 'main.pb' });
    const htmlPath = join(SHOTS, 'quiet-until-click.html');
    writeFileSync(htmlPath, projectPage({
      name: 'Quiet until a click', main: 'main.pb', files: new Map([['main.pb', new TextEncoder().encode(source)]]),
      js, engine: readFileSync(join(ROOT, 'dist/polybasic.js'), 'utf8'), physics: null
    }));
    const page = await openPage(browser, `file://${htmlPath}`, { width: 800, height: 600 });
    await page.waitForTimeout(1500);
    const before = await page.evaluate(() =>
    {
      const { engine, screen } = window.polybasicPage;
      const audio = screen.audio;
      return {
        state: audio.output ? audio.output.context.state : 'none',
        stats: { ...audio.stats },
        frames: engine.frames,
        song: engine.audio.songPlaying() ? 1 : 0,
        songTime: audio.songTime()
      };
    });
    assert(before.frames > 30, `the page is not running: ${JSON.stringify(before)}`);
    assert(before.state === 'suspended' && before.stats.played === 0 && before.stats.skipped > 0 && before.stats.notes === 0, `before a click: ${JSON.stringify(before)}`);
    assert(before.song === 1 && before.songTime === 0, `the song should be waiting: ${JSON.stringify(before)}`);
    await page.mouse.click(400, 300);
    await page.waitForTimeout(300);
    const after = await audioLevels(page, 600, 'page');
    assert(after.state === 'running' && after.stats.played > 0 && after.stats.notes > 0 && after.left > 0.005, `after a click: ${JSON.stringify(after)}`);
    noConsoleErrors(page);
    await page.close();
  });

  await check('sound: LoadSound and PlayMusic play the project\'s files, from the playground and from an exported page', async () =>
  {
    const page = await openPage(browser, `${base}/web/`, { width: 1400, height: 850 });
    const answer = answering(page);
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId(), null, { timeout: 20000 });
    answer('Sound test');
    await page.click('#newBtn');
    await page.waitForFunction(() => window.polybasicPlayground.getProjectId(), null, { timeout: 20000 });
    const id = await project(page, () => window.polybasicPlayground.getProjectId());
    const sine = (hz, seconds) => Array.from({ length: Math.round(44100 * seconds) }, (_, i) => 0.5 * Math.sin(2 * Math.PI * hz * i / 44100));
    const beep = Array.from(makeWav(sine(660, 0.5)));
    const tune = Array.from(makeWav(sine(330, 2)));
    // 440 Hz recorded at 22050 samples a second.
    const low = Array.from(makeWav(Array.from({ length: 22050 * 3 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 22050)), 22050));
    await project(page, ({ beep, tune, low }) => window.polybasicPlayground.upload([
      { name: 'beep.wav', bytes: new Uint8Array(beep) },
      { name: 'tune.wav', bytes: new Uint8Array(tune) },
      { name: 'low.wav', bytes: new Uint8Array(low) }
    ]), { beep, tune, low });
    await project(page, () => window.polybasicPlayground.openFile('assets/beep.wav'));
    const asset = await page.textContent('#assetView');
    assert(asset.includes('LoadSound("assets/beep.wav")') && await page.isVisible('#assetView audio'), asset);
    // The sound files come from the project, never from the network.
    const fetched = [];
    await page.route('**/*.wav', (route) =>
    {
      fetched.push(route.request().url());
      return route.abort();
    });
    await project(page, () => window.polybasicPlayground.openFile('main.pb'));
    await project(page, (t) => window.polybasicPlayground.setText(t), `Graphics3D 640, 480
Global snd, music
snd = LoadSound("assets/beep.wav")
LoopSound snd
SoundVolume snd, 0.5
music = PlayMusic("assets/tune.wav")
Function Update()
  If FrameCount() = 1
    Print "loaded " + SoundLoaded(snd)
    PlaySound snd
  EndIf
  If FrameCount() = 30 Then Print "music " + ChannelPlaying(music)
End Function
`);
    // Twice: the files must still be whole after a run has read them.
    for (const run of [1, 2])
    {
      await project(page, () => window.polybasicPlayground.run());
      await page.waitForFunction(() => document.getElementById('console').textContent.includes('music'), null, { timeout: 10000 });
      const text = await consoleText(page);
      assert(text.includes('loaded 1') && text.includes('music 1'), `run ${run}: ${text}`);
      const level = await audioLevels(page, 400);
      assert(level.left > 0.02 && level.stats.played > 0, `run ${run}: ${JSON.stringify(level)}`);
    }
    assert(fetched.length === 0, `fetched: ${fetched.join(', ')}`);

    // SoundPitch counts in the file's own rate: twice 22050 is an octave up.
    await project(page, (t) => window.polybasicPlayground.setText(t), `Global low
low = LoadSound("assets/low.wav")
Function Update()
  If FrameCount() = 1 Then PlaySound low
  If FrameCount() = 40
    SoundPitch low, 44100
    PlaySound low
    Print "octave"
  EndIf
End Function
`);
    await project(page, () => window.polybasicPlayground.run());
    await page.waitForTimeout(SETTLE_MS + 100);
    const asRecorded = await audioLevels(page, 300);
    await page.waitForFunction(() => document.getElementById('console').textContent.includes('octave'), null, { timeout: 10000 });
    // The first copy (440 Hz) plays on under the new one: the new one is
    // not louder, so look for its frequency among the strongest two.
    await page.waitForTimeout(SETTLE_MS);
    const both = await page.evaluate(() =>
    {
      const audio = window.polybasicPlayground.getScreen().audio;
      const bins = new Float32Array(audio.meter.left.frequencyBinCount);
      audio.meter.left.getFloatFrequencyData(bins);
      const hz = (i) => i * audio.output.context.sampleRate / audio.meter.left.fftSize;
      const near = (f) => Math.max(...[-1, 0, 1].map((d) => bins[Math.round(f / hz(1)) + d]));
      return { at440: near(440), at880: near(880), at220: near(220), at1760: near(1760) };
    });
    assert(Math.abs(asRecorded.pitch - 440) <= 8, `as recorded: ${asRecorded.pitch} Hz`);
    assert(both.at880 > both.at220 + 30 && both.at880 > both.at1760 + 30, `an octave up: ${JSON.stringify(both)}`);
    await page.click('#stopBtn');

    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#exportPageBtn')]);
    const htmlPath = join(SHOTS, 'sound-test.html');
    await download.saveAs(htmlPath);
    await project(page, (x) => window.polybasicPlayground.getStore().remove(x), id);
    noConsoleErrors(page);
    await page.close();

    const game = await browser.newPage({ viewport: { width: 800, height: 600 } });
    const problems = [];
    game.on('pageerror', (e) => problems.push(e.message));
    game.on('console', (m) =>
    {
      if (m.type() === 'error') problems.push(m.text());
    });
    await game.route('**/*', (route) =>
    {
      const u = route.request().url();
      if (u.startsWith('file:') || u.startsWith('blob:') || u.startsWith('data:')) return route.continue();
      problems.push(`fetched ${u}`);
      return route.abort();
    });
    await game.goto(`file://${htmlPath}`);
    await game.waitForFunction(() => window.polybasicPage && window.polybasicPage.engine && window.polybasicPage.engine.frames > 30, null, { timeout: 30000 });
    await game.mouse.click(400, 300);
    const level = await audioLevels(game, 500, 'page');
    assert(level.state === 'running' && level.left > 0.02, `exported page: ${JSON.stringify(level)}`);
    assert(problems.length === 0, problems.join('\n'));
    await game.close();
  });

  await check('sound: Sound Lab answers the keys with sound, and draws the song as it plays', async () =>
  {
    const page = await openPage(browser, `${base}/web/#p=sound-lab`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId() === 'sound-lab', null, { timeout: 20000 });
    await page.waitForFunction(() => document.getElementById('status').textContent === 'Running', null, { timeout: 20000 });
    const box = await page.locator('.polybasic-screen canvas').first().boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(600);
    const music = await audioLevels(page, 400);
    assert(music.state === 'running' && music.stats.notes > 0 && music.left > 0.005, `music: ${JSON.stringify(music)}`);
    const playedBefore = music.stats.played;
    await page.keyboard.press('Digit3');
    await page.waitForTimeout(100);
    const boom = await audioLevels(page, 300);
    assert(boom.stats.played > playedBefore, `the key played nothing: ${JSON.stringify(boom.stats)}`);
    assert(boom.left > music.left, `the explosion is not louder than the music alone: ${boom.left} vs ${music.left}`);
    const shown = await page.evaluate(`(${canvasStats})(window.polybasicPlayground.getScreen().overlayCanvas)`);
    await page.screenshot({ path: join(SHOTS, 'sound-lab.png') });
    assert(shown.colours > 3, 'nothing drawn on the 2D layer');
    await page.click('#stopBtn');
    noConsoleErrors(page);
    await page.close();
  });

  await check('the site root leads to the playground', async () =>
  {
    const page = await openPage(browser, `${base}/`, { width: 1400, height: 850 });
    await page.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId(), null, { timeout: 20000 });
    assert(new URL(page.url()).pathname === '/web/', page.url());
    noConsoleErrors(page);
    await page.close();
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
