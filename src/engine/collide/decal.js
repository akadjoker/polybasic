// Decals: a square of texture pressed onto whatever is there (a scorch
// mark, a bullet hole, a footprint). The square is a box in front of and
// behind the point; every triangle of the meshes inside it that faces the
// same way is cut to the box, and the pieces become the decal's mesh,
// lifted a little off the surface.

import { MeshData } from '../scene/mesh.js';
import { Vec3 } from '../math/vec3.js';
import { meshParts } from './shapes.js';
import { meshTrianglesNear } from './picking.js';

// How far the decal sits off the surface, as a share of its size (the
// renderer also nudges its depth, so this only has to beat rounding).
const LIFT = 0.002;

// Keeps the part of a polygon (flat list of [x, y, z] points) on the side
// of the plane coordinate `axis` where sign * value <= limit.
function clip(points, axis, sign, limit)
{
  const out = [];
  for (let i = 0; i < points.length; i++)
  {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    const da = sign * a[axis] - limit;
    const db = sign * b[axis] - limit;
    if (da <= 0) out.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0))
    {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

// The decal's mesh in world space, or null when nothing is there.
//   point, normal   Vec3: where, and the way the surface faces
//   size            the square's width (and the depth it reaches)
//   angle           degrees, anticlockwise as seen facing the surface
//   targets         the entities to press onto
export function buildDecal(point, normal, size, angle, targets)
{
  const n = normal.clone().normalize();
  const reference = Math.abs(n.y) > 0.99 ? new Vec3(0, 0, 1) : new Vec3(0, 1, 0);
  // Seen from the front (looking along -n), `right` is to the right and
  // `up` is up.
  let right = n.clone().cross(reference).normalize();
  let up = right.clone().cross(n);
  const a = angle * Math.PI / 180;
  const r = right.clone().scale(Math.cos(a)).add(up.clone().scale(Math.sin(a)));
  const u = right.clone().scale(-Math.sin(a)).add(up.clone().scale(Math.cos(a)));
  right = r;
  up = u;
  const half = size / 2;

  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const toLocal = (x, y, z) =>
  {
    const dx = x - point.x;
    const dy = y - point.y;
    const dz = z - point.z;
    return [dx * right.x + dy * right.y + dz * right.z, dx * up.x + dy * up.y + dz * up.z, dx * n.x + dy * n.y + dz * n.z];
  };
  const reach = new Vec3();
  for (const target of targets)
  {
    for (const part of meshParts(target))
    {
      meshTrianglesNear(part, point, reach, half * Math.SQRT2 + 1e-6, (tri) =>
      {
        // Only triangles facing the same way as the surface at the point.
        const ux = tri[3] - tri[0];
        const uy = tri[4] - tri[1];
        const uz = tri[5] - tri[2];
        const vx = tri[6] - tri[0];
        const vy = tri[7] - tri[1];
        const vz = tri[8] - tri[2];
        const face = new Vec3(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        if (face.length() < 1e-12) return;
        face.normalize();
        if (face.dot(n) < 0.1) return;
        let poly = [toLocal(tri[0], tri[1], tri[2]), toLocal(tri[3], tri[4], tri[5]), toLocal(tri[6], tri[7], tri[8])];
        for (const [axis, limit] of [[0, half], [1, half], [2, half]])
        {
          poly = clip(poly, axis, 1, limit);
          if (poly.length >= 3) poly = clip(poly, axis, -1, limit);
          if (poly.length < 3) return;
        }
        const base = positions.length / 3;
        for (const [x, y, z] of poly)
        {
          const lift = z + size * LIFT;
          positions.push(point.x + right.x * x + up.x * y + n.x * lift, point.y + right.y * x + up.y * y + n.y * lift, point.z + right.z * x + up.z * y + n.z * lift);
          normals.push(face.x, face.y, face.z);
          uvs.push(x / size + 0.5, 0.5 - y / size);
        }
        // The cut keeps the triangle's corner order, so the fan does too.
        for (let k = 1; k + 1 < poly.length; k++) indices.push(base, base + k, base + k + 1);
      });
    }
  }
  if (!indices.length) return null;
  smoothNormals(positions, normals);
  return new MeshData(positions, normals, uvs, indices);
}

// Corners at the same place share the average of their faces, so a decal
// on a curved surface is lit smoothly.
function smoothNormals(positions, normals)
{
  const sums = new Map();
  const key = (i) => `${positions[i * 3].toFixed(5)},${positions[i * 3 + 1].toFixed(5)},${positions[i * 3 + 2].toFixed(5)}`;
  for (let i = 0; i < positions.length / 3; i++)
  {
    const k = key(i);
    const s = sums.get(k) || [0, 0, 0];
    s[0] += normals[i * 3];
    s[1] += normals[i * 3 + 1];
    s[2] += normals[i * 3 + 2];
    sums.set(k, s);
  }
  for (let i = 0; i < positions.length / 3; i++)
  {
    const s = sums.get(key(i));
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    normals[i * 3] = s[0] / l;
    normals[i * 3 + 1] = s[1] / l;
    normals[i * 3 + 2] = s[2] / l;
  }
}
