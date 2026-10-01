// The trailer's still cards, drawn as web pages and saved as PNG:
// title, code (a program next to the JavaScript the compiler really makes
// of it), playground (the real playground, with an example open) and close.

import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../../src/index.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

const CSS = `
  :root { --bg1: #070b14; --bg2: #14213d; --teal: #19b5a5; --violet: #8a5cf0; --ink: #eef3fb; --dim: #8fa3c0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1280px; height: 720px; overflow: hidden; }
  body { background: radial-gradient(1200px 700px at 20% 10%, var(--bg2), var(--bg1)); color: var(--ink);
         font-family: "Inter", "DejaVu Sans", system-ui, sans-serif; display: flex; align-items: center; justify-content: center; }
  .mono { font-family: "JetBrains Mono", "DejaVu Sans Mono", ui-monospace, monospace; }
  .mark { background: linear-gradient(90deg, var(--teal), var(--violet)); -webkit-background-clip: text; background-clip: text; color: transparent; }
`;

const page = (body, extra = '') => `<!doctype html><meta charset="utf-8"><style>${CSS}${extra}</style><body>${body}</body>`;

const SNIPPET = `Graphics3D 800, 600

Global cube

camera = CreateCamera()
PositionEntity camera, 0, 0, -5
cube = CreateCube()

Function Update()
  TurnEntity cube, 0, 1, 0
  If KeyDown(KEY_SPACE)
    ScaleEntity cube, 2, 2, 2
  EndIf
End Function`;

const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The generated module's `create` function, without the long line that picks
// the commands out of the runtime (marked as cut).
function generated()
{
  const js = compile(SNIPPET, { file: 'cube.pb' }).js;
  const lines = js.split('\n');
  const start = lines.findIndex((l) => l.startsWith('export function create'));
  const end = lines.findIndex((l, i) => i > start && l === '}');
  const body = lines.slice(start + 2, end).filter((l) => l.trim() !== '');
  const cut = body.findIndex((l) => l.includes('$rt.commands'));
  const shown = body.map((l, i) => (i === cut ? '  const { createcamera, ... } = $rt.commands; // cut' : l));
  return [lines[start], ...shown, '}'].join('\n').replace(/\bc_|\bg_|\bl_|\bfn_/g, '');
}

const CARDS = {
  title: () => page(`
    <div style="text-align:center">
      <div class="mark" style="font-size:150px;font-weight:800;letter-spacing:-3px;line-height:1">PolyBasic</div>
      <div style="font-size:38px;color:var(--dim);margin-top:26px">A friendly BASIC for making 3D games.</div>
      <div class="mono" style="font-size:26px;margin-top:46px;color:var(--teal)">BASIC &#8594; JavaScript &#8594; WebGL</div>
    </div>`),

  code: () => page(`
    <div style="width:1200px">
      <div style="font-size:30px;color:var(--dim);margin-bottom:22px;text-align:center">What you write, and what the compiler makes of it</div>
      <div style="display:flex;gap:20px;align-items:stretch">
        <div style="flex:0 0 440px;min-width:0;background:#0d1626;border:1px solid #223253;border-radius:14px;padding:22px 24px">
          <div style="color:var(--teal);font-size:20px;margin-bottom:12px">cube.pb</div>
          <pre class="mono" style="margin:0;font-size:19px;line-height:1.5">${escape(SNIPPET)}</pre>
        </div>
        <div style="flex:1;min-width:0;background:#0d1626;border:1px solid #223253;border-radius:14px;padding:22px 24px">
          <div style="color:var(--violet);font-size:20px;margin-bottom:12px">JavaScript, as generated (excerpt)</div>
          <pre class="mono" style="margin:0;font-size:16px;line-height:1.45">${escape(generated())}</pre>
          <div style="color:var(--dim);font-size:15px;margin-top:14px">Excerpt: the compiler's name prefixes (c_, g_, l_, fn_) are left out here, to read.</div>
        </div>
      </div>
    </div>`),

  close: () => page(`
    <div style="text-align:center">
      <div class="mark" style="font-size:120px;font-weight:800;letter-spacing:-2px;line-height:1">PolyBasic</div>
      <div style="font-size:40px;margin-top:30px">Open the playground. Make a game.</div>
      <div class="mono" style="font-size:26px;margin-top:40px;color:var(--dim)">github.com/akadjoker/polybasic</div>
    </div>`)
};

// Renders the cards that are web pages, and the playground, into outDir.
export async function renderCards({ browser, base, outDir })
{
  await mkdir(outDir, { recursive: true });
  const page1 = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  for (const [name, html] of Object.entries(CARDS))
  {
    await page1.setContent(html(), { waitUntil: 'load' });
    await page1.screenshot({ path: join(outDir, `${name}.png`) });
  }
  await page1.close();

  const pg = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  await pg.goto(`${base}/web/index.html`);
  await pg.waitForFunction(() => window.polybasicPlayground && window.polybasicPlayground.getProgramId(), null, { timeout: 30000 });
  await pg.evaluate(() => window.polybasicPlayground.openProgram('skinning'));
  await pg.waitForFunction(() => { const s = window.polybasicPlayground.getSession(); return s && s.engine.frames > 20; }, null, { timeout: 30000 });
  await pg.waitForTimeout(800);
  await pg.screenshot({ path: join(outDir, 'playground.png') });
  await pg.close();
}

export async function cardSource()
{
  return readFile(join(ROOT, 'tools/trailer/cards.mjs'), 'utf8');
}
