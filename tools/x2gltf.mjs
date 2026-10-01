// Converts a DirectX .x model (text format) to a binary glTF (.glb), for
// the Blitz3D samples that come as .x files.
//
//   node tools/x2gltf.mjs model.x model.glb
//
// Read: frames with their matrices, meshes (faces of any size, fanned into
// triangles), MeshNormals, MeshTextureCoords, MeshMaterialList with
// Material colours and TextureFilename. Not read: animations, skin
// weights, vertex colours, binary .x files.
//
// .x space is left-handed like PolyBasic's; glTF's is right-handed. The
// file is written so that PolyBasic's glTF reader (which mirrors x) gives
// back the .x coordinates: positions and normals x -> -x, matrices S M S,
// two corners of every triangle swapped. UVs are the same in both.

import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

// ------------------------------------------------------------------ parse

function tokenize(text)
{
  const tokens = [];
  const re = /\/\/[^\n]*|#[^\n]*|"([^"]*)"|([{}])|([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)|([A-Za-z_][\w.-]*)|([;,])|\s+/g;
  let m;
  while ((m = re.exec(text)))
  {
    if (m[1] !== undefined) tokens.push({ s: m[1] });
    else if (m[2]) tokens.push({ p: m[2] });
    else if (m[3]) tokens.push({ n: Number(m[3]) });
    else if (m[4]) tokens.push({ w: m[4] });
  }
  return tokens;
}

// { type, name, values: [numbers and strings in order], children }
function parse(tokens)
{
  let i = 0;
  const block = () =>
  {
    const node = { type: tokens[i++].w, name: '', values: [], children: [] };
    if (tokens[i].w) node.name = tokens[i++].w;
    if (tokens[i].p !== '{') throw new Error(`expected { after ${node.type}`);
    i++;
    while (tokens[i].p !== '}')
    {
      const t = tokens[i];
      if (t.w && tokens[i + 1] && (tokens[i + 1].p === '{' || (tokens[i + 1].w && tokens[i + 2] && tokens[i + 2].p === '{'))) node.children.push(block());
      else if (t.p === '{')
      {
        // A reference to a named block: { name }.
        i += 3;
      }
      else
      {
        if (t.n !== undefined) node.values.push(t.n);
        else if (t.s !== undefined) node.values.push(t.s);
        i++;
      }
    }
    i++;
    return node;
  };
  const roots = [];
  while (i < tokens.length)
  {
    if (tokens[i].w === 'template')
    {
      while (tokens[i].p !== '}') i++;
      i++;
    }
    else if (tokens[i].w) roots.push(block());
    else i++;
  }
  return roots;
}

// ---------------------------------------------------------------- convert

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function readMesh(node)
{
  const v = node.values;
  let k = 0;
  const nv = v[k++];
  const positions = v.slice(k, k + nv * 3);
  k += nv * 3;
  const nf = v[k++];
  const faces = [];
  for (let f = 0; f < nf; f++)
  {
    const n = v[k++];
    faces.push(v.slice(k, k + n));
    k += n;
  }
  let normals = null;
  let normalFaces = null;
  let uvs = null;
  let materials = [{ colour: [1, 1, 1, 1], power: 0, texture: null }];
  let faceMaterial = faces.map(() => 0);
  for (const c of node.children)
  {
    if (c.type === 'MeshNormals')
    {
      const w = c.values;
      let j = 0;
      const nn = w[j++];
      normals = w.slice(j, j + nn * 3);
      j += nn * 3;
      const nnf = w[j++];
      normalFaces = [];
      for (let f = 0; f < nnf; f++)
      {
        const n = w[j++];
        normalFaces.push(w.slice(j, j + n));
        j += n;
      }
    }
    else if (c.type === 'MeshTextureCoords')
    {
      uvs = c.values.slice(1, 1 + c.values[0] * 2);
    }
    else if (c.type === 'MeshMaterialList')
    {
      const w = c.values;
      const count = w[1];
      const list = w.slice(2, 2 + count);
      // Fewer indices than faces: the last goes on for the rest.
      faceMaterial = faces.map((_, f) => list[Math.min(f, list.length - 1)]);
      materials = c.children.filter((m) => m.type === 'Material').map((m) =>
      {
        const tex = m.children.find((t) => t.type === 'TextureFilename');
        return { colour: m.values.slice(0, 4), power: m.values[4], texture: tex ? tex.values[0] : null };
      });
    }
  }
  return { name: node.name, positions, faces, normals, normalFaces, uvs, materials, faceMaterial };
}

function convert(roots, name)
{
  const gltf = {
    asset: { version: '2.0', generator: 'PolyBasic tools/x2gltf.mjs' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }]
  };
  const images = [];
  const chunks = [];
  let offset = 0;
  const addView = (array, target) =>
  {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    const pad = (4 - (offset % 4)) % 4;
    if (pad) chunks.push(new Uint8Array(pad));
    offset += pad;
    chunks.push(bytes);
    gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target });
    offset += bytes.length;
    return gltf.bufferViews.length - 1;
  };
  const addAccessor = (array, type, count, componentType, extra = {}) =>
  {
    gltf.accessors.push({ bufferView: addView(array, componentType === 5125 ? 34963 : 34962), componentType, count, type, ...extra });
    return gltf.accessors.length - 1;
  };
  const materialIndex = new Map();
  const material = (m) =>
  {
    const key = JSON.stringify(m);
    if (materialIndex.has(key)) return materialIndex.get(key);
    const [r, g, b, a] = m.colour;
    const out = {
      pbrMetallicRoughness: {
        baseColorFactor: [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b), a],
        metallicFactor: 0,
        roughnessFactor: 1 - Math.min(m.power, 128) / 128 * 0.8
      }
    };
    if (a < 1) out.alphaMode = 'BLEND';
    if (m.texture)
    {
      images.push({ uri: m.texture });
      if (!gltf.textures) gltf.textures = [];
      gltf.textures.push({ source: images.length - 1 });
      out.pbrMetallicRoughness.baseColorTexture = { index: gltf.textures.length - 1 };
    }
    gltf.materials.push(out);
    materialIndex.set(key, gltf.materials.length - 1);
    return gltf.materials.length - 1;
  };

  const meshOf = (mesh) =>
  {
    const primitives = [];
    for (let mi = 0; mi < mesh.materials.length; mi++)
    {
      // One vertex per (position, normal) corner pair.
      const index = new Map();
      const pos = [];
      const nor = [];
      const uv = [];
      const tri = [];
      const vertex = (p, n) =>
      {
        const key = `${p}/${n}`;
        if (index.has(key)) return index.get(key);
        const i = pos.length / 3;
        pos.push(-mesh.positions[p * 3], mesh.positions[p * 3 + 1], mesh.positions[p * 3 + 2]);
        if (mesh.normals && n >= 0) nor.push(-mesh.normals[n * 3], mesh.normals[n * 3 + 1], mesh.normals[n * 3 + 2]);
        if (mesh.uvs) uv.push(mesh.uvs[p * 2], mesh.uvs[p * 2 + 1]);
        index.set(key, i);
        return i;
      };
      mesh.faces.forEach((face, f) =>
      {
        if (mesh.faceMaterial[f] !== mi) return;
        const nf = mesh.normalFaces ? mesh.normalFaces[f] : face;
        const corners = face.map((p, c) => vertex(p, mesh.normals ? nf[c] : -1));
        // Fan, with two corners swapped for the mirror.
        for (let c = 1; c + 1 < corners.length; c++) tri.push(corners[0], corners[c + 1], corners[c]);
      });
      if (!tri.length) continue;
      const p = Float32Array.from(pos);
      const min = [0, 1, 2].map((a) => Math.min(...p.filter((_, i) => i % 3 === a)));
      const max = [0, 1, 2].map((a) => Math.max(...p.filter((_, i) => i % 3 === a)));
      const attributes = { POSITION: addAccessor(p, 'VEC3', p.length / 3, 5126, { min, max }) };
      if (nor.length) attributes.NORMAL = addAccessor(Float32Array.from(nor), 'VEC3', nor.length / 3, 5126);
      if (uv.length) attributes.TEXCOORD_0 = addAccessor(Float32Array.from(uv), 'VEC2', uv.length / 2, 5126);
      primitives.push({ attributes, indices: addAccessor(Uint32Array.from(tri), 'SCALAR', tri.length, 5125), material: material(mesh.materials[mi]) });
    }
    gltf.meshes.push({ name: mesh.name, primitives });
    return gltf.meshes.length - 1;
  };

  // Frames become nodes; a mesh inside a frame becomes a child node.
  const nodeOf = (node) =>
  {
    const out = { name: node.name || node.type };
    gltf.nodes.push(out);
    const index = gltf.nodes.length - 1;
    const children = [];
    for (const c of node.children)
    {
      if (c.type === 'FrameTransformMatrix')
      {
        const m = c.values.slice(0, 16);
        // S M S with S = diag(-1, 1, 1, 1): the entries in row 0 or column
        // 0 change sign, except the corner.
        for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) if ((row === 0) !== (col === 0)) m[col * 4 + row] = -m[col * 4 + row];
        out.matrix = m;
      }
      else if (c.type === 'Frame') children.push(nodeOf(c));
      else if (c.type === 'Mesh')
      {
        gltf.nodes.push({ name: c.name, mesh: meshOf(readMesh(c)) });
        children.push(gltf.nodes.length - 1);
      }
    }
    if (children.length) out.children = children;
    return index;
  };
  for (const r of roots)
  {
    if (r.type === 'Frame') gltf.scenes[0].nodes.push(nodeOf(r));
    else if (r.type === 'Mesh')
    {
      gltf.nodes.push({ name: r.name, mesh: meshOf(readMesh(r)) });
      gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
    }
  }
  if (images.length) gltf.images = images;
  gltf.scenes[0].name = name;

  const bin = new Uint8Array(offset);
  let at = 0;
  for (const c of chunks)
  {
    bin.set(c, at);
    at += c.length;
  }
  gltf.buffers[0].byteLength = bin.length;
  return glb(gltf, bin);
}

function glb(json, bin)
{
  let text = new TextEncoder().encode(JSON.stringify(json));
  const jsonPad = (4 - (text.length % 4)) % 4;
  text = Uint8Array.from([...text, ...new Array(jsonPad).fill(0x20)]);
  const binPad = (4 - (bin.length % 4)) % 4;
  const body = Uint8Array.from([...bin, ...new Array(binPad).fill(0)]);
  const out = new Uint8Array(12 + 8 + text.length + 8 + body.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, 0x46546c67, true);
  v.setUint32(4, 2, true);
  v.setUint32(8, out.length, true);
  v.setUint32(12, text.length, true);
  v.setUint32(16, 0x4e4f534a, true);
  out.set(text, 20);
  v.setUint32(20 + text.length, body.length, true);
  v.setUint32(24 + text.length, 0x004e4942, true);
  out.set(body, 28 + text.length);
  return out;
}

const [input, output] = process.argv.slice(2);
if (!input || !output)
{
  console.error('usage: node tools/x2gltf.mjs model.x model.glb');
  process.exit(1);
}
const text = readFileSync(input, 'latin1');
if (!text.startsWith('xof ') || text.slice(8, 11) !== 'txt') throw new Error(`${input} is not a text .x file`);
writeFileSync(output, convert(parse(tokenize(text.slice(16))), basename(input)));
console.log(`${input} -> ${output}`);
