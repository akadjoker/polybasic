// Models on the engine side: LoadMesh returns a pivot at once, and the
// file's nodes become entities below it when it has arrived. The pivot
// keeps the model (`e.model`) for its animations.
//
//   e.model = { data, nodes: [entity per glTF node], clips: [animations],
//               animator (animator.js), loaded, failed,
//               waiting: [what to do once it has arrived] }
//
// Commands that need the parts (CopyEntity, EntityBody, Animate) on a model
// that is still loading wait in `waiting` and run, in the order they were
// given, as soon as it arrives: a program can set everything up in its
// main body, before its models are in.
//
// Models are built in the order LoadMesh was called, whatever order the
// files arrive in, so entity handles come out the same on every run.

import { readGltf } from './gltf.js';
import { ANIM_STOP, ANIM_ONCE } from './animation.js';
import { Animator } from './animator.js';
import { paintModel } from '../scene/brush.js';

export class Models
{
  constructor(engine)
  {
    this.engine = engine;
    this.chain = Promise.resolve();
    this.animated = new Set();   // model pivots with a playing animation
    // Files named in quotes, read before main runs: url -> Promise of data.
    this.preloaded = new Map();
    this.ready = new Map();      // url -> data, once read
  }

  io(file)
  {
    const engine = this.engine;
    return {
      loadFile: engine.loadFile,
      loadImage: engine.loadImage,
      decodeImage: engine.decodeImage,
      track: (p) => engine.track(p),
      warn: (text) => engine.warn(`LoadMesh "${file}": ${text}`)
    };
  }

  // Reads a model before main runs, so LoadMesh of it has its parts at once
  // (as Blitz3D programs expect: they change a mesh right after loading it).
  preload(file, url)
  {
    if (this.preloaded.has(url) || !this.engine.loadFile) return null;
    const reading = this.engine.loadFile(url).then((bytes) => readGltf(bytes, url, this.io(file)));
    this.preloaded.set(url, reading);
    return reading.then((data) => this.ready.set(url, data), () => {});
  }

  load(file, url, parent)
  {
    const engine = this.engine;
    const root = engine.world.createEntity('pivot', parent);
    root.model = newModel();
    const fail = (message) =>
    {
      engine.warn(`LoadMesh: could not load "${file}": ${message}`);
      this.failed(root);
    };
    if (!engine.loadFile)
    {
      fail('this platform cannot read files');
      return root;
    }
    const known = this.ready.get(url);
    if (known)
    {
      this.build(root, known);
      return root;
    }
    // Reading starts now (or already has); building waits its turn.
    const reading = this.preloaded.get(url) || engine.loadFile(url).then((bytes) => readGltf(bytes, url, this.io(file)));
    reading.catch(() => {});
    const build = this.chain.then(() => reading).then((data) =>
    {
      if (!root.alive) return;
      this.build(root, data);
    }, (err) => fail(err && err.message ? err.message : String(err)));
    this.chain = build;
    engine.track(build);
    return root;
  }

  // Runs fn once the model of `root` has arrived (now if it has); onFail
  // if it never will.
  whenLoaded(root, fn, onFail = null)
  {
    const m = root.model;
    if (m.loaded) fn();
    else if (m.failed)
    {
      if (onFail) onFail();
    }
    else m.waiting.push({ fn, onFail });
  }

  failed(root)
  {
    const m = root.model;
    m.failed = true;
    const waiting = m.waiting;
    m.waiting = [];
    for (const w of waiting) if (w.onFail) w.onFail();
  }

  build(root, data)
  {
    const world = this.engine.world;
    const nodes = new Array(data.nodes.length).fill(null);
    const make = (index, parent) =>
    {
      const n = data.nodes[index];
      let e;
      if (n.mesh >= 0)
      {
        const m = data.meshes[n.mesh];
        e = world.createMesh(m.mesh, parent);
        e.surfaces = m.materials;
        e.materials = m.materials.map((mat) => mat.clone());
      }
      else e = world.createEntity('pivot', parent);
      e.name = n.name;
      e.position.copy(n.position);
      e.rotation.copy(n.rotation);
      e.scale.copy(n.scale);
      e.worldDirty = false;
      e.touch();
      nodes[index] = e;
      for (const c of n.children) make(c, e);
    };
    for (const r of data.roots) make(r, root);
    const m = root.model;
    m.data = data;
    m.clips = data.animations.slice();
    m.nodes = nodes;
    m.loaded = true;
    bindSkins(m);
    paintModel(root);
    const waiting = m.waiting;
    m.waiting = [];
    for (const w of waiting) w.fn();
  }

  // CopyEntity of a model pivot: the copy gets the same model, with its
  // own nodes (found by their place in the tree) and no animation playing.
  // A copy of a model still loading gets its own parts when it arrives.
  copy(src, dst)
  {
    const m = src.model;
    dst.model = newModel();
    if (!m.loaded)
    {
      dst.model.failed = m.failed;
      this.whenLoaded(src, () =>
      {
        if (dst.alive) this.build(dst, m.data);
      }, () => this.failed(dst));
      return;
    }
    dst.model.data = m.data;
    dst.model.clips = m.clips.slice();
    dst.model.loaded = true;
    dst.model.nodes = m.nodes.map((node) =>
    {
      if (!node) return null;
      const path = [];
      for (let e = node; e && e !== src; e = e.parent) path.unshift(e.parent.children.indexOf(e));
      let e = dst;
      for (const i of path) e = e ? e.children[i] : null;
      return e || null;
    });
    bindSkins(dst.model);
    if (m.animator) dst.model.animator = m.animator.copyFor(dst.model);
  }

  // Plays clip `index` (1-based; 0 stops) on a layer of the model, blending
  // from what that layer played over `transition` seconds; an ANIM_ONCE
  // clip can go on to clip `then` when it ends. A model still loading
  // starts it when it arrives.
  play(root, index, mode, speed, transition = 0, layer = 0, then = 0)
  {
    const m = root.model;
    if (!m.loaded)
    {
      this.whenLoaded(root, () =>
      {
        const count = m.clips.length;
        if (index > count || then > count)
        {
          this.engine.warn(`Animate: the model has ${count} animations, not number ${Math.max(index, then)}`);
          return;
        }
        this.play(root, index, mode, speed, transition, layer, then);
      });
      return;
    }
    const a = animatorOf(m);
    if (mode === ANIM_STOP || index === 0)
    {
      a.stop(layer);
      return;
    }
    const returnTo = then ? { clip: m.clips[then - 1], speed, transition } : null;
    a.play(layer, m.clips[index - 1], mode, speed, transition, returnTo);
    this.animated.add(root);
  }

  // Shows a moment of what a layer plays (of the first clip, held, when it
  // plays nothing).
  setTime(root, time, layer = 0)
  {
    const m = root.model;
    const a = animatorOf(m);
    const l = a.layer(layer);
    if (!l.current)
    {
      if (!m.clips.length) return;
      a.play(layer, m.clips[0], ANIM_ONCE, 1, 0);
      l.playing = false;
    }
    a.seek(layer, time);
  }

  // LoadAnimSeq: one animation of another glTF file (the one named, or the
  // first) added to the model's own, matched to its nodes by name, so
  // a character can take animations kept in files of their own. Returns its number. It is numbered at once; until the file
  // has arrived it is an empty animation, filled in place when it does.
  loadSequence(root, file, url, name)
  {
    const m = root.model;
    const clip = { name: '', duration: 0, channels: [] };
    m.clips.push(clip);
    const number = m.clips.length;
    const fill = (data) =>
    {
      const want = name.toLowerCase();
      const source = name ? data.animations.find((a) => a.name.toLowerCase() === want) : data.animations[0];
      if (!source)
      {
        this.engine.warn(`LoadAnimSeq: "${file}" has ${name ? `no animation named "${name}"` : 'no animations'}`);
        return;
      }
      const byName = new Map();
      m.data.nodes.forEach((n, i) =>
      {
        const key = n.name.toLowerCase();
        if (n.name && !byName.has(key)) byName.set(key, i);
      });
      const channels = [];
      const missing = new Set();
      for (const ch of source.channels)
      {
        const from = data.nodes[ch.node].name;
        const to = byName.get(from.toLowerCase());
        if (to === undefined) missing.add(from || `node ${ch.node}`);
        else channels.push({ ...ch, node: to });
      }
      if (!channels.length) this.engine.warn(`LoadAnimSeq: no node of "${file}" that "${source.name}" moves has a name the model has`);
      else if (missing.size) this.engine.warn(`LoadAnimSeq: the model has no ${[...missing].slice(0, 5).join(', ')}${missing.size > 5 ? '...' : ''}: "${source.name}" leaves them out`);
      Object.assign(clip, { name: source.name, duration: source.duration, channels });
    };
    const known = this.ready.get(url);
    if (known)
    {
      fill(known);
      return number;
    }
    const engine = this.engine;
    if (!engine.loadFile)
    {
      engine.warn(`LoadAnimSeq: could not load "${file}": this platform cannot read files`);
      return number;
    }
    const reading = this.preloaded.get(url) || engine.loadFile(url).then((bytes) => readGltf(bytes, url, this.io(file)));
    // Files fill their animations in the order they were asked for.
    m.sequences = (m.sequences || Promise.resolve()).then(() => reading).then(fill, (err) => engine.warn(`LoadAnimSeq: could not load "${file}": ${err && err.message ? err.message : err}`));
    engine.track(m.sequences);
    return number;
  }

  // The state of a layer: { clip, time, playing } or null.
  layerState(root, layer = 0)
  {
    const a = root.model.animator;
    if (!a || layer >= a.layers.length) return null;
    const l = a.layers[layer];
    return l.current ? { clip: l.current.clip, time: l.current.time, playing: l.playing, mode: l.current.mode, blending: !!l.previous } : null;
  }

  // One step of dt seconds for every model that plays or blends.
  step(dt)
  {
    for (const root of this.animated)
    {
      const a = root.alive ? root.model.animator : null;
      if (!a || !a.step(dt)) this.animated.delete(root);
      else if (!a.active) this.animated.delete(root);
    }
  }
}

function animatorOf(m)
{
  if (!m.animator) m.animator = new Animator(m);
  return m.animator;
}

// Every skinned part of a model gets its skin: the entities of its joints,
// their inverse bind matrices and the palette the renderer draws it with
// (see skinPalette).
function bindSkins(m)
{
  m.data.nodes.forEach((n, i) =>
  {
    const e = m.nodes[i];
    if (!e || n.skin < 0 || !e.mesh || !e.mesh.joints) return;
    const skin = m.data.skins[n.skin];
    e.skin = {
      joints: skin.joints.map((j) => m.nodes[j]),
      inverseBind: skin.inverseBind,
      palette: new Float32Array(skin.joints.length * 16)
    };
  });
}

// The record a model pivot keeps (see the top of this file).
export function newModel()
{
  return { data: null, nodes: [], clips: [], animator: null, loaded: false, failed: false, waiting: [] };
}
