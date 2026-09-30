// Terrains as in Blitz3D (blitz3d/terrain.cpp, terrainrep.cpp): a grid of
// `size` x `size` heights, `size` a power of 2, from 0 to 1 in steps of
// 1/255 (Blitz3D keeps each in a byte). The mesh has size + 1 vertices each
// way over x and z from 0 to size; the last row and column take the
// heights of the first (the grid wraps). Texture coordinates are (x,
// size - z), one texture per cell until ScaleTexture says otherwise.
//
// Blitz3D draws a terrain with a level of detail picked every frame
// (TerrainDetail); here the whole grid is one mesh.

import { MeshData } from './mesh.js';
import { Aabb } from '../math/aabb.js';

export class Terrain
{
  constructor(size)
  {
    this.size = size;
    this.mask = size - 1;
    this.heights = new Uint8Array(size * size);
    this.shading = false;
    this.detail = 0;
    this.dirty = [];
    const n = size + 1;
    const positions = new Float32Array(n * n * 3);
    const normals = new Float32Array(n * n * 3);
    const uvs = new Float32Array(n * n * 2);
    for (let z = 0; z <= size; z++)
    {
      for (let x = 0; x <= size; x++)
      {
        const v = z * n + x;
        positions[v * 3] = x;
        positions[v * 3 + 2] = z;
        normals[v * 3 + 1] = 1;
        uvs[v * 2] = x;
        uvs[v * 2 + 1] = size - z;
      }
    }
    // Two triangles a cell, clockwise seen from above.
    const indices = new Uint32Array(size * size * 6);
    let i = 0;
    for (let z = 0; z < size; z++)
    {
      for (let x = 0; x < size; x++)
      {
        const v = z * n + x;
        indices.set([v, v + n, v + n + 1, v, v + n + 1, v + 1], i);
        i += 6;
      }
    }
    this.mesh = new MeshData([], [], [], []);
    this.mesh.positions = positions;
    this.mesh.normals = normals;
    this.mesh.uvs = uvs;
    this.mesh.indices = indices;
    this.mesh.submeshes = [{ start: 0, count: indices.length, material: 0 }];
    this.mesh.bounds = new Aabb().fromPositions(positions);
    // Picks and collisions find a terrain's triangles by their cells.
    this.mesh.grid = new TerrainGrid(this);
    this.dirty = [];
  }

  // Blitz3D's getHeight: 0 outside 0..size, wrapped inside.
  height(x, z)
  {
    if (x < 0 || z < 0 || x > this.size || z > this.size) return 0;
    return this.heights[(z & this.mask) * this.size + (x & this.mask)] / 255;
  }

  // Stored as Blitz3D does: h * 255 into a byte, so it reads back in steps
  // of 1/255, rounded down.
  setHeight(x, z, h)
  {
    if (x < 0 || z < 0 || x > this.size || z > this.size) return;
    this.heights[(z & this.mask) * this.size + (x & this.mask)] = Math.floor(Math.max(0, Math.min(1, h)) * 255);
    // The vertex and the normals round it; a height on an edge is also the
    // vertex on the far edge.
    const xs = x % this.size === 0 ? [0, this.size] : [x];
    const zs = z % this.size === 0 ? [0, this.size] : [z];
    for (const vx of xs) for (const vz of zs) this.touch(vx - 1, vz - 1, vx + 1, vz + 1);
  }

  touch(x0, z0, x1, z1)
  {
    if (this.dirty.length > 64) this.dirty = [[0, 0, this.size, this.size]];
    else this.dirty.push([Math.max(0, x0), Math.max(0, z0), Math.min(this.size, x1), Math.min(this.size, z1)]);
  }

  // The height between grid points, as TerrainY works it out (bilinear).
  heightAt(x, z)
  {
    const ix = Math.floor(x);
    const iz = Math.floor(z);
    const tx = x - ix;
    const tz = z - iz;
    const h0 = this.height(ix, iz);
    const h1 = this.height(ix + 1, iz);
    const h2 = this.height(ix, iz + 1);
    const h3 = this.height(ix + 1, iz + 1);
    const ha = (h1 - h0) * tx + h0;
    const hb = (h3 - h2) * tx + h2;
    return (hb - ha) * tz + ha;
  }

  setShading(on)
  {
    this.shading = on;
    this.touch(0, 0, this.size, this.size);
  }

  // Brings the changed part of the mesh up to date with the heights (once
  // a step, however many were changed). Normals point straight up without
  // shading, as in Blitz3D; with it, each is the sum of the normals of the
  // four faces round the vertex (terrainrep.cpp, getNormal).
  update()
  {
    if (!this.dirty.length) return;
    const { size, mesh } = this;
    const n = size + 1;
    const p = mesh.positions;
    const nr = mesh.normals;
    for (const [x0, z0, x1, z1] of this.dirty)
    {
      for (let z = z0; z <= z1; z++)
      {
        for (let x = x0; x <= x1; x++)
        {
          const v = (z * n + x) * 3;
          const h = this.height(x, z);
          p[v + 1] = h;
          if (!this.shading)
          {
            nr[v] = 0;
            nr[v + 1] = 1;
            nr[v + 2] = 0;
            continue;
          }
          // Rises to the neighbours: east, north (+z), west, south.
          const e = this.height(x + 1, z) - h;
          const no = this.height(x, z + 1) - h;
          const w = this.height(x - 1, z) - h;
          const so = this.height(x, z - 1) - h;
          // The four face normals are (-e, 1, so), (-e, 1, -no), (w, 1, -no)
          // and (w, 1, so), each made unit length.
          const a = 1 / Math.hypot(e, 1, so);
          const b = 1 / Math.hypot(e, 1, no);
          const c = 1 / Math.hypot(w, 1, no);
          const d = 1 / Math.hypot(w, 1, so);
          const sx = -e * (a + b) + w * (c + d);
          const sy = a + b + c + d;
          const sz = so * (a + d) - no * (b + c);
          const len = Math.hypot(sx, sy, sz);
          nr[v] = sx / len;
          nr[v + 1] = sy / len;
          nr[v + 2] = sz / len;
        }
      }
    }
    this.dirty = [];
    let top = 0;
    for (let i = 0; i < this.heights.length; i++) if (this.heights[i] > top) top = this.heights[i];
    mesh.bounds = new Aabb();
    mesh.bounds.min.set(0, 0, 0);
    mesh.bounds.max.set(size, top / 255, size);
    mesh.version++;
  }

  // Heights from an image: the brightest of red, green and blue, with the
  // image's top row at the far side (z = size - 1), as LoadTerrain reads it.
  fromImage(img)
  {
    const { width, data } = img;
    for (let y = 0; y < width; y++)
    {
      for (let x = 0; x < width; x++)
      {
        const o = (y * width + x) * 4;
        this.heights[(width - 1 - y) * this.size + x] = Math.max(data[o], data[o + 1], data[o + 2]);
      }
    }
    this.touch(0, 0, this.size, this.size);
  }
}

// What picking and collisions ask of a mesh's tree (see collide/bvh.js),
// answered from the grid: the triangles of the cells a box covers, or of
// the cells a ray crosses, in order. Nothing to build when heights change.
class TerrainGrid
{
  constructor(terrain)
  {
    this.terrain = terrain;
  }

  // Triangle t is the (t & 1)th of cell t >> 1 (cells row by row in z).
  corners(t, out)
  {
    const { positions, indices } = this.terrain.mesh;
    for (let k = 0; k < 3; k++)
    {
      const v = indices[t * 3 + k] * 3;
      out[k * 3] = positions[v];
      out[k * 3 + 1] = positions[v + 1];
      out[k * 3 + 2] = positions[v + 2];
    }
    return out;
  }

  // The lowest and highest corner of cell (x, z).
  cellRange(x, z)
  {
    const t = this.terrain;
    const a = t.height(x, z);
    const b = t.height(x + 1, z);
    const c = t.height(x, z + 1);
    const d = t.height(x + 1, z + 1);
    return [Math.min(a, b, c, d), Math.max(a, b, c, d)];
  }

  queryBox(minX, minY, minZ, maxX, maxY, maxZ, visit)
  {
    const size = this.terrain.size;
    const x0 = Math.max(0, Math.floor(minX));
    const z0 = Math.max(0, Math.floor(minZ));
    const x1 = Math.min(size - 1, Math.floor(maxX));
    const z1 = Math.min(size - 1, Math.floor(maxZ));
    for (let z = z0; z <= z1; z++)
    {
      for (let x = x0; x <= x1; x++)
      {
        const [lo, hi] = this.cellRange(x, z);
        if (lo > maxY || hi < minY) continue;
        const c = (z * size + x) * 2;
        visit(c);
        visit(c + 1);
      }
    }
  }

  // Walks the cells under the ray from origin + s * dir, s from 0 to maxS
  // (Amanatides and Woo's grid traversal in x and z). visit may return a
  // smaller maxS (the nearest hit so far) to stop early.
  queryRay(ox, oy, oz, dx, dy, dz, maxS, visit)
  {
    const size = this.terrain.size;
    // Clip the ray to the terrain's square.
    let s0 = 0;
    let s1 = maxS;
    for (const [o, d] of [[ox, dx], [oz, dz]])
    {
      if (d === 0)
      {
        if (o < 0 || o > size) return;
        continue;
      }
      let a = (0 - o) / d;
      let b = (size - o) / d;
      if (a > b) [a, b] = [b, a];
      s0 = Math.max(s0, a);
      s1 = Math.min(s1, b);
    }
    if (s0 > s1) return;
    const eps = 1e-9;
    let x = Math.min(size - 1, Math.max(0, Math.floor(ox + dx * (s0 + eps))));
    let z = Math.min(size - 1, Math.max(0, Math.floor(oz + dz * (s0 + eps))));
    const stepX = dx > 0 ? 1 : -1;
    const stepZ = dz > 0 ? 1 : -1;
    const nextX = dx === 0 ? Infinity : ((dx > 0 ? x + 1 : x) - ox) / dx;
    const nextZ = dz === 0 ? Infinity : ((dz > 0 ? z + 1 : z) - oz) / dz;
    const deltaX = dx === 0 ? Infinity : Math.abs(1 / dx);
    const deltaZ = dz === 0 ? Infinity : Math.abs(1 / dz);
    let tx = nextX;
    let tz = nextZ;
    let limit = s1;
    let enter = s0;
    while (x >= 0 && z >= 0 && x < size && z < size && enter <= limit)
    {
      const leave = Math.min(tx, tz, s1);
      // Skip cells the ray passes over or under.
      const ya = oy + dy * enter;
      const yb = oy + dy * leave;
      const [lo, hi] = this.cellRange(x, z);
      if (Math.min(ya, yb) <= hi && Math.max(ya, yb) >= lo)
      {
        const c = (z * size + x) * 2;
        for (const t of [c, c + 1])
        {
          const s = visit(t);
          if (typeof s === 'number' && s < limit) limit = s;
        }
      }
      if (tx < tz)
      {
        enter = tx;
        tx += deltaX;
        x += stepX;
      }
      else
      {
        enter = tz;
        tz += deltaZ;
        z += stepZ;
      }
    }
  }
}

export function isPowerOfTwo(n)
{
  return n >= 2 && (n & (n - 1)) === 0;
}
