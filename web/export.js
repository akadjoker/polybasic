// Projects in and out of the playground: a project as a .zip file (and
// back), and a project as one web page that plays it anywhere, even
// opened straight from the disk.

import { writeZip, readZip } from './zip.js';
import { cleanPath } from './projects.js';

// The file in a project's zip that names the project and its main program.
export const PROJECT_INFO = 'polybasic.json';

// A project as zip bytes: its files at their paths, and PROJECT_INFO.
export async function projectToZip(project, files)
{
  const entries = [{ name: PROJECT_INFO, data: JSON.stringify({ polybasic: 1, name: project.name, main: project.main }, null, 2) + '\n' }];
  for (const path of [...files.keys()].sort())
  {
    if (path !== PROJECT_INFO) entries.push({ name: path, data: files.get(path) });
  }
  return writeZip(entries);
}

// A project from zip bytes: { name, main, files: Map, skipped: [names] }.
// Zips made by hand work too: a single folder around everything is taken
// off, system clutter is left out, and without PROJECT_INFO the main
// program is main.pb or the only .pb file at the top.
export async function projectFromZip(bytes, zipName = 'project.zip')
{
  let entries = (await readZip(bytes)).filter((e) =>
  {
    const parts = e.name.split('/');
    return !parts.includes('__MACOSX') && parts[parts.length - 1] !== '.DS_Store' && parts[parts.length - 1] !== 'Thumbs.db';
  });
  // Everything inside one folder: that folder is the project.
  const tops = new Set(entries.map((e) => e.name.split('/')[0]));
  if (tops.size === 1 && entries.every((e) => e.name.includes('/')))
  {
    const top = [...tops][0] + '/';
    entries = entries.map((e) => ({ ...e, name: e.name.slice(top.length) }));
  }
  let info = {};
  const infoEntry = entries.find((e) => e.name === PROJECT_INFO);
  if (infoEntry)
  {
    try
    {
      info = JSON.parse(new TextDecoder().decode(infoEntry.data));
    }
    catch
    {
      info = {};
    }
  }
  const files = new Map();
  const skipped = [];
  for (const e of entries)
  {
    if (e.name === PROJECT_INFO) continue;
    const path = cleanPath(e.name);
    if (path instanceof Error) skipped.push(e.name);
    else files.set(path, e.data);
  }
  const programs = [...files.keys()].filter((p) => p.toLowerCase().endsWith('.pb'));
  let main = typeof info.main === 'string' && files.has(info.main) ? info.main : null;
  if (!main && files.has('main.pb')) main = 'main.pb';
  if (!main)
  {
    const top = programs.filter((p) => !p.includes('/'));
    if (top.length === 1) main = top[0];
    else if (programs.length === 1) main = programs[0];
  }
  if (!main) throw new Error(programs.length ? 'the zip has several programs and does not say which one is the main one' : 'the zip has no PolyBasic program (.pb file)');
  const name = typeof info.name === 'string' && info.name.trim() ? info.name.trim() : zipName.replace(/\.zip$/i, '') || 'Imported project';
  return { name, main, files, skipped };
}

// ---------------------------------------------------------- web page

// Text for a <script type="application/json"> block: JSON with every "<"
// escaped, so nothing inside (such as "</script>") can end the block.
export function embedJson(value)
{
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function base64(bytes)
{
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(out);
}

function escapeHtml(text)
{
  return String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

// The page's own code: it turns the embedded engine into a module, puts
// the files and the compiled program together and runs it.
const BOOT = `
const data = (id) => JSON.parse(document.getElementById(id).textContent);
const moduleUrl = (source) => URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
const log = document.getElementById('log');
const show = (text) =>
{
  log.textContent = (log.textContent + text).split('\\n').slice(-8).join('\\n');
};
try
{
  const game = data('pb-game');
  const pb = await import(moduleUrl(data('pb-engine')));
  const files = new Map(Object.entries(game.files).map(([path, b64]) =>
  {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return [path, bytes];
  }));
  const physics = document.getElementById('pb-physics');
  const screen = pb.createScreen(document.getElementById('screen'));
  const engine = screen.newEngine({
    baseUrl: pb.PROJECT_SCHEME + '///' + game.main.split('/').map(encodeURIComponent).join('/'),
    files: { read: (path) => files.get(path) || null },
    loadPhysics: physics ? async () => (await import(moduleUrl(data('pb-physics')))).RapierBackend.create() : undefined
  });
  screen.canvas.focus();
  const host = new pb.BrowserHost({ output: show, onError: (text) => show(text + '\\n') });
  window.polybasicPage = { engine, screen, status: 'running' };
  const result = await pb.runProgram(await pb.loadProgram(game.js), host, { engine });
  window.polybasicPage.status = result.status;
}
catch (err)
{
  log.textContent = String(err && err.stack || err);
  window.polybasicPage = { status: 'error' };
}
`;

// One HTML page that plays a project:
//   name, main     the project's name and main program
//   files          Map path -> Uint8Array (every file; the page reads its
//                  models and textures from here)
//   js             the compiled main program (compile(...).js)
//   engine         the text of dist/polybasic.js
//   physics        the text of dist/physics.js, or null when not needed
export function projectPage({ name, main, files, js, engine, physics = null })
{
  const game = { main, js, files: Object.fromEntries([...files].map(([p, b]) => [p, base64(b)])) };
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="generator" content="PolyBasic">
  <title>${escapeHtml(name)}</title>
  <style>
    html, body { margin: 0; height: 100%; background: #05080b; color: #e8f1f8; font-family: system-ui, sans-serif; }
    #screen { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; }
    #log { position: fixed; left: 0; bottom: 0; margin: 0; padding: 6px 10px; font: 12px monospace; white-space: pre-wrap; pointer-events: none; }
  </style>
</head>
<body>
  <!-- ${escapeHtml(name)}: a PolyBasic program with everything it needs in this one page. -->
  <div id="screen"></div>
  <pre id="log"></pre>
  <script type="application/json" id="pb-game">${embedJson(game)}</script>
  <script type="application/json" id="pb-engine">${embedJson(engine)}</script>
${physics ? `  <script type="application/json" id="pb-physics">${embedJson(physics)}</script>\n` : ''}  <script type="module">${BOOT}</script>
</body>
</html>
`;
}
