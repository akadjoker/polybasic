// A plane: points p with normal . p + constant = 0.

import { Vec3 } from './vec3.js';

export class Plane
{
  constructor(normal = new Vec3(0, 1, 0), constant = 0)
  {
    this.normal = normal;
    this.constant = constant;
  }

  static fromPointNormal(point, normal)
  {
    const n = normal.clone().normalize();
    return new Plane(n, -n.dot(point));
  }

  distanceToPoint(p)
  {
    return this.normal.dot(p) + this.constant;
  }
}
