// A backend that draws nothing and remembers what it was asked to do. The
// engine runs on it in Node (tests, `polybasic run`), which is also the
// proof that nothing outside render/ depends on a real renderer.

import { RenderBackend } from '../backend.js';

export class NullBackend extends RenderBackend
{
  constructor()
  {
    super();
    this.calls = [];
    this.frames = 0;
    this.meshes = new Map();     // mesh id -> version uploaded
    this.textures = new Map();
    this.lastFrame = null;
    this.width = 0;
    this.height = 0;
  }

  init(surface)
  {
    this.calls.push(['init']);
  }

  reset()
  {
    this.meshes.clear();
    this.textures.clear();
    this.lastFrame = null;
    this.calls.push(['reset']);
  }

  resize(width, height, pixelRatio = 1)
  {
    this.width = width;
    this.height = height;
    this.calls.push(['resize', width, height, pixelRatio]);
  }

  render(frame)
  {
    this.frames++;
    for (const item of frame.items)
    {
      if (this.meshes.get(item.mesh.id) !== item.mesh.version) this.meshes.set(item.mesh.id, item.mesh.version);
      for (const m of item.materials)
      {
        const t = m.texture;
        if (t && this.textures.get(t.id) !== t.version) this.textures.set(t.id, t.version);
      }
    }
    for (const t of frame.freedTextures) this.textures.delete(t.id);
    // Keep a copy: the matrices in the frame are live and change later.
    this.lastFrame = {
      cameras: frame.cameras.map((c) => ({ id: c.id, world: Array.from(c.world), fov: c.fov })),
      lights: frame.lights.map((l) => ({ id: l.id, type: l.type, world: Array.from(l.world) })),
      items: frame.items.map((i) => ({ id: i.id, mesh: i.mesh.id, world: Array.from(i.world) }))
    };
    if (this.calls.length < 1000) this.calls.push(['render', frame.cameras.length, frame.lights.length, frame.items.length]);
  }

  dispose()
  {
    this.calls.push(['dispose']);
  }
}
