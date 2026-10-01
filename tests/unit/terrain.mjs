// Terrains: the grid answers picks and collisions exactly as a tree built
// over the same triangles would, and a mesh brought up to date a patch at a
// time is the same as one made afresh.

import { readFile } from 'node:fs/promises';
import { Terrain } from '../../src/engine/scene/terrain.js';
import { MeshBvh } from '../../src/engine/collide/bvh.js';
import { rayTriangle } from '../../src/engine/collide/sweep.js';
import { decodeImage } from '../../src/engine/image/decode.js';
import { assert } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

const HEIGHTMAP = new URL('../../examples/assets/blitz3d/driver/heightmap_256.bmp', import.meta.url);

function random(seed)
{
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
}

test('the grid finds the same nearest triangle as a tree, and every triangle a box touches', async () =>
{
  const t = new Terrain(256);
  t.fromImage(await decodeImage(await readFile(HEIGHTMAP)));
  t.update();
  const tree = new MeshBvh(t.mesh.positions, t.mesh.indices);
  const grid = t.mesh.grid;
  const rnd = random(7);
  const corners = new Float64Array(9);
  const nearest = (q, o, d) =>
  {
    const hit = { t: 1 };
    let got = -1;
    q.queryRay(o[0], o[1], o[2], d[0], d[1], d[2], 1, (i) =>
    {
      if (!rayTriangle(o[0], o[1], o[2], d[0], d[1], d[2], q.corners(i, corners), true, hit)) return undefined;
      got = i;
      return hit.t;
    });
    return [got, hit.t];
  };
  let hits = 0;
  for (let i = 0; i < 600; i++)
  {
    // From beside, above and inside the terrain's square, some rising.
    const o = [rnd() * 300 - 20, rnd() * 2, rnd() * 300 - 20];
    const d = [rnd() * 200 - 100, rnd() * -2 + (i % 3 === 0 ? 0.3 : 0), rnd() * 200 - 100];
    const a = nearest(tree, o, d);
    const b = nearest(grid, o, d);
    if (a[0] >= 0) hits++;
    assert(a[0] === b[0] && Math.abs(a[1] - b[1]) < 1e-9, `ray ${o} ${d}: tree ${a}, grid ${b}`);
  }
  assert(hits > 100, `only ${hits} rays hit the terrain`);
  for (let i = 0; i < 200; i++)
  {
    const c = [rnd() * 256, rnd(), rnd() * 256];
    const r = rnd() * 3;
    const want = new Set();
    tree.queryBox(c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r, (x) => want.add(x));
    const got = new Set();
    grid.queryBox(c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r, (x) => got.add(x));
    for (const x of want) assert(got.has(x), `box at ${c} radius ${r}: triangle ${x} missed`);
  }
});

test('changing heights a few at a time gives the mesh a fresh terrain would have', () =>
{
  const rnd = random(3);
  const changed = new Terrain(16);
  changed.setShading(true);
  changed.update();
  for (let round = 0; round < 20; round++)
  {
    // Edges and corners too: those heights are also the far edge's.
    for (let k = 0; k < 5; k++) changed.setHeight(Math.floor(rnd() * 17), Math.floor(rnd() * 17), rnd());
    changed.update();
  }
  const fresh = new Terrain(16);
  fresh.heights.set(changed.heights);
  fresh.setShading(true);
  fresh.update();
  for (const key of ['positions', 'normals'])
  {
    const a = changed.mesh[key];
    const b = fresh.mesh[key];
    for (let i = 0; i < a.length; i++) assert(Math.abs(a[i] - b[i]) < 1e-6, `${key}[${i}]: ${a[i]} not ${b[i]}`);
  }
  assert(changed.mesh.bounds.max.y === fresh.mesh.bounds.max.y, 'bounds');
});

test('without shading every normal points up, as in Blitz3D', () =>
{
  const t = new Terrain(8);
  for (let i = 0; i < 9; i++) t.setHeight(i, i, i / 8);
  t.update();
  for (let v = 0; v < t.mesh.normals.length; v += 3)
  {
    assert(t.mesh.normals[v] === 0 && t.mesh.normals[v + 1] === 1 && t.mesh.normals[v + 2] === 0, `normal ${v / 3}`);
  }
});

export default unit;
