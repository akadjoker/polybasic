// Axis-aligned bounding box. Entities expose their world box so collision
// and picking (phase 3) can do a cheap first test.

import { Vec3 } from './vec3.js';

export class Aabb
{
  constructor(min = new Vec3(Infinity, Infinity, Infinity), max = new Vec3(-Infinity, -Infinity, -Infinity))
  {
    this.min = min;
    this.max = max;
  }

  isEmpty()
  {
    return this.min.x > this.max.x || this.min.y > this.max.y || this.min.z > this.max.z;
  }

  makeEmpty()
  {
    this.min.set(Infinity, Infinity, Infinity);
    this.max.set(-Infinity, -Infinity, -Infinity);
    return this;
  }

  expandByPoint(p)
  {
    this.min.set(Math.min(this.min.x, p.x), Math.min(this.min.y, p.y), Math.min(this.min.z, p.z));
    this.max.set(Math.max(this.max.x, p.x), Math.max(this.max.y, p.y), Math.max(this.max.z, p.z));
    return this;
  }

  fromPositions(positions)
  {
    this.makeEmpty();
    const p = new Vec3();
    for (let i = 0; i < positions.length; i += 3) this.expandByPoint(p.set(positions[i], positions[i + 1], positions[i + 2]));
    return this;
  }

  // The box around this box after transforming it by a matrix (all eight
  // corners, so rotation grows it as needed).
  transformed(m)
  {
    const out = new Aabb();
    if (this.isEmpty()) return out;
    const p = new Vec3();
    for (let i = 0; i < 8; i++)
    {
      p.set(i & 1 ? this.max.x : this.min.x, i & 2 ? this.max.y : this.min.y, i & 4 ? this.max.z : this.min.z);
      out.expandByPoint(p.applyMat4(m));
    }
    return out;
  }

  intersects(b)
  {
    return this.min.x <= b.max.x && this.max.x >= b.min.x &&
      this.min.y <= b.max.y && this.max.y >= b.min.y &&
      this.min.z <= b.max.z && this.max.z >= b.min.z;
  }

  containsPoint(p)
  {
    return p.x >= this.min.x && p.x <= this.max.x && p.y >= this.min.y && p.y <= this.max.y && p.z >= this.min.z && p.z <= this.max.z;
  }

  center(out = new Vec3())
  {
    return out.set((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2, (this.min.z + this.max.z) / 2);
  }
}
