// The geometric tests behind picking and collisions, on plain numbers so
// the inner loops allocate nothing.
//
// Sweeps move a sphere of radius 1 from point p along v (so t = 0 is the
// start and t = 1 the end of the move); a caller with another radius, or an
// ellipsoid, scales its space first (see collisions.js). A hit records:
//
//   hit.t                  how far along the move (0..1) the contact happens
//   hit.x, hit.y, hit.z    the contact point
//   hit.nx, hit.ny, hit.nz the surface normal at the contact, pointing
//                          towards the sphere
//
// A test only reports a hit nearer than the hit.t it is given, so testing
// many shapes against one `hit` keeps the nearest. A contact the sphere is
// moving away from is ignored, which lets a sphere that starts touching or
// slightly inside something move off it.
//
// Triangles are 9 numbers (three corners). Their front is the side the
// cross product (b - a) x (c - a) points to, which is the outside of
// PolyBasic's clockwise triangles. `twoSided` makes the back solid too.

const EPS = 1e-12;

export function newHit(limit = 1)
{
  return { t: limit, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
}

function record(hit, t, x, y, z, nx, ny, nz)
{
  hit.t = t;
  hit.x = x;
  hit.y = y;
  hit.z = z;
  hit.nx = nx;
  hit.ny = ny;
  hit.nz = nz;
  return true;
}

// The smallest root of a t^2 + b t + c = 0 in [0, max], or -1.
function lowestRoot(a, b, c, max)
{
  if (Math.abs(a) < EPS) return -1;
  const det = b * b - 4 * a * c;
  if (det < 0) return -1;
  const s = Math.sqrt(det);
  let r1 = (-b - s) / (2 * a);
  let r2 = (-b + s) / (2 * a);
  if (r1 > r2)
  {
    const t = r1;
    r1 = r2;
    r2 = t;
  }
  if (r1 >= 0 && r1 <= max) return r1;
  if (r2 >= 0 && r2 <= max) return r2;
  return -1;
}

// Records a contact with point q (a triangle corner, or a point on an
// edge) reached at time t, unless the sphere is moving away from it.
function contactAt(hit, t, px, py, pz, vx, vy, vz, qx, qy, qz)
{
  const cx = px + vx * t;
  const cy = py + vy * t;
  const cz = pz + vz * t;
  let nx = cx - qx;
  let ny = cy - qy;
  let nz = cz - qz;
  const len = Math.hypot(nx, ny, nz);
  if (len < EPS) return false;
  nx /= len;
  ny /= len;
  nz /= len;
  if (nx * vx + ny * vy + nz * vz >= 0) return false;   // moving away
  return record(hit, t, qx, qy, qz, nx, ny, nz);
}

// Sweeps the unit sphere against a triangle (Fauerby, "Improved Collision
// detection and Response", 2003): first the inside of the triangle's
// plane, then, when the sphere misses the inside, its corners and edges.
export function sweepTriangle(px, py, pz, vx, vy, vz, tri, twoSided, hit)
{
  const ax = tri[0], ay = tri[1], az = tri[2];
  const bx = tri[3], by = tri[4], bz = tri[5];
  const cx = tri[6], cy = tri[7], cz = tri[8];
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const nlen = Math.hypot(nx, ny, nz);
  if (nlen < EPS) return false;
  nx /= nlen;
  ny /= nlen;
  nz /= nlen;

  const dist = nx * (px - ax) + ny * (py - ay) + nz * (pz - az);
  const nv = nx * vx + ny * vy + nz * vz;
  // One-sided: the sphere must be in front and not moving out of the back.
  if (!twoSided && dist < 0) return false;

  let t0;
  if (Math.abs(nv) < EPS)
  {
    // Moving parallel to the plane: it touches only if it already does.
    if (Math.abs(dist) >= 1) return false;
    t0 = 0;
  }
  else
  {
    let a = (-1 - dist) / nv;
    let b = (1 - dist) / nv;
    if (a > b)
    {
      const t = a;
      a = b;
      b = t;
    }
    if (a > hit.t || b < 0) return false;
    t0 = Math.max(0, a);
  }

  // Where the sphere first touches the plane, and is that inside?
  const side = dist > 0 || (dist === 0 && nv < 0) ? 1 : -1;
  const qx = px + vx * t0 - nx * side;
  const qy = py + vy * t0 - ny * side;
  const qz = pz + vz * t0 - nz * side;
  if (t0 <= hit.t && insideTriangle(qx, qy, qz, tri, nx, ny, nz))
  {
    // Only a move into the plane (from the side the sphere is on) counts:
    // sliding along it or leaving it is free.
    if (nv * side < 0) return record(hit, t0, qx, qy, qz, nx * side, ny * side, nz * side);
    return false;
  }

  // Corners and edges.
  let found = false;
  const vv = vx * vx + vy * vy + vz * vz;
  for (let k = 0; k < 3; k++)
  {
    const qx2 = tri[k * 3], qy2 = tri[k * 3 + 1], qz2 = tri[k * 3 + 2];
    const b = 2 * (vx * (px - qx2) + vy * (py - qy2) + vz * (pz - qz2));
    const c = (qx2 - px) ** 2 + (qy2 - py) ** 2 + (qz2 - pz) ** 2 - 1;
    const t = lowestRoot(vv, b, c, hit.t);
    if (t >= 0 && contactAt(hit, t, px, py, pz, vx, vy, vz, qx2, qy2, qz2)) found = true;
  }
  for (let k = 0; k < 3; k++)
  {
    const sx = tri[k * 3], sy = tri[k * 3 + 1], sz = tri[k * 3 + 2];
    const ex = tri[((k + 1) % 3) * 3] - sx;
    const ey = tri[((k + 1) % 3) * 3 + 1] - sy;
    const ez = tri[((k + 1) % 3) * 3 + 2] - sz;
    const bx2 = sx - px, by2 = sy - py, bz2 = sz - pz;
    const edgeSq = ex * ex + ey * ey + ez * ez;
    const edgeDotVel = ex * vx + ey * vy + ez * vz;
    const edgeDotBase = ex * bx2 + ey * by2 + ez * bz2;
    const a = edgeSq * -vv + edgeDotVel * edgeDotVel;
    const b = edgeSq * (2 * (vx * bx2 + vy * by2 + vz * bz2)) - 2 * edgeDotVel * edgeDotBase;
    const c = edgeSq * (1 - (bx2 * bx2 + by2 * by2 + bz2 * bz2)) + edgeDotBase * edgeDotBase;
    const t = lowestRoot(a, b, c, hit.t);
    if (t < 0) continue;
    const f = (edgeDotVel * t - edgeDotBase) / edgeSq;
    if (f < 0 || f > 1) continue;
    if (contactAt(hit, t, px, py, pz, vx, vy, vz, sx + ex * f, sy + ey * f, sz + ez * f)) found = true;
  }
  if (found && !twoSided)
  {
    // A corner or edge of a one-sided triangle counts only from the front.
    if (hit.nx * nx + hit.ny * ny + hit.nz * nz < 0) return false;
  }
  return found;
}

// Is q (on the triangle's plane) inside the triangle? Same-side tests
// against the plane normal, with a little tolerance on the edges.
function insideTriangle(qx, qy, qz, tri, nx, ny, nz)
{
  for (let k = 0; k < 3; k++)
  {
    const ax = tri[k * 3], ay = tri[k * 3 + 1], az = tri[k * 3 + 2];
    const k2 = ((k + 1) % 3) * 3;
    const ex = tri[k2] - ax, ey = tri[k2 + 1] - ay, ez = tri[k2 + 2] - az;
    const wx = qx - ax, wy = qy - ay, wz = qz - az;
    const cx = ey * wz - ez * wy;
    const cy = ez * wx - ex * wz;
    const cz = ex * wy - ey * wx;
    if (cx * nx + cy * ny + cz * nz < -1e-9 * (ex * ex + ey * ey + ez * ez)) return false;
  }
  return true;
}

// Sweeps the unit sphere against a sphere of radius `r` around (sx, sy, sz):
// the moving centre hits a sphere of radius 1 + r. The contact point is on
// the surface of the target sphere.
export function sweepSphere(px, py, pz, vx, vy, vz, sx, sy, sz, r, hit)
{
  const R = 1 + r;
  const dx = px - sx, dy = py - sy, dz = pz - sz;
  const a = vx * vx + vy * vy + vz * vz;
  const b = 2 * (vx * dx + vy * dy + vz * dz);
  const c = dx * dx + dy * dy + dz * dz - R * R;
  let t;
  if (c <= 0)
  {
    // Already touching or inside: only a move towards the centre counts.
    if (b >= 0) return false;
    t = 0;
  }
  else t = lowestRoot(a, b, c, hit.t);
  if (t < 0 || t > hit.t) return false;
  let nx = dx + vx * t, ny = dy + vy * t, nz = dz + vz * t;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  return record(hit, t, sx + nx * r, sy + ny * r, sz + nz * r, nx, ny, nz);
}

// A ray from p along d (any length; t is in units of d) against a
// triangle (Moller-Trumbore). The normal faces the ray.
export function rayTriangle(px, py, pz, dx, dy, dz, tri, twoSided, hit)
{
  const ax = tri[0], ay = tri[1], az = tri[2];
  const e1x = tri[3] - ax, e1y = tri[4] - ay, e1z = tri[5] - az;
  const e2x = tri[6] - ax, e2y = tri[7] - ay, e2z = tri[8] - az;
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const det = e1x * hx + e1y * hy + e1z * hz;
  // det = -(d . front normal): positive when the ray meets the front.
  if (Math.abs(det) < EPS) return false;
  if (!twoSided && det < 0) return false;
  const inv = 1 / det;
  const sx = px - ax, sy = py - ay, sz = pz - az;
  const u = (sx * hx + sy * hy + sz * hz) * inv;
  if (u < 0 || u > 1) return false;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < 0 || u + v > 1) return false;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  if (t < 0 || t > hit.t) return false;
  let nx = e1y * e2z - e1z * e2y;
  let ny = e1z * e2x - e1x * e2z;
  let nz = e1x * e2y - e1y * e2x;
  const len = Math.hypot(nx, ny, nz);
  nx /= len;
  ny /= len;
  nz /= len;
  if (nx * dx + ny * dy + nz * dz > 0)
  {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  return record(hit, t, px + dx * t, py + dy * t, pz + dz * t, nx, ny, nz);
}

// A ray against a sphere. A ray that starts inside the sphere does not
// hit it (it only ever leaves it).
export function raySphere(px, py, pz, dx, dy, dz, sx, sy, sz, r, hit)
{
  const ox = px - sx, oy = py - sy, oz = pz - sz;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  if (c < 0) return false;
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ox * dx + oy * dy + oz * dz);
  const t = lowestRoot(a, b, c, hit.t);
  if (t < 0) return false;
  const x = px + dx * t, y = py + dy * t, z = pz + dz * t;
  return record(hit, t, x, y, z, (x - sx) / r, (y - sy) / r, (z - sz) / r);
}
