// An entity is a node of the scene graph: a local transform (position,
// rotation, scale relative to its parent), children, and a cached world
// matrix that is only recomputed when something above it moved.
//
// Pivots, meshes, cameras and lights are all entities; `kind` says which,
// and the kind-specific settings live in `mesh`/`materials`, `camera` or
// `light`. A mesh has one material per submesh (built-in shapes have one;
// a loaded model can have several), and `material` is the first.

import { Vec3 } from '../math/vec3.js';
import { Quat } from '../math/quat.js';
import { Mat4 } from '../math/mat4.js';

const DEG = 180 / Math.PI;

export class Entity
{
  constructor(id, kind)
  {
    this.id = id;
    this.kind = kind;       // 'pivot' | 'mesh' | 'camera' | 'light'
    this.name = '';
    this.parent = null;
    this.children = [];
    this.position = new Vec3();
    this.rotation = new Quat();
    this.scale = new Vec3(1, 1, 1);
    this.visible = true;
    this.order = 0;         // draw order: lower first; cameras render in this order
    // Shadows (for lights that cast them): does it cast one, and do the
    // others fall on it? EntityFX FX_NOSHADOWCAST / FX_NOSHADOWRECV.
    this.castShadow = true;
    this.receiveShadow = true;
    this.alive = true;
    this.mesh = null;
    this.materials = [];
    this.camera = null;
    this.light = null;
    // Picking and collisions (src/engine/collide): how the entity is seen
    // by rays and by moving spheres.
    this.pickMode = 0;        // 0 none, 1 sphere, 2 polygon, 3 box
    this.obscurer = true;     // blocks EntityVisible
    this.collisionType = 0;   // 0: takes no part in collisions
    this.radiusX = 1;         // sphere / ellipsoid radii, in world units
    this.radiusY = 1;
    this.box = null;          // [x, y, z, width, height, depth] in its own space; null: the mesh bounds
    this.collisionFrom = null;  // world position the next collision sweep starts from
    this.collisions = [];       // what it ran into in the last step
    this.worldMatrixCache = new Mat4();
    this.worldDirty = true;
  }

  get material()
  {
    return this.materials.length ? this.materials[0] : null;
  }

  set material(m)
  {
    this.materials = m ? [m] : [];
  }

  // ---------------------------------------------------------- matrices

  // Marks this entity and everything below it as needing a new world
  // matrix. Stops early at nodes that are already dirty (their children
  // were marked then).
  touch()
  {
    if (this.worldDirty) return;
    this.worldDirty = true;
    for (const c of this.children) c.touch();
  }

  localMatrix(out = new Mat4())
  {
    return out.compose(this.position, this.rotation, this.scale);
  }

  get worldMatrix()
  {
    if (this.worldDirty)
    {
      this.localMatrix(this.worldMatrixCache);
      if (this.parent) this.worldMatrixCache.premultiply(this.parent.worldMatrix);
      this.worldDirty = false;
    }
    return this.worldMatrixCache;
  }

  // World rotation, ignoring scale.
  worldRotation(out = new Quat())
  {
    out.copy(this.rotation);
    for (let p = this.parent; p; p = p.parent) out.premultiply(p.rotation);
    return out;
  }

  worldPosition(out = new Vec3())
  {
    const e = this.worldMatrix.e;
    return out.set(e[12], e[13], e[14]);
  }

  // Is it drawn? Hidden parents hide their children.
  get shown()
  {
    for (let e = this; e; e = e.parent)
    {
      if (!e.visible) return false;
    }
    return true;
  }

  // ------------------------------------------------------- transforms

  setPosition(x, y, z, global)
  {
    const p = new Vec3(x, y, z);
    if (global && this.parent)
    {
      const inv = this.parent.worldMatrix.clone();
      if (inv.invert()) p.applyMat4(inv);
    }
    this.position.copy(p);
    this.touch();
  }

  // Moves along the entity's own axes: MoveEntity e, 0, 0, 1 is "forward".
  move(x, y, z)
  {
    this.position.add(new Vec3(x, y, z).applyQuat(this.rotation));
    this.touch();
  }

  // Moves along the parent's axes, or the world axes when global.
  translate(x, y, z, global)
  {
    const d = new Vec3(x, y, z);
    if (global && this.parent)
    {
      const inv = this.parent.worldMatrix.clone();
      if (inv.invert()) d.applyMat4Direction(inv);
    }
    this.position.add(d);
    this.touch();
  }

  // Sets the rotation, relative to the parent or to the world.
  setRotation(pitch, yaw, roll, global)
  {
    const q = new Quat().fromEuler(pitch, yaw, roll);
    if (global && this.parent) q.premultiply(this.parent.worldRotation().invert());
    this.rotation.copy(q.normalize());
    this.touch();
  }

  // Sets the rotation from a quaternion in world space.
  setWorldRotation(q)
  {
    const r = q.clone();
    if (this.parent) r.premultiply(this.parent.worldRotation().invert());
    this.rotation.copy(r.normalize());
    this.touch();
  }

  // Turns by the given angles: about the entity's own axes, or about the
  // world axes when global.
  turn(pitch, yaw, roll, global)
  {
    const q = new Quat().fromEuler(pitch, yaw, roll);
    if (global)
    {
      const world = this.worldRotation().premultiply(q);
      if (this.parent) world.premultiply(this.parent.worldRotation().invert());
      this.rotation.copy(world);
    }
    else this.rotation.multiply(q);
    this.rotation.normalize();
    this.touch();
  }

  // Turns the entity so its forward axis (+Z) points at a world position.
  pointAt(target, roll = 0)
  {
    const d = target.clone().sub(this.worldPosition());
    const flat = Math.hypot(d.x, d.z);
    if (flat === 0 && d.y === 0) return;
    const yaw = Math.atan2(-d.x, d.z) * DEG;
    const pitch = Math.atan2(-d.y, flat) * DEG;
    this.setRotation(pitch, yaw, roll, true);
  }

  setScale(x, y, z)
  {
    this.scale.set(x, y, z);
    this.touch();
  }

  // Position as the user sees it: local (relative to the parent) or world.
  getPosition(global)
  {
    return global ? this.worldPosition() : this.position.clone();
  }

  getRotation(global)
  {
    return (global ? this.worldRotation() : this.rotation.clone()).toEuler();
  }

  // Attaches to a new parent (or none). With keepWorld the entity stays
  // where it is on screen; otherwise its local values are kept and it moves
  // with the new parent.
  setParent(parent, keepWorld)
  {
    const world = keepWorld ? this.worldMatrix.clone() : null;
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = parent;
    if (parent) parent.children.push(this);
    if (world)
    {
      if (parent)
      {
        const inv = parent.worldMatrix.clone();
        if (inv.invert()) world.premultiply(inv);
      }
      world.decompose(this.position, this.rotation, this.scale);
    }
    this.worldDirty = false;
    this.touch();
  }

  // The world-space box around the mesh (null for entities without one).
  // Collision and picking in phase 3 start here.
  worldBounds()
  {
    return this.mesh ? this.mesh.bounds.transformed(this.worldMatrix) : null;
  }
}
