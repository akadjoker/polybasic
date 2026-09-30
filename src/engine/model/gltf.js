// A glTF 2.0 reader (https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html):
// .gltf (JSON, with its buffers and images in data: URIs or separate files)
// and .glb (binary). It turns a file into PolyBasic's own data, which
// model.js makes entities from:
//
//   { nodes:      [{ name, position, rotation, scale, mesh, children }],
//     roots:      [node index],             the scene's top nodes
//     meshes:     [{ mesh: MeshData, materials: [Material] }],
//     animations: [{ name, duration, channels: [{ node, path, interpolation, times, values }] }] }
//
// glTF space is right-handed (+Y up, +Z the front of a model, +X its
// left). PolyBasic's is left-handed with +X right. Mirroring X maps one to
// the other and keeps a model's front along +Z and its left on the left:
// positions and normals get x -> -x, rotations (x, y, z, w) ->
// (x, -y, -z, w), matrices M -> S M S, and every triangle swaps two
// corners (a mirror turns it inside out).
//
// Read: meshes (triangles, strips and fans; any component type, normalized
// or not, sparse accessors), normals (flat ones are made when missing),
// UVs, vertex colours, materials (base colour factor and texture, alpha
// modes, double-sided, KHR_materials_unlit, KHR_texture_transform),
// samplers, the node tree and node animations (translation, rotation,
// scale; linear, step and cubic spline).
// Not read: skins and morph targets (the model shows in its rest pose),
// cameras and lights in the file, and compressed data (Draco, meshopt,
// Basis textures), which is reported as an error when the file needs it.

import { MeshData } from '../scene/mesh.js';
import { Material } from '../scene/material.js';
import { Texture } from '../scene/texture.js';
import { Mat4 } from '../math/mat4.js';
import { Vec3 } from '../math/vec3.js';
import { Quat } from '../math/quat.js';

const GLB_MAGIC = 0x46546c67;      // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

// Extensions a file may require that this reader handles.
const SUPPORTED_REQUIRED = new Set(['KHR_texture_transform', 'KHR_materials_unlit', 'KHR_mesh_quantization']);

const COMPONENTS = {
  5120: { array: Int8Array, bytes: 1, get: 'getInt8', norm: (v) => Math.max(v / 127, -1) },
  5121: { array: Uint8Array, bytes: 1, get: 'getUint8', norm: (v) => v / 255 },
  5122: { array: Int16Array, bytes: 2, get: 'getInt16', norm: (v) => Math.max(v / 32767, -1) },
  5123: { array: Uint16Array, bytes: 2, get: 'getUint16', norm: (v) => v / 65535 },
  5125: { array: Uint32Array, bytes: 4, get: 'getUint32', norm: (v) => v },
  5126: { array: Float32Array, bytes: 4, get: 'getFloat32', norm: (v) => v }
};
const SIZES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const WRAPS = { 10497: 'repeat', 33071: 'clamp', 33648: 'mirror' };

// io: { loadFile(url), loadImage(url) or null, decodeImage(bytes, mime)
//       or null, track(promise), warn(text) }
export async function readGltf(bytes, url, io)
{
  const { json, bin } = container(toBytes(bytes));
  const version = String((json.asset && json.asset.version) || '');
  if (!version.startsWith('2.')) throw new Error(`this is glTF ${version || '(no version)'}, only glTF 2.0 is read`);
  for (const ext of json.extensionsRequired || [])
  {
    if (!SUPPORTED_REQUIRED.has(ext)) throw new Error(`the file needs the glTF extension ${ext}, which PolyBasic does not read`);
  }
  const reader = new Reader(json, url, io);
  await reader.loadBuffers(bin);
  return reader.read();
}

function toBytes(data)
{
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  throw new Error('not file data');
}

// The JSON and the binary chunk of a .glb, or the JSON of a .gltf.
function container(bytes)
{
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 12 && view.getUint32(0, true) === GLB_MAGIC)
  {
    const version = view.getUint32(4, true);
    if (version !== 2) throw new Error(`this is a version ${version} .glb, only version 2 is read`);
    const length = Math.min(view.getUint32(8, true), bytes.length);
    let json = null;
    let bin = null;
    for (let at = 12; at + 8 <= length;)
    {
      const size = view.getUint32(at, true);
      const type = view.getUint32(at + 4, true);
      const body = bytes.subarray(at + 8, at + 8 + size);
      if (type === CHUNK_JSON && !json) json = JSON.parse(new TextDecoder().decode(body));
      else if (type === CHUNK_BIN && !bin) bin = body;
      at += 8 + size;
    }
    if (!json) throw new Error('the .glb has no JSON chunk');
    return { json, bin };
  }
  const text = new TextDecoder().decode(bytes).replace(/^﻿/, '');
  if (!/^\s*\{/.test(text)) throw new Error('not a glTF file (only .gltf and .glb models are read)');
  return { json: JSON.parse(text), bin: null };
}

function resolve(base, uri)
{
  try
  {
    return new URL(uri, base).href;
  }
  catch
  {
    return uri;
  }
}

function dataUri(uri)
{
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  if (!m[2]) return { mime: m[1], bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
  const text = atob(m[3]);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return { mime: m[1], bytes };
}

// sRGB encoding of a linear colour channel: glTF colour factors are
// linear, PolyBasic materials hold sRGB colours (like the 0..255 values a
// program passes to EntityColor).
function toSrgb(c)
{
  const v = Math.max(0, Math.min(1, c));
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

class Reader
{
  constructor(json, url, io)
  {
    this.json = json;
    this.url = url;
    this.io = io;
    this.buffers = [];
    this.accessors = new Map();
    this.textures = new Map();
    this.materials = new Map();
    this.warned = new Set();
  }

  warnOnce(key, text)
  {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.io.warn(text);
  }

  async loadBuffers(bin)
  {
    const list = this.json.buffers || [];
    this.buffers = await Promise.all(list.map(async (b, i) =>
    {
      if (b.uri === undefined)
      {
        if (i !== 0 || !bin) throw new Error(`buffer ${i} has no data`);
        return bin;
      }
      const inline = dataUri(b.uri);
      if (inline) return inline.bytes;
      return toBytes(await this.io.loadFile(resolve(this.url, b.uri)));
    }));
  }

  // -------------------------------------------------------------- data

  bufferView(index)
  {
    const v = this.json.bufferViews[index];
    const buffer = this.buffers[v.buffer];
    const offset = v.byteOffset || 0;
    if (offset + v.byteLength > buffer.length) throw new Error(`bufferView ${index} runs past the end of its buffer`);
    return { bytes: buffer.subarray(offset, offset + v.byteLength), stride: v.byteStride || 0 };
  }

  // An accessor's values as numbers (normalized ones scaled to -1..1 or
  // 0..1), `count * size` long.
  accessor(index)
  {
    let values = this.accessors.get(index);
    if (values) return values;
    const a = this.json.accessors[index];
    const comp = COMPONENTS[a.componentType];
    const size = SIZES[a.type];
    if (!comp || !size) throw new Error(`accessor ${index} has an unknown type`);
    const n = a.count * size;
    const floats = a.componentType === 5126 || a.normalized;
    values = floats ? new Float32Array(n) : new comp.array(n);
    if (a.bufferView !== undefined) this.readInto(values, this.bufferView(a.bufferView), a.byteOffset || 0, a.count, size, comp, a.normalized);
    if (a.sparse)
    {
      const s = a.sparse;
      const idxComp = COMPONENTS[s.indices.componentType];
      const indices = new idxComp.array(s.count);
      this.readInto(indices, this.bufferView(s.indices.bufferView), s.indices.byteOffset || 0, s.count, 1, idxComp, false);
      const sparseValues = floats ? new Float32Array(s.count * size) : new comp.array(s.count * size);
      this.readInto(sparseValues, this.bufferView(s.values.bufferView), s.values.byteOffset || 0, s.count, size, comp, a.normalized);
      for (let i = 0; i < s.count; i++)
      {
        for (let k = 0; k < size; k++) values[indices[i] * size + k] = sparseValues[i * size + k];
      }
    }
    this.accessors.set(index, values);
    return values;
  }

  readInto(out, view, offset, count, size, comp, normalized)
  {
    const stride = view.stride || size * comp.bytes;
    const bytes = view.bytes;
    if (offset + stride * (count - 1) + size * comp.bytes > bytes.length) throw new Error('an accessor runs past the end of its data');
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const get = dv[comp.get].bind(dv);
    for (let i = 0; i < count; i++)
    {
      const base = offset + i * stride;
      for (let k = 0; k < size; k++)
      {
        const v = get(base + k * comp.bytes, true);
        out[i * size + k] = normalized ? comp.norm(v) : v;
      }
    }
  }

  // ------------------------------------------------------------ textures

  texture(info)
  {
    if (!info || info.index === undefined) return null;
    const key = info.index;
    if (this.textures.has(key)) return this.textures.get(key);
    const tex = this.json.textures[info.index];
    const t = new Texture(0, 0);
    this.textures.set(key, t);
    const sampler = tex.sampler !== undefined ? this.json.samplers[tex.sampler] : {};
    t.wrapU = WRAPS[sampler.wrapS] || 'repeat';
    t.wrapV = WRAPS[sampler.wrapT] || 'repeat';
    t.nearest = sampler.magFilter === 9728;
    if (tex.source === undefined)
    {
      this.warnOnce('texture-source', 'a texture uses an image format PolyBasic does not read; it is left out');
      t.failed = true;
      return t;
    }
    const image = this.json.images[tex.source];
    const done = (img) =>
    {
      if (img)
      {
        t.image = img;
        t.width = img.width;
        t.height = img.height;
      }
      t.loaded = true;
      t.version++;
    };
    const failed = (err) =>
    {
      t.failed = true;
      this.io.warn(`a texture of the model could not be loaded (${err && err.message ? err.message : err})`);
    };
    let job;
    const inline = image.uri !== undefined ? dataUri(image.uri) : null;
    if (image.bufferView !== undefined || inline)
    {
      const bytes = inline ? inline.bytes : this.bufferView(image.bufferView).bytes;
      const mime = inline ? inline.mime : image.mimeType;
      job = this.io.decodeImage ? this.io.decodeImage(bytes, mime) : Promise.resolve(null);
    }
    else
    {
      t.url = resolve(this.url, image.uri);
      if (this.io.loadImage) job = this.io.loadImage(t.url);
      else job = this.io.loadFile(t.url).then(() => null);
    }
    this.io.track(job.then(done, failed));
    return t;
  }

  // ----------------------------------------------------------- materials

  // The material template for a glTF material index (-1: the default).
  material(index)
  {
    if (this.materials.has(index)) return this.materials.get(index);
    const m = new Material();
    const g = index >= 0 ? this.json.materials[index] : {};
    const pbr = g.pbrMetallicRoughness || {};
    const f = pbr.baseColorFactor || [1, 1, 1, 1];
    m.color = [toSrgb(f[0]), toSrgb(f[1]), toSrgb(f[2])];
    m.alphaMode = (g.alphaMode || 'OPAQUE').toLowerCase();
    m.alpha = m.alphaMode === 'opaque' ? 1 : f[3];
    m.alphaCutoff = g.alphaCutoff !== undefined ? g.alphaCutoff : 0.5;
    m.twoSided = Boolean(g.doubleSided);
    m.fullbright = Boolean(g.extensions && g.extensions.KHR_materials_unlit);
    // A rough approximation of PBR on PolyBasic's simpler shading: smooth
    // surfaces get a highlight.
    m.shininess = Math.max(0, Math.min(1, 1 - (pbr.roughnessFactor !== undefined ? pbr.roughnessFactor : 1)));
    m.texture = this.texture(pbr.baseColorTexture);
    m.name = g.name || '';
    this.materials.set(index, m);
    return m;
  }

  // Which UV set the base colour texture reads, and its transform.
  uvSetup(index)
  {
    const g = index >= 0 ? this.json.materials[index] : {};
    const info = g.pbrMetallicRoughness && g.pbrMetallicRoughness.baseColorTexture;
    if (!info) return { set: 0, transform: null };
    const tt = info.extensions && info.extensions.KHR_texture_transform;
    const set = tt && tt.texCoord !== undefined ? tt.texCoord : info.texCoord || 0;
    const transform = tt && (tt.offset || tt.rotation || tt.scale) ? tt : null;
    return { set, transform };
  }

  // -------------------------------------------------------------- meshes

  mesh(index)
  {
    const g = this.json.meshes[index];
    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    const submeshes = [];
    const materials = [];
    let hasColors = false;
    for (const prim of g.primitives)
    {
      const mode = prim.mode === undefined ? 4 : prim.mode;
      if (mode < 4)
      {
        this.warnOnce('mode', 'points and lines in the model are left out (only triangles are drawn)');
        continue;
      }
      if (prim.targets) this.warnOnce('morph', 'the model has morph targets, which PolyBasic does not play yet: it shows its base shape');
      const attr = prim.attributes;
      if (attr.POSITION === undefined) continue;
      const pos = this.accessor(attr.POSITION);
      const count = pos.length / 3;
      let tri = prim.indices !== undefined ? Array.from(this.accessor(prim.indices)) : Array.from({ length: count }, (_, i) => i);
      tri = toTriangles(tri, mode);
      const matIndex = prim.material !== undefined ? prim.material : -1;
      const { set, transform } = this.uvSetup(matIndex);
      const uvKey = `TEXCOORD_${set}`;
      const uv = attr[uvKey] !== undefined ? this.accessor(attr[uvKey]) : null;
      const nor = attr.NORMAL !== undefined ? this.accessor(attr.NORMAL) : null;
      const col = attr.COLOR_0 !== undefined ? this.accessor(attr.COLOR_0) : null;
      const colSize = col ? SIZES[this.json.accessors[attr.COLOR_0].type] : 0;
      if (col) hasColors = true;

      // Without normals, glTF asks for flat shading: every triangle gets
      // its own corners.
      const flat = !nor;
      const corners = flat ? tri : null;
      const vertexOf = flat ? (i) => corners[i] : (i) => i;
      const vertexCount = flat ? tri.length : count;
      const base = positions.length / 3;
      for (let i = 0; i < vertexCount; i++)
      {
        const v = vertexOf(i);
        positions.push(-pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
        if (nor) normals.push(-nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
        let u = uv ? uv[v * 2] : 0;
        let w = uv ? uv[v * 2 + 1] : 0;
        if (transform)
        {
          const [sx, sy] = transform.scale || [1, 1];
          const r = transform.rotation || 0;
          const [ox, oy] = transform.offset || [0, 0];
          const c = Math.cos(r);
          const s = Math.sin(r);
          const tu = c * sx * u + s * sy * w + ox;
          const tw = -s * sx * u + c * sy * w + oy;
          u = tu;
          w = tw;
        }
        uvs.push(u, w);
        if (col) colors.push(col[v * colSize], col[v * colSize + 1], col[v * colSize + 2], colSize === 4 ? col[v * colSize + 3] : 1);
        else colors.push(1, 1, 1, 1);
      }
      const start = indices.length;
      if (flat)
      {
        for (let i = 0; i < tri.length; i += 3)
        {
          // Corners i, i + 1, i + 2, swapped for the mirror.
          indices.push(base + i, base + i + 2, base + i + 1);
          const [nx, ny, nz] = faceNormal(positions, base + i, base + i + 2, base + i + 1);
          for (let k = 0; k < 3; k++) normals.push(nx, ny, nz);
        }
      }
      else
      {
        for (let i = 0; i < tri.length; i += 3) indices.push(base + tri[i], base + tri[i + 2], base + tri[i + 1]);
      }
      let slot = materials.indexOf(matIndex);
      if (slot < 0)
      {
        slot = materials.length;
        materials.push(matIndex);
      }
      submeshes.push({ start, count: indices.length - start, material: slot });
    }
    const data = new MeshData(positions, normals, uvs, indices);
    data.submeshes = submeshes.length ? submeshes : data.submeshes;
    if (hasColors) data.colors = Float32Array.from(colors);
    const mats = materials.map((i) =>
    {
      const m = this.material(i).clone();
      m.vertexColors = hasColors;
      return m;
    });
    data.name = g.name || '';
    return { mesh: data, materials: mats.length ? mats : [new Material()] };
  }

  // --------------------------------------------------------------- nodes

  node(n, index)
  {
    const position = new Vec3();
    const rotation = new Quat();
    const scale = new Vec3(1, 1, 1);
    if (n.matrix)
    {
      const m = new Mat4().fromArray(n.matrix);
      // S M S with S = diag(-1, 1, 1): the entries in row 0 or column 0,
      // but not both, change sign.
      for (const i of [1, 2, 3, 4, 8, 12]) m.e[i] = -m.e[i];
      m.decompose(position, rotation, scale);
    }
    else
    {
      const t = n.translation || [0, 0, 0];
      const r = n.rotation || [0, 0, 0, 1];
      const s = n.scale || [1, 1, 1];
      position.set(-t[0], t[1], t[2]);
      rotation.set(r[0], -r[1], -r[2], r[3]).normalize();
      scale.set(s[0], s[1], s[2]);
    }
    if (n.skin !== undefined) this.warnOnce('skin', 'the model is skinned, which PolyBasic does not play yet: it shows in its rest pose');
    return {
      name: n.name || '',
      position,
      rotation,
      scale,
      mesh: n.mesh !== undefined ? n.mesh : -1,
      children: n.children || [],
      index
    };
  }

  // ---------------------------------------------------------- animations

  animation(a, index)
  {
    const channels = [];
    let duration = 0;
    for (const ch of a.channels)
    {
      const path = ch.target.path;
      if (ch.target.node === undefined) continue;
      if (path === 'weights')
      {
        this.warnOnce('weights', 'morph target animations are left out');
        continue;
      }
      const sampler = a.samplers[ch.sampler];
      const times = Float32Array.from(this.accessor(sampler.input));
      const values = Float32Array.from(this.accessor(sampler.output));
      // The same mirror as the nodes. It is linear, so cubic spline
      // tangents convert the same way as the values.
      if (path === 'translation') for (let i = 0; i < values.length; i += 3) values[i] = -values[i];
      else if (path === 'rotation')
      {
        for (let i = 0; i < values.length; i += 4)
        {
          values[i + 1] = -values[i + 1];
          values[i + 2] = -values[i + 2];
        }
      }
      if (times.length) duration = Math.max(duration, times[times.length - 1]);
      channels.push({ node: ch.target.node, path, interpolation: sampler.interpolation || 'LINEAR', times, values });
    }
    return { name: a.name || `animation ${index + 1}`, duration, channels };
  }

  read()
  {
    const json = this.json;
    const meshes = (json.meshes || []).map((_, i) => this.mesh(i));
    const nodes = (json.nodes || []).map((n, i) => this.node(n, i));
    let roots;
    const sceneIndex = json.scene !== undefined ? json.scene : 0;
    if (json.scenes && json.scenes[sceneIndex]) roots = json.scenes[sceneIndex].nodes || [];
    else
    {
      // No scene: every node that is nobody's child.
      const child = new Set(nodes.flatMap((n) => n.children));
      roots = nodes.map((_, i) => i).filter((i) => !child.has(i));
    }
    const animations = (json.animations || []).map((a, i) => this.animation(a, i));
    return { nodes, roots, meshes, animations };
  }
}

// Triangle strips and fans as a plain triangle list (glTF 2.0, 3.7.2.1).
function toTriangles(idx, mode)
{
  if (mode === 4) return idx.slice(0, idx.length - (idx.length % 3));
  const out = [];
  if (mode === 5)
  {
    for (let i = 0; i + 2 < idx.length; i++)
    {
      if (i % 2 === 0) out.push(idx[i], idx[i + 1], idx[i + 2]);
      else out.push(idx[i + 1], idx[i], idx[i + 2]);
    }
  }
  else if (mode === 6)
  {
    for (let i = 1; i + 1 < idx.length; i++) out.push(idx[i], idx[i + 1], idx[0]);
  }
  return out;
}

// The normal out of the front of triangle a, b, c (PolyBasic winding).
function faceNormal(p, a, b, c)
{
  const ux = p[b * 3] - p[a * 3];
  const uy = p[b * 3 + 1] - p[a * 3 + 1];
  const uz = p[b * 3 + 2] - p[a * 3 + 2];
  const vx = p[c * 3] - p[a * 3];
  const vy = p[c * 3 + 1] - p[a * 3 + 1];
  const vz = p[c * 3 + 2] - p[a * 3 + 2];
  const n = new Vec3(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx).normalize();
  return [n.x, n.y, n.z];
}
