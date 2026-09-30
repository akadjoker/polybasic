// A 3D vector. PolyBasic space is left-handed: X right, Y up, Z forward
// (into the screen). Only the render backend knows any other convention.

export class Vec3
{
  constructor(x = 0, y = 0, z = 0)
  {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z)
  {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v)
  {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone()
  {
    return new Vec3(this.x, this.y, this.z);
  }

  add(v)
  {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  sub(v)
  {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  scale(s)
  {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  dot(v)
  {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  // Standard cross product. With PolyBasic's clockwise front faces,
  // (b - a) x (c - a) points out of the front of triangle a, b, c.
  cross(v)
  {
    const x = this.y * v.z - this.z * v.y;
    const y = this.z * v.x - this.x * v.z;
    const z = this.x * v.y - this.y * v.x;
    return this.set(x, y, z);
  }

  length()
  {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  distanceTo(v)
  {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  normalize()
  {
    const len = this.length();
    return len > 0 ? this.scale(1 / len) : this;
  }

  lerp(v, t)
  {
    this.x += (v.x - this.x) * t;
    this.y += (v.y - this.y) * t;
    this.z += (v.z - this.z) * t;
    return this;
  }

  equals(v, eps = 1e-9)
  {
    return Math.abs(this.x - v.x) <= eps && Math.abs(this.y - v.y) <= eps && Math.abs(this.z - v.z) <= eps;
  }

  // Rotates this vector by quaternion q.
  applyQuat(q)
  {
    const { x, y, z } = this;
    const tx = 2 * (q.y * z - q.z * y);
    const ty = 2 * (q.z * x - q.x * z);
    const tz = 2 * (q.x * y - q.y * x);
    this.x = x + q.w * tx + (q.y * tz - q.z * ty);
    this.y = y + q.w * ty + (q.z * tx - q.x * tz);
    this.z = z + q.w * tz + (q.x * ty - q.y * tx);
    return this;
  }

  // Transforms this vector as a point (w = 1) by a 4x4 matrix.
  applyMat4(m)
  {
    const e = m.e;
    const { x, y, z } = this;
    const w = e[3] * x + e[7] * y + e[11] * z + e[15] || 1;
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) / w;
    return this;
  }

  // Transforms this vector as a direction (w = 0): no translation.
  applyMat4Direction(m)
  {
    const e = m.e;
    const { x, y, z } = this;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    return this;
  }
}
