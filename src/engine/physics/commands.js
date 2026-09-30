// The physics commands: signatures (same format as src/engine/commands.js),
// constants and implementations. A program that calls any of them waits,
// before its main body runs, for the physics engine to load.

import { handleHelpers, tidy } from '../handles.js';
import { runtimeError } from '../../runtime/errors.js';
import {
  BODY_STATIC, BODY_DYNAMIC, BODY_KINEMATIC,
  SHAPE_AUTO, SHAPE_BOX, SHAPE_SPHERE, SHAPE_CAPSULE, SHAPE_CYLINDER, SHAPE_HULL, SHAPE_MESH,
  MESH_NOT_DYNAMIC
} from './physics.js';

export const PHYSICS_COMMANDS = [
  'PhysicsGravity(x#, y#, z#)',
  'EntityBody(entity, kind = 2, shape = 0)',
  'FreeBody(entity)',
  'EntityHasBody%(entity)',
  'BodyMass(entity, mass#)',
  'BodyFriction(entity, friction#)',
  'BodyBounce(entity, bounce#)',
  'BodyDamping(entity, linear#, angular#)',
  'BodyLockRotation(entity, pitch, yaw, roll)',
  'ApplyForce(entity, x#, y#, z#)',
  'ApplyImpulse(entity, x#, y#, z#)',
  'ApplyTorque(entity, pitch#, yaw#, roll#)',
  'SetVelocity(entity, x#, y#, z#)',
  'SetAngularVelocity(entity, pitch#, yaw#, roll#)',
  'BodyVX#(entity)',
  'BodyVY#(entity)',
  'BodyVZ#(entity)',
  'BodyPitchSpeed#(entity)',
  'BodyYawSpeed#(entity)',
  'BodyRollSpeed#(entity)',
  'CountContacts%(entity)',
  'ContactEntity%(entity, index)'
];

// The keys the compiler uses for these commands (lower case names), to
// spot programs that need the physics engine.
export const PHYSICS_KEYS = new Set(PHYSICS_COMMANDS.map((s) => s.slice(0, s.search(/[%#$(]/)).toLowerCase()));

export const PHYSICS_CONSTANTS = {
  BODY_STATIC,
  BODY_DYNAMIC,
  BODY_KINEMATIC,
  SHAPE_AUTO,
  SHAPE_BOX,
  SHAPE_SPHERE,
  SHAPE_CAPSULE,
  SHAPE_CYLINDER,
  SHAPE_HULL,
  SHAPE_MESH
};

// Defaults for a new body.
const DEFAULTS = {
  mass: 1,
  friction: 0.5,
  restitution: 0,
  linearDamping: 0,
  angularDamping: 0.05,
  ccd: true
};

const DEG = Math.PI / 180;

// PolyBasic angles to an angular vector about the world axes and back:
// pitch turns about +X, yaw about -Y and roll about +Z (see quat.js).
const toAxes = (pitch, yaw, roll) => [pitch * DEG, -yaw * DEG, roll * DEG];

export function createPhysicsCommands(engine)
{
  const physics = engine.physics;
  const { entity } = handleHelpers(engine.world);

  const ready = () =>
  {
    if (!physics.backend) throw runtimeError('Physics is not available here (no physics engine was loaded)');
  };
  // The body of an entity, optionally of a kind that can be pushed.
  const bodyOf = (handle, dynamicOnly = false) =>
  {
    ready();
    const e = entity(handle);
    const b = physics.body(e);
    if (!b) throw runtimeError(`Entity ${handle} has no body (give it one with EntityBody)`);
    if (dynamicOnly && b.type !== 'dynamic') throw runtimeError(`Entity ${handle} has a ${b.type} body; only a dynamic body (BODY_DYNAMIC) can be pushed or weighed`);
    return b;
  };
  // Does something to a body: now, or once a model still loading has it.
  const act = (handle, dynamicOnly, fn) =>
  {
    const b = bodyOf(handle, dynamicOnly);
    if (b.pending) b.ops.push(fn);
    else fn(b.id);
  };
  // Reads a body: a model's body that is not there yet reads as still.
  const read = (handle, fn) =>
  {
    const b = bodyOf(handle);
    return b.pending ? 0 : tidy(fn(b.id));
  };
  const nonNegative = (v, what) =>
  {
    if (!(v >= 0)) throw runtimeError(`${what} must be 0 or more, not ${v}`);
    return v;
  };

  return {
    physicsgravity(x, y, z)
    {
      ready();
      physics.setGravity(x, y, z);
    },
    entitybody(handle, kind, shape)
    {
      ready();
      if (kind < BODY_STATIC || kind > BODY_KINEMATIC) throw runtimeError(`EntityBody kind must be BODY_STATIC, BODY_DYNAMIC or BODY_KINEMATIC (1 to 3), not ${kind}`);
      if (shape < SHAPE_AUTO || shape > SHAPE_MESH) throw runtimeError(`EntityBody shape must be one of the SHAPE_ constants (0 to 6), not ${shape}`);
      if (shape === SHAPE_MESH && kind === BODY_DYNAMIC) throw runtimeError(`EntityBody: ${MESH_NOT_DYNAMIC}`);
      const e = entity(handle);
      if (e.model && !e.model.loaded && !e.model.failed)
      {
        // A model still loading: the body comes with its parts.
        physics.addLater(e, kind, shape, DEFAULTS, (fn) => engine.models.whenLoaded(e, fn));
        return;
      }
      try
      {
        physics.add(e, kind, shape, DEFAULTS);
      }
      catch (err)
      {
        throw runtimeError(`EntityBody: ${err.message}`);
      }
    },
    freebody(handle)
    {
      ready();
      physics.remove(entity(handle));
    },
    entityhasbody: (handle) => (physics.body(entity(handle)) ? 1 : 0),
    bodymass(handle, mass)
    {
      if (!(mass > 0)) throw runtimeError(`BodyMass must be more than 0, not ${mass}`);
      act(handle, true, (id) => physics.backend.setMass(id, mass));
    },
    bodyfriction(handle, friction)
    {
      nonNegative(friction, 'BodyFriction');
      act(handle, false, (id) => physics.backend.setFriction(id, friction));
    },
    bodybounce(handle, bounce)
    {
      nonNegative(bounce, 'BodyBounce');
      act(handle, false, (id) => physics.backend.setRestitution(id, bounce));
    },
    bodydamping(handle, linear, angular)
    {
      nonNegative(linear, 'BodyDamping linear');
      nonNegative(angular, 'BodyDamping angular');
      act(handle, true, (id) => physics.backend.setDamping(id, linear, angular));
    },
    bodylockrotation(handle, pitch, yaw, roll)
    {
      act(handle, true, (id) => physics.backend.lockRotation(id, pitch !== 0, yaw !== 0, roll !== 0));
    },
    applyforce(handle, x, y, z)
    {
      act(handle, true, (id) => physics.backend.applyForce(id, [x, y, z]));
    },
    applyimpulse(handle, x, y, z)
    {
      act(handle, true, (id) => physics.backend.applyImpulse(id, [x, y, z]));
    },
    applytorque(handle, pitch, yaw, roll)
    {
      act(handle, true, (id) => physics.backend.applyTorque(id, toAxes(pitch, yaw, roll)));
    },
    setvelocity(handle, x, y, z)
    {
      act(handle, true, (id) => physics.backend.setVelocity(id, [x, y, z]));
    },
    setangularvelocity(handle, pitch, yaw, roll)
    {
      act(handle, true, (id) => physics.backend.setAngularVelocity(id, toAxes(pitch, yaw, roll)));
    },
    bodyvx: (handle) => read(handle, (id) => physics.backend.velocity(id)[0]),
    bodyvy: (handle) => read(handle, (id) => physics.backend.velocity(id)[1]),
    bodyvz: (handle) => read(handle, (id) => physics.backend.velocity(id)[2]),
    bodypitchspeed: (handle) => read(handle, (id) => physics.backend.angularVelocity(id)[0] / DEG),
    bodyyawspeed: (handle) => read(handle, (id) => -physics.backend.angularVelocity(id)[1] / DEG),
    bodyrollspeed: (handle) => read(handle, (id) => physics.backend.angularVelocity(id)[2] / DEG),
    countcontacts(handle)
    {
      if (bodyOf(handle).pending) return 0;
      return physics.contacts(entity(handle)).length;
    },
    contactentity(handle, index)
    {
      const b = bodyOf(handle);
      const list = b.pending ? [] : physics.contacts(entity(handle));
      const other = list[index - 1];
      if (!other) throw runtimeError(`Entity ${handle} touches ${list.length} bod${list.length === 1 ? 'y' : 'ies'}, not number ${index}`);
      return other.id;
    }
  };
}
