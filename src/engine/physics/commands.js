// The physics commands: signatures (same format as src/engine/commands.js),
// constants and implementations. A program that calls any of them waits,
// before its main body runs, for the physics engine to load.

import { handleHelpers, tidy } from '../handles.js';
import { runtimeError } from '../../runtime/errors.js';
import {
  BODY_STATIC, BODY_DYNAMIC, BODY_KINEMATIC,
  SHAPE_AUTO, SHAPE_BOX, SHAPE_SPHERE, SHAPE_CAPSULE, SHAPE_CYLINDER, SHAPE_HULL, SHAPE_MESH
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
      const e = entity(handle);
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
      physics.backend.setMass(bodyOf(handle, true).id, mass);
    },
    bodyfriction(handle, friction)
    {
      physics.backend.setFriction(bodyOf(handle).id, nonNegative(friction, 'BodyFriction'));
    },
    bodybounce(handle, bounce)
    {
      physics.backend.setRestitution(bodyOf(handle).id, nonNegative(bounce, 'BodyBounce'));
    },
    bodydamping(handle, linear, angular)
    {
      physics.backend.setDamping(bodyOf(handle, true).id, nonNegative(linear, 'BodyDamping linear'), nonNegative(angular, 'BodyDamping angular'));
    },
    bodylockrotation(handle, pitch, yaw, roll)
    {
      physics.backend.lockRotation(bodyOf(handle, true).id, pitch !== 0, yaw !== 0, roll !== 0);
    },
    applyforce(handle, x, y, z)
    {
      physics.backend.applyForce(bodyOf(handle, true).id, [x, y, z]);
    },
    applyimpulse(handle, x, y, z)
    {
      physics.backend.applyImpulse(bodyOf(handle, true).id, [x, y, z]);
    },
    applytorque(handle, pitch, yaw, roll)
    {
      physics.backend.applyTorque(bodyOf(handle, true).id, toAxes(pitch, yaw, roll));
    },
    setvelocity(handle, x, y, z)
    {
      physics.backend.setVelocity(bodyOf(handle, true).id, [x, y, z]);
    },
    setangularvelocity(handle, pitch, yaw, roll)
    {
      physics.backend.setAngularVelocity(bodyOf(handle, true).id, toAxes(pitch, yaw, roll));
    },
    bodyvx: (handle) => tidy(physics.backend.velocity(bodyOf(handle).id)[0]),
    bodyvy: (handle) => tidy(physics.backend.velocity(bodyOf(handle).id)[1]),
    bodyvz: (handle) => tidy(physics.backend.velocity(bodyOf(handle).id)[2]),
    bodypitchspeed: (handle) => tidy(physics.backend.angularVelocity(bodyOf(handle).id)[0] / DEG),
    bodyyawspeed: (handle) => tidy(-physics.backend.angularVelocity(bodyOf(handle).id)[1] / DEG),
    bodyrollspeed: (handle) => tidy(physics.backend.angularVelocity(bodyOf(handle).id)[2] / DEG),
    countcontacts(handle)
    {
      bodyOf(handle);
      return physics.contacts(entity(handle)).length;
    },
    contactentity(handle, index)
    {
      bodyOf(handle);
      const list = physics.contacts(entity(handle));
      const other = list[index - 1];
      if (!other) throw runtimeError(`Entity ${handle} touches ${list.length} bod${list.length === 1 ? 'y' : 'ies'}, not number ${index}`);
      return other.id;
    }
  };
}
