// MD2 commands, with Blitz3D's names and arguments (see md2.js).

import { handleHelpers } from '../handles.js';
import { runtimeError } from '../../runtime/errors.js';
import { readMd2, md2Mesh, Md2Player } from './md2.js';

export const MD2_COMMANDS = [
  'LoadMD2%(file$, parent = 0)',
  'AnimateMD2(md2, mode = 1, speed# = 1, first = 0, last = 9999, transition# = 0)',
  'MD2AnimTime#(md2)',
  'MD2AnimLength%(md2)',
  'MD2Animating%(md2)'
];

// The MD2 models of an engine: files read once and shared, and the
// entities that play them, stepped after every Update.
export class Md2Models
{
  constructor(engine)
  {
    this.engine = engine;
    this.files = new Map();     // url -> { md2 } or { error } once read
    this.reading = new Map();   // url -> Promise of the file's data
    this.playing = new Set();   // entities with an MD2
  }

  read(url)
  {
    if (!this.reading.has(url))
    {
      const p = this.engine.loadFile(url).then((bytes) => readMd2(bytes));
      p.then((md2) => this.files.set(url, { md2 }), (error) => this.files.set(url, { error }));
      this.reading.set(url, p);
    }
    return this.reading.get(url);
  }

  // Files named in quotes, read before main (LoadMD2 then has the model at
  // once, as in Blitz3D).
  preload(url)
  {
    if (!this.engine.loadFile) return null;
    return this.read(url).then(() => {}, () => {});
  }

  give(e, md2)
  {
    e.mesh = md2Mesh(md2);
    e.md2 = new Md2Player(md2, e.mesh);
    this.playing.add(e);
    const waiting = e.md2Waiting;
    e.md2Waiting = null;
    if (waiting) for (const fn of waiting) fn();
  }

  // Runs fn once e has its model: now, or when the file arrives.
  whenLoaded(e, fn)
  {
    if (e.md2) fn();
    else if (e.md2Waiting) e.md2Waiting.push(fn);
  }

  // The model's entity, or null when the file is known to be bad (Blitz3D
  // returns 0 then).
  load(file, parent)
  {
    const engine = this.engine;
    const url = engine.resolve(file);
    const known = this.files.get(url);
    if (known && known.error)
    {
      engine.warn(`LoadMD2: could not load "${file}": ${known.error.message}`);
      return null;
    }
    const e = engine.world.createEntity('mesh', parent);
    e.md2Waiting = [];
    if (known)
    {
      this.give(e, known.md2);
      return e;
    }
    if (!engine.loadFile)
    {
      engine.warn(`LoadMD2: could not load "${file}": this platform cannot read files`);
      return e;
    }
    engine.track(this.read(url).then((md2) =>
    {
      if (e.alive) this.give(e, md2);
    }, (err) => engine.warn(`LoadMD2: could not load "${file}": ${err.message}`)));
    return e;
  }

  // CopyEntity: every MD2 in the copied tree gets its own pose, standing in
  // frame 0 with nothing playing (a Blitz3D copy starts afresh), and shares
  // the file's frames.
  copy(src, dst)
  {
    if (src.md2Waiting || src.md2)
    {
      dst.md2Waiting = [];
      this.whenLoaded(src, () =>
      {
        if (dst.alive) this.give(dst, src.md2.md2);
      });
    }
    for (let i = 0; i < src.children.length && i < dst.children.length; i++) this.copy(src.children[i], dst.children[i]);
  }

  step()
  {
    for (const e of this.playing)
    {
      if (!e.alive) this.playing.delete(e);
      else e.md2.step();
    }
  }
}

export function createMd2Commands(engine)
{
  const { entity, parentOf } = handleHelpers(engine.world);
  const models = engine.md2Models;
  const md2Of = (handle) =>
  {
    const e = entity(handle);
    if (!e.md2 && !e.md2Waiting) throw runtimeError(`Entity ${handle} is not an MD2 model`);
    return e;
  };
  return {
    loadmd2(file, parent)
    {
      engine.autoGraphics();
      const e = models.load(file, parentOf(parent));
      return e ? e.id : 0;
    },
    animatemd2(handle, mode, speed, first, last, transition)
    {
      if (mode < 0 || mode > 3) throw runtimeError(`AnimateMD2 mode must be ANIM_STOP, ANIM_LOOP, ANIM_PINGPONG or ANIM_ONCE (0 to 3), not ${mode}`);
      const e = md2Of(handle);
      models.whenLoaded(e, () => e.md2.start(first, last, mode, speed, transition));
    },
    md2animtime: (handle) => { const e = md2Of(handle); return e.md2 ? e.md2.time : 0; },
    md2animlength: (handle) => { const e = md2Of(handle); return e.md2 ? e.md2.frameCount : 0; },
    md2animating: (handle) => { const e = md2Of(handle); return e.md2 && e.md2.animating ? 1 : 0; }
  };
}
