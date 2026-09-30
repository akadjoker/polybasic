// Physics for entities: EntityBody gives an entity a body in the physics
// world, and every step after Update the two are kept in step:
//
//   1. an entity the program moved (PositionEntity, TurnEntity, ...) takes
//      its body along: a jump for static and dynamic bodies, a push
//      through the world for kinematic ones;
//   2. the world advances by one step;
//   3. dynamic bodies move their entities.
//
// The body's shape is worked out when EntityBody is called, from the
// entity's mesh (or all the meshes below it, for a loaded model), its box
// or radius, and its scale at that moment.

import { Vec3 } from '../math/vec3.js';
import { Quat } from '../math/quat.js';
import { localBox } from '../collide/shapes.js';

export const BODY_STATIC = 1;
export const BODY_DYNAMIC = 2;
export const BODY_KINEMATIC = 3;

export const SHAPE_AUTO = 0;
export const SHAPE_BOX = 1;
export const SHAPE_SPHERE = 2;
export const SHAPE_CAPSULE = 3;
export const SHAPE_CYLINDER = 4;
export const SHAPE_HULL = 5;
export const SHAPE_MESH = 6;

const TYPES = { [BODY_STATIC]: 'static', [BODY_DYNAMIC]: 'dynamic', [BODY_KINEMATIC]: 'kinematic' };

// 9.8 m/s^2 with one unit as half a metre (the built-in shapes are 2 units
// across, about a metre).
export const DEFAULT_GRAVITY = [0, -19.6, 0];

export class Physics
{
  constructor(world, load)
  {
    this.world = world;
    this.load = load;         // () => Promise<PhysicsBackend>, or null
    this.backend = null;
    this.loading = null;
    this.gravity = [...DEFAULT_GRAVITY];
    this.bodies = new Map();  // entity -> { id, type, position, rotation }
  }

  get available()
  {
    return Boolean(this.load);
  }

  // Loads the backend (once). Returns a promise, or null when it is there.
  prepare()
  {
    if (this.backend || !this.load) return null;
    if (!this.loading)
    {
      this.loading = this.load().then((backend) =>
      {
        this.backend = backend;
        backend.setGravity(...this.gravity);
      });
    }
    return this.loading;
  }

  setGravity(x, y, z)
  {
    this.gravity = [x, y, z];
    if (this.backend) this.backend.setGravity(x, y, z);
  }

  body(e)
  {
    return this.bodies.get(e) || null;
  }

  // Gives entity e a body of `kind` (BODY_...) with a shape (SHAPE_...).
  // Throws an Error with a message for the program when it cannot.
  add(e, kind, shapeKind, options)
  {
    this.remove(e);
    const type = TYPES[kind];
    const position = e.worldPosition();
    const rotation = e.worldRotation();
    const { shape, offset } = buildShape(e, type, shapeKind);
    const id = this.backend.createBody({
      type,
      position: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
      shape,
      offset,
      ...options
    });
    this.bodies.set(e, { id, type, position, rotation });
  }

  remove(e)
  {
    const b = this.bodies.get(e);
    if (!b) return;
    this.backend.removeBody(b.id);
    this.bodies.delete(e);
  }

  // One step of dt seconds (see the top of this file).
  step(dt)
  {
    if (!this.backend || this.bodies.size === 0) return;
    for (const [e, b] of this.bodies)
    {
      if (!e.alive)
      {
        this.backend.removeBody(b.id);
        this.bodies.delete(e);
        continue;
      }
      const p = e.worldPosition();
      const q = e.worldRotation();
      if (!p.equals(b.position, 0) || !sameQuat(q, b.rotation))
      {
        this.backend.setTransform(b.id, [p.x, p.y, p.z], [q.x, q.y, q.z, q.w]);
        b.position = p;
        b.rotation = q;
      }
    }
    this.backend.step(dt);
    for (const [e, b] of this.bodies)
    {
      if (b.type === 'static') continue;
      const t = this.backend.transform(b.id);
      const p = new Vec3(...t.position);
      const q = new Quat(...t.rotation);
      if (b.type === 'dynamic' || !p.equals(b.position, 0) || !sameQuat(q, b.rotation))
      {
        e.setPosition(p.x, p.y, p.z, true);
        e.setWorldRotation(q);
      }
      // What the entity reads now, so a change by the program shows.
      b.position = e.worldPosition();
      b.rotation = e.worldRotation();
    }
  }

  // The entities whose bodies touch e's.
  contacts(e)
  {
    const b = this.bodies.get(e);
    if (!b) return [];
    const byId = new Map();
    for (const [other, ob] of this.bodies) byId.set(ob.id, other);
    return this.backend.contacts(b.id).map((id) => byId.get(id)).filter((o) => o && o.alive);
  }

  dispose()
  {
    if (this.backend) this.backend.dispose();
    this.backend = null;
    this.bodies.clear();
  }
}

function sameQuat(a, b)
{
  return a.x === b.x && a.y === b.y && a.z === b.z && a.w === b.w;
}

// ----------------------------------------------------------------- shapes

// The shape of entity e's body in the body's frame: the entity's world
// position and rotation, without scale (scale is baked into the shape).
function buildShape(e, type, kind)
{
  const points = bodyPoints(e);
  if (kind === SHAPE_AUTO) kind = autoKind(e, type, points);
  if ((kind === SHAPE_HULL || kind === SHAPE_MESH) && !points.triangles.length)
  {
    throw new Error(`Entity ${e.id} has no mesh to make a ${kind === SHAPE_HULL ? 'SHAPE_HULL' : 'SHAPE_MESH'} from`);
  }
  if (kind === SHAPE_MESH && type === 'dynamic')
  {
    throw new Error('SHAPE_MESH is for BODY_STATIC and BODY_KINEMATIC bodies; a moving body needs a solid shape such as SHAPE_HULL or SHAPE_BOX');
  }
  if (kind === SHAPE_MESH)
  {
    return { shape: { kind: 'mesh', vertices: Float32Array.from(points.positions), indices: Uint32Array.from(points.triangles) }, offset: [0, 0, 0] };
  }
  if (kind === SHAPE_HULL)
  {
    return { shape: { kind: 'hull', points: Float32Array.from(points.positions) }, offset: [0, 0, 0] };
  }

  // Box-like shapes come from the bounds of the points (or, for a pivot
  // with no mesh below it, from its EntityRadius).
  let min;
  let max;
  if (points.count)
  {
    min = points.min;
    max = points.max;
  }
  else
  {
    const r = e.radiusX;
    min = [-r, -r, -r];
    max = [r, r, r];
  }
  const half = [0, 1, 2].map((a) => Math.max(1e-4, (max[a] - min[a]) / 2));
  const offset = [0, 1, 2].map((a) => (max[a] + min[a]) / 2);
  const round = Math.max(half[0], half[2]);
  switch (kind)
  {
    case SHAPE_BOX:
      return { shape: { kind: 'box', half }, offset };
    case SHAPE_SPHERE:
      return { shape: { kind: 'sphere', radius: Math.max(...half) }, offset };
    case SHAPE_CAPSULE:
      return { shape: { kind: 'capsule', halfHeight: Math.max(0, half[1] - round), radius: round }, offset };
    case SHAPE_CYLINDER:
      return { shape: { kind: 'cylinder', halfHeight: half[1], radius: round }, offset };
    default:
      throw new Error(`Unknown shape ${kind}`);
  }
}

// The shape SHAPE_AUTO stands for: a built-in sphere or cylinder keeps its
// form; other meshes are exact triangles when they do not move by physics
// and a box when they do; a bare pivot is a sphere of its EntityRadius.
function autoKind(e, type, points)
{
  if (!points.count) return SHAPE_SPHERE;
  if (e.box) return SHAPE_BOX;
  if (e.mesh && points.meshes === 1)
  {
    if (e.mesh.primitive === 'sphere') return SHAPE_SPHERE;
    if (e.mesh.primitive === 'cylinder') return SHAPE_CYLINDER;
  }
  return type === 'dynamic' ? SHAPE_BOX : SHAPE_MESH;
}

// The geometry of e and everything below it, in the body frame. With an
// EntityBox, the box's corners stand in for the meshes.
function bodyPoints(e)
{
  const origin = e.worldPosition();
  const toBody = e.worldRotation().invert();
  const positions = [];
  const triangles = [];
  let meshes = 0;
  const add = (x, y, z, m) =>
  {
    const p = new Vec3(x, y, z).applyMat4(m).sub(origin).applyQuat(toBody);
    positions.push(p.x, p.y, p.z);
  };
  if (e.box)
  {
    const { min, max } = localBox(e);
    for (let i = 0; i < 8; i++) add(i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2], e.worldMatrix);
  }
  else
  {
    const visit = (n) =>
    {
      if (n.mesh && n.mesh.positions.length)
      {
        meshes++;
        const base = positions.length / 3;
        const m = n.worldMatrix;
        const p = n.mesh.positions;
        for (let i = 0; i < p.length; i += 3) add(p[i], p[i + 1], p[i + 2], m);
        for (const i of n.mesh.indices) triangles.push(base + i);
      }
      for (const c of n.children) visit(c);
    };
    visit(e);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3)
  {
    for (let a = 0; a < 3; a++)
    {
      min[a] = Math.min(min[a], positions[i + a]);
      max[a] = Math.max(max[a], positions[i + a]);
    }
  }
  return { positions, triangles, meshes, count: positions.length / 3, min, max };
}
