// Browser glue: a PolyBasic screen on a web page. It stacks a WebGL canvas
// (drawn by the three.js backend) and a 2D canvas (the Draw overlay) in a
// box that keeps the program's aspect ratio inside the element it is given,
// feeds DOM input to the engine and loads textures with <img> and other
// files with fetch.
//
//   const screen = createScreen(element);
//   const engine = screen.newEngine({ baseUrl });   // one per program run
//
// The rest of the engine never touches the DOM.

import { Engine } from './engine.js';
import { ThreeBackend } from './render/three/three-backend.js';
import { CanvasOverlay } from './overlay/overlay.js';
import { Input } from './input/input.js';
import { attachDomInput } from './input/dom-input.js';

// More pixels than this per logical pixel costs speed for little gain.
const MAX_PIXEL_RATIO = 2;

// URLs of files in a playground project (kept in the browser, not on a
// server): polybasic-project:///main.pb, polybasic-project:///assets/a.png.
// They resolve relative paths like any URL and never reach the network.
export const PROJECT_SCHEME = 'polybasic-project:';

const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

// The path of a project URL inside the project ("assets/a.png").
export function projectPath(url)
{
  return decodeURIComponent(new URL(url).pathname.replace(/^\/+/, ''));
}

export function createScreen(container)
{
  const box = document.createElement('div');
  box.className = 'polybasic-screen';
  box.style.cssText = 'position: relative; flex: none;';
  const gl = document.createElement('canvas');
  const overlayCanvas = document.createElement('canvas');
  for (const c of [gl, overlayCanvas])
  {
    c.style.cssText = 'position: absolute; left: 0; top: 0; width: 100%; height: 100%; display: block;';
  }
  overlayCanvas.style.pointerEvents = 'none';
  gl.tabIndex = 0;
  box.append(gl, overlayCanvas);
  container.append(box);

  const backend = new ThreeBackend();
  backend.init(gl);
  const overlay = new CanvasOverlay(overlayCanvas);
  const input = new Input();
  let width = 800;
  let height = 600;

  const fit = () =>
  {
    const area = container.getBoundingClientRect();
    if (area.width <= 0 || area.height <= 0) return;
    const scale = Math.min(area.width / width, area.height / height);
    const cssW = Math.max(1, Math.floor(width * scale));
    const cssH = Math.max(1, Math.floor(height * scale));
    box.style.width = `${cssW}px`;
    box.style.height = `${cssH}px`;
    const ratio = Math.min(MAX_PIXEL_RATIO, (cssW * (window.devicePixelRatio || 1)) / width);
    backend.resize(width, height, ratio);
    overlay.resize(width, height, ratio);
  };
  new ResizeObserver(fit).observe(container);

  const toLogical = (clientX, clientY) =>
  {
    const r = box.getBoundingClientRect();
    return [(clientX - r.left) * width / r.width, (clientY - r.top) * height / r.height];
  };
  attachDomInput(input, gl, toLogical);

  const loadImage = (url) => new Promise((resolve, reject) =>
  {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Cannot load ${url}`));
    img.src = url;
  });

  const loadFile = async (url) =>
  {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Cannot load ${url} (${response.status})`);
    return response.arrayBuffer();
  };

  // Images inside a model file (.glb). Rows stay top first, as our
  // textures expect, and colours are left alone.
  const decodeImage = (bytes, mimeType) => createImageBitmap(new Blob([bytes], { type: mimeType }), {
    imageOrientation: 'none',
    premultiplyAlpha: 'none',
    colorSpaceConversion: 'none'
  });

  // The physics engine is a separate file next to this one (the browser
  // build is dist/polybasic.js, physics dist/physics.js), fetched only by
  // programs that use physics.
  const loadPhysics = async () =>
  {
    const { RapierBackend } = await import(new URL('./physics.js', import.meta.url).href);
    return RapierBackend.create();
  };

  return {
    element: box,
    canvas: gl,
    overlayCanvas,
    backend,
    input,
    fit,
    size: () => [width, height],
    // Blank the screen (nothing is running).
    clear(r = 0, g = 0, b = 0)
    {
      backend.reset();
      backend.render({
        width, height, clearColor: [r / 255, g / 255, b / 255], ambient: [0, 0, 0],
        cameras: [], lights: [], items: [], freedEntities: [], freedTextures: []
      });
      overlay.begin(width, height);
    },
    // A fresh engine for one run of a program, drawing on this screen.
    //   baseUrl      the program's URL: its files are relative to it
    //   files        a project's files: { read(path) -> Uint8Array or null },
    //                used for URLs of PROJECT_SCHEME
    //   loadPhysics  instead of fetching dist/physics.js (an exported page
    //                carries its own)
    newEngine(options = {})
    {
      const files = options.files || null;
      // A project file, or null for a URL that is not a project's.
      const own = (url) =>
      {
        if (!url.startsWith(PROJECT_SCHEME)) return null;
        const path = projectPath(url);
        const bytes = files ? files.read(path) : null;
        if (!bytes) throw new Error(`there is no file "${path}" in the project`);
        return bytes;
      };
      input.releaseAll();
      input.sample();
      overlay.begin(width, height);
      const engine = new Engine({
        backend,
        overlay,
        input,
        loadImage: async (url) =>
        {
          const bytes = own(url);
          if (!bytes) return loadImage(url);
          const ext = url.split('.').pop().toLowerCase();
          return decodeImage(bytes, IMAGE_TYPES[ext] || 'application/octet-stream');
        },
        loadFile: async (url) => own(url) || loadFile(url),
        decodeImage,
        loadPhysics: options.loadPhysics || loadPhysics,
        baseUrl: options.baseUrl || document.baseURI,
        onResize: (w, h) =>
        {
          width = w;
          height = h;
          fit();
        }
      });
      engine.unlockPointer = () =>
      {
        if (document.pointerLockElement === gl) document.exitPointerLock();
      };
      return engine;
    }
  };
}
