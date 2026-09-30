// MD2 models (Quake 2's format) as Blitz3D reads and plays them
// (blitz3d/md2rep.cpp, md2model.cpp). Every frame keeps each vertex as
// three bytes, scaled and moved by the frame, and the index of its normal
// in a table; a pose between two frames is the straight blend of the two.
//
// The file's axes (x, y, z) are Blitz3D's (z, x, y), and its triangles are
// turned round (corners 0, 2, 1). A vertex is one pair of the file's vertex
// and texture coordinate. The skin named in the file is not loaded: a
// program gives the model its texture with EntityTexture, as in Blitz3D.

import { MeshData } from '../scene/mesh.js';
import { Aabb } from '../math/aabb.js';
import { Vec3 } from '../math/vec3.js';
import { MD2_NORMALS } from './md2-normals.js';

const MAGIC = 0x32504449;   // "IDP2"
const HEADER = 68;

// Blitz3D's normals table with its axes swapped as the vertices are.
const NORMALS = new Float32Array(MD2_NORMALS.length);
for (let i = 0; i < MD2_NORMALS.length; i += 3)
{
  NORMALS[i] = MD2_NORMALS[i + 1];
  NORMALS[i + 1] = MD2_NORMALS[i + 2];
  NORMALS[i + 2] = MD2_NORMALS[i];
}

export function readMd2(bytes)
{
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < HEADER) throw new Error('not an MD2 file (too short)');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const int = (i) => view.getInt32(i * 4, true);
  if (int(0) !== MAGIC) throw new Error('not an MD2 file');
  if (int(1) !== 8) throw new Error(`MD2 version ${int(1)}; only version 8 is read`);
  const skinWidth = int(2);
  const skinHeight = int(3);
  const frameSize = int(4);
  const fileVerts = int(6);
  const fileUvs = int(7);
  const triCount = int(8);
  const frameCount = int(10);
  const uvAt = int(12);
  const triAt = int(13);
  const frameAt = int(14);
  if (frameCount <= 0) throw new Error('the MD2 file has no frames');
  const fits = (at, size) => at >= 0 && size >= 0 && at + size <= data.length;
  if (skinWidth <= 0 || skinHeight <= 0) throw new Error(`MD2 skin size ${skinWidth} x ${skinHeight}`);
  if (!fits(uvAt, fileUvs * 4) || !fits(triAt, triCount * 12) || !fits(frameAt, frameCount * frameSize) || frameSize < 40 + fileVerts * 4)
  {
    throw new Error('MD2 file is cut short or its header is damaged');
  }

  // One vertex per (file vertex, texture coordinate) pair, in the order
  // the triangles first use them.
  const pairs = new Map();
  const source = [];
  const uvs = [];
  const indices = new Uint32Array(triCount * 3);
  for (let t = 0; t < triCount; t++)
  {
    const corner = [];
    for (let j = 0; j < 3; j++)
    {
      const v = view.getUint16(triAt + t * 12 + j * 2, true);
      const uv = view.getUint16(triAt + t * 12 + 6 + j * 2, true);
      if (v >= fileVerts || uv >= fileUvs) throw new Error(`MD2 triangle ${t} uses vertex ${v} of ${fileVerts} or texture coordinate ${uv} of ${fileUvs}`);
      const key = v * 65536 + uv;
      let index = pairs.get(key);
      if (index === undefined)
      {
        index = source.length;
        pairs.set(key, index);
        source.push(v);
        uvs.push(view.getInt16(uvAt + uv * 4, true) / skinWidth, view.getInt16(uvAt + uv * 4 + 2, true) / skinHeight);
      }
      corner.push(index);
    }
    indices[t * 3] = corner[0];
    indices[t * 3 + 1] = corner[2];
    indices[t * 3 + 2] = corner[1];
  }

  const n = source.length;
  const box = new Aabb();
  const point = new Vec3();
  const frames = [];
  for (let f = 0; f < frameCount; f++)
  {
    const at = frameAt + f * frameSize;
    const float = (i) => view.getFloat32(at + i * 4, true);
    const scale = [float(1), float(2), float(0)];
    const move = [float(4), float(5), float(3)];
    const xyz = new Uint8Array(n * 3);
    const normal = new Uint8Array(n);
    for (let k = 0; k < n; k++)
    {
      const v = at + 40 + source[k] * 4;
      xyz[k * 3] = data[v + 1];
      xyz[k * 3 + 1] = data[v + 2];
      xyz[k * 3 + 2] = data[v];
      normal[k] = Math.min(data[v + 3], 161);
      box.expandByPoint(point.set(xyz[k * 3] * scale[0] + move[0], xyz[k * 3 + 1] * scale[1] + move[1], xyz[k * 3 + 2] * scale[2] + move[2]));
    }
    frames.push({ scale, move, xyz, normal });
  }
  return { frames, vertexCount: n, uvs: Float32Array.from(uvs), indices, box };
}

// The mesh a model draws with: its frame 0 until it is animated. Its
// positions and normals change in place as it plays (mesh.pose counts the
// changes), and its bounds are the box round every frame.
export function md2Mesh(md2)
{
  const n = md2.vertexCount;
  const mesh = new MeshData([], [], [], []);
  mesh.positions = new Float32Array(n * 3);
  mesh.normals = new Float32Array(n * 3);
  mesh.uvs = md2.uvs;
  mesh.indices = md2.indices;
  mesh.submeshes = [{ start: 0, count: md2.indices.length, material: 0 }];
  mesh.bounds = new Aabb(md2.box.min.clone(), md2.box.max.clone());
  mesh.pose = 0;
  if (md2.frames.length) poseFrames(md2, mesh, 0, 0, 0);
  return mesh;
}

function framePoint(frame, k, out, o)
{
  const { xyz, scale, move } = frame;
  out[o] = xyz[k * 3] * scale[0] + move[0];
  out[o + 1] = xyz[k * 3 + 1] * scale[1] + move[1];
  out[o + 2] = xyz[k * 3 + 2] * scale[2] + move[2];
}

// Frames a and b blended by t (md2rep.cpp, render with two frames).
function poseFrames(md2, mesh, a, b, t)
{
  const fa = md2.frames[a];
  const fb = md2.frames[b];
  const p = mesh.positions;
  const nr = mesh.normals;
  const pa = [0, 0, 0];
  const pb = [0, 0, 0];
  for (let k = 0, o = 0; k < md2.vertexCount; k++, o += 3)
  {
    framePoint(fa, k, pa, 0);
    framePoint(fb, k, pb, 0);
    const na = fa.normal[k] * 3;
    const nb = fb.normal[k] * 3;
    for (let i = 0; i < 3; i++)
    {
      p[o + i] = (pb[i] - pa[i]) * t + pa[i];
      nr[o + i] = (NORMALS[nb + i] - NORMALS[na + i]) * t + NORMALS[na + i];
    }
  }
  mesh.pose++;
}

// Saved vertices blended towards frame b by t (render with a Vert array).
function poseFrom(md2, mesh, from, b, t)
{
  const fb = md2.frames[b];
  const p = mesh.positions;
  const nr = mesh.normals;
  const n = md2.vertexCount * 3;
  const pb = [0, 0, 0];
  for (let k = 0, o = 0; k < md2.vertexCount; k++, o += 3)
  {
    framePoint(fb, k, pb, 0);
    const nb = fb.normal[k] * 3;
    for (let i = 0; i < 3; i++)
    {
      p[o + i] = (pb[i] - from[o + i]) * t + from[o + i];
      nr[o + i] = (NORMALS[nb + i] - from[n + o + i]) * t + from[n + o + i];
    }
  }
  mesh.pose++;
}

export const MD2_TRANSITION = 0x8000;

// What one MD2 model is playing (md2model.cpp): times are in frames, the
// speed in frames per step. A transition blends, over `transition` steps,
// from the pose it started from to the first frame of the new animation.
export class Md2Player
{
  constructor(md2, mesh)
  {
    this.md2 = md2;
    this.mesh = mesh;
    this.mode = 0;
    this.time = 0;
    this.speed = 0;
    this.first = 0;
    this.last = 0;
    this.length = 0;
    this.renderA = 0;
    this.renderB = 0;
    this.renderT = 0;
    this.transTime = 0;
    this.transSpeed = 0;
    this.from = null;   // positions then normals, where a transition starts
  }

  get frameCount()
  {
    return this.md2.frames.length;
  }

  // Frame b one past the end (Blitz3D reads past its last frame there,
  // with a blend of 0): the last frame instead.
  frame(i)
  {
    return Math.max(0, Math.min(this.frameCount - 1, i));
  }

  start(first, last, mode, speed, transition)
  {
    const count = this.frameCount;
    if (!count) return;
    if (last < first) [first, last] = [last, first];
    first = Math.max(0, Math.min(count - 1, first));
    last = Math.max(0, Math.min(count - 1, last));
    if (transition > 0)
    {
      const n = this.md2.vertexCount * 3;
      if (!this.from) this.from = new Float32Array(n * 2);
      // Where it is now, in the pose it is drawn in.
      if (this.mode & MD2_TRANSITION) this.pose();
      this.from.set(this.mesh.positions, 0);
      this.from.set(this.mesh.normals, n);
      this.transSpeed = 1 / transition;
      this.transTime = 0;
      mode |= MD2_TRANSITION;
    }
    this.first = first;
    this.last = last;
    this.length = last - first;
    this.speed = speed;
    this.time = ((mode & 0x7fff) === 1 || speed >= 0) ? first : last;
    this.mode = mode;
    if (!speed || !this.length)
    {
      this.renderA = this.renderB = Math.trunc(this.time);
      this.renderT = 0;
      this.mode &= MD2_TRANSITION;
    }
    this.pose();
  }

  // One step (UpdateWorld's elapsed time of 1).
  step(elapsed = 1)
  {
    if (!this.mode) return;
    if (this.mode & MD2_TRANSITION)
    {
      this.transTime += this.transSpeed;
      if (this.transTime < 1)
      {
        this.pose();
        return;
      }
      this.mode &= ~MD2_TRANSITION;
      if (!this.mode)
      {
        this.pose();
        return;
      }
    }
    this.time += this.speed * elapsed;
    if (this.time < this.first)
    {
      if (this.mode === 1) this.time += this.length;
      else if (this.mode === 2)
      {
        this.time = this.first + (this.first - this.time);
        this.speed = -this.speed;
      }
      else
      {
        this.time = this.first;
        this.mode = 0;
      }
    }
    else if (this.time >= this.last)
    {
      if (this.mode === 1) this.time -= this.length;
      else if (this.mode === 2)
      {
        this.time = this.last - (this.time - this.last);
        this.speed = -this.speed;
      }
      else
      {
        this.time = this.last;
        this.mode = 0;
      }
    }
    this.renderA = Math.floor(this.time);
    this.renderB = this.renderA + 1;
    if (this.mode === 1 && this.renderB === this.last) this.renderB = this.first;
    this.renderT = this.time - this.renderA;
    this.pose();
  }

  pose()
  {
    if (this.mode & MD2_TRANSITION) poseFrom(this.md2, this.mesh, this.from, this.frame(Math.trunc(this.time)), this.transTime);
    else poseFrames(this.md2, this.mesh, this.frame(this.renderA), this.frame(this.renderB), this.renderT);
  }

  get animating()
  {
    return this.mode !== 0;
  }
}
