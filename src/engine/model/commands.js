// The model commands: loading glTF models and playing their animations.
// Signatures use the format of src/engine/commands.js.

import { handleHelpers, tidy } from '../handles.js';
import { runtimeError } from '../../runtime/errors.js';
import { ANIM_STOP, ANIM_LOOP, ANIM_ONCE, ANIM_PINGPONG } from './animation.js';
import { Animator, MAX_LAYERS } from './animator.js';

export const MODEL_COMMANDS = [
  'LoadMesh%(file$, parent = 0)',
  'MeshLoaded%(entity)',
  'FindChild%(entity, name$)',
  'CountAnimations%(entity)',
  'AnimationName$(entity, index)',
  'FindAnimation%(entity, name$)',
  'Animate(entity, animation = 1, mode = 1, speed# = 1, transition# = 0)',
  'AnimateLayer(entity, layer, animation, mode = 1, speed# = 1, transition# = 0)',
  'AnimateOnce(entity, animation, then = 0, speed# = 1, transition# = 0, layer = 0)',
  'AnimLayerMask(entity, layer, bone$, weight# = 1)',
  'Animating%(entity, layer = 0)',
  'AnimTime#(entity, layer = 0)',
  'SetAnimTime(entity, time#, layer = 0)',
  'AnimLength#(entity, animation = 1)'
];

// A transition is given in steps (Updates), as in Blitz3D: 12 is 0.2 s.
const STEPS = 60;

export const MODEL_CONSTANTS = {
  ANIM_STOP,
  ANIM_LOOP,
  ANIM_ONCE,
  ANIM_PINGPONG
};

export function createModelCommands(engine)
{
  const { entity, parentOf } = handleHelpers(engine.world);
  const models = engine.models;

  // The model of a LoadMesh pivot (loaded, unless `loading` is allowed).
  const model = (handle, loading = false) =>
  {
    const e = entity(handle);
    if (!e.model) throw runtimeError(`Entity ${handle} is not a model (LoadMesh makes models)`);
    if (e.model.failed) throw runtimeError(`Model ${handle} could not be loaded`);
    if (!e.model.loaded && !loading) throw runtimeError(`Model ${handle} is still loading: its parts and animations are there from the first Update (MeshLoaded tells when)`);
    return e;
  };
  const animation = (e, index) =>
  {
    const list = e.model.clips;
    if (index < 1 || index > list.length) throw runtimeError(`Model ${e.id} has ${list.length} animation${list.length === 1 ? '' : 's'}, not number ${index}`);
    return list[index - 1];
  };

  const checkLayer = (command, layer) =>
  {
    if (layer < 0 || layer >= MAX_LAYERS) throw runtimeError(`${command}: layers are numbered 0 to ${MAX_LAYERS - 1}, not ${layer}`);
  };
  // Animate and the commands like it. A model still loading starts the
  // animation when it arrives.
  const start = (command, handle, layer, index, mode, speed, transition, then) =>
  {
    const e = model(handle, true);
    checkLayer(command, layer);
    if (mode < ANIM_STOP || mode > ANIM_ONCE) throw runtimeError(`${command} mode must be ANIM_STOP, ANIM_LOOP, ANIM_PINGPONG or ANIM_ONCE (0 to 3), not ${mode}`);
    if (index < 0) throw runtimeError(`${command} needs an animation number from 1, or 0 to stop, not ${index}`);
    if (transition < 0) throw runtimeError(`${command}: a transition is a number of steps, 0 or more, not ${transition}`);
    if (e.model.loaded)
    {
      if (index !== 0) animation(e, index);
      if (then !== 0) animation(e, then);
    }
    models.play(e, index, mode, speed, transition / STEPS, layer, then);
  };
  const animatorOf = (e) =>
  {
    if (!e.model.animator) e.model.animator = new Animator(e.model);
    return e.model.animator;
  };

  return {
    loadmesh(file, parent)
    {
      engine.autoGraphics();
      return engine.loadMesh(file, parentOf(parent)).id;
    },
    meshloaded(handle)
    {
      const e = entity(handle);
      return e.model && e.model.loaded ? 1 : 0;
    },
    findchild(handle, name)
    {
      const want = name.toLowerCase();
      const search = (e) =>
      {
        for (const c of e.children)
        {
          if (c.name.toLowerCase() === want) return c;
          const found = search(c);
          if (found) return found;
        }
        return null;
      };
      const found = search(entity(handle));
      return found ? found.id : 0;
    },
    countanimations: (handle) => model(handle).model.clips.length,
    animationname: (handle, index) => animation(model(handle), index).name,
    findanimation(handle, name)
    {
      const want = name.toLowerCase();
      const i = model(handle).model.clips.findIndex((a) => a.name.toLowerCase() === want);
      return i + 1;
    },
    animate: (handle, index, mode, speed, transition) => start('Animate', handle, 0, index, mode, speed, transition, 0),
    animatelayer: (handle, layer, index, mode, speed, transition) => start('AnimateLayer', handle, layer, index, mode, speed, transition, 0),
    animateonce(handle, index, then, speed, transition, layer)
    {
      if (index < 1) throw runtimeError(`AnimateOnce needs an animation number from 1, not ${index}`);
      if (then < 0) throw runtimeError(`AnimateOnce's next animation must be a number from 1, or 0 for none, not ${then}`);
      start('AnimateOnce', handle, layer, index, ANIM_ONCE, speed, transition, then);
    },
    animlayermask(handle, layer, bone, weight)
    {
      const e = model(handle);
      checkLayer('AnimLayerMask', layer);
      const want = bone.toLowerCase();
      const node = e.model.data.nodes.findIndex((n) => n.name.toLowerCase() === want);
      if (node < 0) throw runtimeError(`AnimLayerMask: model ${handle} has no bone or part named "${bone}"`);
      animatorOf(e).mask(layer, node, weight);
    },
    animating(handle, layer)
    {
      const e = model(handle, true);
      const st = models.layerState(e, layer);
      return st && st.playing ? 1 : 0;
    },
    animtime(handle, layer)
    {
      const e = model(handle, true);
      const st = models.layerState(e, layer);
      return st ? tidy(st.time) : 0;
    },
    setanimtime(handle, time, layer)
    {
      const e = model(handle);
      checkLayer('SetAnimTime', layer);
      if (!e.model.clips.length) throw runtimeError(`Model ${handle} has no animations`);
      models.setTime(e, time, layer);
    },
    animlength: (handle, index) => tidy(animation(model(handle), index).duration)
  };
}
