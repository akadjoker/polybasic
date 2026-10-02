// The glTF reader and models: files built here in memory (to reach every
// corner of the format), the Kenney models checked against three.js's own
// GLTFLoader, and animations against known values.

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readGltf } from '../../src/engine/model/gltf.js';
import { sample, advance, ANIM_LOOP, ANIM_ONCE, ANIM_PINGPONG } from '../../src/engine/model/animation.js';
import { newModel } from '../../src/engine/model/model.js';
import { skinPalette } from '../../src/engine/scene/skin.js';
import { rayOnto } from '../../src/engine/collide/picking.js';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { Mat4 } from '../../src/engine/math/mat4.js';
import { Vec3 } from '../../src/engine/math/vec3.js';
import { Quat } from '../../src/engine/math/quat.js';
import { assert, near, nearAll } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });
const KENNEY = fileURLToPath(new URL('../../examples/assets/kenney/', import.meta.url));
const FOX = fileURLToPath(new URL('../../examples/assets/fox/', import.meta.url));
const DRIVER = fileURLToPath(new URL('../../examples/assets/blitz3d/driver/', import.meta.url));

// ------------------------------------------------------------ fixtures

// Builds glTF files: typed arrays go into one binary buffer, 4-byte
// aligned, each with its bufferView and accessor.
class Builder
{
  constructor()
  {
    this.json = { asset: { version: '2.0' }, buffers: [], bufferViews: [], accessors: [], meshes: [], nodes: [], scenes: [{ nodes: [] }], scene: 0 };
    this.parts = [];
    this.length = 0;
  }

  view(bytes, stride)
  {
    while (this.length % 4) this.pushBytes(new Uint8Array(1));
    const offset = this.length;
    this.pushBytes(bytes);
    const view = { buffer: 0, byteOffset: offset, byteLength: bytes.length };
    if (stride) view.byteStride = stride;
    this.json.bufferViews.push(view);
    return this.json.bufferViews.length - 1;
  }

  pushBytes(bytes)
  {
    this.parts.push(bytes);
    this.length += bytes.length;
  }

  accessor(typed, type, extra = {})
  {
    const componentType = { Int8Array: 5120, Uint8Array: 5121, Int16Array: 5122, Uint16Array: 5123, Uint32Array: 5125, Float32Array: 5126 }[typed.constructor.name];
    const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
    const bufferView = this.view(new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength));
    this.json.accessors.push({ bufferView, componentType, count: typed.length / size, type, ...extra });
    return this.json.accessors.length - 1;
  }

  bin()
  {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const p of this.parts)
    {
      out.set(p, at);
      at += p.length;
    }
    return out;
  }

  // A .gltf with the buffer as a data: URI.
  gltf()
  {
    const bin = this.bin();
    const json = structuredClone(this.json);
    json.buffers = [{ byteLength: bin.length, uri: 'data:application/octet-stream;base64,' + Buffer.from(bin).toString('base64') }];
    return new TextEncoder().encode(JSON.stringify(json));
  }

  // A .gltf and its .bin file.
  gltfWithBin(name)
  {
    const bin = this.bin();
    const json = structuredClone(this.json);
    json.buffers = [{ byteLength: bin.length, uri: name }];
    return { gltf: new TextEncoder().encode(JSON.stringify(json)), bin };
  }

  glb()
  {
    const bin = this.bin();
    const json = structuredClone(this.json);
    json.buffers = [{ byteLength: bin.length }];
    let text = new TextEncoder().encode(JSON.stringify(json));
    const pad = (bytes, fill) =>
    {
      const n = Math.ceil(bytes.length / 4) * 4;
      const out = new Uint8Array(n).fill(fill);
      out.set(bytes);
      return out;
    };
    text = pad(text, 0x20);
    const binPadded = pad(bin, 0);
    const total = 12 + 8 + text.length + 8 + binPadded.length;
    const out = new Uint8Array(total);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 0x46546c67, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);
    dv.setUint32(12, text.length, true);
    dv.setUint32(16, 0x4e4f534a, true);
    out.set(text, 20);
    dv.setUint32(20 + text.length, binPadded.length, true);
    dv.setUint32(24 + text.length, 0x004e4942, true);
    out.set(binPadded, 28 + text.length);
    return out;
  }
}

// A square facing +Z in glTF (its front is towards +Z, counter-clockwise
// seen from there), 2 units wide.
function square(b, extra = {})
{
  const pos = b.accessor(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 'VEC3', { min: [-1, -1, 0], max: [1, 1, 0] });
  const nor = b.accessor(new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]), 'VEC3');
  const uv = b.accessor(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 'VEC2');
  const idx = b.accessor(new Uint16Array([0, 1, 2, 0, 2, 3]), 'SCALAR');
  return { attributes: { POSITION: pos, NORMAL: nor, TEXCOORD_0: uv }, indices: idx, ...extra };
}

async function read(bytes, files = {}, url = 'file:///models/test.gltf')
{
  const warnings = [];
  const pending = [];
  const data = await readGltf(bytes, url, {
    loadFile: async (u) =>
    {
      if (!(u in files)) throw new Error(`no file ${u}`);
      return files[u];
    },
    loadImage: null,
    decodeImage: null,
    track: (p) => pending.push(p),
    warn: (t) => warnings.push(t)
  });
  await Promise.all(pending);
  return { data, warnings };
}

// Every triangle's cross product points the way its vertex normals do.
function windingAgrees(mesh)
{
  const p = mesh.positions;
  const n = mesh.normals;
  const ix = mesh.indices;
  for (let i = 0; i < ix.length; i += 3)
  {
    const [a, b, c] = [ix[i], ix[i + 1], ix[i + 2]];
    const u = new Vec3(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]);
    const v = new Vec3(p[c * 3] - p[a * 3], p[c * 3 + 1] - p[a * 3 + 1], p[c * 3 + 2] - p[a * 3 + 2]);
    const sum = new Vec3();
    for (const k of [a, b, c]) sum.add(new Vec3(n[k * 3], n[k * 3 + 1], n[k * 3 + 2]));
    const cross = u.cross(v);
    // A triangle with no area (models have a few) has no winding.
    if (cross.length() < 1e-12) continue;
    if (cross.dot(sum) <= 0) return false;
  }
  return true;
}

// ----------------------------------------------------------------- tests

test('the same model from a .gltf with a data URI, a .gltf with a .bin and a .glb', async () =>
{
  const b = new Builder();
  b.json.meshes.push({ primitives: [square(b)] });
  b.json.nodes.push({ mesh: 0, name: 'sq' });
  b.json.scenes[0].nodes.push(0);
  const { gltf, bin } = b.gltfWithBin('sq.bin');
  const results = [
    await read(b.gltf()),
    await read(gltf, { 'file:///models/sq.bin': bin }),
    await read(b.glb(), {}, 'file:///models/test.glb')
  ];
  for (const { data, warnings } of results)
  {
    assert(warnings.length === 0, warnings.join('; '));
    const m = data.meshes[0].mesh;
    // Mirrored in X; the front still faces +Z.
    nearAll(m.positions, [1, -1, 0, -1, -1, 0, -1, 1, 0, 1, 1, 0], 0, 'positions');
    nearAll(m.normals.slice(0, 3), [0, 0, 1], 0, 'normal');
    nearAll(m.uvs, [0, 1, 1, 1, 1, 0, 0, 0], 0, 'uvs');
    assert(windingAgrees(m), 'winding');
    assert(data.nodes[0].name === 'sq' && data.roots[0] === 0, 'node');
  }
});

test('node transforms: TRS and matrix nodes land where the mirrored glTF world puts them', async () =>
{
  const b = new Builder();
  b.json.meshes.push({ primitives: [square(b)] });
  const axis = new Vec3(1, 2, 3).normalize();
  const r = new Quat().setAxisAngle(axis.x, axis.y, axis.z, 40);
  const trs = { translation: [1, 2, 3], rotation: [r.x, r.y, r.z, r.w], scale: [2, 1, 0.5] };
  // The same transform as a matrix (glTF right-handed maths is the same
  // arithmetic).
  const m = new Mat4().compose(new Vec3(...trs.translation), r, new Vec3(...trs.scale));
  b.json.nodes.push({ ...trs, children: [1], name: 'a' });
  b.json.nodes.push({ matrix: m.toArray(), mesh: 0, name: 'b' });
  b.json.scenes[0].nodes.push(0);
  const { data } = await read(b.gltf());
  const engine = new Engine();
  const root = engine.world.createEntity('pivot');
  root.model = newModel();
  engine.models.build(root, data);
  const a = root.children[0];
  const bb = a.children[0];
  // glTF world of node b = M * M; ours must be S (M * M) S.
  const want = m.clone().multiply(m);
  for (const i of [1, 2, 3, 4, 8, 12]) want.e[i] = -want.e[i];
  assert(bb.worldMatrix.equals(want, 1e-9), `world matrix\n${bb.worldMatrix.toArray()}\n${want.toArray()}`);
  assert(a.name === 'a' && bb.name === 'b', 'names');
});

test('accessors: normalized, interleaved, sparse; strips, fans and flat normals', async () =>
{
  const b = new Builder();
  // Interleaved position (3 floats) + normalized ushort uv (2 x u16), stride 16.
  const buf = new ArrayBuffer(16 * 4);
  const dv = new DataView(buf);
  const pts = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0]];
  pts.forEach((p, i) =>
  {
    p.forEach((v, k) => dv.setFloat32(i * 16 + k * 4, v, true));
    dv.setUint16(i * 16 + 12, i * 20000, true);
    dv.setUint16(i * 16 + 14, 65535, true);
  });
  const view = b.view(new Uint8Array(buf), 16);
  b.json.accessors.push({ bufferView: view, byteOffset: 0, componentType: 5126, count: 4, type: 'VEC3' });
  const posA = b.json.accessors.length - 1;
  b.json.accessors.push({ bufferView: view, byteOffset: 12, componentType: 5123, normalized: true, count: 4, type: 'VEC2' });
  const uvA = b.json.accessors.length - 1;
  // A sparse accessor: the base positions with vertex 3 moved to z = 5.
  const sIdx = b.view(new Uint8Array(new Uint8Array([3]).buffer));
  const sVal = b.view(new Uint8Array(new Float32Array([1, 1, 5]).buffer));
  b.json.accessors.push({ bufferView: view, byteOffset: 0, componentType: 5126, count: 4, type: 'VEC3', sparse: { count: 1, indices: { bufferView: sIdx, componentType: 5121 }, values: { bufferView: sVal } } });
  const sparseA = b.json.accessors.length - 1;
  b.json.meshes.push({ primitives: [
    { attributes: { POSITION: posA, TEXCOORD_0: uvA }, mode: 5 },     // strip, no normals
    { attributes: { POSITION: sparseA }, indices: b.accessor(new Uint8Array([0, 1, 3, 2]), 'SCALAR'), mode: 6 }  // fan
  ] });
  b.json.nodes.push({ mesh: 0 });
  b.json.scenes[0].nodes.push(0);
  const { data } = await read(b.gltf());
  const m = data.meshes[0].mesh;
  // Flat: every triangle has its own three corners. Strip of 4: 2
  // triangles; fan of 4: 2 triangles.
  assert(m.triangleCount === 4 && m.vertexCount === 12, `${m.triangleCount} triangles, ${m.vertexCount} vertices`);
  assert(m.submeshes.length === 2, 'submeshes');
  assert(windingAgrees(m), 'flat normals agree with the winding');
  // Normalized UVs: 20000 / 65535 and 1. Flat shading gives every corner
  // its own vertex: vertex 1 is the second corner of the first strip
  // triangle, the file's vertex 1.
  near(m.uvs[1 * 2], 20000 / 65535, 1e-6, 'u of vertex 1');
  near(m.uvs[1], 1, 1e-6, 'v');
  // The sparse vertex moved to z = 5.
  const zs = Array.from({ length: m.vertexCount }, (_, i) => m.positions[i * 3 + 2]);
  assert(zs.includes(5), `sparse value missing: ${zs}`);
  // Strip triangles alternate order in the file; after the mirror all
  // face the same way.
  const n0 = [m.normals[2], m.normals[5], m.normals[8]];
  const n1 = [m.normals[11], m.normals[14], m.normals[17]];
  assert(Math.sign(n0[0]) === Math.sign(n1[0]) || n0.every((v, i) => Math.abs(v - n1[i]) < 1e-6), 'strip faces agree');
});

test('materials: colours to sRGB, alpha modes, two sides, unlit, texture transform baked into UVs', async () =>
{
  const b = new Builder();
  b.json.materials = [
    { name: 'half', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.21404114, 1, 0.25], roughnessFactor: 0.3 }, alphaMode: 'BLEND', doubleSided: true },
    { name: 'cut', alphaMode: 'MASK', alphaCutoff: 0.3, extensions: { KHR_materials_unlit: {} } },
    {
      name: 'moved',
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0, extensions: { KHR_texture_transform: { offset: [0.5, 0], scale: [2, 3] } } }
      }
    }
  ];
  b.json.images = [{ uri: 'pixels.png' }];
  b.json.samplers = [{ wrapS: 33071, wrapT: 33648, magFilter: 9728 }];
  b.json.textures = [{ source: 0, sampler: 0 }];
  b.json.meshes.push({ primitives: [square(b, { material: 0 }), square(b, { material: 1 }), square(b, { material: 2 })] });
  b.json.nodes.push({ mesh: 0 });
  b.json.scenes[0].nodes.push(0);
  const { data, warnings } = await read(b.gltf(), { 'file:///models/pixels.png': new Uint8Array(4) });
  assert(warnings.length === 0, warnings.join('; '));
  const { mesh, materials } = data.meshes[0];
  assert(materials.length === 3 && mesh.submeshes.map((s) => s.material).join() === '0,1,2', 'one material per part');
  const [half, cut, moved] = materials;
  nearAll(half.color, [0.735357, 0.5, 1], 1e-5, 'linear 0.5 is sRGB 0.7354');
  assert(half.alphaMode === 'blend' && half.alpha === 0.25 && half.twoSided, 'blend');
  near(half.shininess, 0.7, 1e-9, 'shininess from roughness');
  assert(cut.alphaMode === 'mask' && cut.alphaCutoff === 0.3 && cut.fullbright, 'mask, unlit');
  const t = moved.texture;
  assert(t && t.loaded && t.wrapU === 'clamp' && t.wrapV === 'mirror' && t.nearest, 'sampler');
  // UV (1, 0) of the third part: scale (2, 3), then offset (0.5, 0).
  const uv = Array.from(mesh.uvs.slice(8 * 2, 12 * 2));
  nearAll(uv, [0.5, 3, 2.5, 3, 2.5, 0, 0.5, 0], 1e-6, 'transformed uvs');
});

test('what is not read is said clearly', async () =>
{
  const b = new Builder();
  b.json.extensionsRequired = ['KHR_draco_mesh_compression'];
  let message = '';
  try
  {
    await read(b.gltf());
  }
  catch (e)
  {
    message = e.message;
  }
  assert(/KHR_draco_mesh_compression, which PolyBasic does not read/.test(message), message);

  const s = new Builder();
  s.json.meshes.push({ primitives: [square(s, { targets: [{}] })] });
  s.json.nodes.push({ mesh: 0, skin: 0 });
  s.json.scenes[0].nodes.push(0);
  const { warnings } = await read(s.gltf());
  assert(warnings.some((w) => /uses skin 0, which the file does not have/.test(w)) && warnings.some((w) => /morph targets/.test(w)), warnings.join('; '));

  let old = '';
  try
  {
    await read(new TextEncoder().encode('{"asset":{"version":"1.0"}}'));
  }
  catch (e)
  {
    old = e.message;
  }
  assert(/only glTF 2.0/.test(old), old);
  let other = '';
  try
  {
    await read(new TextEncoder().encode('solid cube\nfacet normal 0 0 1'));
  }
  catch (e)
  {
    other = e.message;
  }
  assert(/only .gltf and .glb/.test(other), other);
});

test('animation curves: linear, slerp, step and cubic spline', () =>
{
  const lin = { path: 'translation', interpolation: 'LINEAR', times: [0, 1, 3], values: [0, 0, 0, 2, 4, 6, 4, 4, 4] };
  nearAll(sample(lin, 0.5, [0, 0, 0]), [1, 2, 3], 1e-9, 'linear');
  nearAll(sample(lin, 2, [0, 0, 0]), [3, 4, 5], 1e-9, 'linear second span');
  nearAll(sample(lin, 9, [0, 0, 0]), [4, 4, 4], 1e-9, 'after the end');
  nearAll(sample(lin, -1, [0, 0, 0]), [0, 0, 0], 1e-9, 'before the start');
  const step = { ...lin, interpolation: 'STEP' };
  nearAll(sample(step, 0.99, [0, 0, 0]), [0, 0, 0], 1e-9, 'step');
  // Slerp half way between no turn and 90 degrees about Y: 45 degrees.
  const q90 = new Quat().setAxisAngle(0, 1, 0, 90);
  const rot = { path: 'rotation', interpolation: 'LINEAR', times: [0, 1], values: [0, 0, 0, 1, q90.x, q90.y, q90.z, q90.w] };
  const q = sample(rot, 0.5, [0, 0, 0, 0]);
  const q45 = new Quat().setAxisAngle(0, 1, 0, 45);
  assert(new Quat(...q).equals(q45, 1e-9), `slerp ${q}`);
  // Cubic spline: p0 = 0, p1 = 1 with tangents 0 over 2 seconds gives
  // smoothstep: 0.5 at the middle, 0.15625 at a quarter.
  const cubic = { path: 'translation', interpolation: 'CUBICSPLINE', times: [0, 2], values: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0] };
  nearAll(sample(cubic, 1, [0, 0, 0]), [0.5, 0.5, 0.5], 1e-9, 'cubic middle');
  nearAll(sample(cubic, 0.5, [0, 0, 0]), [0.15625, 0.15625, 0.15625], 1e-9, 'cubic quarter');
  // With an out-tangent of 1 per second at the start: p = h10 * 2 + h01.
  const sloped = { ...cubic, values: [0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0] };
  const u = 0.25;
  const expect = (u ** 3 - 2 * u ** 2 + u) * 2 + (-2 * u ** 3 + 3 * u ** 2);
  near(sample(sloped, 0.5, [0, 0, 0])[0], expect, 1e-9, 'cubic with a tangent');
});

test('animation modes: loop, once, ping-pong', () =>
{
  const anim = { duration: 1 };
  const loop = { mode: ANIM_LOOP, speed: 1, time: 0.9, direction: 1 };
  assert(advance(loop, anim, 0.2) && Math.abs(loop.time - 0.1) < 1e-9, `loop ${loop.time}`);
  const back = { mode: ANIM_LOOP, speed: -1, time: 0.1, direction: 1 };
  advance(back, anim, 0.2);
  near(back.time, 0.9, 1e-9, 'loop backwards');
  const once = { mode: ANIM_ONCE, speed: 1, time: 0.9, direction: 1 };
  assert(!advance(once, anim, 0.2) && once.time === 1, `once ${once.time}`);
  const pp = { mode: ANIM_PINGPONG, speed: 1, time: 0.9, direction: 1 };
  advance(pp, anim, 0.2);
  near(pp.time, 0.9, 1e-9, 'bounced back');
  assert(pp.direction === -1, 'going back');
  advance(pp, anim, 1.0);
  near(pp.time, 0.1, 1e-9, 'bounced at the start');
});

test('every Kenney model reads like three.js GLTFLoader reads it, mirrored', async () =>
{
  // GLTFLoader wants a browser; with `self` set it parses geometry and
  // transforms and only fails on the texture (reported, not thrown).
  const hadSelf = 'self' in globalThis;
  if (!hadSelf) globalThis.self = globalThis;
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const files = (await readdir(KENNEY)).filter((f) => f.endsWith('.glb'));
  assert(files.length === 10, `${files.length} models`);
  let meshes = 0;
  for (const file of files)
  {
    const bytes = await readFile(join(KENNEY, file));
    const url = pathToFileURL(join(KENNEY, file)).href;
    const { data, warnings } = await read(bytes, { [new URL('Textures/colormap.png', url).href]: new Uint8Array(4) }, url);
    assert(warnings.length === 0, `${file}: ${warnings.join('; ')}`);
    const quiet = [console.error, console.warn];
    console.error = console.warn = () => {};
    const gltf = await new Promise((ok, fail) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, fail));
    [console.error, console.warn] = quiet;
    gltf.scene.updateMatrixWorld(true);
    const theirs = [];
    gltf.scene.traverse((o) =>
    {
      if (o.isMesh) theirs.push(o);
    });

    const engine = new Engine();
    const root = engine.world.createEntity('pivot');
    root.model = newModel();
    engine.models.build(root, data);
    const ours = [];
    const walk = (e) =>
    {
      if (e.mesh) ours.push(e);
      for (const c of e.children) walk(c);
    };
    walk(root);
    assert(ours.length === theirs.length, `${file}: ${ours.length} meshes, three.js has ${theirs.length}`);
    for (let i = 0; i < ours.length; i++)
    {
      const e = ours[i];
      const o = theirs[i];
      assert(e.name === o.name || o.name.startsWith(e.name), `${file}: mesh ${i} is ${e.name}, three.js ${o.name}`);
      const want = new Mat4().fromArray(o.matrixWorld.elements);
      for (const k of [1, 2, 3, 4, 8, 12]) want.e[k] = -want.e[k];
      assert(e.worldMatrix.equals(want, 1e-6), `${file} ${e.name}: world matrix`);
      const p = o.geometry.attributes.position;
      assert(p.count === e.mesh.vertexCount, `${file} ${e.name}: vertex count`);
      for (let v = 0; v < p.count; v++)
      {
        if (Math.abs(e.mesh.positions[v * 3] + p.getX(v)) > 1e-6 || Math.abs(e.mesh.positions[v * 3 + 1] - p.getY(v)) > 1e-6 || Math.abs(e.mesh.positions[v * 3 + 2] - p.getZ(v)) > 1e-6)
        {
          throw new Error(`${file} ${e.name}: vertex ${v} differs`);
        }
      }
      const idx = o.geometry.index.array;
      for (let t = 0; t < idx.length; t += 3)
      {
        const mine = e.mesh.indices;
        if (mine[t] !== idx[t] || mine[t + 1] !== idx[t + 2] || mine[t + 2] !== idx[t + 1]) throw new Error(`${file} ${e.name}: triangle ${t / 3} differs`);
      }
      assert(windingAgrees(e.mesh), `${file} ${e.name}: winding`);
      meshes++;
    }
    assert(data.animations.map((a) => a.name).join() === gltf.animations.map((a) => a.name).join(), `${file}: animations`);
    for (let k = 0; k < gltf.animations.length; k++) near(data.animations[k].duration, gltf.animations[k].duration, 1e-6, `${file}: duration`);
  }
  if (!hadSelf) delete globalThis.self;
  assert(meshes >= 15, `only ${meshes} meshes compared`);
});

test('the skinned Fox bends as three.js bends it: every vertex of Walk at 0.37 s, mirrored', async () =>
{
  const hadSelf = 'self' in globalThis;
  if (!hadSelf) globalThis.self = globalThis;
  const THREE = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const bytes = await readFile(join(FOX, 'fox.glb'));
  const { data, warnings } = await read(bytes, {}, pathToFileURL(join(FOX, 'fox.glb')).href);
  assert(warnings.length === 0, warnings.join('; '));
  assert(data.skins.length === 1 && data.skins[0].joints.length === 24, 'one skin of 24 joints');
  const quiet = [console.error, console.warn];
  console.error = console.warn = () => {};
  const gltf = await new Promise((ok, fail) => new GLTFLoader().parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', ok, fail));
  [console.error, console.warn] = quiet;
  if (!hadSelf) delete globalThis.self;
  const t = 0.37;
  const walk = gltf.animations.findIndex((a) => a.name === 'Walk');
  const mixer = new THREE.AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations[walk]).play();
  mixer.setTime(t);
  gltf.scene.updateMatrixWorld(true);
  let theirs = null;
  gltf.scene.traverse((o) =>
  {
    if (o.isSkinnedMesh) theirs = o;
  });
  theirs.skeleton.update();

  const engine = new Engine();
  const root = engine.world.createEntity('pivot');
  root.model = newModel();
  engine.models.build(root, data);
  engine.models.play(root, walk + 1, ANIM_LOOP, 1);
  engine.models.setTime(root, t);
  const part = root.model.nodes.find((n) => n && n.skin);
  assert(part, 'no skinned part');
  const palette = skinPalette(part);
  const mesh = part.mesh;
  const index = theirs.geometry.index ? theirs.geometry.index.array : null;
  const v = new THREE.Vector3();
  const world = part.worldMatrix.e;
  let worst = 0;
  let moved = 0;
  for (let i = 0; i < mesh.vertexCount; i++)
  {
    // One vertex per triangle corner (the Fox has no normals, so it is
    // drawn flat), in three.js's order.
    theirs.getVertexPosition(index ? index[i] : i, v).applyMatrix4(theirs.matrixWorld);
    const p = [0, 0, 0];
    for (let k = 0; k < 4; k++)
    {
      const w = mesh.weights[i * 4 + k];
      if (!w) continue;
      const m = palette.subarray(mesh.joints[i * 4 + k] * 16);
      const [x, y, z] = [mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]];
      for (let r = 0; r < 3; r++) p[r] += w * (m[r] * x + m[4 + r] * y + m[8 + r] * z + m[12 + r]);
    }
    const q = [0, 1, 2].map((r) => world[r] * p[0] + world[4 + r] * p[1] + world[8 + r] * p[2] + world[12 + r]);
    worst = Math.max(worst, Math.abs(q[0] + v.x), Math.abs(q[1] - v.y), Math.abs(q[2] - v.z));
    if (Math.hypot(q[0] + mesh.positions[i * 3], q[1] - mesh.positions[i * 3 + 1], q[2] - mesh.positions[i * 3 + 2]) > 1) moved++;
  }
  assert(worst < 1e-3, `a vertex is ${worst} away from three.js's`);
  assert(moved > mesh.vertexCount / 4, `only ${moved} vertices moved away from the rest pose`);

  // Picks and bounds follow the pose: a ray at the middle of a triangle
  // that three.js has bent (the one that moved most), along its normal,
  // meets the fox there; the same ray at the rest pose misses it.
  const bent = (i) => [0, 1, 2].map((k) => theirs.getVertexPosition(i * 3 + k, new THREE.Vector3()).applyMatrix4(theirs.matrixWorld));
  let best = { move: 0 };
  for (let tri = 0; tri < mesh.vertexCount / 3; tri++)
  {
    const pts = bent(tri);
    const centre = pts[0].clone().add(pts[1]).add(pts[2]).multiplyScalar(1 / 3);
    const rest = [0, 1, 2].map((k) => new THREE.Vector3(-mesh.positions[(tri * 3 + k) * 3], mesh.positions[(tri * 3 + k) * 3 + 1], mesh.positions[(tri * 3 + k) * 3 + 2]));
    const was = rest[0].clone().add(rest[1]).add(rest[2]).multiplyScalar(1 / 3);
    const move = centre.distanceTo(was);
    const normal = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).normalize();
    const area = pts[1].clone().sub(pts[0]).cross(pts[2].clone().sub(pts[0])).length();
    if (move > best.move && area > 20) best = { move, centre, normal };
  }
  assert(best.move > 5, `no triangle moved: ${best.move}`);
  const ray = (from) => rayOnto(part, new Vec3(-from.x, from.y, from.z), new Vec3(best.normal.x, -best.normal.y, -best.normal.z).scale(6));
  // From 3 units above the triangle, along minus its normal, in PolyBasic's
  // space (x mirrored).
  const origin = best.centre.clone().addScaledVector(best.normal, 3);
  const hit = ray(origin);
  assert(hit && Math.hypot(hit.x + best.centre.x, hit.y - best.centre.y, hit.z - best.centre.z) < 1e-3, `the pick at the bent triangle: ${hit ? [hit.x, hit.y, hit.z] : 'a miss'}`);
  // The bounds are those of the bent vertices (x mirrored for PolyBasic).
  const box = part.worldBounds();
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < mesh.vertexCount; i++)
  {
    theirs.getVertexPosition(index ? index[i] : i, v).applyMatrix4(theirs.matrixWorld);
    const p = [-v.x, v.y, v.z];
    for (let k = 0; k < 3; k++)
    {
      lo[k] = Math.min(lo[k], p[k]);
      hi[k] = Math.max(hi[k], p[k]);
    }
  }
  nearAll([box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z], [...lo, ...hi], 1e-3, 'bounds of the bent fox');
  // Back to the rest pose: the same ray goes through where the triangle was.
  engine.models.play(root, 0, 0, 1);
  for (const n of root.model.nodes)
  {
    if (!n) continue;
    const r = data.nodes[root.model.nodes.indexOf(n)];
    n.position.copy(r.position);
    n.rotation.copy(r.rotation);
    n.scale.copy(r.scale);
    n.touch();
  }
  const again = ray(origin);
  assert(!again || Math.hypot(again.x + best.centre.x, again.y - best.centre.y, again.z - best.centre.z) > 1e-2, 'the pick still finds the bent triangle in the rest pose');
});

test('LoadMesh in a program: the pivot at once, the parts before the first Update, animations play', async () =>
{
  const source = `
Global guy, copy
guy = LoadMesh(Later("character.glb"))
Print "loaded in main: " + MeshLoaded(guy)
Function Update()
  f = FrameCount()
  If f = 1
    Print "loaded: " + MeshLoaded(guy) + ", children " + CountChildren(guy) + ", animations " + CountAnimations(guy)
    For i = 1 To CountAnimations(guy)
      Print "  " + i + " " + AnimationName(guy, i) + " " + AnimLength(guy, i)
    Next
    leg = FindChild(guy, "LEG-LEFT")
    Print "left leg on the left: " + (EntityX(leg, True) < 0)
    Animate guy, FindAnimation(guy, "walk"), ANIM_LOOP, 1
    copy = CopyEntity(guy)
    Animate copy, FindAnimation(guy, "jump"), ANIM_ONCE, 2
  EndIf
  If f = 31
    Print "walking: " + Animating(guy) + " at " + AnimTime(guy) + ", copy jumped: done " + (1 - Animating(copy)) + " at " + AnimTime(copy)
    Print "copy's arm is its own: " + (FindChild(copy, "arm-left") <> FindChild(guy, "arm-left"))
    Animate guy, 0
    Print "stopped: " + Animating(guy)
    End
  EndIf
End Function
Function Later$(name$)
  Return name
End Function
`;
  const module = await loadProgram(compile(source, { file: 'test.pb' }).js);
  const engine = new Engine({ baseUrl: pathToFileURL(join(KENNEY, 'x.pb')).href, loadFile: (u) => readFile(fileURLToPath(u)) });
  const host = new CaptureHost();
  const r = await runProgram(module, host, { engine });
  assert(r.status === 'ended', `${r.status} ${r.error ? r.error.message : ''}\n${host.output}`);
  const lines = host.output.split('\n');
  assert(lines[0] === 'loaded in main: 0', lines[0]);
  assert(lines[1] === 'loaded: 1, children 1, animations 4', lines[1]);
  assert(lines[2] === '  1 static 0.1', lines[2]);
  assert(lines[4] === '  3 walk 0.433333', lines[4]);
  assert(lines[6] === 'left leg on the left: 1', lines[6]);
  // 30 steps of 1/60 s of a 0.4333 s walk: 0.5 - 0.4333 = 0.0667.
  assert(lines[7] === 'walking: 1 at 0.0666667, copy jumped: done 1 at 0.5', lines[7]);
  assert(lines[8] === "copy's arm is its own: 1", lines[8]);
  assert(lines[9] === 'stopped: 0', lines[9]);
});

test('a model wears its entity brush over each surface, as Blitz3D combines them', async () =>
{
  const source = `
Global car, copy
car = LoadMesh(Later("car.glb"))
EntityColor car, 255, 51, 0
EntityAlpha car, 0.5
EntityShininess car, 0.25
Function Update()
  copy = CopyEntity(car)
  EntityColor copy, 0, 255, 255
  EntityFX copy, FX_FULLBRIGHT
  End
End Function
Function Later$(name$)
  Return name
End Function
`;
  const module = await loadProgram(compile(source, { file: 'test.pb' }).js);
  const engine = new Engine({ baseUrl: pathToFileURL(join(DRIVER, 'x.pb')).href, loadFile: (u) => readFile(fileURLToPath(u)) });
  const host = new CaptureHost();
  const r = await runProgram(module, host, { engine });
  assert(r.status === 'ended', `${r.status} ${r.error ? r.error.message : ''}\n${host.output}`);
  const models = engine.world.entities.filter((e) => e.model);
  assert(models.length === 2, `${models.length} models`);
  const parts = (root) => root.model.nodes.filter((n) => n && n.surfaces);
  const [car, copy] = models;
  assert(parts(car).length > 0, 'the car has no parts with surfaces');
  for (const part of parts(car))
  {
    part.surfaces.forEach((s, i) =>
    {
      const m = part.materials[i];
      nearAll(m.color, [s.color[0], s.color[1] * 0.2, 0], 1e-6, 'colour multiplies');
      near(m.alpha, (s.alphaMode === 'opaque' ? 1 : s.alpha) * 0.5, 1e-6, 'alpha multiplies');
      assert(m.alphaMode !== 'opaque', 'half faded yet drawn opaque');
      near(m.shininess, Math.min(1, s.shininess + 0.25), 1e-6, 'shininess adds');
      assert(m.texture === s.texture && !m.fullbright, 'the car took the copy\'s looks');
    });
  }
  for (const part of parts(copy))
  {
    part.surfaces.forEach((s, i) =>
    {
      const m = part.materials[i];
      nearAll(m.color, [0, s.color[1], s.color[2]], 1e-6, 'the copy\'s own colour');
      near(m.alpha, (s.alphaMode === 'opaque' ? 1 : s.alpha) * 0.5, 1e-6, 'the copy keeps the alpha it was copied with');
      assert(m.fullbright, 'EntityFX did not reach the copy\'s parts');
    });
  }
});

test('a missing model or one that is not glTF is reported and never loads', async () =>
{
  const source = 'Global a, b\na = LoadMesh("nothing.glb")\nb = LoadMesh("../tile.png")\nPrint MeshLoaded(a) + " " + MeshLoaded(b)\nFunction Update()\n  Print MeshLoaded(a) + " " + MeshLoaded(b)\n  End\nEnd Function\n';
  const module = await loadProgram(compile(source, { file: 'test.pb' }).js);
  const engine = new Engine({ baseUrl: pathToFileURL(join(KENNEY, 'x.pb')).href, loadFile: (u) => readFile(fileURLToPath(u)) });
  const host = new CaptureHost();
  await runProgram(module, host, { engine });
  assert(/LoadMesh: could not load "nothing.glb"/.test(host.output), host.output);
  assert(/LoadMesh: could not load "..\/tile.png": not a glTF file/.test(host.output), host.output);
  assert(host.output.trim().endsWith('0 0'), host.output);
});

export default unit;
