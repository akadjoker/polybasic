// PolyBasic Playground: pick an example or one of your projects, edit it,
// run it.
//
// The page is static. Examples come from programs/manifest.json and the
// .pb files it points at; edits to an example are kept in localStorage
// (per example, only while they differ from the original), and "Share"
// puts the code, compressed, in the URL hash. Your projects are kept in
// the browser (IndexedDB, see projects.js): several files each (programs,
// images, models), one of them the main program. They go in and out as
// .zip files. The structure follows the DivJS playground (same author,
// MIT).

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
  compile, CompileError, loadProgram, runProgram, BrowserHost, createScreen, PROJECT_SCHEME, PHYSICS_KEYS
} from '../dist/polybasic.js';
import { polybasicLanguage, toDiagnostic } from './polybasic-language.js';
import { ProjectStore, cleanPath } from './projects.js';
import { projectToZip, projectFromZip, projectPage } from './export.js';

const MANIFEST_URL = 'programs/manifest.json';
// Static hosting caches files; revalidate so a new deploy shows up.
const FETCH_OPTIONS = { cache: 'no-cache' };
const STORAGE_PREFIX = 'polybasic.playground.source.';
// Where the single program of earlier versions of the playground was kept.
const OLD_NEW_PROGRAM_KEY = STORAGE_PREFIX + 'new';
const MAX_CONSOLE_LINES = 500;
const STATS_INTERVAL_MS = 500;
const SAVE_DELAY_MS = 400;

// Files edited as text; everything else is an asset (image, model...).
const TEXT_TYPES = new Set(['pb', 'txt', 'md', 'json', 'csv']);
const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
const SOUND_TYPES = { wav: 'audio/wav', ogg: 'audio/ogg', mp3: 'audio/mpeg' };

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
  importBtn: document.getElementById('importBtn'),
  importInput: document.getElementById('importInput'),
  uploadInput: document.getElementById('uploadInput'),
  programList: document.getElementById('programList'),
  title: document.getElementById('programTitle'),
  description: document.getElementById('programDescription'),
  controls: document.getElementById('programControls'),
  infoActions: document.getElementById('infoActions'),
  fileBar: document.getElementById('fileBar'),
  editor: document.getElementById('editor'),
  assetView: document.getElementById('assetView'),
  screen: document.getElementById('screen'),
  status: document.getElementById('status'),
  stats: document.getElementById('stats'),
  console: document.getElementById('console'),
  toast: document.getElementById('toast'),
  fullscreenBtn: document.getElementById('fullscreenBtn')
};

let manifest = { programs: [], categories: [] };
let store = null;            // the ProjectStore
let projects = [];           // the saved projects (records), newest first

// What is open: an example (`current`, its entry in the manifest) or a
// project (`project`, its record, with `files` in memory and `openPath` the
// file in the editor).
let mode = null;             // 'example' | 'project'
let current = null;
let originalSource = '';     // the example's unedited source
let project = null;
let files = new Map();       // path -> Uint8Array
let openPath = null;
const dirty = new Set();     // project files changed since they were saved

let view = null;             // the CodeMirror EditorView
let screen = null;           // the PolyBasic screen (canvases + input)
let session = null;          // the running program: { controller, engine, done }
let settingDoc = false;      // true while the page replaces the document itself
let sharedUnsaved = false;   // shared code on screen, not saved until the user edits it
let saveTimer = 0;
let previewUrl = null;       // object URL of the image shown for an asset
// Bumped by every run() and stop(): a run overtaken while it was still
// loading must not start.
let runToken = 0;
const sourceCache = new Map();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// ── Storage for example edits (may be unavailable) ──────────────────────

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
  return bytesToBase64Url(await transform(encoder.encode(text), new CompressionStream('deflate-raw')));
}

async function decodeSource(encoded)
{
  return decoder.decode(await transform(base64UrlToBytes(encoded), new DecompressionStream('deflate-raw')));
}

function parseHash()
{
  const params = new URLSearchParams(window.location.hash.slice(1));
  return { programId: params.get('p'), projectId: params.get('project'), code: params.get('code') };
}

function setHash(hash)
{
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

// An error line whose location jumps to the code when clicked. In a
// project, `file` names the file it is in (opened on the click).
function logErrorAt(prefix, message, line, column, kind = 'error', file = null)
{
  const entry = logLine('', kind);
  entry.append(`${prefix}: ${message} `);
  if (Number.isInteger(line) && line > 0)
  {
    const link = document.createElement('a');
    const where = column ? `line ${line}, column ${column}` : `line ${line}`;
    link.textContent = file && mode === 'project' ? `(${file}, ${where})` : `(${where})`;
    link.addEventListener('click', async () =>
    {
      if (file && mode === 'project' && file !== openPath) await openFile(file);
      jumpTo(line, column);
    });
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

// ── Files of a project ──────────────────────────────────────────────────

const extensionOf = (path) => (path.includes('.') ? path.split('.').pop().toLowerCase() : '');
const isText = (path) => TEXT_TYPES.has(extensionOf(path));

function textOf(path)
{
  const bytes = files.get(path);
  return bytes ? decoder.decode(bytes) : null;
}

// Include files, read from the project (text files only).
function readProjectFile(path)
{
  const clean = path.replace(/^\/+/, '');
  if (!isText(clean) || !files.has(clean)) throw new Error(`no file ${clean}`);
  return textOf(clean);
}

// The path of `target` as seen from the folder of `from` ("assets/a.png"
// from "main.pb", "../assets/a.png" from "lib/game.pb").
function relativePath(from, target)
{
  const base = from.split('/').slice(0, -1);
  const parts = target.split('/');
  let same = 0;
  while (same < base.length && same < parts.length - 1 && base[same] === parts[same]) same++;
  return [...base.slice(same).map(() => '..'), ...parts.slice(same)].join('/');
}

function formatSize(n)
{
  if (n < 1024) return `${n} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ── Editor ──────────────────────────────────────────────────────────────

// The file being edited, as the compiler names it.
function fileName()
{
  if (mode === 'project') return openPath || 'main.pb';
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
          { key: 'Mod-s', run: () => { saveNow().then(() => toast('Saved in this browser')); return true; } }
        ])),
        keymap.of([indentWithTab]),
        oneDarkTheme,
        polybasicLanguage(() => ({ file: fileName(), readFile: mode === 'project' ? readProjectFile : null })),
        EditorView.updateListener.of((update) =>
        {
          if (!update.docChanged || settingDoc) return;
          sharedUnsaved = false;
          if (mode === 'project' && openPath)
          {
            files.set(openPath, encoder.encode(currentText()));
            dirty.add(openPath);
          }
          scheduleSave();
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

// Shows the editor, or the panel for an asset (a file that is not text).
function showEditor(on)
{
  el.editor.hidden = !on;
  el.assetView.hidden = on;
}

// ── Saving ──────────────────────────────────────────────────────────────

// Saves what is not saved yet: an example's edits in localStorage, a
// project's changed files in the project store.
async function saveNow()
{
  clearTimeout(saveTimer);
  if (mode === 'example')
  {
    // Shared code only replaces the saved edits once the user changes it.
    if (!current || sharedUnsaved) return;
    const text = currentText();
    if (text === originalSource) storageRemove(current.id);
    else storageSet(current.id, text);
    updateEditedState();
    return;
  }
  if (mode === 'project' && project && dirty.size)
  {
    const id = project.id;
    const paths = [...dirty];
    dirty.clear();
    try
    {
      for (const path of paths) await store.writeFile(id, path, files.get(path));
    }
    catch (err)
    {
      for (const path of paths) dirty.add(path);
      logLine(`Could not save: ${err.message}`, 'error');
    }
  }
}

function scheduleSave()
{
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DELAY_MS);
  updateEditedState();
}

function isEdited(id)
{
  return storageGet(id) !== null;
}

function updateEditedState()
{
  const edited = mode === 'example' && Boolean(current) && currentText() !== originalSource;
  el.resetBtn.disabled = !edited;
  for (const button of el.programList.querySelectorAll('button[data-id]'))
  {
    const mark = button.querySelector('.edited');
    mark.hidden = !(mode === 'example' && button.dataset.id === current?.id ? edited : isEdited(button.dataset.id));
  }
}

// ── The side bar: your projects and their files, then the examples ─────

function sideButton(label, onClick)
{
  const button = document.createElement('button');
  button.append(label);
  button.addEventListener('click', onClick);
  return button;
}

function renderProgramList()
{
  el.programList.textContent = '';
  const heading = (text) =>
  {
    const h = document.createElement('h3');
    h.textContent = text;
    el.programList.appendChild(h);
  };

  heading('Your projects');
  if (projects.length === 0)
  {
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'None yet: start one with + New project, or save an example as a project.';
    el.programList.appendChild(hint);
  }
  for (const p of projects)
  {
    const button = sideButton(p.name, () => openProject(p.id));
    button.dataset.project = p.id;
    const isOpen = mode === 'project' && project && project.id === p.id;
    button.setAttribute('aria-current', String(isOpen));
    el.programList.appendChild(button);
    if (isOpen) el.programList.appendChild(renderFiles());
  }

  for (const category of manifest.categories)
  {
    const entries = manifest.programs.filter((e) => e.category === category.id);
    if (entries.length === 0) continue;
    heading(category.title);
    for (const entry of entries)
    {
      const button = sideButton(entry.title, () => openProgram(entry));
      button.dataset.id = entry.id;
      const mark = document.createElement('span');
      mark.className = 'edited';
      mark.textContent = 'edited';
      mark.hidden = true;
      button.append(mark);
      button.setAttribute('aria-current', String(mode === 'example' && entry.id === current?.id));
      el.programList.appendChild(button);
    }
  }
  updateEditedState();
}

// The open project's files as a tree (folders as labels, files under
// them), and buttons to add some.
function renderFiles()
{
  const box = document.createElement('div');
  box.className = 'files';
  const sorted = [...project.paths].sort((a, b) =>
  {
    // Files at the top of the project first, then each folder.
    const da = a.includes('/') ? 1 : 0;
    const db = b.includes('/') ? 1 : 0;
    return da - db || a.localeCompare(b);
  });
  let folder = '';
  for (const path of sorted)
  {
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
    if (dir !== folder)
    {
      folder = dir;
      if (dir)
      {
        const label = document.createElement('div');
        label.className = 'folder';
        label.textContent = dir;
        box.appendChild(label);
      }
    }
    const button = sideButton(path.slice(slash + 1), () => openFile(path));
    if (dir) button.classList.add('in-folder');
    button.dataset.path = path;
    button.title = path === project.main ? `${path}: the main program (Run starts here)` : path;
    button.setAttribute('aria-current', String(path === openPath));
    if (path === project.main)
    {
      const star = document.createElement('span');
      star.className = 'main-mark';
      star.textContent = 'main';
      button.append(star);
    }
    box.appendChild(button);
  }
  const row = document.createElement('div');
  row.className = 'file-actions';
  const add = sideButton('+ File', () => newFile());
  add.className = 'small';
  add.id = 'newFileBtn';
  const upload = sideButton('Upload…', () => el.uploadInput.click());
  upload.className = 'small';
  upload.id = 'uploadBtn';
  upload.title = 'Add images, models or programs to the project';
  row.append(add, upload);
  box.appendChild(row);
  return box;
}

// Buttons under the title: for an example, saving it as a project; for a
// project, what can be done to it and to the open file.
function renderActions()
{
  el.infoActions.textContent = '';
  el.fileBar.textContent = '';
  const button = (id, label, title, onClick, disabled = false) =>
  {
    const b = document.createElement('button');
    b.id = id;
    b.className = 'small';
    b.textContent = label;
    b.title = title;
    b.disabled = disabled;
    b.addEventListener('click', onClick);
    return b;
  };
  if (mode === 'example')
  {
    el.infoActions.append(button('saveAsProjectBtn', 'Save as project', 'Copy this example, with its images and models, into a project of your own', saveAsProject));
    el.fileBar.hidden = true;
    return;
  }
  if (mode !== 'project') return;
  setProjectInfo();
  el.infoActions.append(
    button('renameProjectBtn', 'Rename', 'Rename the project', renameProject),
    button('exportZipBtn', 'Download .zip', 'Download the whole project as a .zip file', () => exportZip()),
    button('exportPageBtn', 'Export page', 'Make one web page that plays the program, to put anywhere', () => exportPage()),
    button('deleteProjectBtn', 'Delete', 'Delete the project from this browser', deleteProject)
  );
  el.fileBar.hidden = false;
  const label = document.createElement('span');
  label.className = 'file-name';
  label.textContent = openPath || '';
  el.fileBar.append(
    label,
    button('mainFileBtn', 'Make main', 'Run starts with this program', () => makeMain(), !openPath || openPath === project.main || extensionOf(openPath) !== 'pb'),
    button('renameFileBtn', 'Rename file', 'Rename or move the file (use / for folders)', () => renameFile(), !openPath),
    button('deleteFileBtn', 'Delete file', 'Delete the file from the project', () => deleteFile(), !openPath || openPath === project.main)
  );
}

function setProjectInfo()
{
  const n = project.paths.length;
  const where = store.persistent ? 'kept in this browser' : 'kept only until this page is closed';
  setInfo(project.name, `Your project: ${n} file${n === 1 ? '' : 's'}, ${where}. Run starts with ${project.main}.`, '');
}

function setInfo(title, description, controls)
{
  el.title.textContent = title;
  el.description.textContent = description || '';
  el.controls.textContent = controls || '';
  document.title = `${title} - PolyBasic Playground`;
}

// ── Examples ────────────────────────────────────────────────────────────

async function fetchOriginal(entry)
{
  if (!sourceCache.has(entry.id))
  {
    const response = await fetch(entry.file, FETCH_OPTIONS);
    if (!response.ok) throw new Error(`Could not load ${entry.file} (${response.status})`);
    sourceCache.set(entry.id, await response.text());
  }
  return sourceCache.get(entry.id);
}

// Open an example. `sharedSource` is code from a share link: it replaces
// the editor text (and becomes the saved edit once the user changes it)
// but never silently overwrites edits already saved for that example.
async function openProgram(entry, { sharedSource = null } = {})
{
  await leave();
  let source;
  try
  {
    source = await fetchOriginal(entry);
  }
  catch (err)
  {
    logLine(String(err.message || err), 'error');
    return;
  }
  mode = 'example';
  current = entry;
  project = null;
  files = new Map();
  openPath = null;
  originalSource = source;
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
  showEditor(true);
  setEditorText(text);
  sharedUnsaved = sharedSource !== null && text !== saved;
  setInfo(entry.title, entry.description, entry.controls);
  el.shareBtn.disabled = false;
  setHash(`#p=${encodeURIComponent(entry.id)}`);
  renderProgramList();
  renderActions();
  await run();
  if (notice) logLine(notice, 'warn');
}

// Saves what is open and stops it, before something else is opened.
async function leave()
{
  await saveNow();
  stop();
}

// ── Projects ────────────────────────────────────────────────────────────

async function refreshProjects()
{
  projects = await store.list();
}

async function openProject(id, { run: runIt = true, path = null } = {})
{
  await leave();
  const record = await store.get(id);
  if (!record)
  {
    logLine('That project is no longer in this browser.', 'error');
    return false;
  }
  mode = 'project';
  project = record;
  current = null;
  files = await store.readAll(id);
  dirty.clear();
  setProjectInfo();
  el.shareBtn.disabled = true;
  setHash(`#project=${encodeURIComponent(id)}`);
  await refreshProjects();
  await openFile(path && files.has(path) ? path : record.main);
  if (runIt) await run();
  return true;
}

// Shows a file of the open project: text in the editor, anything else in
// the asset panel.
async function openFile(path)
{
  await saveNow();
  openPath = path;
  if (isText(path))
  {
    showEditor(true);
    setEditorText(textOf(path) ?? '');
  }
  else showAsset(path);
  renderProgramList();
  renderActions();
}

function showAsset(path)
{
  showEditor(false);
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  const bytes = files.get(path) || new Uint8Array(0);
  const ext = extensionOf(path);
  el.assetView.textContent = '';
  const title = document.createElement('h3');
  title.textContent = path;
  const size = document.createElement('p');
  size.textContent = formatSize(bytes.length);
  el.assetView.append(title, size);
  const from = relativePath(project.main, path);
  let use = null;
  if (IMAGE_TYPES[ext])
  {
    previewUrl = URL.createObjectURL(new Blob([bytes], { type: IMAGE_TYPES[ext] }));
    const img = document.createElement('img');
    img.src = previewUrl;
    img.alt = path;
    el.assetView.appendChild(img);
    use = `tex = LoadTexture("${from}")`;
  }
  else if (SOUND_TYPES[ext])
  {
    previewUrl = URL.createObjectURL(new Blob([bytes], { type: SOUND_TYPES[ext] }));
    const player = document.createElement('audio');
    player.controls = true;
    player.src = previewUrl;
    el.assetView.appendChild(player);
    use = `sound = LoadSound("${from}")`;
  }
  else if (ext === 'glb' || ext === 'gltf') use = `model = LoadMesh("${from}")`;
  else if (ext === 'md2') use = `model = LoadMD2("${from}")`;
  if (use)
  {
    const hint = document.createElement('p');
    hint.textContent = `Use it from ${project.main}:`;
    const code = document.createElement('code');
    code.textContent = use;
    el.assetView.append(hint, code);
  }
}

// A name typed by the user, checked; null when cancelled or wrong.
function askPath(question, suggestion)
{
  const answer = window.prompt(question, suggestion);
  if (answer === null) return null;
  const path = cleanPath(answer);
  if (path instanceof Error)
  {
    toast(`Not a file name: ${path.message}`);
    return null;
  }
  return path;
}

async function newProject(name = null)
{
  const chosen = name ?? window.prompt('Name of the new project:', 'My game');
  if (chosen === null) return null;
  const record = await store.create(chosen.trim() || 'My game', { 'main.pb': NEW_PROGRAM_SOURCE });
  await openProject(record.id);
  return record.id;
}

async function renameProject()
{
  const name = window.prompt('New name of the project:', project.name);
  if (name === null || !name.trim()) return;
  project = await store.update(project.id, (p) =>
  {
    p.name = name.trim();
  });
  await refreshProjects();
  renderProgramList();
  renderActions();
}

async function deleteProject()
{
  if (!window.confirm(`Delete the project "${project.name}" and all its files from this browser?`)) return;
  const id = project.id;
  stop();
  dirty.clear();
  mode = null;
  project = null;
  await store.remove(id);
  await refreshProjects();
  await openProgram(manifest.programs[0]);
  toast('Project deleted');
}

async function newFile()
{
  const path = askPath('Name of the new file (for example enemies.pb or lib/maths.pb):', 'new.pb');
  if (!path) return;
  if (files.has(path))
  {
    toast(`There is already a file ${path}`);
    return;
  }
  const text = extensionOf(path) === 'pb' ? `; ${path}\n` : '';
  await addFiles([{ path, bytes: encoder.encode(text) }]);
  await openFile(path);
}

// Adds (or replaces) files in the open project.
async function addFiles(list)
{
  for (const { path, bytes } of list)
  {
    await store.writeFile(project.id, path, bytes);
    files.set(path, bytes);
  }
  project = await store.get(project.id);
  await refreshProjects();
  renderProgramList();
}

// Files chosen with Upload: programs at the top of the project, the rest
// (images, models) in assets/.
async function uploadFiles(fileList)
{
  const list = [];
  for (const file of fileList)
  {
    const path = cleanPath(extensionOf(file.name) === 'pb' ? file.name : `assets/${file.name}`);
    if (path instanceof Error)
    {
      toast(`Skipped ${file.name}: ${path.message}`);
      continue;
    }
    if (files.has(path) && !window.confirm(`Replace ${path} in the project?`)) continue;
    list.push({ path, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  if (!list.length) return;
  await addFiles(list);
  toast(list.length === 1 ? `Added ${list[0].path}` : `Added ${list.length} files`);
  await openFile(list[0].path);
}

async function renameFile()
{
  const to = askPath('New name (use / for folders):', openPath);
  if (!to || to === openPath) return;
  await saveNow();
  try
  {
    await store.renameFile(project.id, openPath, to);
  }
  catch (err)
  {
    toast(err.message);
    return;
  }
  files.set(to, files.get(openPath));
  files.delete(openPath);
  project = await store.get(project.id);
  await openFile(to);
}

async function deleteFile()
{
  if (!window.confirm(`Delete ${openPath} from the project?`)) return;
  const path = openPath;
  await store.deleteFile(project.id, path);
  files.delete(path);
  dirty.delete(path);
  project = await store.get(project.id);
  await openFile(project.main);
}

async function makeMain()
{
  await store.setMain(project.id, openPath);
  project = await store.get(project.id);
  renderProgramList();
  renderActions();
  toast(`${openPath} is the main program now`);
}

// An example, with its edits and the files it uses (listed in the
// manifest), copied into a new project. Paths stay as they are, so the
// program finds its files where it looked for them before.
async function saveAsProject()
{
  const entry = current;
  const name = window.prompt('Name of the new project:', entry.title);
  if (name === null) return null;
  await saveNow();
  const main = entry.file.split('/').pop();
  const copy = { [main]: currentText() };
  const base = new URL(entry.file, window.location.href);
  try
  {
    for (const asset of entry.assets || [])
    {
      const response = await fetch(new URL(asset, base), FETCH_OPTIONS);
      if (!response.ok) throw new Error(`could not load ${asset} (${response.status})`);
      copy[asset] = new Uint8Array(await response.arrayBuffer());
    }
  }
  catch (err)
  {
    logLine(`Could not copy the example: ${err.message}`, 'error');
    return null;
  }
  const record = await store.create(name.trim() || entry.title, copy, main);
  await openProject(record.id);
  toast('Saved as a project');
  return record.id;
}

// ── Running ─────────────────────────────────────────────────────────────

// Shows a compile error in the editor, in the file it is in.
async function showCompileError(err)
{
  const file = mode === 'project' && err.file && files.has(err.file) ? err.file : null;
  if (file && file !== openPath && isText(file)) await openFile(file);
  if (!file || file === openPath) view.dispatch(setDiagnostics(view.state, [toDiagnostic(err, view.state.doc)]));
  logErrorAt('Compile error', err.message, err.line, err.column, 'error', file);
}

async function run()
{
  if (mode !== 'example' && mode !== 'project') return;
  await saveNow();
  stop();
  clearConsole();
  view.dispatch(setDiagnostics(view.state, []));

  const main = mode === 'project' ? project.main : fileName();
  const source = mode === 'project' ? textOf(project.main) ?? '' : currentText();
  let compiled;
  try
  {
    compiled = compile(source, { file: main, readFile: mode === 'project' ? readProjectFile : undefined });
  }
  catch (err)
  {
    if (!(err instanceof CompileError)) throw err;
    await showCompileError(err);
    setStatus('Compile error', 'error');
    el.stats.textContent = '';
    // Nothing ran: do not leave the previous program's picture on screen
    // as if it were this code's.
    screen.clear();
    return;
  }
  for (const w of compiled.warnings)
  {
    const inProject = mode === 'project' && w.file && files.has(w.file);
    logErrorAt('Warning', w.message, w.line, w.column, 'warn', inProject ? w.file : null);
  }

  const token = runToken;
  const module = await loadProgram(compiled.js);
  if (token !== runToken) return;
  const engine = mode === 'project'
    ? screen.newEngine({
      baseUrl: `${PROJECT_SCHEME}///${main.split('/').map(encodeURIComponent).join('/')}`,
      files: { read: (path) => files.get(path) || null }
    })
    : screen.newEngine({ baseUrl: new URL(current.file, window.location.href).href });
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
      if (mode === 'project')
      {
        const known = e.file && files.has(e.file);
        logErrorAt('Runtime error', known ? e.message : `${e.message}${e.file ? ` (in ${e.file})` : ''}`, known ? e.line : null, null, 'error', known ? e.file : null);
      }
      else
      {
        const here = e.file === fileName();
        logErrorAt('Runtime error', e.file && !here ? `${e.message} (in ${e.file})` : e.message, here ? e.line : null);
      }
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
  runToken++;
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

// ── Export and import ───────────────────────────────────────────────────

// Hands the browser a file to save.
function download(bytes, name, type)
{
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// A file name made from a project name ("My Game!" -> "my-game").
function slug(name)
{
  return name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project';
}

async function exportZip()
{
  await saveNow();
  download(await projectToZip(project, files), `${slug(project.name)}.zip`, 'application/zip');
  toast('Project downloaded as .zip');
}

// One page with the engine, the compiled program and all the project's
// files; the physics engine too when the program uses physics.
async function exportPage()
{
  await saveNow();
  let compiled;
  try
  {
    compiled = compile(textOf(project.main) ?? '', { file: project.main, readFile: readProjectFile });
  }
  catch (err)
  {
    if (!(err instanceof CompileError)) throw err;
    await showCompileError(err);
    toast('Fix the program first: it does not compile');
    return;
  }
  const uses = (await loadProgram(compiled.js)).$uses || [];
  const needsPhysics = uses.some((name) => PHYSICS_KEYS.has(name));
  let engine;
  let physics = null;
  try
  {
    const get = async (url) =>
    {
      const response = await fetch(url, FETCH_OPTIONS);
      if (!response.ok) throw new Error(`${url}: ${response.status}`);
      return response.text();
    };
    engine = await get('../dist/polybasic.js');
    if (needsPhysics) physics = await get('../dist/physics.js');
  }
  catch (err)
  {
    logLine(`Could not export the page: ${err.message}`, 'error');
    return;
  }
  const html = projectPage({ name: project.name, main: project.main, files, js: compiled.js, engine, physics });
  download(encoder.encode(html), `${slug(project.name)}.html`, 'text/html');
  toast(`Page exported (${formatSize(html.length)})`);
}

async function importZip(file)
{
  let imported;
  try
  {
    imported = await projectFromZip(new Uint8Array(await file.arrayBuffer()), file.name);
  }
  catch (err)
  {
    logLine(`Could not import ${file.name}: ${err.message}`, 'error');
    toast('Import failed');
    return null;
  }
  const record = await store.create(imported.name, Object.fromEntries(imported.files), imported.main);
  await openProject(record.id);
  if (imported.skipped.length) logLine(`Left out of the import (not usable file names): ${imported.skipped.join(', ')}`, 'warn');
  toast(`Imported ${imported.name}`);
  return record.id;
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
  await saveNow();
  const encoded = await encodeSource(currentText());
  return `${window.location.origin}${window.location.pathname}#p=${encodeURIComponent(current.id)}&code=${encoded}`;
}

async function share()
{
  if (mode !== 'example') return;
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
  if (mode !== 'example' || currentText() === originalSource) return;
  if (!window.confirm(`Discard your edits to "${current.title}"?`)) return;
  storageRemove(current.id);
  sharedUnsaved = false;
  setEditorText(originalSource);
  updateEditedState();
  run();
}

async function openFromHash()
{
  const { programId, projectId, code } = parseHash();
  if (projectId && await openProject(projectId)) return;
  const entry = manifest.programs.find((p) => p.id === programId) || manifest.programs[0];
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

// Earlier versions kept one program of your own ("New program") in
// localStorage: it becomes a project.
async function migrateOldProgram()
{
  let text = null;
  try
  {
    text = window.localStorage.getItem(OLD_NEW_PROGRAM_KEY);
  }
  catch
  {
    return;
  }
  if (text === null || !store.persistent) return;
  await store.create('My program', { 'main.pb': text });
  storageRemove('new');
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
  store = await ProjectStore.open();
  await migrateOldProgram();
  await refreshProjects();
  createEditor();

  el.runBtn.addEventListener('click', run);
  el.stopBtn.addEventListener('click', stop);
  el.resetBtn.addEventListener('click', reset);
  el.shareBtn.addEventListener('click', share);
  el.newBtn.addEventListener('click', () => newProject());
  el.importBtn.addEventListener('click', () => el.importInput.click());
  el.importInput.addEventListener('change', () =>
  {
    const file = el.importInput.files[0];
    el.importInput.value = '';
    if (file) importZip(file);
  });
  el.uploadInput.addEventListener('change', () =>
  {
    const chosen = [...el.uploadInput.files];
    el.uploadInput.value = '';
    if (chosen.length && mode === 'project') uploadFiles(chosen);
  });
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
  window.addEventListener('beforeunload', () =>
  {
    saveNow();
  });
  window.addEventListener('hashchange', () =>
  {
    const { programId, projectId, code } = parseHash();
    if (code || (projectId && projectId !== project?.id) || (programId && programId !== current?.id)) openFromHash();
  });
  setInterval(updateStats, STATS_INTERVAL_MS);

  await openFromHash();
  if (!store.persistent)
  {
    logLine('This browser does not let the playground keep projects (a private window?): they last until the page is closed. Download them as .zip to keep them.', 'warn');
  }
}

// For debugging from the browser console, and for the browser tests.
window.polybasicPlayground = {
  getProgramId: () => (mode === 'example' ? current?.id ?? null : null),
  getProjectId: () => (mode === 'project' ? project?.id ?? null : null),
  getProject: () => (project ? { ...project } : null),
  getOpenPath: () => openPath,
  getSession: () => session,
  getScreen: () => screen,
  getStore: () => store,
  getText: () => currentText(),
  setText: (text) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }),
  openProgram: (id) => openProgram(manifest.programs.find((p) => p.id === id)),
  openProject: (id) => openProject(id),
  openFile: (path) => openFile(path),
  newProject: (name) => newProject(name),
  // [{ name, bytes }] as if chosen with Upload.
  upload: (list) => uploadFiles(list.map(({ name, bytes }) => new File([bytes], name))),
  importZip: (name, bytes) => importZip(new File([bytes], name)),
  saveNow: () => saveNow(),
  run: () => run(),
  buildShareUrl: () => buildShareUrl(),
  lastShareUrl: null
};

init();
