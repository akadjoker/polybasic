// Models on the engine side: LoadMesh returns a pivot at once, and the
// file's nodes become entities below it when it has arrived. The pivot
// keeps the model (`e.model`) for its animations.
//
//   e.model = { data, nodes: [entity per glTF node], state, loaded, failed,
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
import { pose, advance, ANIM_STOP } from './animation.js';

export class Models
{
  constructor(engine)
  {
    this.engine = engine;
    this.chain = Promise.resolve();
    this.animated = new Set();   // model pivots with a playing animation
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
    const io = {
      loadFile: engine.loadFile,
      loadImage: engine.loadImage,
      decodeImage: engine.decodeImage,
      track: (p) => engine.track(p),
      warn: (text) => engine.warn(`LoadMesh "${file}": ${text}`)
    };
    // Reading starts now; building waits its turn.
    const reading = engine.loadFile(url).then((bytes) => readGltf(bytes, url, io));
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
    m.nodes = nodes;
    m.loaded = true;
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
  }

  play(root, index, mode, speed)
  {
    const m = root.model;
    if (!m.loaded)
    {
      this.whenLoaded(root, () =>
      {
        if (index > m.data.animations.length)
        {
          this.engine.warn(`Animate: the model has ${m.data.animations.length} animations, not number ${index}`);
          return;
        }
        this.play(root, index, mode, speed);
      });
      return;
    }
    if (mode === ANIM_STOP || index === 0)
    {
      m.state = null;
      this.animated.delete(root);
      return;
    }
    m.state = { index, mode, speed, time: speed < 0 ? m.data.animations[index - 1].duration : 0, direction: 1, playing: true };
    this.animated.add(root);
    pose(m, m.data.animations[index - 1], m.state.time);
  }

  setTime(root, time)
  {
    const m = root.model;
    const anim = m.data.animations[(m.state ? m.state.index : 1) - 1];
    if (!anim) return;
    const t = Math.max(0, Math.min(anim.duration, time));
    if (m.state) m.state.time = t;
    pose(m, anim, t);
  }

  // One step of dt seconds for every playing animation.
  step(dt)
  {
    for (const root of this.animated)
    {
      const m = root.model;
      if (!root.alive || !m.state)
      {
        this.animated.delete(root);
        continue;
      }
      const anim = m.data.animations[m.state.index - 1];
      const going = advance(m.state, anim, dt);
      pose(m, anim, m.state.time);
      if (!going)
      {
        m.state.playing = false;
        this.animated.delete(root);
      }
    }
  }
}

// The record a model pivot keeps (see the top of this file).
export function newModel()
{
  return { data: null, nodes: [], state: null, loaded: false, failed: false, waiting: [] };
}
