// The physics backend interface. PolyBasic's physics commands talk to the
// engine's Physics (physics.js), which keeps entities and bodies in step;
// Physics talks to a backend through these methods only, so the physics
// engine underneath (Rapier today) can be replaced by writing one class.
//
// Bodies are small Int ids chosen by the backend. Vectors are [x, y, z]
// arrays and rotations [x, y, z, w] quaternions, in PolyBasic space (the
// maths does not care about handedness: a backend passes them through).
//
//   setGravity(x, y, z)
//   createBody(desc) -> id
//       desc: { type: 'static' | 'dynamic' | 'kinematic',
//               position, rotation,
//               shape, offset,              offset: shape centre in the body
//               mass, friction, restitution, linearDamping, angularDamping,
//               ccd }                       ccd: sweep fast bodies
//       shape: { kind: 'box', half: [hx, hy, hz] }
//            | { kind: 'sphere', radius }
//            | { kind: 'capsule', halfHeight, radius }      along Y
//            | { kind: 'cylinder', halfHeight, radius }     along Y
//            | { kind: 'hull', points: Float32Array }       convex hull
//            | { kind: 'mesh', vertices: Float32Array, indices: Uint32Array }
//   removeBody(id)
//   setTransform(id, position, rotation)   jump there (a kinematic body is
//                                          moved there by the next step,
//                                          pushing what is in the way)
//   transform(id) -> { position, rotation }
//   setVelocity(id, v)      velocity(id) -> v
//   setAngularVelocity(id, w)  angularVelocity(id) -> w    radians/second
//   applyImpulse(id, v)     a sudden push, now
//   applyForce(id, v)       a push during the next step only
//   applyTorque(id, v)      a twist during the next step only
//   setMass(id, mass)  setFriction(id, f)  setRestitution(id, r)
//   setDamping(id, linear, angular)
//   lockRotation(id, x, y, z)   true stops turning about that world axis
//   step(dt)                advance the simulation by dt seconds
//   contacts(id) -> [id]    bodies touching this one after the last step
//   dispose()               release everything
//
// A backend is made ready by the platform's loadPhysics() (see engine.js),
// which may have to fetch and compile code first.

export class PhysicsBackend
{
  setGravity(x, y, z)
  {
  }

  createBody(desc)
  {
    return 0;
  }

  removeBody(id)
  {
  }

  setTransform(id, position, rotation)
  {
  }

  transform(id)
  {
    return { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
  }

  setVelocity(id, v)
  {
  }

  velocity(id)
  {
    return [0, 0, 0];
  }

  setAngularVelocity(id, w)
  {
  }

  angularVelocity(id)
  {
    return [0, 0, 0];
  }

  applyImpulse(id, v)
  {
  }

  applyForce(id, v)
  {
  }

  applyTorque(id, v)
  {
  }

  setMass(id, mass)
  {
  }

  setFriction(id, friction)
  {
  }

  setRestitution(id, restitution)
  {
  }

  setDamping(id, linear, angular)
  {
  }

  lockRotation(id, x, y, z)
  {
  }

  step(dt)
  {
  }

  contacts(id)
  {
    return [];
  }

  dispose()
  {
  }
}
