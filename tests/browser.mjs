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
//   - the playground: every example runs, an edit changes the picture, a
//     compile error is marked at its line, a share link brings the code back;
//   - no console errors anywhere.
// Screenshots go to tests/output/.

import http from 'node:http';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../src/index.js';
import { nodeEngineOptions } from '../src/node.js';
import { projectPoint } from '../src/engine/collide/camera.js';

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
      else
      {
        await playground.waitForFunction(() => document.getElementById('console').textContent.trim().length > 0, null, { timeout: 10000 });
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
