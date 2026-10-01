// Frame capture for the trailer: serves the repository, opens a program in
// tools/trailer/capture.html and saves one image per video frame, with the
// program's clock moved by hand (see capture.html).
//
//   node tools/trailer/capture.mjs <program.pb> <out-dir> <frames> [fps] [size]
//
// Keys can be pressed on given frames by a scene file (see trailer.mjs).

import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.md2': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.pb': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.bmp': 'image/bmp',
  '.wav': 'audio/wav'
};

export function serve()
{
  const server = http.createServer(async (req, res) =>
  {
    try
    {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const bytes = await readFile(join(ROOT, path));
      res.writeHead(200, { 'content-type': TYPES[extname(path)] || 'application/octet-stream' });
      res.end(bytes);
    }
    catch
    {
      res.writeHead(404);
      res.end();
    }
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

// Runs `program` for `frames` video frames, calling onFrame(page, index)
// before each one is drawn (to press keys or move the mouse) and saving
// each as <outDir>/<index>.jpg. Returns the program's output.
export async function capture({ base, browser, program, outDir, frames, fps = 30, size = '1280x720', onFrame = null, start = 0 })
{
  const [w, h] = size.split('x').map(Number);
  await mkdir(outDir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const problems = [];
  page.on('pageerror', (e) => problems.push(e.message));
  await page.goto(`${base}/tools/trailer/capture.html?src=${encodeURIComponent(`../../${program}`)}&size=${size}`);
  await page.waitForFunction(() => window.cap && window.cap.ready, null, { timeout: 60000 });
  const error = await page.evaluate(() => window.cap.error);
  if (error) throw new Error(`${program}: ${error}`);
  for (let i = 0; i < frames; i++)
  {
    if (onFrame) await onFrame(page, i);
    await page.evaluate((ms) => window.cap.advance(ms), 1000 / fps);
    await page.screenshot({ path: join(outDir, `${String(start + i).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
  }
  const output = await page.evaluate(() => window.cap.output);
  const late = await page.evaluate(() => window.cap.error);
  await page.close();
  if (late) throw new Error(`${program}: ${late}`);
  if (problems.length) throw new Error(`${program}: ${problems.join('; ')}`);
  return output;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
  const [program, outDir, frames, fps, size] = process.argv.slice(2);
  if (!program || !outDir || !frames)
  {
    console.error('usage: node tools/trailer/capture.mjs <program.pb> <out-dir> <frames> [fps] [size]');
    process.exit(1);
  }
  const { server, base } = await serve();
  const browser = await chromium.launch();
  try
  {
    await capture({ base, browser, program, outDir, frames: Number(frames), fps: Number(fps) || 30, size: size || '1280x720' });
    console.log(`${frames} frames in ${outDir}`);
  }
  finally
  {
    await browser.close();
    server.close();
  }
}
