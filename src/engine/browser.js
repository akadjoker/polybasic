// Browser glue: a PolyBasic screen on a web page. It stacks a WebGL canvas
// (drawn by the three.js backend) and a 2D canvas (the Draw overlay) in a
// box that keeps the program's aspect ratio inside the element it is given,
// feeds DOM input to the engine and loads textures with <img>.
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

  return {
    element: box,
    canvas: gl,
    overlayCanvas,
    backend,
    input,
    fit,
    size: () => [width, height],
    // A fresh engine for one run of a program, drawing on this screen.
    newEngine(options = {})
    {
      input.releaseAll();
      input.sample();
      overlay.begin(width, height);
      const engine = new Engine({
        backend,
        overlay,
        input,
        loadImage,
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
