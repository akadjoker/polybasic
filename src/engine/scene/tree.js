/*!
 * proctree.js
 * Copyright (c) 2012, Paul Brunt
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions are met:
 *     * Redistributions of source code must retain the above copyright
 *       notice, this list of conditions and the following disclaimer.
 *     * Redistributions in binary form must reproduce the above copyright
 *       notice, this list of conditions and the following disclaimer in the
 *       documentation and/or other materials provided with the distribution.
 *     * Neither the name of tree.js nor the
 *       names of its contributors may be used to endorse or promote products
 *       derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL PAUL BRUNT BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

// Trees made from a handful of numbers: a port of proctree.js (Copyright
// (c) 2012, Paul Brunt; BSD 3-clause licence, see LICENSE-THIRD-PARTY).
//
// A binary tree of branches is grown (split), rings of vertices are put at
// every fork (createForks), the rings are joined into bark (doFaces), and
// every branch tip gets a pair of leaf cards (createTwigs). Two details of
// the original are what the numbers mean, and are kept: the "random"
// numbers are |cos(a + a * a)|, and a branch splits across its direction
// crossed with a shuffle of its own components.
//
// proctree.js builds in a right-handed space with anticlockwise fronts and
// texture V counted from the bottom; the result is turned into PolyBasic's
// (X mirrored, corners swapped, V from the top), as the glTF reader does.
//
// The kinds are presets (Oak, Willow, Shrub, Ash, Poplar, Sequoia,
// Beech), all on the same base settings.

import { MeshData } from './mesh.js';

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (v) => Math.sqrt(dot(v, v));
const scale = (v, s) => [v[0] * s, v[1] * s, v[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const normalize = (v) =>
{
  const l = length(v);
  return l > 1e-20 ? scale(v, 1 / l) : [0, 0, 0];
};
// `vec` turned by `angle` about `axis` (Rodrigues).
const axisAngle = (vec, axis, angle) =>
{
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return add(add(scale(vec, c), scale(cross(axis, vec), s)), scale(axis, dot(axis, vec) * (1 - c)));
};
// Scales only the part of `vector` along `direction`.
const scaleInDirection = (vector, direction, s) =>
{
  const m = dot(vector, direction);
  return add(vector, scale(direction, m * s - m));
};

export const TREE_OAK = 1;
export const TREE_WILLOW = 2;
export const TREE_SHRUB = 3;
export const TREE_ASH = 4;
export const TREE_POPLAR = 5;
export const TREE_SEQUOIA = 6;
export const TREE_BEECH = 7;

const BASE = {
  clumpMax: 0.45, clumpMin: 0.40, lengthFalloffFactor: 0.85, lengthFalloffPower: 1, branchFactor: 2.45,
  radiusFalloffRate: 0.73, climbRate: 0.371, trunkKink: 0.093, maxRadius: 0.25, treeSteps: 2, taperRate: 0.95,
  twistRate: 3.02, segments: 6, levels: 5, sweepAmount: 0.01, initialBranchLength: 0.85, trunkLength: 2.5,
  dropAmount: -0.10, growAmount: 0.235, vMultiplier: 0.36, twigScale: 2.0, seed: 10
};

// Each kind: its settings on top of the base, and the leaves it wears
// (0 broad, 1 long and thin, 2 small and round).
export const TREE_KINDS = {
  [TREE_OAK]: { seed: 696, treeSteps: 9, initialBranchLength: 0.79, maxRadius: 0.22, trunkLength: 3.21, twigScale: 0.55, leaves: 0 },
  [TREE_WILLOW]: { seed: 264, levels: 4, treeSteps: 9, initialBranchLength: 0.59, lengthFalloffFactor: 0.57, dropAmount: 0.4, maxRadius: 0.05, radiusFalloffRate: 0.7, twistRate: 2.62, trunkLength: 1.79, twigScale: 0.4, leaves: 1 },
  [TREE_SHRUB]: { seed: 264, levels: 3, treeSteps: 0, initialBranchLength: 0.19, dropAmount: 0.2, maxRadius: 0.04, radiusFalloffRate: 0.58, twistRate: 5.0, trunkLength: 0.38, twigScale: 0.65, leaves: 0 },
  [TREE_ASH]: { levels: 7, initialBranchLength: 0.59, lengthFalloffFactor: 0.95, dropAmount: -0.3, growAmount: 0.03, maxRadius: 0.18, radiusFalloffRate: 0.61, climbRate: 0.2, trunkKink: -0.37, twistRate: 1.41, trunkLength: 7.05, twigScale: 0.65, leaves: 1 },
  [TREE_POPLAR]: { treeSteps: 30, dropAmount: 0.0, maxRadius: 0.2, climbRate: 0.3, trunkKink: 0.01, twistRate: -2.47, trunkLength: 3.61, twigScale: 1.0, leaves: 2 },
  [TREE_SEQUOIA]: { seed: 264, levels: 4, treeSteps: 12, initialBranchLength: 2.19, dropAmount: 0.0, growAmount: -0.38, maxRadius: 0.6, radiusFalloffRate: 0.57, climbRate: 2.02, trunkKink: 0.0, trunkLength: 11.52, twigScale: 2.0, leaves: 0 },
  [TREE_BEECH]: { seed: 325, levels: 7, treeSteps: 4, initialBranchLength: 0.89, dropAmount: 0.151, growAmount: 0.033, maxRadius: 0.21, climbRate: 0.37, twistRate: 2.21, trunkLength: 4.83, twigScale: 0.7, leaves: 0 }
};

// The settings of a kind, with `seed` (when not 0) in place of its own.
export function treeSettings(kind, seed = 0)
{
  const { leaves, ...own } = TREE_KINDS[kind];
  const p = { ...BASE, ...own };
  if (seed) p.seed = seed;
  // The forks are built from half rings: an even count of 4 or more.
  p.segments = Math.max(4, p.segments & ~1);
  p.levels = Math.max(1, p.levels);
  return { settings: p, leaves };
}

class Branch
{
  constructor(head, parent = null)
  {
    this.head = head;
    this.parent = parent;
    this.child0 = null;
    this.child1 = null;
    this.length = 1;
    this.type = null;
  }

  mirror(vec, norm, p)
  {
    const v = cross(norm, cross(vec, norm));
    const s = p.branchFactor * dot(v, vec);
    return [vec[0] - v[0] * s, vec[1] - v[1] * s, vec[2] - v[2] * s];
  }

  split(level, steps, p, random, l1 = 1, l2 = 1)
  {
    const rLevel = p.levels - level;
    let po;
    if (this.parent) po = this.parent.head;
    else
    {
      po = [0, 0, 0];
      this.type = 'trunk';
    }
    const so = this.head;
    const dir = normalize(sub(so, po));
    const normal = cross(dir, [dir[2], dir[0], dir[1]]);
    const tangent = cross(dir, normal);
    const r = random(rLevel * 10 + l1 * 5 + l2 + p.seed);
    let adj = add(scale(normal, r), scale(tangent, 1 - r));
    if (r > 0.5) adj = scale(adj, -1);
    const clump = (p.clumpMax - p.clumpMin) * r + p.clumpMin;
    let newdir = normalize(add(scale(adj, 1 - clump), scale(dir, clump)));
    let newdir2 = this.mirror(newdir, dir, p);
    if (r > 0.5)
    {
      const t = newdir;
      newdir = newdir2;
      newdir2 = t;
    }
    if (steps > 0)
    {
      const angle = steps / p.treeSteps * 2 * Math.PI * p.twistRate;
      newdir2 = normalize([Math.sin(angle), r, Math.cos(angle)]);
    }
    const grow = level * level / (p.levels * p.levels) * p.growAmount;
    const drop = rLevel * p.dropAmount;
    const sweep = rLevel * p.sweepAmount;
    newdir = normalize(add(newdir, [sweep, drop + grow, 0]));
    newdir2 = normalize(add(newdir2, [sweep, drop + grow, 0]));
    this.child0 = new Branch(add(so, scale(newdir, this.length)), this);
    this.child1 = new Branch(add(so, scale(newdir2, this.length)), this);
    this.child0.length = Math.pow(this.length, p.lengthFalloffPower) * p.lengthFalloffFactor;
    this.child1.length = Math.pow(this.length, p.lengthFalloffPower) * p.lengthFalloffFactor;
    if (level > 0)
    {
      if (steps > 0)
      {
        this.child0.head = add(this.head, [(r - 0.5) * 2 * p.trunkKink, p.climbRate, (r - 0.5) * 2 * p.trunkKink]);
        this.child0.type = 'trunk';
        this.child0.length = this.length * p.taperRate;
        this.child0.split(level, steps - 1, p, random, l1 + 1, l2);
      }
      else this.child0.split(level - 1, 0, p, random, l1 + 1, l2);
      this.child1.split(level - 1, 0, p, random, l1, l2 + 1);
    }
  }
}

class Builder
{
  constructor(p)
  {
    this.p = p;
    this.verts = [];
    this.faces = [];
    this.normals = [];
    this.uv = [];
    this.twigVerts = [];
    this.twigNormals = [];
    this.twigFaces = [];
    this.twigUvs = [];
    this.root = new Branch([0, p.trunkLength, 0]);
    this.root.length = p.initialBranchLength;
    const random = (a) => Math.abs(Math.cos(a + a * a));
    this.root.split(p.levels, p.treeSteps, p, random);
    this.createForks(this.root, p.maxRadius);
    this.createTwigs(this.root);
    this.doFaces(this.root);
    this.calcNormals();
  }

  calcNormals()
  {
    const all = this.verts.map(() => []);
    for (const f of this.faces)
    {
      const n = normalize(cross(sub(this.verts[f[1]], this.verts[f[2]]), sub(this.verts[f[1]], this.verts[f[0]])));
      all[f[0]].push(n);
      all[f[1]].push(n);
      all[f[2]].push(n);
    }
    this.normals = all.map((list) =>
    {
      let total = [0, 0, 0];
      for (const n of list) total = add(total, n);
      const l = length(total);
      return l > 1e-8 ? scale(total, 1 / l) : [0, 1, 0];
    });
  }

  doFaces(branch)
  {
    const p = this.p;
    const segments = p.segments;
    const { faces, verts, uv } = this;
    if (!branch.parent)
    {
      for (let i = 0; i < verts.length; i++) uv[i] = [0, 0];
      const tangent = normalize(cross(sub(branch.child0.head, branch.head), sub(branch.child1.head, branch.head)));
      const normal = normalize(branch.head);
      let angle = Math.acos(Math.max(-1, Math.min(1, dot(tangent, [-1, 0, 0]))));
      if (dot(cross([-1, 0, 0], tangent), normal) > 0) angle = 2 * Math.PI - angle;
      const segOffset = Math.round(angle / Math.PI / 2 * segments);
      for (let i = 0; i < segments; i++)
      {
        const v1 = branch.ring0[i];
        const v2 = branch.root[(i + segOffset + 1) % segments];
        const v3 = branch.root[(i + segOffset) % segments];
        const v4 = branch.ring0[(i + 1) % segments];
        faces.push([v1, v4, v3]);
        faces.push([v4, v2, v3]);
        uv[(i + segOffset) % segments] = [Math.abs(i / segments - 0.5) * 2, 0];
        const len = length(sub(verts[branch.ring0[i]], verts[branch.root[(i + segOffset) % segments]])) * p.vMultiplier;
        uv[branch.ring0[i]] = [Math.abs(i / segments - 0.5) * 2, len];
        uv[branch.ring2[i]] = [Math.abs(i / segments - 0.5) * 2, len];
      }
    }
    if (branch.child0.ring0)
    {
      let segOffset0;
      let segOffset1;
      let match0;
      let match1;
      let v1 = normalize(sub(verts[branch.ring1[0]], branch.head));
      let v2 = normalize(sub(verts[branch.ring2[0]], branch.head));
      v1 = scaleInDirection(v1, normalize(sub(branch.child0.head, branch.head)), 0);
      v2 = scaleInDirection(v2, normalize(sub(branch.child1.head, branch.head)), 0);
      for (let i = 0; i < segments; i++)
      {
        let d = normalize(sub(verts[branch.child0.ring0[i]], branch.child0.head));
        let l = dot(d, v1);
        if (segOffset0 === undefined || l > match0)
        {
          match0 = l;
          segOffset0 = segments - i;
        }
        d = normalize(sub(verts[branch.child1.ring0[i]], branch.child1.head));
        l = dot(d, v2);
        if (segOffset1 === undefined || l > match1)
        {
          match1 = l;
          segOffset1 = segments - i;
        }
      }
      const uvScale = p.maxRadius / branch.radius;
      for (let i = 0; i < segments; i++)
      {
        let a = branch.child0.ring0[i];
        let b = branch.ring1[(i + segOffset0 + 1) % segments];
        let c = branch.ring1[(i + segOffset0) % segments];
        let d = branch.child0.ring0[(i + 1) % segments];
        faces.push([a, d, c]);
        faces.push([d, b, c]);
        a = branch.child1.ring0[i];
        b = branch.ring2[(i + segOffset1 + 1) % segments];
        c = branch.ring2[(i + segOffset1) % segments];
        d = branch.child1.ring0[(i + 1) % segments];
        faces.push([a, b, c]);
        faces.push([a, d, b]);
        const len1 = length(sub(verts[branch.child0.ring0[i]], verts[branch.ring1[(i + segOffset0) % segments]])) * uvScale;
        const uv1 = uv[branch.ring1[(i + segOffset0 - 1) % segments]];
        uv[branch.child0.ring0[i]] = [uv1[0], uv1[1] + len1 * p.vMultiplier];
        uv[branch.child0.ring2[i]] = [uv1[0], uv1[1] + len1 * p.vMultiplier];
        const len2 = length(sub(verts[branch.child1.ring0[i]], verts[branch.ring2[(i + segOffset1) % segments]])) * uvScale;
        const uv2 = uv[branch.ring2[(i + segOffset1 - 1) % segments]];
        uv[branch.child1.ring0[i]] = [uv2[0], uv2[1] + len2 * p.vMultiplier];
        uv[branch.child1.ring2[i]] = [uv2[0], uv2[1] + len2 * p.vMultiplier];
      }
      this.doFaces(branch.child0);
      this.doFaces(branch.child1);
    }
    else
    {
      for (let i = 0; i < segments; i++)
      {
        faces.push([branch.child0.end, branch.ring1[(i + 1) % segments], branch.ring1[i]]);
        faces.push([branch.child1.end, branch.ring2[(i + 1) % segments], branch.ring2[i]]);
        let len = length(sub(verts[branch.child0.end], verts[branch.ring1[i]]));
        uv[branch.child0.end] = [Math.abs(i / segments - 1 - 0.5) * 2, len * p.vMultiplier];
        len = length(sub(verts[branch.child1.end], verts[branch.ring2[i]]));
        uv[branch.child1.end] = [Math.abs(i / segments - 0.5) * 2, len * p.vMultiplier];
      }
    }
  }

  createTwigs(branch)
  {
    const p = this.p;
    if (branch.child0)
    {
      this.createTwigs(branch.child0);
      this.createTwigs(branch.child1);
      return;
    }
    const tangent = normalize(cross(sub(branch.parent.child0.head, branch.parent.head), sub(branch.parent.child1.head, branch.parent.head)));
    const binormal = normalize(sub(branch.head, branch.parent.head));
    const s = p.twigScale;
    const corner = (t, b) => add(add(branch.head, scale(tangent, t)), scale(binormal, b));
    const top = s * 2 - branch.length;
    const bottom = -branch.length;
    const v = this.twigVerts;
    const base = v.length;
    // Two cards back to back, as proctree.js pushes them: vert1..vert4 face
    // one way; then vert8, vert7, vert6, vert5 (the same corners) the other.
    v.push(corner(s, top), corner(-s, top), corner(-s, bottom), corner(s, bottom));
    v.push(corner(s, top), corner(-s, top), corner(-s, bottom), corner(s, bottom));
    const [v1, v2, v3, v4] = [base, base + 1, base + 2, base + 3];
    const [v8, v7, v6, v5] = [base + 4, base + 5, base + 6, base + 7];
    this.twigFaces.push([v1, v2, v3], [v4, v1, v3], [v6, v7, v8], [v6, v8, v5]);
    const n1 = normalize(cross(sub(v[v1], v[v3]), sub(v[v2], v[v3])));
    const n2 = normalize(cross(sub(v[v7], v[v6]), sub(v[v8], v[v6])));
    this.twigNormals.push(n1, n1, n1, n1, n2, n2, n2, n2);
    this.twigUvs.push([0, 1], [1, 1], [1, 0], [0, 0], [0, 1], [1, 1], [1, 0], [0, 0]);
  }

  createForks(branch, radius)
  {
    const p = this.p;
    branch.radius = radius;
    if (radius > branch.length) radius = branch.length;
    const verts = this.verts;
    const segments = p.segments;
    const segmentAngle = Math.PI * 2 / segments;
    if (!branch.parent)
    {
      branch.root = [];
      for (let i = 0; i < segments; i++)
      {
        const vec = axisAngle([-1, 0, 0], [0, 1, 0], -segmentAngle * i);
        branch.root.push(verts.length);
        verts.push(scale(vec, radius / p.radiusFalloffRate));
      }
    }
    if (!branch.child0)
    {
      branch.end = verts.length;
      verts.push(branch.head);
      return;
    }
    const axis = branch.parent ? normalize(sub(branch.head, branch.parent.head)) : normalize(branch.head);
    const axis1 = normalize(sub(branch.head, branch.child0.head));
    const axis2 = normalize(sub(branch.head, branch.child1.head));
    const tangent = normalize(cross(axis1, axis2));
    branch.tangent = tangent;
    const axis3 = normalize(cross(tangent, normalize(add(scale(axis1, -1), scale(axis2, -1)))));
    const dir = [axis2[0], 0, axis2[2]];
    const centre = add(branch.head, scale(dir, -p.maxRadius / 2));
    const ring0 = branch.ring0 = [];
    const ring1 = branch.ring1 = [];
    const ring2 = branch.ring2 = [];
    let s = p.radiusFalloffRate;
    if (branch.child0.type === 'trunk' || branch.type === 'trunk') s = 1 / p.taperRate;
    const linch0 = verts.length;
    ring0.push(linch0);
    ring2.push(linch0);
    verts.push(add(centre, scale(tangent, radius * s)));
    let start = verts.length - 1;
    const d1 = axisAngle(tangent, axis2, 1.57);
    const d2 = normalize(cross(tangent, axis));
    const k = 1 / dot(d1, d2);
    for (let i = 1; i < segments / 2; i++)
    {
      let vec = axisAngle(tangent, axis2, segmentAngle * i);
      ring0.push(start + i);
      ring2.push(start + i);
      vec = scaleInDirection(vec, d2, k);
      verts.push(add(centre, scale(vec, radius * s)));
    }
    const linch1 = verts.length;
    ring0.push(linch1);
    ring1.push(linch1);
    verts.push(add(centre, scale(tangent, -radius * s)));
    for (let i = segments / 2 + 1; i < segments; i++)
    {
      const vec = axisAngle(tangent, axis1, segmentAngle * i);
      ring0.push(verts.length);
      ring1.push(verts.length);
      verts.push(add(centre, scale(vec, radius * s)));
    }
    ring1.push(linch0);
    ring2.push(linch1);
    start = verts.length - 1;
    for (let i = 1; i < segments / 2; i++)
    {
      const vec = axisAngle(tangent, axis3, segmentAngle * i);
      ring1.push(start + i);
      ring2.push(start + (segments / 2 - i));
      verts.push(add(centre, scale(vec, radius * s)));
    }
    const radius0 = branch.child0.type === 'trunk' ? radius * p.taperRate : radius * p.radiusFalloffRate;
    const radius1 = radius * p.radiusFalloffRate;
    this.createForks(branch.child0, radius0);
    this.createForks(branch.child1, radius1);
  }
}

// proctree.js's space to PolyBasic's: X mirrored, two corners swapped, V
// counted from the top.
function toMesh(verts, normals, uvs, faces)
{
  const positions = [];
  const n = [];
  const t = [];
  for (let i = 0; i < verts.length; i++)
  {
    positions.push(-verts[i][0], verts[i][1], verts[i][2]);
    n.push(-normals[i][0], normals[i][1], normals[i][2]);
    const uv = uvs[i] || [0, 0];
    t.push(uv[0], 1 - uv[1]);
  }
  const indices = [];
  for (const f of faces) indices.push(f[0], f[2], f[1]);
  return new MeshData(positions, n, t, indices);
}

// A tree of `kind` (TREE_*): { bark, twigs } meshes and its kind of leaves.
export function buildTree(kind, seed = 0)
{
  const { settings, leaves } = treeSettings(kind, seed);
  const b = new Builder(settings);
  return {
    bark: toMesh(b.verts, b.normals, b.uv, b.faces),
    twigs: toMesh(b.twigVerts, b.twigNormals, b.twigUvs, b.twigFaces),
    leaves
  };
}
