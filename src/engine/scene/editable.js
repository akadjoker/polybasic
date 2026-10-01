// Meshes a program builds and changes, as in Blitz3D: a mesh has surfaces,
// a surface has vertices and triangles. Surfaces are handles, like
// entities.
//
// An EditableMesh is a MeshData whose arrays are rebuilt from its surfaces
// only when something reads them after a change, so a program can add ten
// thousand vertices one by one and the arrays are built once. Everything
// that reads meshes (the renderer, picking, collisions, physics) sees an
// ordinary MeshData.

import { MeshData } from './mesh.js';
import { Aabb } from '../math/aabb.js';

// Vertex colours come in as 0..255 on screen (as EntityColor's); meshes
// keep them linear.
const linear = (c) =>
{
  const v = Math.max(0, Math.min(255, c)) / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const screen = (v) =>
{
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, c)) * 255);
};

export class Surface
{
  constructor(mesh)
  {
    this.handleKind = 'a surface';
    this.handle = 0;
    this.mesh = mesh;
    this.positions = [];
    this.normals = [];
    this.uvs = [];
    this.colors = [];      // RGBA, linear
    this.triangles = [];
    this.material = 0;     // which of the entity's materials it is drawn with
    this.joints = null;    // four joints and weights a vertex, for a skinned
    this.weights = null;   // model's part
  }

  get vertexCount()
  {
    return this.positions.length / 3;
  }

  get triangleCount()
  {
    return this.triangles.length / 3;
  }

  addVertex(x, y, z, u, v)
  {
    this.positions.push(x, y, z);
    this.normals.push(0, 0, 0);
    this.uvs.push(u, v);
    this.colors.push(1, 1, 1, 1);
    if (this.joints)
    {
      this.joints.push(0, 0, 0, 0);
      this.weights.push(1, 0, 0, 0);
    }
    this.mesh.touch();
    return this.vertexCount - 1;
  }

  addTriangle(a, b, c)
  {
    this.triangles.push(a, b, c);
    this.mesh.touch();
    return this.triangleCount - 1;
  }

  setPosition(i, x, y, z)
  {
    this.positions[i * 3] = x;
    this.positions[i * 3 + 1] = y;
    this.positions[i * 3 + 2] = z;
    this.mesh.touch();
  }

  setNormal(i, x, y, z)
  {
    this.normals[i * 3] = x;
    this.normals[i * 3 + 1] = y;
    this.normals[i * 3 + 2] = z;
    this.mesh.touch();
  }

  setColor(i, r, g, b, a)
  {
    this.colors[i * 4] = linear(r);
    this.colors[i * 4 + 1] = linear(g);
    this.colors[i * 4 + 2] = linear(b);
    this.colors[i * 4 + 3] = Math.max(0, Math.min(1, a));
    this.mesh.colored = true;
    this.mesh.touch();
  }

  // A vertex colour as 0..255 on screen, or the alpha 0..1 (channel 3).
  color(i, channel)
  {
    const v = this.colors[i * 4 + channel];
    return channel === 3 ? v : screen(v);
  }

  setUv(i, u, v)
  {
    this.uvs[i * 2] = u;
    this.uvs[i * 2 + 1] = v;
    this.mesh.touch();
  }

  clear(vertices, triangles)
  {
    if (vertices)
    {
      this.positions.length = 0;
      this.normals.length = 0;
      this.uvs.length = 0;
      this.colors.length = 0;
      if (this.joints)
      {
        this.joints.length = 0;
        this.weights.length = 0;
      }
    }
    if (triangles) this.triangles.length = 0;
    this.mesh.touch();
  }

  // Smooth normals, as Blitz3D makes them: each vertex gets the average of
  // the facing of every triangle of the surface that has a corner where it
  // is (so vertices at the same place share one normal).
  updateNormals()
  {
    const p = this.positions;
    const sums = new Map();
    const key = (i) => `${p[i * 3]},${p[i * 3 + 1]},${p[i * 3 + 2]}`;
    const t = this.triangles;
    for (let k = 0; k < t.length; k += 3)
    {
      const [a, b, c] = [t[k], t[k + 1], t[k + 2]];
      const ux = p[b * 3] - p[a * 3];
      const uy = p[b * 3 + 1] - p[a * 3 + 1];
      const uz = p[b * 3 + 2] - p[a * 3 + 2];
      const vx = p[c * 3] - p[a * 3];
      const vy = p[c * 3 + 1] - p[a * 3 + 1];
      const vz = p[c * 3 + 2] - p[a * 3 + 2];
      let nx = uy * vz - uz * vy;
      let ny = uz * vx - ux * vz;
      let nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz);
      if (l <= 1e-12) continue;
      nx /= l;
      ny /= l;
      nz /= l;
      for (const v of [a, b, c])
      {
        const s = sums.get(key(v)) || [0, 0, 0];
        s[0] += nx;
        s[1] += ny;
        s[2] += nz;
        sums.set(key(v), s);
      }
    }
    for (let i = 0; i < this.vertexCount; i++)
    {
      const s = sums.get(key(i)) || [0, 0, 0];
      const l = Math.hypot(s[0], s[1], s[2]) || 1;
      this.normals[i * 3] = s[0] / l;
      this.normals[i * 3 + 1] = s[1] / l;
      this.normals[i * 3 + 2] = s[2] / l;
    }
    this.mesh.touch();
  }
}

export class EditableMesh extends MeshData
{
  constructor()
  {
    super([], [], [], []);
    this.surfaces = [];
    this.colored = false;
    this.dirty = false;
  }

  // Makes a mesh a program can change from any MeshData (a built-in shape,
  // a model part): one surface per submesh, with the vertices its
  // triangles use and its material.
  static from(data)
  {
    const m = new EditableMesh();
    const indices = data.indices;
    for (const sub of data.submeshes)
    {
      const s = new Surface(m);
      s.material = sub.material;
      if (data.joints)
      {
        s.joints = [];
        s.weights = [];
      }
      const local = new Map();
      for (let k = sub.start; k < sub.start + sub.count; k++)
      {
        const v = indices[k];
        let i = local.get(v);
        if (i === undefined)
        {
          i = local.size;
          local.set(v, i);
          s.positions.push(data.positions[v * 3], data.positions[v * 3 + 1], data.positions[v * 3 + 2]);
          s.normals.push(data.normals[v * 3], data.normals[v * 3 + 1], data.normals[v * 3 + 2]);
          s.uvs.push(data.uvs[v * 2], data.uvs[v * 2 + 1]);
          if (data.colors) for (let c = 0; c < 4; c++) s.colors.push(data.colors[v * 4 + c]);
          else s.colors.push(1, 1, 1, 1);
          if (data.joints)
          {
            for (let c = 0; c < 4; c++)
            {
              s.joints.push(data.joints[v * 4 + c]);
              s.weights.push(data.weights[v * 4 + c]);
            }
          }
        }
        s.triangles.push(i);
      }
      m.surfaces.push(s);
    }
    m.colored = !!data.colors;
    m.touch();
    return m;
  }

  touch()
  {
    this.dirty = true;
  }

  // Rebuilds the arrays from the surfaces, if anything changed. A triangle
  // with a corner that no longer exists (ClearSurface of the vertices only)
  // is left out.
  sync()
  {
    if (!this.dirty) return;
    this.dirty = false;
    let vertices = 0;
    let corners = 0;
    for (const s of this.surfaces)
    {
      vertices += s.vertexCount;
      corners += s.triangles.length;
    }
    const positions = new Float32Array(vertices * 3);
    const normals = new Float32Array(vertices * 3);
    const uvs = new Float32Array(vertices * 2);
    const colors = new Float32Array(vertices * 4);
    const skinned = this.surfaces.some((s) => s.joints);
    const joints = skinned ? new Uint16Array(vertices * 4) : null;
    const weights = skinned ? new Float32Array(vertices * 4) : null;
    const indices = new Uint32Array(corners);
    const submeshes = [];
    let base = 0;
    let used = 0;
    for (const s of this.surfaces)
    {
      const n = s.vertexCount;
      const start = used;
      positions.set(s.positions, base * 3);
      normals.set(s.normals, base * 3);
      uvs.set(s.uvs, base * 2);
      colors.set(s.colors, base * 4);
      if (skinned)
      {
        if (s.joints)
        {
          joints.set(s.joints, base * 4);
          weights.set(s.weights, base * 4);
        }
        else for (let i = 0; i < n; i++) weights[(base + i) * 4] = 1;
      }
      const t = s.triangles;
      for (let k = 0; k < t.length; k += 3)
      {
        const a = t[k];
        const b = t[k + 1];
        const c = t[k + 2];
        if (a >= n || b >= n || c >= n) continue;
        indices[used++] = base + a;
        indices[used++] = base + b;
        indices[used++] = base + c;
      }
      if (used > start) submeshes.push({ start, count: used - start, material: s.material });
      base += n;
    }
    this._positions = positions;
    this._normals = normals;
    this._uvs = uvs;
    this._indices = used === corners ? indices : indices.slice(0, used);
    this._colors = this.colored ? colors : null;
    this._joints = joints;
    this._weights = weights;
    this._submeshes = submeshes.length ? submeshes : [{ start: 0, count: 0, material: 0 }];
    this._bounds = new Aabb().fromPositions(positions);
    this._version++;
  }

  get positions() { this.sync(); return this._positions; }
  set positions(v) { this._positions = v; }
  get normals() { this.sync(); return this._normals; }
  set normals(v) { this._normals = v; }
  get uvs() { this.sync(); return this._uvs; }
  set uvs(v) { this._uvs = v; }
  get indices() { this.sync(); return this._indices; }
  set indices(v) { this._indices = v; }
  get colors() { this.sync(); return this._colors; }
  set colors(v) { this._colors = v; }
  get joints() { this.sync(); return this._joints; }
  set joints(v) { this._joints = v; }
  get weights() { this.sync(); return this._weights; }
  set weights(v) { this._weights = v; }
  get submeshes() { this.sync(); return this._submeshes; }
  set submeshes(v) { this._submeshes = v; }
  get bounds() { this.sync(); return this._bounds; }
  set bounds(v) { this._bounds = v; }
  get version() { this.sync(); return this._version; }
  set version(v) { this._version = v; }
}
