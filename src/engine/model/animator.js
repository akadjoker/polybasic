// What a model is playing: one or more layers, each with the animation it
// plays and the one it is blending away from. Every step the model's nodes start from their rest
// pose; each layer, in order, moves them towards its animations by its
// blend and its mask (how much each node follows that layer). Positions
// and scales blend straight, rotations by normalized lerp.
//
// The nodes are the model's entities (model.js), so the joints of a skin
// are moved like any other part, and FindChild finds them. Nodes are only
// written while something plays or blends: a stopped model keeps its pose.

import { sample, advance, ANIM_LOOP, ANIM_ONCE } from './animation.js';

export const MAX_LAYERS = 8;

function newLayer()
{
  return {
    current: null,     // { clip, time, speed, mode, direction }
    previous: null,    // the same, for the animation it blends away from
    blend: 1,          // 0..1: how far into `current` the blend is
    blendSpeed: 0,     // blend added per second
    playing: false,
    mask: null,        // Float32Array, one weight per node; null: all 1
    returnTo: null     // { clip, speed, transition } after an ANIM_ONCE
  };
}

export class Animator
{
  constructor(model)
  {
    this.model = model;
    this.layers = [newLayer()];
    const n = model.data.nodes.length;
    // Each node's pose as it is worked out: position, rotation, scale.
    this.p = new Float64Array(n * 3);
    this.q = new Float64Array(n * 4);
    this.s = new Float64Array(n * 3);
    this.v = [0, 0, 0, 0];
    this.dirty = false;
  }

  layer(index)
  {
    while (this.layers.length <= index) this.layers.push(newLayer());
    return this.layers[index];
  }

  // Starts a clip on a layer, blending from what it played over
  // `transition` seconds. ANIM_ONCE with `returnTo` goes on to that clip
  // (looping) once it ends.
  play(index, clip, mode, speed, transition, returnTo = null)
  {
    const layer = this.layer(index);
    layer.previous = transition > 0 && layer.current ? layer.current : null;
    layer.current = { clip, time: speed < 0 ? clip.duration : 0, speed, mode, direction: 1 };
    layer.blend = layer.previous ? 0 : 1;
    layer.blendSpeed = transition > 0 ? 1 / transition : 0;
    layer.playing = true;
    layer.returnTo = mode === ANIM_ONCE ? returnTo : null;
    this.dirty = true;
    this.evaluate();
  }

  stop(index)
  {
    const layer = this.layer(index);
    layer.current = null;
    layer.previous = null;
    layer.playing = false;
    layer.returnTo = null;
  }

  // A moment of the layer's animation, shown at once (no blend).
  seek(index, time)
  {
    const layer = this.layer(index);
    if (!layer.current) return;
    const d = layer.current.clip.duration;
    layer.current.time = Math.max(0, Math.min(d, time));
    layer.previous = null;
    layer.blend = 1;
    this.dirty = true;
    this.evaluate();
  }

  // How much each node follows a layer: `weight` for the node named and
  // every node below it. The first mask of a layer starts from 0 for every
  // other node.
  mask(index, node, weight)
  {
    const layer = this.layer(index);
    const nodes = this.model.data.nodes;
    if (!layer.mask) layer.mask = new Float32Array(nodes.length);
    const w = Math.max(0, Math.min(1, weight));
    const visit = (i) =>
    {
      layer.mask[i] = w;
      for (const c of nodes[i].children) visit(c);
    };
    visit(node);
    this.dirty = true;
  }

  clearMask(index)
  {
    this.layer(index).mask = null;
    this.dirty = true;
  }

  get active()
  {
    return this.dirty || this.layers.some((l) => l.playing || l.previous);
  }

  // One step of dt seconds.
  step(dt)
  {
    if (!this.active) return false;
    for (const layer of this.layers)
    {
      if (layer.previous)
      {
        advance(layer.previous, layer.previous.clip, dt);
        // Steps of 1/60 s add up to a hair under 1: a blend of n steps ends
        // on step n.
        layer.blend = Math.min(1, layer.blend + dt * layer.blendSpeed);
        if (layer.blend >= 1 - 1e-9)
        {
          layer.blend = 1;
          layer.previous = null;
        }
      }
      if (layer.current && layer.playing && !advance(layer.current, layer.current.clip, dt))
      {
        layer.playing = false;
        const next = layer.returnTo;
        if (next)
        {
          const index = this.layers.indexOf(layer);
          this.play(index, next.clip, ANIM_LOOP, next.speed, next.transition);
        }
      }
    }
    this.evaluate();
    return true;
  }

  // The nodes moved to the layers' poses.
  evaluate()
  {
    const { p, q, s } = this;
    const nodes = this.model.nodes;
    const rest = this.model.data.nodes;
    const used = new Set();
    for (const layer of this.layers)
    {
      for (const st of [layer.previous, layer.current])
      {
        if (st) for (const ch of st.clip.channels) used.add(ch.node);
      }
    }
    for (const i of used)
    {
      const r = rest[i];
      p.set([r.position.x, r.position.y, r.position.z], i * 3);
      q.set([r.rotation.x, r.rotation.y, r.rotation.z, r.rotation.w], i * 4);
      s.set([r.scale.x, r.scale.y, r.scale.z], i * 3);
    }
    for (const layer of this.layers)
    {
      if (layer.previous) this.apply(layer.previous, 1, layer.mask);
      if (layer.current) this.apply(layer.current, layer.previous ? layer.blend : 1, layer.mask);
    }
    for (const i of used)
    {
      const e = nodes[i];
      if (!e || !e.alive) continue;
      e.position.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
      e.rotation.set(q[i * 4], q[i * 4 + 1], q[i * 4 + 2], q[i * 4 + 3]);
      e.scale.set(s[i * 3], s[i * 3 + 1], s[i * 3 + 2]);
      e.worldDirty = false;
      e.touch();
    }
    this.dirty = false;
  }

  // Moves the pose towards a clip at its time by `weight` (times the
  // node's mask).
  apply(st, weight, mask)
  {
    if (weight <= 0.001) return;
    const { p, q, s, v } = this;
    for (const ch of st.clip.channels)
    {
      const i = ch.node;
      const amount = weight * (mask ? mask[i] : 1);
      if (amount <= 0.001) continue;
      sample(ch, st.time, v);
      if (ch.path === 'translation') mix3(p, i * 3, v, amount);
      else if (ch.path === 'scale') mix3(s, i * 3, v, amount);
      else if (ch.path === 'rotation') nlerp(q, i * 4, v, amount);
    }
  }

  // A copy of the model (CopyEntity) plays on its own: nothing playing,
  // the same masks.
  copyFor(model)
  {
    const a = new Animator(model);
    a.layers = this.layers.map((l) => ({ ...newLayer(), mask: l.mask ? l.mask.slice() : null }));
    return a;
  }
}

function mix3(out, o, v, t)
{
  for (let k = 0; k < 3; k++) out[o + k] += (v[k] - out[o + k]) * t;
}

function nlerp(out, o, v, t)
{
  const dot = out[o] * v[0] + out[o + 1] * v[1] + out[o + 2] * v[2] + out[o + 3] * v[3];
  const sign = dot < 0 ? -1 : 1;
  let len = 0;
  for (let k = 0; k < 4; k++)
  {
    out[o + k] = out[o + k] * (1 - t) + v[k] * sign * t;
    len += out[o + k] * out[o + k];
  }
  len = Math.sqrt(len) || 1;
  for (let k = 0; k < 4; k++) out[o + k] /= len;
}
