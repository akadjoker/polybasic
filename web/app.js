// PolyBasic Playground: pick a program, edit it, run it.
//
// The page is static. Programs come from programs/manifest.json and the
// .pb files it points at; edits are kept in localStorage (per program,
// only while they differ from the original); "Share" puts the code,
// compressed, in the URL hash so a link carries it without any server.
// The structure follows the DivJS playground (same author, MIT).

import {
  basicSetup,
  EditorView,
  EditorState,
  keymap,
  Prec,
  indentWithTab,
  oneDarkTheme,
  setDiagnostics
} from './vendor/codemirror.js';
import {
  compile, CompileError, loadProgram, runProgram, BrowserHost, createScreen
} from '../dist/polybasic.js';
import { polybasicLanguage, toDiagnostic } from './polybasic-language.js';

const MANIFEST_URL = 'programs/manifest.json';
// Static hosting caches files; revalidate so a new deploy shows up.
const FETCH_OPTIONS = { cache: 'no-cache' };
const STORAGE_PREFIX = 'polybasic.playground.source.';
const MAX_CONSOLE_LINES = 500;
const STATS_INTERVAL_MS = 500;

const NEW_PROGRAM = {
  id: 'new',
  title: 'New program',
  category: 'yours',
  file: null,
  description: 'Your own program. It is kept in this browser.',
  controls: ''
};

const NEW_PROGRAM_SOURCE = `; My first PolyBasic program
Graphics3D 800, 600

Global cube

camera = CreateCamera()
PositionEntity camera, 0, 1, -4
light = CreateLight()
RotateEntity light, 40, -30, 0

cube = CreateCube()
EntityColor cube, 255, 140, 60

Function Update()
  TurnEntity cube, 0.5, 1, 0
End Function

Function Draw()
  Text 10, 10, "Edit me and press Run (Ctrl+Enter)"
End Function
`;

const el = {
  runBtn: document.getElementById('runBtn'),
  stopBtn: document.getElementById('stopBtn'),
  resetBtn: document.getElementById('resetBtn'),
  shareBtn: document.getElementById('shareBtn'),
  newBtn: document.getElementById('newBtn'),
  programList: document.getElementById('programList'),
  title: document.getElementById('programTitle'),
  description: document.getElementById('programDescription'),
  controls: document.getElementById('programControls'),
  editor: document.getElementById('editor'),
  screen: document.getElementById('screen'),
  status: document.getElementById('status'),
  stats: document.getElementById('stats'),
  console: document.getElementById('console'),
  toast: document.getElementById('toast'),
  fullscreenBtn: document.getElementById('fullscreenBtn')
};

let manifest = { programs: [], categories: [] };
let current = null;          // the open program's manifest entry
let originalSource = '';     // its unedited source
let view = null;             // the CodeMirror EditorView
let screen = null;           // the PolyBasic screen (canvases + input)
let session = null;          // the running program: { controller, engine, done }
let settingDoc = false;      // true while the page replaces the document itself
let sharedUnsaved = false;   // shared code on screen, not saved until the user edits it
let saveTimer = 0;
const sourceCache = new Map();

// ── Storage (may be unavailable: private windows, blocked site data) ────

function storageGet(id)
{
  try
  {
    return window.localStorage.getItem(STORAGE_PREFIX + id);
  }
  catch
  {
    return null;
  }
}

function storageSet(id, text)
{
  try
  {
    window.localStorage.setItem(STORAGE_PREFIX + id, text);
  }
  catch
  {
    // Not saved; the page keeps working.
  }
}

function storageRemove(id)
{
  try
  {
    window.localStorage.removeItem(STORAGE_PREFIX + id);
  }
  catch
  {
    // Nothing to remove.
  }
}

// ── Share links: deflate-raw + base64url in the URL hash ────────────────

function bytesToBase64Url(bytes)
{
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text)
{
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function transform(bytes, stream)
{
  const piped = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}

async function encodeSource(text)
{
  return bytesToBase64Url(await transform(new TextEncoder().encode(text), new CompressionStream('deflate-raw')));
}

async function decodeSource(encoded)
{
  return new TextDecoder().decode(await transform(base64UrlToBytes(encoded), new DecompressionStream('deflate-raw')));
}

function parseHash()
{
  const params = new URLSearchParams(window.location.hash.slice(1));
  return { programId: params.get('p'), code: params.get('code') };
}

function setHash(programId)
{
  const hash = `#p=${encodeURIComponent(programId)}`;
  if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
}

// ── Console, status, toast ──────────────────────────────────────────────

let openLine = null;         // the console line Write is still adding to

function logLine(text, kind = '')
{
  openLine = null;
  const line = document.createElement('div');
  if (kind) line.className = kind;
  line.textContent = text;
  el.console.appendChild(line);
  while (el.console.childElementCount > MAX_CONSOLE_LINES) el.console.firstElementChild.remove();
  el.console.scrollTop = el.console.scrollHeight;
  return line;
}

// Print/Write output: text arrives in pieces; a line ends at "\n".
function logOutput(text)
{
  const parts = text.split('\n');
  parts.forEach((part, i) =>
  {
    if (i > 0) openLine = null;
    if (part === '' && i === parts.length - 1) return;
    if (!openLine)
    {
      openLine = logLine('');
    }
    openLine.textContent += part;
  });
  if (text.endsWith('\n')) openLine = null;
  el.console.scrollTop = el.console.scrollHeight;
}

// An error line whose location jumps to the code when clicked.
function logErrorAt(prefix, message, line, column, kind = 'error')
{
  const entry = logLine('', kind);
  entry.append(`${prefix}: ${message} `);
  if (Number.isInteger(line) && line > 0)
  {
    const link = document.createElement('a');
    link.textContent = column ? `(line ${line}, column ${column})` : `(line ${line})`;
    link.addEventListener('click', () => jumpTo(line, column));
    entry.append(link);
  }
}

function clearConsole()
{
  el.console.textContent = '';
  openLine = null;
}

function setStatus(text, kind = '')
{
  el.status.textContent = text;
  el.status.className = kind;
}

let toastTimer = 0;
function toast(text)
{
  el.toast.textContent = text;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() =>
  {
    el.toast.hidden = true;
  }, 2500);
}

// ── Editor ──────────────────────────────────────────────────────────────

function fileName()
{
  return current && current.file ? current.file.split('/').pop() : 'main.pb';
}

function createEditor()
{
  view = new EditorView({
    parent: el.editor,
    state: EditorState.create({
      doc: '',
      extensions: [
        basicSetup,
        // Above basicSetup's own Mod-Enter (insert blank line).
        Prec.highest(keymap.of([
          { key: 'Mod-Enter', run: () => { run(); return true; } },
          { key: 'Mod-s', run: () => { saveNow(); toast('Saved in this browser'); return true; } }
        ])),
        keymap.of([indentWithTab]),
        oneDarkTheme,
        polybasicLanguage(fileName),
        EditorView.updateListener.of((update) =>
        {
          if (update.docChanged && !settingDoc)
          {
            sharedUnsaved = false;
            scheduleSave();
          }
        })
      ]
    })
  });
}

function setEditorText(text)
{
  settingDoc = true;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  view.dispatch(setDiagnostics(view.state, []));
  settingDoc = false;
}

function jumpTo(line, col)
{
  const doc = view.state.doc;
  if (line < 1 || line > doc.lines) return;
  const info = doc.line(line);
  const pos = Math.min(info.from + Math.max(0, (col || 1) - 1), info.to);
  view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  view.focus();
}

function currentText()
{
  return view.state.doc.toString();
}

// ── Saving edits ────────────────────────────────────────────────────────

function saveNow()
{
  clearTimeout(saveTimer);
  // Shared code only replaces the saved edits once the user changes it.
  if (!current || sharedUnsaved) return;
  const text = currentText();
  if (text === originalSource) storageRemove(current.id);
  else storageSet(current.id, text);
  updateEditedState();
}

function scheduleSave()
{
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
  updateEditedState();
}

function isEdited(id)
{
  return storageGet(id) !== null;
}

function updateEditedState()
{
  const edited = Boolean(current) && currentText() !== originalSource;
  el.resetBtn.disabled = !edited;
  for (const button of el.programList.querySelectorAll('button[data-id]'))
  {
    const mark = button.querySelector('.edited');
    mark.hidden = !(button.dataset.id === current?.id ? edited : isEdited(button.dataset.id));
  }
}

// ── Program list ────────────────────────────────────────────────────────

function allPrograms()
{
  return [NEW_PROGRAM, ...manifest.programs];
}

function renderProgramList()
{
  el.programList.textContent = '';
  const categories = [{ id: 'yours', title: 'Yours' }, ...manifest.categories];
  for (const category of categories)
  {
    const entries = allPrograms().filter((p) => p.category === category.id);
    if (category.id === 'yours' && !isEdited(NEW_PROGRAM.id) && current?.id !== NEW_PROGRAM.id) continue;
    if (entries.length === 0) continue;
    const heading = document.createElement('h3');
    heading.textContent = category.title;
    el.programList.appendChild(heading);
    for (const entry of entries)
    {
      const button = document.createElement('button');
      button.dataset.id = entry.id;
      button.append(entry.title);
      const mark = document.createElement('span');
      mark.className = 'edited';
      mark.textContent = 'edited';
      mark.hidden = true;
      button.append(mark);
      button.addEventListener('click', () => openProgram(entry));
      el.programList.appendChild(button);
    }
  }
  for (const button of el.programList.querySelectorAll('button[data-id]'))
  {
    button.setAttribute('aria-current', String(button.dataset.id === current?.id));
  }
  updateEditedState();
}

async function fetchOriginal(entry)
{
  if (!entry.file) return NEW_PROGRAM_SOURCE;
  if (!sourceCache.has(entry.id))
  {
    const response = await fetch(entry.file, FETCH_OPTIONS);
    if (!response.ok) throw new Error(`Could not load ${entry.file} (${response.status})`);
    sourceCache.set(entry.id, await response.text());
  }
  return sourceCache.get(entry.id);
}

// Open a program. `sharedSource` is code from a share link: it replaces the
// editor text (and becomes the saved edit once the user changes it) but
// never silently overwrites edits already saved for that program.
async function openProgram(entry, { sharedSource = null } = {})
{
  saveNow();
  stop();
  current = entry;
  try
  {
    originalSource = await fetchOriginal(entry);
  }
  catch (err)
  {
    logLine(String(err.message || err), 'error');
    return;
  }
  const saved = storageGet(entry.id);
  let text = saved ?? originalSource;
  let notice = '';
  if (sharedSource !== null)
  {
    if (saved !== null && saved !== sharedSource)
    {
      notice = 'Opened shared code. Your saved edits for this program are kept until you change this code.';
    }
    text = sharedSource;
  }
  setEditorText(text);
  sharedUnsaved = sharedSource !== null && text !== saved;
  el.title.textContent = entry.title;
  el.description.textContent = entry.description || '';
  el.controls.textContent = entry.controls || '';
  document.title = `${entry.title} - PolyBasic Playground`;
  setHash(entry.id);
  renderProgramList();
  await run();
  if (notice) logLine(notice, 'warn');
}

// ── Running ─────────────────────────────────────────────────────────────

async function run()
{
  if (!current) return;
  saveNow();
  stop();
  clearConsole();
  view.dispatch(setDiagnostics(view.state, []));

  let compiled;
  try
  {
    compiled = compile(currentText(), { file: fileName() });
  }
  catch (err)
  {
    if (!(err instanceof CompileError)) throw err;
    view.dispatch(setDiagnostics(view.state, [toDiagnostic(err, view.state.doc)]));
    logErrorAt('Compile error', err.message, err.line, err.column);
    setStatus('Compile error', 'error');
    el.stats.textContent = '';
    // Nothing ran: do not leave the previous program's picture on screen
    // as if it were this code's.
    screen.clear();
    return;
  }
  for (const w of compiled.warnings) logErrorAt('Warning', w.message, w.line, w.column, 'warn');

  const module = await loadProgram(compiled.js);
  const baseUrl = current.file ? new URL(current.file, window.location.href).href : window.location.href;
  const engine = screen.newEngine({ baseUrl });
  const controller = new AbortController();
  const host = new BrowserHost({ output: logOutput, onError: () => {} });
  const me = { controller, engine, done: null };
  session = me;
  setStatus('Running', 'running');
  el.stopBtn.disabled = false;
  screen.canvas.focus({ preventScroll: true });
  me.done = runProgram(module, host, { engine, signal: controller.signal }).then((result) =>
  {
    if (session !== me) return result;
    el.stopBtn.disabled = true;
    if (result.status === 'error')
    {
      const e = result.error;
      const here = e.file === fileName();
      logErrorAt('Runtime error', e.file && !here ? `${e.message} (in ${e.file})` : e.message, here ? e.line : null);
      setStatus('Stopped by an error', 'error');
    }
    else if (result.status === 'ended') setStatus('Finished (End)');
    else if (result.status === 'finished') setStatus('Finished');
    else setStatus('Stopped');
    return result;
  });
}

function stop()
{
  if (session)
  {
    session.controller.abort();
    session = null;
  }
  setStatus('Stopped');
  el.stopBtn.disabled = true;
}

function updateStats()
{
  if (session && session.engine) el.stats.textContent = `${session.engine.fps} fps · ${session.engine.world.entities.length} entities`;
}

// ── Full screen ─────────────────────────────────────────────────────────

function isFullscreen()
{
  return document.fullscreenElement === el.screen || el.screen.classList.contains('screen-max');
}

async function toggleFullscreen()
{
  if (isFullscreen())
  {
    if (document.fullscreenElement) await document.exitFullscreen();
    el.screen.classList.remove('screen-max');
  }
  else if (el.screen.requestFullscreen)
  {
    try
    {
      await el.screen.requestFullscreen();
    }
    catch
    {
      el.screen.classList.add('screen-max');
    }
  }
  else el.screen.classList.add('screen-max');
  updateFullscreenButton();
  screen.canvas.focus({ preventScroll: true });
}

function updateFullscreenButton()
{
  el.fullscreenBtn.textContent = isFullscreen() ? '✕ Leave full screen' : '⛶ Full screen';
  screen.fit();
}

// ── Actions ─────────────────────────────────────────────────────────────

async function buildShareUrl()
{
  saveNow();
  const encoded = await encodeSource(currentText());
  return `${window.location.origin}${window.location.pathname}#p=${encodeURIComponent(current.id)}&code=${encoded}`;
}

async function share()
{
  const url = await buildShareUrl();
  window.polybasicPlayground.lastShareUrl = url;
  try
  {
    await navigator.clipboard.writeText(url);
    toast('Link copied');
  }
  catch
  {
    window.prompt('Copy this link:', url);
  }
  if (url.length > 8000) logLine(`This link is ${url.length} characters long; some apps may cut long links.`, 'warn');
}

function reset()
{
  if (!current || currentText() === originalSource) return;
  if (!window.confirm(`Discard your edits to "${current.title}"?`)) return;
  storageRemove(current.id);
  sharedUnsaved = false;
  setEditorText(originalSource);
  updateEditedState();
  run();
}

async function openFromHash()
{
  const { programId, code } = parseHash();
  const entry = allPrograms().find((p) => p.id === programId) || manifest.programs[0];
  if (code)
  {
    try
    {
      await openProgram(entry, { sharedSource: await decodeSource(code) });
      return;
    }
    catch
    {
      logLine('The shared code in this link could not be read.', 'error');
    }
  }
  await openProgram(entry);
}

async function init()
{
  el.stopBtn.disabled = true;
  el.resetBtn.disabled = true;
  screen = createScreen(el.screen);
  try
  {
    manifest = await (await fetch(MANIFEST_URL, FETCH_OPTIONS)).json();
  }
  catch (err)
  {
    el.title.textContent = 'Could not load the program list';
    logLine(String(err.message || err), 'error');
    return;
  }
  createEditor();

  el.runBtn.addEventListener('click', run);
  el.stopBtn.addEventListener('click', stop);
  el.resetBtn.addEventListener('click', reset);
  el.shareBtn.addEventListener('click', share);
  el.newBtn.addEventListener('click', () => openProgram(NEW_PROGRAM));
  el.fullscreenBtn.addEventListener('click', toggleFullscreen);
  document.addEventListener('fullscreenchange', updateFullscreenButton);
  window.addEventListener('keydown', (event) =>
  {
    if (event.key === 'Escape' && el.screen.classList.contains('screen-max'))
    {
      el.screen.classList.remove('screen-max');
      updateFullscreenButton();
    }
  });
  screen.canvas.addEventListener('pointerdown', () => screen.canvas.focus({ preventScroll: true }));
  window.addEventListener('beforeunload', saveNow);
  window.addEventListener('hashchange', () =>
  {
    const { programId, code } = parseHash();
    if (code || programId !== current?.id) openFromHash();
  });
  setInterval(updateStats, STATS_INTERVAL_MS);

  await openFromHash();
}

// For debugging from the browser console, and for the browser tests.
window.polybasicPlayground = {
  getProgramId: () => current?.id ?? null,
  getSession: () => session,
  getScreen: () => screen,
  getText: () => currentText(),
  setText: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
  openProgram: (id) => openProgram(allPrograms().find((p) => p.id === id)),
  run: () => run(),
  buildShareUrl: () => buildShareUrl(),
  lastShareUrl: null
};

init();
