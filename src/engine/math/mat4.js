// A 4x4 matrix stored column-major in a Float64Array, the same layout as
// WebGL (element [col * 4 + row]). Translation lives in e[12], e[13], e[14].

export class Mat4
{
  constructor()
  {
    this.e = new Float64Array(16);
    this.e[0] = this.e[5] = this.e[10] = this.e[15] = 1;
  }

  identity()
  {
    this.e.fill(0);
    this.e[0] = this.e[5] = this.e[10] = this.e[15] = 1;
    return this;
  }

  copy(m)
  {
    this.e.set(m.e);
    return this;
  }

  clone()
  {
    return new Mat4().copy(this);
  }

  fromArray(values)
  {
    this.e.set(values);
    return this;
  }

  // Translation * Rotation * Scale, the usual order for an entity.
  compose(pos, quat, scale)
  {
    const e = this.e;
    const { x, y, z, w } = quat;
    const x2 = x + x;
    const y2 = y + y;
    const z2 = z + z;
    const xx = x * x2;
    const xy = x * y2;
    const xz = x * z2;
    const yy = y * y2;
    const yz = y * z2;
    const zz = z * z2;
    const wx = w * x2;
    const wy = w * y2;
    const wz = w * z2;
    const sx = scale.x;
    const sy = scale.y;
    const sz = scale.z;
    e[0] = (1 - (yy + zz)) * sx;
    e[1] = (xy + wz) * sx;
    e[2] = (xz - wy) * sx;
    e[3] = 0;
    e[4] = (xy - wz) * sy;
    e[5] = (1 - (xx + zz)) * sy;
    e[6] = (yz + wx) * sy;
    e[7] = 0;
    e[8] = (xz + wy) * sz;
    e[9] = (yz - wx) * sz;
    e[10] = (1 - (xx + yy)) * sz;
    e[11] = 0;
    e[12] = pos.x;
    e[13] = pos.y;
    e[14] = pos.z;
    e[15] = 1;
    return this;
  }

  // this = a * b
  multiplyMatrices(a, b)
  {
    const ae = a.e;
    const be = b.e;
    const out = new Float64Array(16);
    for (let col = 0; col < 4; col++)
    {
      for (let row = 0; row < 4; row++)
      {
        out[col * 4 + row] =
          ae[row] * be[col * 4] +
          ae[4 + row] * be[col * 4 + 1] +
          ae[8 + row] * be[col * 4 + 2] +
          ae[12 + row] * be[col * 4 + 3];
      }
    }
    this.e.set(out);
    return this;
  }

  multiply(m)
  {
    return this.multiplyMatrices(this, m);
  }

  premultiply(m)
  {
    return this.multiplyMatrices(m, this);
  }

  determinant()
  {
    const e = this.e;
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = e;
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    return b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  }

  // General inverse (cofactors). Returns false and leaves the matrix
  // unchanged when it cannot be inverted.
  invert()
  {
    const e = this.e;
    const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = e;
    const b00 = a00 * a11 - a01 * a10;
    const b01 = a00 * a12 - a02 * a10;
    const b02 = a00 * a13 - a03 * a10;
    const b03 = a01 * a12 - a02 * a11;
    const b04 = a01 * a13 - a03 * a11;
    const b05 = a02 * a13 - a03 * a12;
    const b06 = a20 * a31 - a21 * a30;
    const b07 = a20 * a32 - a22 * a30;
    const b08 = a20 * a33 - a23 * a30;
    const b09 = a21 * a32 - a22 * a31;
    const b10 = a21 * a33 - a23 * a31;
    const b11 = a22 * a33 - a23 * a32;
    const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
    if (!det) return false;
    const inv = 1 / det;
    e[0] = (a11 * b11 - a12 * b10 + a13 * b09) * inv;
    e[1] = (a02 * b10 - a01 * b11 - a03 * b09) * inv;
    e[2] = (a31 * b05 - a32 * b04 + a33 * b03) * inv;
    e[3] = (a22 * b04 - a21 * b05 - a23 * b03) * inv;
    e[4] = (a12 * b08 - a10 * b11 - a13 * b07) * inv;
    e[5] = (a00 * b11 - a02 * b08 + a03 * b07) * inv;
    e[6] = (a32 * b02 - a30 * b05 - a33 * b01) * inv;
    e[7] = (a20 * b05 - a22 * b02 + a23 * b01) * inv;
    e[8] = (a10 * b10 - a11 * b08 + a13 * b06) * inv;
    e[9] = (a01 * b08 - a00 * b10 - a03 * b06) * inv;
    e[10] = (a30 * b04 - a31 * b02 + a33 * b00) * inv;
    e[11] = (a21 * b02 - a20 * b04 - a23 * b00) * inv;
    e[12] = (a11 * b07 - a10 * b09 - a12 * b06) * inv;
    e[13] = (a00 * b09 - a01 * b07 + a02 * b06) * inv;
    e[14] = (a31 * b01 - a30 * b03 - a32 * b00) * inv;
    e[15] = (a20 * b03 - a21 * b01 + a22 * b00) * inv;
    return true;
  }

  // Splits a T * R * S matrix back into its parts (no shear assumed).
  decompose(pos, quat, scale)
  {
    const e = this.e;
    let sx = Math.hypot(e[0], e[1], e[2]);
    const sy = Math.hypot(e[4], e[5], e[6]);
    const sz = Math.hypot(e[8], e[9], e[10]);
    if (this.determinant() < 0) sx = -sx;
    pos.set(e[12], e[13], e[14]);
    scale.set(sx, sy, sz);
    const ix = sx ? 1 / sx : 0;
    const iy = sy ? 1 / sy : 0;
    const iz = sz ? 1 / sz : 0;
    quat.fromRotationMatrix(
      e[0] * ix, e[4] * iy, e[8] * iz,
      e[1] * ix, e[5] * iy, e[9] * iz,
      e[2] * ix, e[6] * iy, e[10] * iz);
    return this;
  }

  // Perspective projection for a camera looking down +Z (left-handed),
  // mapping depth to [-1, 1]. `fovY` is the vertical field of view in
  // degrees.
  perspective(fovY, aspect, near, far)
  {
    const f = 1 / Math.tan(fovY * Math.PI / 360);
    this.e.fill(0);
    this.e[0] = f / aspect;
    this.e[5] = f;
    this.e[10] = (far + near) / (far - near);
    this.e[11] = 1;
    this.e[14] = -2 * far * near / (far - near);
    return this;
  }

  equals(m, eps = 1e-9)
  {
    for (let i = 0; i < 16; i++)
    {
      if (Math.abs(this.e[i] - m.e[i]) > eps) return false;
    }
    return true;
  }

  toArray()
  {
    return Array.from(this.e);
  }
}
