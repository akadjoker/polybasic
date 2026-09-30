// The picking and collision commands: signatures (same format as
// src/engine/commands.js), constants and implementations.

import { Vec3 } from '../math/vec3.js';
import { handleHelpers, tidy } from '../handles.js';
import { runtimeError } from '../../runtime/errors.js';
import { pickLine, emptyPick, PICK_NONE, PICK_SPHERE, PICK_POLYGON, PICK_BOX } from './picking.js';
import { screenRay, projectPoint } from './camera.js';

export const COLLIDE_COMMANDS = [
  // Shapes for picking and collisions
  'EntityPickMode(entity, mode, obscurer = 1)',
  'EntityRadius(entity, x#, y# = 0)',
  'EntityBox(entity, x#, y#, z#, width#, height#, depth#)',

  // Picking
  'CameraPick%(camera, x#, y#)',
  'LinePick%(x#, y#, z#, dx#, dy#, dz#, radius# = 0)',
  'EntityPick%(entity, range#)',
  'EntityVisible%(entity, other)',
  'PickedEntity%()',
  'PickedX#()',
  'PickedY#()',
  'PickedZ#()',
  'PickedNX#()',
  'PickedNY#()',
  'PickedNZ#()',
  'PickedTime#()',
  'PickedDistance#()',

  // From the world to the screen
  'CameraProject%(camera, x#, y#, z#)',
  'ProjectedX#()',
  'ProjectedY#()',
  'ProjectedZ#()'
];

export const COLLIDE_CONSTANTS = {
  PICK_NONE,
  PICK_SPHERE,
  PICK_POLYGON,
  PICK_BOX
};

export function createCollideCommands(engine)
{
  const world = engine.world;
  const { entity, ofKind } = handleHelpers(world);
  let picked = emptyPick();
  let projected = { x: 0, y: 0, depth: 0 };

  // Runs a pick and remembers the result for the Picked... functions.
  const pick = (origin, line, radius, accept) =>
  {
    picked = pickLine(world, origin, line, radius, accept);
    return picked.entity ? picked.entity.id : 0;
  };

  return {
    entitypickmode(handle, mode, obscurer)
    {
      if (mode < PICK_NONE || mode > PICK_BOX) throw runtimeError(`EntityPickMode mode must be PICK_NONE, PICK_SPHERE, PICK_POLYGON or PICK_BOX (0 to 3), not ${mode}`);
      const e = entity(handle);
      e.pickMode = mode;
      e.obscurer = obscurer !== 0;
    },
    entityradius(handle, x, y)
    {
      if (!(x > 0) || y < 0) throw runtimeError(`EntityRadius needs a positive radius, not ${x}, ${y}`);
      const e = entity(handle);
      e.radiusX = x;
      e.radiusY = y > 0 ? y : x;
    },
    entitybox(handle, x, y, z, width, height, depth)
    {
      if (!(width >= 0 && height >= 0 && depth >= 0)) throw runtimeError(`EntityBox needs a size of 0 or more, not ${width} x ${height} x ${depth}`);
      entity(handle).box = [x, y, z, width, height, depth];
    },

    camerapick(camera, x, y)
    {
      const cam = ofKind(camera, 'camera', 'camera');
      const ray = screenRay(cam, x, y, engine.width, engine.height);
      return pick(ray.origin, ray.direction.scale(cam.camera.far), 0, (e) => e !== cam);
    },
    linepick(x, y, z, dx, dy, dz, radius)
    {
      return pick(new Vec3(x, y, z), new Vec3(dx, dy, dz), radius, () => true);
    },
    entitypick(handle, range)
    {
      const e = entity(handle);
      const forward = new Vec3(0, 0, 1).applyMat4Direction(e.worldMatrix).normalize().scale(range);
      return pick(e.worldPosition(), forward, 0, (o) => o !== e);
    },
    entityvisible(a, b)
    {
      const from = entity(a);
      const to = entity(b);
      const start = from.worldPosition();
      const line = to.worldPosition().sub(start);
      // Only obscurers block the view, and neither end blocks itself.
      const hit = pickLine(world, start, line, 0, (e) => e.obscurer && e !== from && e !== to);
      return hit.entity ? 0 : 1;
    },
    pickedentity: () => (picked.entity && picked.entity.alive ? picked.entity.id : 0),
    pickedx: () => tidy(picked.x),
    pickedy: () => tidy(picked.y),
    pickedz: () => tidy(picked.z),
    pickednx: () => tidy(picked.nx),
    pickedny: () => tidy(picked.ny),
    pickednz: () => tidy(picked.nz),
    pickedtime: () => tidy(picked.t),
    pickeddistance: () => tidy(picked.distance),

    cameraproject(camera, x, y, z)
    {
      const cam = ofKind(camera, 'camera', 'camera');
      const p = projectPoint(cam, new Vec3(x, y, z), engine.width, engine.height);
      projected = p.inFront ? p : { x: 0, y: 0, depth: 0 };
      return p.inFront ? 1 : 0;
    },
    projectedx: () => tidy(projected.x),
    projectedy: () => tidy(projected.y),
    projectedz: () => tidy(projected.depth)
  };
}
