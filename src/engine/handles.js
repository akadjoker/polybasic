// Helpers shared by the command modules: turning the Int handles a program
// passes into entities and textures (with a clear runtime error for a bad
// one), and the value conversions between PolyBasic and the engine.

import { Entity } from './scene/entity.js';
import { Texture } from './scene/texture.js';
import { runtimeError } from '../runtime/errors.js';

export const byte = (v) => Math.max(0, Math.min(255, v | 0));

// Colours: 0..255 in programs, 0..1 in the engine.
export const unit = (v) => byte(v) / 255;

// Positions and angles read back by a program are rounded to 9 decimals,
// so a cube turned by 90 degrees reports x = 0, not 2.22045e-16.
export const tidy = (v) =>
{
  const r = Math.round(v * 1e9) / 1e9;
  return r === 0 ? 0 : r;
};

// What a handle's object is, for error messages: "an entity", "a texture",
// or the `handleKind` of other objects kept under handles ("a sound").
export function describe(object)
{
  if (object instanceof Entity) return 'an entity';
  if (object instanceof Texture) return 'a texture';
  return object && object.handleKind ? object.handleKind : 'something else';
}

export function handleHelpers(world)
{
  const entity = (handle) =>
  {
    const e = world.handles.get(handle);
    if (e instanceof Entity) return e;
    if (handle === 0) throw runtimeError('Entity handle is 0 (no entity)');
    if (e) throw runtimeError(`Handle ${handle} is ${describe(e)}, not an entity`);
    throw runtimeError(`Entity ${handle} does not exist (it was freed, or never created)`);
  };
  const parentOf = (handle) => (handle === 0 ? null : entity(handle));
  const texture = (handle) =>
  {
    const t = world.handles.get(handle);
    if (t instanceof Texture) return t;
    if (handle === 0) throw runtimeError('Texture handle is 0 (no texture)');
    if (t) throw runtimeError(`Handle ${handle} is ${describe(t)}, not a texture`);
    throw runtimeError(`Texture ${handle} does not exist (it was freed, or never created)`);
  };
  const ofKind = (handle, kind, what) =>
  {
    const e = entity(handle);
    if (e.kind !== kind) throw runtimeError(`Entity ${handle} is not a ${what}`);
    return e;
  };
  return { entity, parentOf, texture, ofKind };
}
