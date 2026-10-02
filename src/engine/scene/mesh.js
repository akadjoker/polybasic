// Mesh data in PolyBasic's own format, independent of any renderer:
// flat arrays of positions, normals and uvs, triangle indices, and
// submeshes (ranges of indices that share a material: one for the built-in
// shapes, one per part for a model).
//
// Conventions: left-handed space (X right, Y up, Z forward); a triangle's
// front face is the one where its corners run clockwise, so the standard
// cross product (b - a) x (c - a) points out of the front. UV (0, 0) is the
// top-left of a texture. The built-in shapes fit in the -1..1 cube.

import { Aabb } from '../math/aabb.js';

let nextMeshId = 1;

export class MeshData
{
  constructor(positions, normals, uvs, indices)
  {
    this.id = nextMeshId++;
    this.version = 0;
    this.positions = Float32Array.from(positions);
    this.normals = Float32Array.from(normals);
    this.uvs = Float32Array.from(uvs);
    this.indices = Uint32Array.from(indices);
    this.submeshes = [{ start: 0, count: this.indices.length, material: 0 }];
    this.colors = null;       // optional RGBA per vertex (0..1, linear), from models
    this.joints = null;       // skinned models: four joint numbers a vertex (Uint16Array)
    this.weights = null;      // and their weights, adding up to 1 (Float32Array)
    this.bounds = new Aabb().fromPositions(this.positions);
  }

  get vertexCount()
  {
    return this.positions.length / 3;
  }

  get triangleCount()
  {
    return this.indices.length / 3;
  }
}

// Collects vertices and triangles. `triangle` fixes the winding on its own:
// it compares the triangle's facing with the vertex normals and swaps two
// corners when needed, so the shape code only has to say which corners
// form a triangle.
class Builder
{
  constructor()
  {
    this.p = [];
    this.n = [];
    this.uv = [];
    this.idx = [];
  }

  vertex(x, y, z, nx, ny, nz, u, v)
  {
    this.p.push(x, y, z);
    this.n.push(nx, ny, nz);
    this.uv.push(u, v);
    return this.p.length / 3 - 1;
  }

  triangle(a, b, c)
  {
    const p = this.p;
    const ux = p[b * 3] - p[a * 3];
    const uy = p[b * 3 + 1] - p[a * 3 + 1];
    const uz = p[b * 3 + 2] - p[a * 3 + 2];
    const vx = p[c * 3] - p[a * 3];
    const vy = p[c * 3 + 1] - p[a * 3 + 1];
    const vz = p[c * 3 + 2] - p[a * 3 + 2];
    const cx = uy * vz - uz * vy;
    const cy = uz * vx - ux * vz;
    const cz = ux * vy - uy * vx;
    if (cx === 0 && cy === 0 && cz === 0) return;   // degenerate (a pole): skip
    const n = this.n;
    const nx = n[a * 3] + n[b * 3] + n[c * 3];
    const ny = n[a * 3 + 1] + n[b * 3 + 1] + n[c * 3 + 1];
    const nz = n[a * 3 + 2] + n[b * 3 + 2] + n[c * 3 + 2];
    if (cx * nx + cy * ny + cz * nz < 0) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  quad(a, b, c, d)
  {
    this.triangle(a, b, c);
    this.triangle(a, c, d);
  }

  // A grid of (cols + 1) x (rows + 1) vertices from `at(u, v)` (u, v in
  // 0..1), which returns [x, y, z, nx, ny, nz].
  grid(cols, rows, at)
  {
    const base = this.p.length / 3;
    for (let j = 0; j <= rows; j++)
    {
      for (let i = 0; i <= cols; i++)
      {
        const u = i / cols;
        const v = j / rows;
        const [x, y, z, nx, ny, nz] = at(u, v);
        this.vertex(x, y, z, nx, ny, nz, u, v);
      }
    }
    for (let j = 0; j < rows; j++)
    {
      for (let i = 0; i < cols; i++)
      {
        const a = base + j * (cols + 1) + i;
        this.quad(a, a + 1, a + cols + 2, a + cols + 1);
      }
    }
  }

  // A flat disc facing `ny` (+1 up, -1 down) at height y.
  disc(segments, y, ny, radius = 1)
  {
    const center = this.vertex(0, y, 0, 0, ny, 0, 0.5, 0.5);
    const first = this.p.length / 3;
    for (let i = 0; i <= segments; i++)
    {
      const a = (i / segments) * Math.PI * 2;
      const x = Math.cos(a) * radius;
      const z = Math.sin(a) * radius;
      this.vertex(x, y, z, 0, ny, 0, 0.5 + x / 2, 0.5 - z / 2);
    }
    for (let i = 0; i < segments; i++) this.triangle(center, first + i, first + i + 1);
  }

  build()
  {
    return new MeshData(this.p, this.n, this.uv, this.idx);
  }
}

export function createCube()
{
  const b = new Builder();
  // Each face: normal, and the two axes that span it (right, down in UV).
  const faces = [
    [[0, 0, -1], [1, 0, 0], [0, -1, 0]],   // front (towards -Z, facing the default camera)
    [[0, 0, 1], [-1, 0, 0], [0, -1, 0]],   // back
    [[1, 0, 0], [0, 0, 1], [0, -1, 0]],    // right
    [[-1, 0, 0], [0, 0, -1], [0, -1, 0]],  // left
    [[0, 1, 0], [1, 0, 0], [0, 0, -1]],    // top
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]]     // bottom
  ];
  for (const [n, r, d] of faces)
  {
    const corner = (su, sv) => b.vertex(
      n[0] + r[0] * su + d[0] * sv,
      n[1] + r[1] * su + d[1] * sv,
      n[2] + r[2] * su + d[2] * sv,
      n[0], n[1], n[2], (su + 1) / 2, (sv + 1) / 2);
    const a = corner(-1, -1);
    const c1 = corner(1, -1);
    const c2 = corner(1, 1);
    const c3 = corner(-1, 1);
    b.quad(a, c1, c2, c3);
  }
  return b.build();
}

export function createSphere(segments = 16)
{
  const b = new Builder();
  const stacks = Math.max(2, segments);
  const slices = Math.max(3, segments * 2);
  b.grid(slices, stacks, (u, v) =>
  {
    const theta = u * Math.PI * 2;
    const phi = v * Math.PI;
    const x = Math.sin(phi) * Math.cos(theta);
    const y = Math.cos(phi);
    const z = Math.sin(phi) * Math.sin(theta);
    return [x, y, z, x, y, z];
  });
  return b.build();
}

export function createCylinder(segments = 16, solid = true)
{
  const b = new Builder();
  const n = Math.max(3, segments);
  b.grid(n, 1, (u, v) =>
  {
    const a = u * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    return [x, 1 - v * 2, z, x, 0, z];
  });
  if (solid)
  {
    b.disc(n, 1, 1);
    b.disc(n, -1, -1);
  }
  return b.build();
}

export function createCone(segments = 16, solid = true)
{
  const b = new Builder();
  const n = Math.max(3, segments);
  // The side normal leans up: the slope is 2 high for 1 out, so the
  // normal is (2 * dir, 1) normalised.
  const k = 1 / Math.sqrt(5);
  b.grid(n, 1, (u, v) =>
  {
    const a = u * Math.PI * 2;
    const x = Math.cos(a);
    const z = Math.sin(a);
    return [x * v, 1 - v * 2, z * v, 2 * x * k, k, 2 * z * k];
  });
  if (solid) b.disc(n, -1, -1);
  return b.build();
}

export function createPlane(divisions = 1)
{
  const b = new Builder();
  const n = Math.max(1, divisions);
  b.grid(n, n, (u, v) => [u * 2 - 1, 0, 1 - v * 2, 0, 1, 0]);
  return b.build();
}

export function createTorus(segments = 24, thickness = 0.25)
{
  const b = new Builder();
  const n = Math.max(3, segments);
  const tube = Math.max(3, Math.round(n / 2));
  const ring = 1 - thickness;
  b.grid(n, tube, (u, v) =>
  {
    const a = u * Math.PI * 2;
    const t = v * Math.PI * 2;
    const nx = Math.cos(t) * Math.cos(a);
    const ny = Math.sin(t);
    const nz = Math.cos(t) * Math.sin(a);
    return [Math.cos(a) * ring + nx * thickness, ny * thickness, Math.sin(a) * ring + nz * thickness, nx, ny, nz];
  });
  return b.build();
}
