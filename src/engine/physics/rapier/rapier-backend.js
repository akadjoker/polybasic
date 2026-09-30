// The Rapier physics backend (https://rapier.rs, Apache-2.0). This is the
// only file that imports Rapier; the browser build puts it in its own file
// (dist/physics.js), fetched only by programs that use physics.

import RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsBackend } from '../backend.js';

// Shapes closer than this count as touching (world units).
const TOUCHING = 0.005;

// Rapier's WebAssembly is compiled once per page (or Node process).
let ready = null;

const vec = (v) => ({ x: v[0], y: v[1], z: v[2] });
const quat = (q) => ({ x: q[0], y: q[1], z: q[2], w: q[3] });
const arr = (v) => [v.x, v.y, v.z];

export class RapierBackend extends PhysicsBackend
{
  // A ready backend with an empty world.
  static async create()
  {
    if (!ready) ready = RAPIER.init();
    await ready;
    return new RapierBackend();
  }

  constructor()
  {
    super();
    this.world = new RAPIER.World({ x: 0, y: 0, z: 0 });
    this.bodies = new Map();      // id -> { body, collider, type }
    this.byCollider = new Map();  // collider handle -> id
    this.nextId = 1;
  }

  setGravity(x, y, z)
  {
    this.world.gravity = { x, y, z };
  }

  createBody(desc)
  {
    const type = desc.type;
    const bodyDesc = type === 'static'
      ? RAPIER.RigidBodyDesc.fixed()
      : type === 'kinematic' ? RAPIER.RigidBodyDesc.kinematicPositionBased() : RAPIER.RigidBodyDesc.dynamic();
    bodyDesc.setTranslation(desc.position[0], desc.position[1], desc.position[2]);
    bodyDesc.setRotation(quat(desc.rotation));
    if (type === 'dynamic')
    {
      bodyDesc.setLinearDamping(desc.linearDamping);
      bodyDesc.setAngularDamping(desc.angularDamping);
      bodyDesc.setCcdEnabled(Boolean(desc.ccd));
    }
    const body = this.world.createRigidBody(bodyDesc);

    const colliderDesc = shapeDesc(desc.shape);
    if (!colliderDesc)
    {
      this.world.removeRigidBody(body);
      throw new Error(`Rapier cannot build a ${desc.shape.kind} shape from this geometry`);
    }
    colliderDesc.setTranslation(desc.offset[0], desc.offset[1], desc.offset[2]);
    colliderDesc.setFriction(desc.friction);
    colliderDesc.setRestitution(desc.restitution);
    if (type === 'dynamic') colliderDesc.setMass(desc.mass);
    const collider = this.world.createCollider(colliderDesc, body);

    const id = this.nextId++;
    this.bodies.set(id, { body, collider, type, locked: [false, false, false] });
    this.byCollider.set(collider.handle, id);
    return id;
  }

  removeBody(id)
  {
    const b = this.bodies.get(id);
    if (!b) return;
    this.byCollider.delete(b.collider.handle);
    this.world.removeRigidBody(b.body);
    this.bodies.delete(id);
  }

  setTransform(id, position, rotation)
  {
    const { body, type } = this.bodies.get(id);
    if (type === 'kinematic')
    {
      body.setNextKinematicTranslation(vec(position));
      body.setNextKinematicRotation(quat(rotation));
    }
    else
    {
      body.setTranslation(vec(position), true);
      body.setRotation(quat(rotation), true);
    }
  }

  transform(id)
  {
    const { body } = this.bodies.get(id);
    const r = body.rotation();
    return { position: arr(body.translation()), rotation: [r.x, r.y, r.z, r.w] };
  }

  setVelocity(id, v)
  {
    this.bodies.get(id).body.setLinvel(vec(v), true);
  }

  velocity(id)
  {
    return arr(this.bodies.get(id).body.linvel());
  }

  setAngularVelocity(id, w)
  {
    // Rapier's locks act on forces and contacts; a speed set directly
    // would still turn a locked axis, so it is left out here.
    const b = this.bodies.get(id);
    b.body.setAngvel(vec(w.map((v, i) => (b.locked[i] ? 0 : v))), true);
  }

  angularVelocity(id)
  {
    return arr(this.bodies.get(id).body.angvel());
  }

  applyImpulse(id, v)
  {
    this.bodies.get(id).body.applyImpulse(vec(v), true);
  }

  applyForce(id, v)
  {
    this.bodies.get(id).body.addForce(vec(v), true);
  }

  applyTorque(id, v)
  {
    this.bodies.get(id).body.addTorque(vec(v), true);
  }

  setMass(id, mass)
  {
    const b = this.bodies.get(id);
    b.collider.setMass(mass);
    // Rapier passes the new mass on to the body at the next step; an
    // impulse given before then must already see it.
    b.body.recomputeMassPropertiesFromColliders();
    b.body.wakeUp();
  }

  setFriction(id, friction)
  {
    this.bodies.get(id).collider.setFriction(friction);
  }

  setRestitution(id, restitution)
  {
    this.bodies.get(id).collider.setRestitution(restitution);
  }

  setDamping(id, linear, angular)
  {
    const { body } = this.bodies.get(id);
    body.setLinearDamping(linear);
    body.setAngularDamping(angular);
  }

  lockRotation(id, x, y, z)
  {
    const b = this.bodies.get(id);
    b.locked = [x, y, z];
    b.body.setEnabledRotations(!x, !y, !z, true);
  }

  step(dt)
  {
    this.world.timestep = dt;
    this.world.step();
    // Forces and torques last one step (Rapier keeps them until reset).
    for (const { body, type } of this.bodies.values())
    {
      if (type !== 'dynamic') continue;
      body.resetForces(false);
      body.resetTorques(false);
    }
  }

  contacts(id)
  {
    const { collider } = this.bodies.get(id);
    const out = [];
    // The pairs Rapier is tracking are the candidates. Whether they touch
    // is measured on the shapes as they are now: the pair's own contact
    // data is no guide (its distances are from the last contact update, and
    // a body asleep on a triangle mesh reports no solver contacts).
    this.world.contactPairsWith(collider, (other) =>
    {
      const otherId = this.byCollider.get(other.handle);
      if (otherId !== undefined && collider.contactCollider(other, TOUCHING)) out.push(otherId);
    });
    return out.sort((a, b) => a - b);
  }

  dispose()
  {
    this.world.free();
    this.bodies.clear();
    this.byCollider.clear();
  }
}

function shapeDesc(shape)
{
  switch (shape.kind)
  {
    case 'box':
      return RAPIER.ColliderDesc.cuboid(shape.half[0], shape.half[1], shape.half[2]);
    case 'sphere':
      return RAPIER.ColliderDesc.ball(shape.radius);
    case 'capsule':
      return RAPIER.ColliderDesc.capsule(shape.halfHeight, shape.radius);
    case 'cylinder':
      return RAPIER.ColliderDesc.cylinder(shape.halfHeight, shape.radius);
    case 'hull':
      return RAPIER.ColliderDesc.convexHull(shape.points);
    case 'mesh':
      return RAPIER.ColliderDesc.trimesh(shape.vertices, shape.indices);
    default:
      throw new Error(`Unknown shape ${shape.kind}`);
  }
}
