// The engine ties the scene, the render backend, the 2D overlay and input
// together and plugs into the runner's frame loop:
//
//   before main:        prepare() loads what the program needs (physics)
//   when it stops:      stop() releases the physics world and silences the sound
//   after main:         whenReady() waits for the files main started loading
//   every Update step:  input.sample()  ->  Update()  ->  endStep() (animations, physics, collisions, 3D sound, trails)
//   every frame:        world matrices + backend.render()  ->  Draw() on the overlay
//
// It is platform-neutral. src/engine/browser.js builds one with the three.js
// backend, Web Audio, a canvas overlay and DOM input; in Node the defaults
// (null backends, null overlay, no input events) run the same programs
// headless.

import { World } from './scene/world.js';
import { NullBackend } from './render/null/null-backend.js';
import { NullOverlay } from './overlay/overlay.js';
import { Input } from './input/input.js';
import { createEngineCommands } from './commands.js';
import { Collisions } from './collide/collisions.js';
import { Physics } from './physics/physics.js';
import { decodeImage } from './image/decode.js';
import { Models } from './model/model.js';
import { Md2Models } from './model/md2-commands.js';
import { PHYSICS_KEYS } from './physics/commands.js';
import { Audio } from './audio/audio.js';
import { NullAudio } from './audio/null/null-audio.js';
import { STEP_MS } from '../runtime/runtime.js';

export const DEFAULT_WIDTH = 800;
export const DEFAULT_HEIGHT = 600;

export class Engine
{
  // options:
  //   backend    a RenderBackend (default: NullBackend)
  //   audio      an AudioBackend (default: NullAudio)
  //   overlay    the 2D layer (default: NullOverlay)
  //   input      an Input (default: a fresh one, fed by nobody)
  //   loadImage  (url) => Promise<image>, used by LoadTexture
  //   loadFile   (url) => Promise<ArrayBuffer | Uint8Array>, used by
  //              LoadMesh, LoadSound and PlayMusic (and, without loadImage,
  //              to check that a texture file exists)
  //   decodeImage (bytes, mimeType) => Promise<image>, for images stored
  //              inside a model file
  //   loadPhysics () => Promise<PhysicsBackend>, a ready physics backend
  //              (see physics/backend.js); without it the physics
  //              commands report that physics is not available
  //   baseUrl    file paths are relative to this (the .pb's URL)
  //   onResize   (width, height) => void, called by Graphics3D so the
  //              platform can lay out its canvases
  constructor(options = {})
  {
    this.world = new World();
    this.collisions = new Collisions(this.world);
    this.physics = new Physics(this.world, options.loadPhysics || null, (text) => this.warn(text));
    this.models = new Models(this);
    this.md2Models = new Md2Models(this);
    this.steps = 0;
    this.audio = new Audio(this, options.audio || new NullAudio());
    this.trails = [];
    this.backend = options.backend || new NullBackend();
    this.overlay = options.overlay || new NullOverlay();
    this.input = options.input || new Input();
    this.loadImage = options.loadImage || null;
    this.loadFile = options.loadFile || null;
    this.decodeImage = options.decodeImage || null;
    this.pending = new Set();
    this.terrains = [];
    // Heightmaps named in quotes in the program, read before main runs:
    // url -> { image } or { error }.
    this.heightmaps = new Map();
    this.baseUrl = options.baseUrl || '';
    this.onResize = options.onResize || ((w, h) => this.backend.resize(w, h, 1));
    this.width = DEFAULT_WIDTH;
    this.height = DEFAULT_HEIGHT;
    this.graphicsSet = false;
    this.style = { color: [255, 255, 255], fontSize: 16 };
    this.meshes = new Map();
    this.frames = 0;
    this.fps = 0;
    this.frameTimes = [];
    this.now = () => 0;
    this.warn = () => {};
    // The platform initialises a real backend once; the default null
    // backend is ours to set up.
    if (!options.backend) this.backend.init(null);
    this.backend.reset();
    this.onResize(this.width, this.height);
  }

  // Called by the runner with the runtime, to install the commands.
  commands(rt)
  {
    this.now = () => rt.host.now();
    this.warn = (text) => rt.host.debug(text);
    return createEngineCommands(this, rt);
  }

  setGraphics(width, height)
  {
    this.width = width;
    this.height = height;
    this.graphicsSet = true;
    this.onResize(width, height);
  }

  // Creating the first visible thing without Graphics3D opens the default
  // screen, so small programs can skip the setup line.
  autoGraphics()
  {
    this.graphicsSet = true;
  }

  // Built-in shapes of the same kind share one MeshData: a thousand cubes
  // are one geometry on the GPU.
  sharedMesh(key, make)
  {
    let mesh = this.meshes.get(key);
    if (!mesh)
    {
      mesh = make();
      this.meshes.set(key, mesh);
    }
    return mesh;
  }

  // Keeps track of a load in progress, so whenReady can wait for it.
  track(promise)
  {
    const p = Promise.resolve(promise).catch(() => {}).finally(() => this.pending.delete(p));
    this.pending.add(p);
    return promise;
  }

  // Returns the texture at once; its image arrives later. Until then the
  // entities using it are drawn with their plain colour.
  loadTexture(file)
  {
    const t = this.world.createTexture(0, 0);
    t.url = resolveUrl(this.baseUrl, file);
    const done = (image) =>
    {
      if (image)
      {
        t.image = image;
        t.width = image.width;
        t.height = image.height;
      }
      t.loaded = true;
      t.version++;
    };
    const failed = () =>
    {
      t.failed = true;
      this.warn(`LoadTexture: could not load "${file}"`);
    };
    if (this.loadImage) this.track(this.loadImage(t.url).then(done, failed));
    // Headless: nothing to decode, but the file must exist, and the texture
    // behaves as loaded so programs follow the same path everywhere.
    else if (this.loadFile) this.track(this.loadFile(t.url).then(() => done(null), failed));
    else this.track(Promise.resolve().then(() => done(null)));
    return t;
  }

  // Starts loading a glTF model; returns its pivot at once (see
  // model/model.js).
  loadMesh(file, parent)
  {
    return this.models.load(file, resolveUrl(this.baseUrl, file), parent);
  }

  // Sound files, relative to the program like every other file.
  loadSound(file)
  {
    return this.audio.load(file, resolveUrl(this.baseUrl, file));
  }

  playMusic(file, loop)
  {
    return this.audio.playMusic(file, resolveUrl(this.baseUrl, file), loop);
  }

  // ----------------------------------------------------- runner hooks

  // Called before main with the commands the program uses. Returns a
  // promise when something must be loaded first, or null.
  prepare(uses, files = [])
  {
    const jobs = [];
    if (uses.some((name) => PHYSICS_KEYS.has(name))) jobs.push(this.physics.prepare());
    // LoadTerrain must know the heightmap's size at once (programs scale
    // the terrain by TerrainSize right after loading it).
    for (const [command, file] of files)
    {
      if (command === 'loadmesh' && this.loadFile)
      {
        jobs.push(this.models.preload(file, this.resolve(file)));
        continue;
      }
      if (command === 'loadmd2')
      {
        jobs.push(this.md2Models.preload(this.resolve(file)));
        continue;
      }
      if (command !== 'loadterrain' || !this.loadFile) continue;
      const url = resolveUrl(this.baseUrl, file);
      if (this.heightmaps.has(url)) continue;
      this.heightmaps.set(url, null);
      jobs.push(this.loadHeightmap(url).then(
        (image) => this.heightmaps.set(url, { image }),
        (error) => this.heightmaps.set(url, { error })
      ));
    }
    const waiting = jobs.filter(Boolean);
    return waiting.length ? Promise.all(waiting) : null;
  }

  // A file name as the program wrote it, relative to its .pb file.
  resolve(file)
  {
    return resolveUrl(this.baseUrl, file);
  }

  async loadHeightmap(url)
  {
    return decodeImage(await this.loadFile(url));
  }

  // After main: a promise that settles once every file started so far has
  // arrived (or failed), or null when nothing is loading. Loads can start
  // more loads (a model's textures), so it waits until the set is empty.
  whenReady()
  {
    if (this.pending.size === 0) return null;
    const drain = () => (this.pending.size ? Promise.all([...this.pending]).then(drain) : undefined);
    return drain();
  }

  beginStep()
  {
    // Whatever the main body did to positions was setting up, not moving:
    // collisions start from where everything is now.
    if (this.steps++ === 0) this.collisions.resetAll();
    this.input.sample();
  }

  // After each Update: the world moves on by one step. Animations, then
  // physics, then collisions, which see where bodies ended up; then sounds
  // placed in the world follow where everything is now.
  endStep()
  {
    this.updateTerrains();
    this.md2Models.step();
    this.models.step(STEP_MS / 1000);
    this.physics.step(STEP_MS / 1000);
    this.collisions.update();
    this.audio.step();
    this.trails = this.trails.filter((t) => t.entity.alive);
    for (const t of this.trails) t.update(STEP_MS / 1000);
  }

  // The program stopped (for whatever reason): let go of what only a
  // running program needs. The scene stays on screen.
  stop()
  {
    this.physics.dispose();
    this.audio.stopAll();
  }

  updateTerrains()
  {
    this.terrains = this.terrains.filter((e) => e.alive);
    for (const e of this.terrains) e.terrain.update();
  }

  renderFrame()
  {
    this.updateTerrains();
    const frame = this.world.buildFrame(this.width, this.height);
    // Seconds of simulated time, for what moves on its own (grass in the wind).
    frame.time = this.steps * STEP_MS / 1000;
    this.backend.render(frame);
    this.frames++;
    const now = this.now();
    this.frameTimes.push(now);
    while (this.frameTimes.length && this.frameTimes[0] <= now - 1000) this.frameTimes.shift();
    this.fps = this.frameTimes.length;
  }

  beginDraw()
  {
    this.overlay.begin(this.width, this.height);
  }

  endDraw()
  {
    this.overlay.end();
  }

  dispose()
  {
    this.backend.dispose();
  }
}

// A file named by a program, relative to the program's own URL. Full URLs
// (with a scheme) are kept; a path from the root starts at the base's root.
function resolveUrl(base, file)
{
  if (!base || /^[a-z][a-z0-9+.-]*:/i.test(file)) return file;
  try
  {
    return new URL(file, base).href;
  }
  catch
  {
    return file;
  }
}
