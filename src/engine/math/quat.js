// A rotation quaternion (x, y, z, w).
//
// Euler angles are in degrees and follow PolyBasic's conventions:
//   pitch  about X, positive tilts the nose down
//   yaw    about Y, positive turns left (counter-clockwise seen from above)
//   roll   about Z, positive tilts the top to the left
// and combine as R = yaw * pitch * roll (roll is applied first).

const DEG = Math.PI / 180;

export class Quat
{
  constructor(x = 0, y = 0, z = 0, w = 1)
  {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  set(x, y, z, w)
  {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  copy(q)
  {
    return this.set(q.x, q.y, q.z, q.w);
  }

  clone()
  {
    return new Quat(this.x, this.y, this.z, this.w);
  }

  identity()
  {
    return this.set(0, 0, 0, 1);
  }

  // A rotation of `degrees` about a unit axis. The yaw, pitch and roll
  // conventions above are rotations about -Y, +X and +Z respectively in
  // the usual right-hand sense, which is what fromEuler builds on.
  setAxisAngle(ax, ay, az, degrees)
  {
    const half = degrees * DEG / 2;
    const s = Math.sin(half);
    return this.set(ax * s, ay * s, az * s, Math.cos(half));
  }

  // this = this * q  (q is applied first, in this rotation's frame)
  multiply(q)
  {
    return this.multiplyQuats(this, q);
  }

  // this = q * this  (q is applied after, in the outer frame)
  premultiply(q)
  {
    return this.multiplyQuats(q, this);
  }

  multiplyQuats(a, b)
  {
    const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
    const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
    const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
    const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
    return this.set(x, y, z, w);
  }

  invert()
  {
    // Unit quaternions: the inverse is the conjugate.
    return this.set(-this.x, -this.y, -this.z, this.w);
  }

  normalize()
  {
    const len = Math.hypot(this.x, this.y, this.z, this.w) || 1;
    return this.set(this.x / len, this.y / len, this.z / len, this.w / len);
  }

  fromEuler(pitch, yaw, roll)
  {
    const qy = new Quat().setAxisAngle(0, -1, 0, yaw);
    const qx = new Quat().setAxisAngle(1, 0, 0, pitch);
    const qz = new Quat().setAxisAngle(0, 0, 1, roll);
    return this.copy(qy).multiply(qx).multiply(qz);
  }

  // Back to { pitch, yaw, roll } in degrees, with pitch in [-90, 90].
  toEuler()
  {
    const { x, y, z, w } = this;
    // Columns of the rotation matrix that the angles can be read from:
    // forward (Z axis), and the Y components of the X and Y axes.
    const fx = 2 * (x * z + w * y);
    const fy = 2 * (y * z - w * x);
    const fz = 1 - 2 * (x * x + y * y);
    const xy = 2 * (x * y + w * z);
    const yy = 1 - 2 * (x * x + z * z);
    const sinPitch = Math.max(-1, Math.min(1, -fy));
    const pitch = Math.asin(sinPitch) / DEG;
    let yaw;
    let roll;
    if (Math.abs(sinPitch) < 0.9999999)
    {
      yaw = Math.atan2(-fx, fz) / DEG;
      roll = Math.atan2(xy, yy) / DEG;
    }
    else
    {
      // Looking straight up or down: yaw and roll turn about the same axis,
      // so put it all in yaw.
      const xx = 1 - 2 * (y * y + z * z);
      const xz = 2 * (x * z - w * y);
      yaw = Math.atan2(xz, xx) / DEG;
      roll = 0;
    }
    return { pitch: clean(pitch), yaw: clean(yaw), roll: clean(roll) };
  }

  // Builds the quaternion of a pure rotation matrix given row by row
  // (m<row><col>). Shepperd's method: pick the largest diagonal term for
  // numerical stability.
  fromRotationMatrix(m00, m01, m02, m10, m11, m12, m20, m21, m22)
  {
    const trace = m00 + m11 + m22;
    if (trace > 0)
    {
      const s = 0.5 / Math.sqrt(trace + 1);
      return this.set((m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s);
    }
    if (m00 > m11 && m00 > m22)
    {
      const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
      return this.set(0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
    }
    if (m11 > m22)
    {
      const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
      return this.set((m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s);
    }
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    return this.set((m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s);
  }

  equals(q, eps = 1e-9)
  {
    // q and -q are the same rotation.
    const d = Math.abs(this.x * q.x + this.y * q.y + this.z * q.z + this.w * q.w);
    return Math.abs(d - 1) <= eps;
  }
}

// Rounds away float noise such as 89.99999999999999 or -0.
function clean(v)
{
  const r = Math.round(v * 1e9) / 1e9;
  return r === 0 ? 0 : r;
}
