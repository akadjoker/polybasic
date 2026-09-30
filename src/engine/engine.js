// The engine ties the scene, the render backend, the 2D overlay and input
// together and plugs into the runner's frame loop:
//
//   every Update step:  input.sample()  ->  Update()
//   every frame:        world matrices + backend.render()  ->  Draw() on the overlay
//
// It is platform-neutral. src/engine/browser.js builds one with the three.js
// backend, a canvas overlay and DOM input; in Node the defaults (null
// backend, null overlay, no input events) run the same programs headless.

import { World } from './scene/world.js';
import { NullBackend } from './render/null/null-backend.js';
import { NullOverlay } from './overlay/overlay.js';
import { Input } from './input/input.js';
import { createEngineCommands } from './commands.js';

export const DEFAULT_WIDTH = 800;
export const DEFAULT_HEIGHT = 600;

export class Engine
{
  // options:
  //   backend    a RenderBackend (default: NullBackend)
  //   overlay    the 2D layer (default: NullOverlay)
  //   input      an Input (default: a fresh one, fed by nobody)
  //   loadImage  (url) => Promise<image>, used by LoadTexture
  //   baseUrl    LoadTexture paths are relative to this (the .pb's URL)
  //   onResize   (width, height) => void, called by Graphics3D so the
  //              platform can lay out its canvases
  constructor(options = {})
  {
    this.world = new World();
    this.backend = options.backend || new NullBackend();
    this.overlay = options.overlay || new NullOverlay();
    this.input = options.input || new Input();
    this.loadImage = options.loadImage || null;
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

  // Returns the texture at once; its image arrives later. Until then the
  // entities using it are drawn with their plain colour.
  loadTexture(file)
  {
    const t = this.world.createTexture(0, 0);
    t.url = resolveUrl(this.baseUrl, file);
    if (!this.loadImage)
    {
      // Headless: nothing to decode, but the texture behaves as loaded on
      // the next frame so programs follow the same path everywhere.
      Promise.resolve().then(() =>
      {
        t.loaded = true;
        t.version++;
      });
      return t;
    }
    this.loadImage(t.url).then((image) =>
    {
      t.image = image;
      t.width = image.width;
      t.height = image.height;
      t.loaded = true;
      t.version++;
    }, () =>
    {
      t.failed = true;
      this.warn(`LoadTexture: could not load "${file}"`);
    });
    return t;
  }

  // ----------------------------------------------------- runner hooks

  beginStep()
  {
    this.input.sample();
  }

  renderFrame()
  {
    const frame = this.world.buildFrame(this.width, this.height);
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

function resolveUrl(base, file)
{
  if (!base || /^[a-z]+:|^\//i.test(file)) return file;
  try
  {
    return new URL(file, base).href;
  }
  catch
  {
    return file;
  }
}
