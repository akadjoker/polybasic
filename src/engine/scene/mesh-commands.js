// The commands that build and change meshes, as in Blitz3D: surfaces,
// vertices, triangles, and whole-mesh changes (ScaleMesh, FitMesh...).
// Signatures use the format of src/engine/commands.js.
//
// Any mesh can be changed, the built-in shapes too: a shape shares its
// geometry with every other of its kind, so the first change gives the
// entity a copy of its own (as Blitz3D's shapes are separate meshes).
// Copies made with CopyEntity share the mesh they were copied from, as in
// Blitz3D; CopyMesh makes a separate one.

import { handleHelpers, describe } from '../handles.js';
import { runtimeError } from '../../runtime/errors.js';
import { EditableMesh, Surface } from './editable.js';
import { Quat } from '../math/quat.js';
import { Vec3 } from '../math/vec3.js';
import { Aabb } from '../math/aabb.js';

export const MESH_COMMANDS = [
  'CreateMesh%(parent = 0)',
  'CreateSurface%(mesh)',
  'CountSurfaces%(mesh)',
  'GetSurface%(mesh, index)',
  'ClearSurface(surface, vertices = 1, triangles = 1)',
  'AddVertex%(surface, x#, y#, z#, u# = 0, v# = 0, w# = 1)',
  'AddTriangle%(surface, v0, v1, v2)',
  'VertexCoords(surface, index, x#, y#, z#)',
  'VertexNormal(surface, index, nx#, ny#, nz#)',
  'VertexColor(surface, index, r#, g#, b#, a# = 1)',
  'VertexTexCoords(surface, index, u#, v#, w# = 1, set = 0)',
  'CountVertices%(surface)',
  'CountTriangles%(surface)',
  'VertexX#(surface, index)',
  'VertexY#(surface, index)',
  'VertexZ#(surface, index)',
  'VertexNX#(surface, index)',
  'VertexNY#(surface, index)',
  'VertexNZ#(surface, index)',
  'VertexRed#(surface, index)',
  'VertexGreen#(surface, index)',
  'VertexBlue#(surface, index)',
  'VertexAlpha#(surface, index)',
  'VertexU#(surface, index, set = 0)',
  'VertexV#(surface, index, set = 0)',
  'TriangleVertex%(surface, triangle, corner)',
  'UpdateNormals(mesh)',
  'ScaleMesh(mesh, x#, y#, z#)',
  'RotateMesh(mesh, pitch#, yaw#, roll#)',
  'PositionMesh(mesh, x#, y#, z#)',
  'FitMesh(mesh, x#, y#, z#, width#, height#, depth#, uniform = 0)',
  'FlipMesh(mesh)',
  'AddMesh(source, dest)',
  'CopyMesh%(mesh, parent = 0)',
  'MeshWidth#(mesh)',
  'MeshHeight#(mesh)',
  'MeshDepth#(mesh)'
];

export const MESH_CONSTANTS = {
  FX_VERTEXCOLOR: 2,
  FX_VERTEXALPHA: 32
};

// Moves every vertex of a mesh by the 3x3 matrix `m` (row-major, as
// [[a, b, c], ...]) and the offset `t`; normals turn with the matrix's
// cofactors (so they stay square to the surface when it is stretched).
function transform(mesh, m, t)
{
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const co = [
    [e * i - f * h, f * g - d * i, d * h - e * g],
    [c * h - b * i, a * i - c * g, b * g - a * h],
    [b * f - c * e, c * d - a * f, a * e - b * d]
  ];
  for (const s of mesh.surfaces)
  {
    const p = s.positions;
    const n = s.normals;
    for (let k = 0; k < p.length; k += 3)
    {
      const [x, y, z] = [p[k], p[k + 1], p[k + 2]];
      p[k] = a * x + b * y + c * z + t[0];
      p[k + 1] = d * x + e * y + f * z + t[1];
      p[k + 2] = g * x + h * y + i * z + t[2];
      const [nx, ny, nz] = [n[k], n[k + 1], n[k + 2]];
      const ox = co[0][0] * nx + co[0][1] * ny + co[0][2] * nz;
      const oy = co[1][0] * nx + co[1][1] * ny + co[1][2] * nz;
      const oz = co[2][0] * nx + co[2][1] * ny + co[2][2] * nz;
      const l = Math.hypot(ox, oy, oz) || 1;
      n[k] = ox / l;
      n[k + 1] = oy / l;
      n[k + 2] = oz / l;
    }
  }
  mesh.touch();
}

// A matrix's 3x3 part and translation (Mat4 is column-major).
function affine(mat)
{
  const e = mat.e;
  return { m: [[e[0], e[4], e[8]], [e[1], e[5], e[9]], [e[2], e[6], e[10]]], t: [e[12], e[13], e[14]] };
}

const mul3 = (a, b) => a.map((row) => [0, 1, 2].map((c) => row[0] * b[0][c] + row[1] * b[1][c] + row[2] * b[2][c]));
const mulv = (a, v) => a.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);

export function createMeshCommands(engine)
{
  const world = engine.world;
  const { entity, parentOf } = handleHelpers(world);

  const newSurface = (mesh) =>
  {
    const s = new Surface(mesh);
    world.addHandle(s);
    mesh.surfaces.push(s);
    mesh.touch();
    return s;
  };
  // The box that MeshWidth and the like measure: a mesh's own, or, for a
  // loaded model, the box around all its parts in the model's space
  // (empty while it is still loading). Measuring changes nothing.
  const measured = (handle) =>
  {
    const e = entity(handle);
    if (e.kind === 'mesh' && e.mesh && !e.sprite && !e.trail) return e.mesh.bounds;
    if (!e.model) throw runtimeError(`Entity ${handle} is not a mesh or a model`);
    const box = new Aabb();
    const toModel = e.worldMatrix.clone();
    toModel.invert();
    const visit = (n) =>
    {
      if (n !== e && n.mesh && !n.mesh.bounds.isEmpty())
      {
        const part = n.mesh.bounds.transformed(n.worldMatrix.clone().premultiply(toModel));
        box.expandByPoint(part.min).expandByPoint(part.max);
      }
      for (const c of n.children) visit(c);
    };
    visit(e);
    return box;
  };
  // Changes the geometry of a mesh, or of every part of a loaded model in
  // the model's own space (once it has arrived): fn(mesh, into) where
  // into(m, t) gives the change x -> m x + t as the part's own.
  const reshape = (handle, fn) =>
  {
    const e = entity(handle);
    if (!e.model)
    {
      fn(mesh(handle), (m, t) => ({ m, t }));
      return;
    }
    engine.models.whenLoaded(e, () =>
    {
      const toModel = e.worldMatrix.clone();
      toModel.invert();
      const visit = (n) =>
      {
        if (n !== e && n.mesh && n.kind === 'mesh')
        {
          if (!(n.mesh instanceof EditableMesh))
          {
            n.mesh = EditableMesh.from(n.mesh);
            for (const surface of n.mesh.surfaces) world.addHandle(surface);
          }
          const P = affine(n.worldMatrix.clone().premultiply(toModel));
          const back = n.worldMatrix.clone().premultiply(toModel);
          back.invert();
          const Pi = affine(back);
          // Pi (m (P x + p) + t) + pi
          fn(n.mesh, (m, t) => ({
            m: mul3(Pi.m, mul3(m, P.m)),
            t: mulv(Pi.m, mulv(m, P.t).map((v, k) => v + t[k])).map((v, k) => v + Pi.t[k])
          }));
        }
        for (const c of n.children) visit(c);
      };
      visit(e);
    });
  };
  const change = (handle, m, t) => reshape(handle, (mesh, into) =>
  {
    const own = into(m, t);
    transform(mesh, own.m, own.t);
  });
  // FitMesh: scale and move so the box b fills the given one.
  const fit = (handle, b, x, y, z, width, height, depth, uniform) =>
  {
    if (b.isEmpty()) return;
    const size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
    let s = [width, height, depth].map((want, n) => (size[n] > 0 ? want / size[n] : 1));
    if (uniform)
    {
      // Blitz3D's rule: the smallest of the three, for all of them.
      if (s[0] < s[1] && s[0] < s[2]) s = [s[0], s[0], s[0]];
      else if (s[1] < s[0] && s[1] < s[2]) s = [s[1], s[1], s[1]];
      else s = [s[2], s[2], s[2]];
    }
    const centre = [(b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2];
    const target = [x + width / 2, y + height / 2, z + depth / 2];
    change(handle, [[s[0], 0, 0], [0, s[1], 0], [0, 0, s[2]]], [0, 1, 2].map((n) => target[n] - s[n] * centre[n]));
  };
  const flip = (m) =>
  {
    for (const surface of m.surfaces)
    {
      for (let k = 0; k < surface.normals.length; k++) surface.normals[k] = -surface.normals[k];
      const t = surface.triangles;
      for (let k = 0; k < t.length; k += 3) [t[k + 1], t[k + 2]] = [t[k + 2], t[k + 1]];
    }
    m.touch();
  };
  // The mesh of an entity, made its own and changeable.
  const mesh = (handle) =>
  {
    const e = entity(handle);
    if (e.kind !== 'mesh' || !e.mesh) throw runtimeError(`Entity ${handle} is not a mesh`);
    if (e.sprite) throw runtimeError(`Entity ${handle} is a sprite: its square cannot be changed`);
    if (e.trail) throw runtimeError(`Entity ${handle} is a trail: its mesh is made anew every step`);
    if (!(e.mesh instanceof EditableMesh))
    {
      e.mesh = EditableMesh.from(e.mesh);
      for (const s of e.mesh.surfaces) world.addHandle(s);
    }
    return e.mesh;
  };
  const surface = (handle) =>
  {
    const s = world.handles.get(handle);
    if (s instanceof Surface) return s;
    if (handle === 0) throw runtimeError('Surface handle is 0 (no surface)');
    if (s) throw runtimeError(`Handle ${handle} is ${describe(s)}, not a surface`);
    throw runtimeError(`Surface ${handle} does not exist`);
  };
  const vertex = (s, index) =>
  {
    if (!(index >= 0 && index < s.vertexCount)) throw runtimeError(`Surface ${s.handle} has ${s.vertexCount} vertices (0 to ${s.vertexCount - 1}), not number ${index}`);
    return index;
  };
  const uvSet = (set) =>
  {
    if (set !== 0) throw runtimeError(`Only texture coordinate set 0 is supported, not ${set}`);
  };
  // A new mesh entity with a copy of `source`'s surfaces.
  const copyInto = (dest, source) =>
  {
    for (const from of source.surfaces)
    {
      const s = newSurface(dest);
      s.positions = from.positions.slice();
      s.normals = from.normals.slice();
      s.uvs = from.uvs.slice();
      s.colors = from.colors.slice();
      s.triangles = from.triangles.slice();
    }
    dest.colored = dest.colored || source.colored;
    dest.touch();
  };

  return {
    createmesh(parent)
    {
      engine.autoGraphics();
      return world.createMesh(new EditableMesh(), parentOf(parent)).id;
    },
    createsurface: (handle) => newSurface(mesh(handle)).handle,
    countsurfaces: (handle) => mesh(handle).surfaces.length,
    getsurface(handle, index)
    {
      const m = mesh(handle);
      if (!(index >= 1 && index <= m.surfaces.length)) throw runtimeError(`Mesh ${handle} has ${m.surfaces.length} surface${m.surfaces.length === 1 ? '' : 's'}, not number ${index} (they are numbered from 1)`);
      return m.surfaces[index - 1].handle;
    },
    clearsurface(handle, vertices, triangles)
    {
      surface(handle).clear(vertices !== 0, triangles !== 0);
    },
    addvertex: (handle, x, y, z, u, v) => surface(handle).addVertex(x, y, z, u, v),
    addtriangle(handle, a, b, c)
    {
      const s = surface(handle);
      return s.addTriangle(vertex(s, a), vertex(s, b), vertex(s, c));
    },
    vertexcoords(handle, index, x, y, z)
    {
      const s = surface(handle);
      s.setPosition(vertex(s, index), x, y, z);
    },
    vertexnormal(handle, index, x, y, z)
    {
      const s = surface(handle);
      s.setNormal(vertex(s, index), x, y, z);
    },
    vertexcolor(handle, index, r, g, b, a)
    {
      const s = surface(handle);
      s.setColor(vertex(s, index), r, g, b, a);
    },
    vertextexcoords(handle, index, u, v, w, set)
    {
      uvSet(set);
      const s = surface(handle);
      s.setUv(vertex(s, index), u, v);
    },
    countvertices: (handle) => surface(handle).vertexCount,
    counttriangles: (handle) => surface(handle).triangleCount,
    vertexx: (h, i) => { const s = surface(h); return s.positions[vertex(s, i) * 3]; },
    vertexy: (h, i) => { const s = surface(h); return s.positions[vertex(s, i) * 3 + 1]; },
    vertexz: (h, i) => { const s = surface(h); return s.positions[vertex(s, i) * 3 + 2]; },
    vertexnx: (h, i) => { const s = surface(h); return s.normals[vertex(s, i) * 3]; },
    vertexny: (h, i) => { const s = surface(h); return s.normals[vertex(s, i) * 3 + 1]; },
    vertexnz: (h, i) => { const s = surface(h); return s.normals[vertex(s, i) * 3 + 2]; },
    vertexred: (h, i) => { const s = surface(h); return s.color(vertex(s, i), 0); },
    vertexgreen: (h, i) => { const s = surface(h); return s.color(vertex(s, i), 1); },
    vertexblue: (h, i) => { const s = surface(h); return s.color(vertex(s, i), 2); },
    vertexalpha: (h, i) => { const s = surface(h); return s.color(vertex(s, i), 3); },
    vertexu: (h, i, set) => { uvSet(set); const s = surface(h); return s.uvs[vertex(s, i) * 2]; },
    vertexv: (h, i, set) => { uvSet(set); const s = surface(h); return s.uvs[vertex(s, i) * 2 + 1]; },
    trianglevertex(handle, triangle, corner)
    {
      const s = surface(handle);
      if (!(triangle >= 0 && triangle < s.triangleCount)) throw runtimeError(`Surface ${handle} has ${s.triangleCount} triangles (0 to ${s.triangleCount - 1}), not number ${triangle}`);
      if (!(corner >= 0 && corner <= 2)) throw runtimeError(`A triangle's corners are 0, 1 and 2, not ${corner}`);
      return s.triangles[triangle * 3 + corner];
    },
    updatenormals(handle)
    {
      for (const s of mesh(handle).surfaces) s.updateNormals();
    },
    scalemesh(handle, x, y, z)
    {
      change(handle, [[x, 0, 0], [0, y, 0], [0, 0, z]], [0, 0, 0]);
    },
    rotatemesh(handle, pitch, yaw, roll)
    {
      const q = new Quat().fromEuler(pitch, yaw, roll);
      const col = (v) => new Vec3(...v).applyQuat(q);
      const [i, j, k] = [col([1, 0, 0]), col([0, 1, 0]), col([0, 0, 1])];
      change(handle, [[i.x, j.x, k.x], [i.y, j.y, k.y], [i.z, j.z, k.z]], [0, 0, 0]);
    },
    positionmesh(handle, x, y, z)
    {
      change(handle, [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [x, y, z]);
    },
    fitmesh(handle, x, y, z, width, height, depth, uniform)
    {
      const e = entity(handle);
      if (e.model) engine.models.whenLoaded(e, () => fit(handle, measured(handle), x, y, z, width, height, depth, uniform));
      else fit(handle, mesh(handle).bounds, x, y, z, width, height, depth, uniform);
    },
    flipmesh(handle)
    {
      reshape(handle, (m) => flip(m));
    },
    addmesh(source, dest)
    {
      if (source === dest) throw runtimeError('A mesh cannot be added to itself');
      copyInto(mesh(dest), mesh(source));
    },
    copymesh(handle, parent)
    {
      const src = entity(handle);
      const from = mesh(handle);
      const e = world.createMesh(new EditableMesh(), parentOf(parent));
      copyInto(e.mesh, from);
      e.materials = src.materials.map((m) => m.clone());
      return e.id;
    },
    meshwidth: (handle) => { const b = measured(handle); return b.isEmpty() ? 0 : b.max.x - b.min.x; },
    meshheight: (handle) => { const b = measured(handle); return b.isEmpty() ? 0 : b.max.y - b.min.y; },
    meshdepth: (handle) => { const b = measured(handle); return b.isEmpty() ? 0 : b.max.z - b.min.z; }
  };
}
