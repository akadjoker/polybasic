// A bounding volume hierarchy over the triangles of a mesh, in the mesh's
// own space. Picking and collisions ask it for the few triangles near a ray
// or inside a box instead of testing every triangle.
//
// Built once per mesh version (meshBvh caches it on the MeshData): a binary
// tree of boxes, split at the middle of the longest axis of the triangle
// centres, with up to LEAF_SIZE triangles per leaf. Nodes live in flat
// arrays; the triangles are reordered so every node owns a contiguous run.

const LEAF_SIZE = 4;

export class MeshBvh
{
  constructor(positions, indices)
  {
    this.positions = positions;
    const count = indices.length / 3;
    this.triangleCount = count;
    // Triangle corners as vertex numbers, and each triangle's box and centre.
    this.tri = Uint32Array.from(indices);
    const box = new Float64Array(count * 6);
    const centre = new Float64Array(count * 3);
    for (let t = 0; t < count; t++)
    {
      for (let axis = 0; axis < 3; axis++)
      {
        const a = positions[this.tri[t * 3] * 3 + axis];
        const b = positions[this.tri[t * 3 + 1] * 3 + axis];
        const c = positions[this.tri[t * 3 + 2] * 3 + axis];
        const lo = Math.min(a, b, c);
        const hi = Math.max(a, b, c);
        box[t * 6 + axis] = lo;
        box[t * 6 + 3 + axis] = hi;
        centre[t * 3 + axis] = (lo + hi) / 2;
      }
    }
    this.boxes = box;
    this.order = new Uint32Array(count);
    for (let t = 0; t < count; t++) this.order[t] = t;

    // At most 2n - 1 nodes.
    const maxNodes = Math.max(1, count * 2);
    this.bounds = new Float64Array(maxNodes * 6);
    this.left = new Int32Array(maxNodes);     // -1 for a leaf
    this.start = new Uint32Array(maxNodes);   // leaf: first entry in `order`
    this.count = new Uint32Array(maxNodes);   // leaf: number of triangles
    this.nodes = 0;
    if (count) this.build(box, centre, 0, count);
    else
    {
      // An empty mesh: one empty leaf.
      this.bounds.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], 0);
      this.left[0] = -1;
      this.nodes = 1;
    }
  }

  // Builds the node for order[from .. to) and returns its index.
  build(box, centre, from, to)
  {
    const node = this.nodes++;
    const b = this.bounds;
    const lo = [Infinity, Infinity, Infinity];
    const hi = [-Infinity, -Infinity, -Infinity];
    const clo = [Infinity, Infinity, Infinity];
    const chi = [-Infinity, -Infinity, -Infinity];
    for (let i = from; i < to; i++)
    {
      const t = this.order[i];
      for (let axis = 0; axis < 3; axis++)
      {
        lo[axis] = Math.min(lo[axis], box[t * 6 + axis]);
        hi[axis] = Math.max(hi[axis], box[t * 6 + 3 + axis]);
        clo[axis] = Math.min(clo[axis], centre[t * 3 + axis]);
        chi[axis] = Math.max(chi[axis], centre[t * 3 + axis]);
      }
    }
    b.set([...lo, ...hi], node * 6);
    const n = to - from;
    let axis = 0;
    if (chi[1] - clo[1] > chi[axis] - clo[axis]) axis = 1;
    if (chi[2] - clo[2] > chi[axis] - clo[axis]) axis = 2;
    if (n <= LEAF_SIZE || chi[axis] - clo[axis] <= 0)
    {
      this.left[node] = -1;
      this.start[node] = from;
      this.count[node] = n;
      return node;
    }
    // Partition around the middle of the centres' extent.
    const mid = (clo[axis] + chi[axis]) / 2;
    let i = from;
    let j = to - 1;
    while (i <= j)
    {
      if (centre[this.order[i] * 3 + axis] < mid) i++;
      else
      {
        const tmp = this.order[i];
        this.order[i] = this.order[j];
        this.order[j] = tmp;
        j--;
      }
    }
    let split = i;
    if (split === from || split === to) split = (from + to) >> 1;
    const leftChild = this.build(box, centre, from, split);
    const rightChild = this.build(box, centre, split, to);
    // The right child always follows the left subtree, so only the left
    // index is stored; the right one is kept in `start` for inner nodes.
    this.left[node] = leftChild;
    this.start[node] = rightChild;
    return node;
  }

  // Writes the corners of triangle t (an index into the mesh's triangles)
  // into out[0..8].
  corners(t, out)
  {
    const p = this.positions;
    for (let k = 0; k < 3; k++)
    {
      const v = this.tri[t * 3 + k] * 3;
      out[k * 3] = p[v];
      out[k * 3 + 1] = p[v + 1];
      out[k * 3 + 2] = p[v + 2];
    }
    return out;
  }

  // Calls visit(t) for every triangle whose box overlaps the box
  // [minX, minY, minZ] .. [maxX, maxY, maxZ].
  queryBox(minX, minY, minZ, maxX, maxY, maxZ, visit)
  {
    const b = this.bounds;
    const stack = [0];
    while (stack.length)
    {
      const node = stack.pop();
      const o = node * 6;
      if (b[o] > maxX || b[o + 3] < minX || b[o + 1] > maxY || b[o + 4] < minY || b[o + 2] > maxZ || b[o + 5] < minZ) continue;
      if (this.left[node] < 0)
      {
        const tb = this.boxes;
        const end = this.start[node] + this.count[node];
        for (let i = this.start[node]; i < end; i++)
        {
          const t = this.order[i];
          const q = t * 6;
          if (tb[q] > maxX || tb[q + 3] < minX || tb[q + 1] > maxY || tb[q + 4] < minY || tb[q + 2] > maxZ || tb[q + 5] < minZ) continue;
          visit(t);
        }
      }
      else stack.push(this.start[node], this.left[node]);
    }
  }

  // Calls visit(t) for triangles in nodes the ray origin + s * dir
  // (0 <= s <= maxS) passes through. visit may return a new, smaller maxS
  // (the nearest hit so far) to prune the rest of the search.
  queryRay(ox, oy, oz, dx, dy, dz, maxS, visit)
  {
    const b = this.bounds;
    const ix = 1 / dx;
    const iy = 1 / dy;
    const iz = 1 / dz;
    const stack = [0];
    let limit = maxS;
    while (stack.length)
    {
      const node = stack.pop();
      const o = node * 6;
      if (!slab(b, o, ox, oy, oz, ix, iy, iz, limit)) continue;
      if (this.left[node] < 0)
      {
        const end = this.start[node] + this.count[node];
        for (let i = this.start[node]; i < end; i++)
        {
          const s = visit(this.order[i]);
          if (typeof s === 'number' && s < limit) limit = s;
        }
      }
      else stack.push(this.start[node], this.left[node]);
    }
  }
}

// The entry and exit distances of the ray while it crosses a box.
const range = new Float64Array(2);

// Does the ray reach the box at bounds[o..o+5] before `limit`? Runs for
// every node visited, so it allocates nothing.
function slab(b, o, ox, oy, oz, ix, iy, iz, limit)
{
  range[0] = 0;
  range[1] = limit;
  return slabAxis(b[o], b[o + 3], ox, ix) &&
    slabAxis(b[o + 1], b[o + 4], oy, iy) &&
    slabAxis(b[o + 2], b[o + 5], oz, iz);
}

function slabAxis(lo, hi, origin, inv)
{
  let near = (lo - origin) * inv;
  let far = (hi - origin) * inv;
  // A zero direction gives +-Infinity, or NaN when the origin lies on the
  // face: inside the slab is a pass, outside a miss.
  if (near !== near || far !== far) return origin >= lo && origin <= hi;
  if (near > far)
  {
    const t = near;
    near = far;
    far = t;
  }
  if (near > range[0]) range[0] = near;
  if (far < range[1]) range[1] = far;
  return range[0] <= range[1];
}

// The tree of a mesh, built on first use and rebuilt when the mesh changes.
export function meshBvh(mesh)
{
  // A terrain answers from its grid instead (scene/terrain.js).
  if (mesh.grid) return mesh.grid;
  // A posed mesh (MD2) is built again only when asked after a new pose.
  if (!mesh.bvhCache || mesh.bvhCache.version !== mesh.version || mesh.bvhCache.pose !== mesh.pose)
  {
    mesh.bvhCache = { version: mesh.version, pose: mesh.pose, bvh: new MeshBvh(mesh.positions, mesh.indices) };
  }
  return mesh.bvhCache.bvh;
}
