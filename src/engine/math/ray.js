// A ray: origin + t * direction, t >= 0. The basis for picking in phase 3.

import { Vec3 } from './vec3.js';

export class Ray
{
  constructor(origin = new Vec3(), direction = new Vec3(0, 0, 1))
  {
    this.origin = origin;
    this.direction = direction;
  }

  at(t, out = new Vec3())
  {
    return out.copy(this.direction).scale(t).add(this.origin);
  }

  // Distance along the ray to a plane, or null when it never gets there.
  intersectPlane(plane)
  {
    const denom = plane.normal.dot(this.direction);
    if (Math.abs(denom) < 1e-12) return null;
    const t = -(plane.normal.dot(this.origin) + plane.constant) / denom;
    return t >= 0 ? t : null;
  }

  // Distance along the ray to a box (slab test), or null on a miss.
  intersectAabb(box)
  {
    let tmin = 0;
    let tmax = Infinity;
    for (const axis of ['x', 'y', 'z'])
    {
      const o = this.origin[axis];
      const d = this.direction[axis];
      if (Math.abs(d) < 1e-12)
      {
        if (o < box.min[axis] || o > box.max[axis]) return null;
        continue;
      }
      let t1 = (box.min[axis] - o) / d;
      let t2 = (box.max[axis] - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
    return tmin;
  }
}
