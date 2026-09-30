// The model commands: loading glTF models and playing their animations.
// Signatures use the format of src/engine/commands.js.

import { handleHelpers, tidy } from '../handles.js';
import { runtimeError } from '../../runtime/errors.js';
import { ANIM_STOP, ANIM_LOOP, ANIM_ONCE, ANIM_PINGPONG } from './animation.js';

export const MODEL_COMMANDS = [
  'LoadMesh%(file$, parent = 0)',
  'MeshLoaded%(entity)',
  'FindChild%(entity, name$)',
  'CountAnimations%(entity)',
  'AnimationName$(entity, index)',
  'FindAnimation%(entity, name$)',
  'Animate(entity, animation = 1, mode = 1, speed# = 1)',
  'Animating%(entity)',
  'AnimTime#(entity)',
  'SetAnimTime(entity, time#)',
  'AnimLength#(entity, animation = 1)'
];

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
    const list = e.model.data.animations;
    if (index < 1 || index > list.length) throw runtimeError(`Model ${e.id} has ${list.length} animation${list.length === 1 ? '' : 's'}, not number ${index}`);
    return list[index - 1];
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
    countanimations: (handle) => model(handle).model.data.animations.length,
    animationname: (handle, index) => animation(model(handle), index).name,
    findanimation(handle, name)
    {
      const want = name.toLowerCase();
      const i = model(handle).model.data.animations.findIndex((a) => a.name.toLowerCase() === want);
      return i + 1;
    },
    animate(handle, index, mode, speed)
    {
      // A model still loading starts the animation when it arrives.
      const e = model(handle, true);
      if (mode < ANIM_STOP || mode > ANIM_ONCE) throw runtimeError(`Animate mode must be ANIM_STOP, ANIM_LOOP, ANIM_PINGPONG or ANIM_ONCE (0 to 3), not ${mode}`);
      if (index < 0) throw runtimeError(`Animate needs an animation number from 1, or 0 to stop, not ${index}`);
      if (index !== 0 && e.model.loaded) animation(e, index);
      models.play(e, index, mode, speed);
    },
    animating(handle)
    {
      const e = model(handle, true);
      return e.model.state && e.model.state.playing ? 1 : 0;
    },
    animtime(handle)
    {
      const e = model(handle, true);
      return e.model.state ? tidy(e.model.state.time) : 0;
    },
    setanimtime(handle, time)
    {
      const e = model(handle);
      if (!e.model.data.animations.length) throw runtimeError(`Model ${handle} has no animations`);
      models.setTime(e, time);
    },
    animlength: (handle, index) => tidy(animation(model(handle), index).duration)
  };
}
