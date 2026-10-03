// Converts a DirectX .x model (text or binary format) to a binary glTF
// (.glb), for the Blitz3D samples that come as .x files.
//
//   node tools/x2gltf.mjs model.x model.glb
//
// Read: frames with their matrices, meshes (faces of any size, fanned into
// triangles), MeshNormals, MeshTextureCoords, MeshMaterialList with
// Material colours and TextureFilename, and AnimationSets of frames moved
// by position, rotation and scale keys. Not read: matrix keys, skin
// weights, vertex colours, compressed (mszip) .x files.
//
// An animation's key times are frames, as Blitz3D plays them (one frame a
// step at speed 1, and a step is 1/60 of a second): they are written as
// frame / 60 seconds, so Animate at speed 1 plays one frame a step. A
// frame an animation moves is written as translation, rotation and scale
// (the glTF way) taken from its matrix; a channel the animation has no keys
// for keeps the matrix's value.
//
// .x space is left-handed like PolyBasic's; glTF's is right-handed. The
// file is written so that PolyBasic's glTF reader (which mirrors x) gives
// back the .x coordinates: positions and normals x -> -x, matrices S M S,
// two corners of every triangle swapped. UVs are the same in both.

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ------------------------------------------------------------------ parse

export function tokenize(text)
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

// The binary format ("xof 0302bin 0032") is the same stream of names,
// braces, strings and numbers, written as 16-bit tokens: a list of integers
// or floats is one token, and templates (which only describe the data) are
// skipped. The tokens made are the text format's, so one parser does both.
// Floats are 32 or 64 bits as the header says.
export function tokenizeBinary(bytes)
{
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (from, to) => String.fromCharCode(...bytes.subarray(from, to));
  const wide = text(12, 16) === '0064';
  const tokens = [];
  let i = 16;
  let skipping = false;
  let depth = 0;
  const number = (n) =>
  {
    if (!skipping) tokens.push({ n });
  };
  while (i < bytes.length)
  {
    const id = view.getUint16(i, true);
    i += 2;
    switch (id)
    {
      case 1: // name
      case 2: // string, then the token that ended it
      {
        const length = view.getUint32(i, true);
        const s = text(i + 4, i + 4 + length);
        i += 4 + length;
        if (id === 2) i += 2;
        if (!skipping) tokens.push(id === 1 ? { w: s } : { s });
        break;
      }
      case 3:
        number(view.getInt32(i, true));
        i += 4;
        break;
      case 5: // GUID
        i += 16;
        break;
      case 6:
      {
        const count = view.getUint32(i, true);
        i += 4;
        for (let k = 0; k < count; k++, i += 4) number(view.getInt32(i, true));
        break;
      }
      case 7:
      {
        const count = view.getUint32(i, true);
        i += 4;
        for (let k = 0; k < count; k++)
        {
          number(wide ? view.getFloat64(i, true) : view.getFloat32(i, true));
          i += wide ? 8 : 4;
        }
        break;
      }
      case 10:
        if (skipping) depth++;
        else tokens.push({ p: '{' });
        break;
      case 11:
        if (!skipping) tokens.push({ p: '}' });
        else if (--depth === 0) skipping = false;
        break;
      case 31: // template: skipped up to its closing brace
        skipping = true;
        depth = 0;
        break;
      case 12: case 13: case 14: case 15: case 16: case 17: case 18: case 19: case 20:
      case 40: case 41: case 42: case 43: case 44: case 45: case 46: case 47: case 48: case 49: case 50: case 51: case 52:
        break;
      default:
        throw new Error(`unknown token ${id} at byte ${i - 2} of the binary .x file`);
    }
  }
  return tokens;
}

// { type, name, values: [numbers and strings in order], children }
export function parse(tokens)
{
  let i = 0;
  const block = () =>
  {
    const node = { type: tokens[i++].w, name: '', values: [], children: [], refs: [] };
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
        if (tokens[i + 1].w) node.refs.push(tokens[i + 1].w);
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

// Translation, rotation (x y z w) and scale of a glTF matrix (16 numbers,
// column by column).
export function decompose(m)
{
  const scale = [Math.hypot(m[0], m[1], m[2]), Math.hypot(m[4], m[5], m[6]), Math.hypot(m[8], m[9], m[10])];
  // A mirrored matrix is told by its determinant: the sign goes to x.
  const det = m[0] * (m[5] * m[10] - m[6] * m[9]) - m[4] * (m[1] * m[10] - m[2] * m[9]) + m[8] * (m[1] * m[6] - m[2] * m[5]);
  if (det < 0) scale[0] = -scale[0];
  // The rotation matrix r[row][column], from the columns made unit.
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let col = 0; col < 3; col++) for (let row = 0; row < 3; row++) r[row][col] = m[col * 4 + row] / scale[col];
  const trace = r[0][0] + r[1][1] + r[2][2];
  let x;
  let y;
  let z;
  let w;
  if (trace > 0)
  {
    const t = Math.sqrt(trace + 1) * 2;
    w = t / 4;
    x = (r[2][1] - r[1][2]) / t;
    y = (r[0][2] - r[2][0]) / t;
    z = (r[1][0] - r[0][1]) / t;
  }
  else if (r[0][0] > r[1][1] && r[0][0] > r[2][2])
  {
    const t = Math.sqrt(1 + r[0][0] - r[1][1] - r[2][2]) * 2;
    w = (r[2][1] - r[1][2]) / t;
    x = t / 4;
    y = (r[0][1] + r[1][0]) / t;
    z = (r[0][2] + r[2][0]) / t;
  }
  else if (r[1][1] > r[2][2])
  {
    const t = Math.sqrt(1 + r[1][1] - r[0][0] - r[2][2]) * 2;
    w = (r[0][2] - r[2][0]) / t;
    x = (r[0][1] + r[1][0]) / t;
    y = t / 4;
    z = (r[1][2] + r[2][1]) / t;
  }
  else
  {
    const t = Math.sqrt(1 + r[2][2] - r[0][0] - r[1][1]) * 2;
    w = (r[1][0] - r[0][1]) / t;
    x = (r[0][2] + r[2][0]) / t;
    y = (r[1][2] + r[2][1]) / t;
    z = t / 4;
  }
  return { translation: [m[12], m[13], m[14]], rotation: [x, y, z, w], scale };
}

// The keys of an AnimationKey block: [{ time, values }].
function readKeys(node)
{
  const v = node.values;
  const keys = [];
  let i = 2;
  for (let n = 0; n < v[1]; n++)
  {
    const length = v[i + 1];
    keys.push({ time: v[i], values: v.slice(i + 2, i + 2 + length) });
    i += 2 + length;
  }
  return keys;
}

const FRAMES_PER_SECOND = 60;

// `named`: the Material blocks of the file by name, for the lists that point
// to them ({ name }) instead of holding them.
function readMesh(node, named)
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
      const blocks = c.children.filter((m) => m.type === 'Material').concat(c.refs.map((r) => named.get(r)));
      if (blocks.some((m) => !m)) throw new Error(`mesh ${node.name} lists a material the file does not have`);
      materials = blocks.map((m) =>
      {
        const tex = m.children.find((t) => t.type.toLowerCase() === 'texturefilename');
        return { colour: m.values.slice(0, 4), power: m.values[4], texture: tex ? tex.values[0] : null };
      });
    }
  }
  return { name: node.name, positions, faces, normals, normalFaces, uvs, materials, faceMaterial };
}

// `options.resolveTexture(file)`: the file name of a texture a material
// names, as it is on disk (Windows does not tell capitals apart, the web
// does), or null when it is not there: such a texture is left out, as
// Blitz3D does, and the material keeps its colour (`options.missing` gets
// its name).
export function convert(roots, name, options = {})
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
  const named = new Map();
  const collect = (node) =>
  {
    if (node.type === 'Material' && node.name) named.set(node.name, node);
    node.children.forEach(collect);
  };
  roots.forEach(collect);
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
    const file = m.texture && options.resolveTexture ? options.resolveTexture(m.texture.replace(/\\+/g, '/')) : m.texture && m.texture.replace(/\\+/g, '/');
    if (m.texture && !file)
    {
      if (options.missing && !options.missing.includes(m.texture)) options.missing.push(m.texture);
    }
    else if (m.texture)
    {
      images.push({ uri: file });
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
  const frameNodes = new Map();
  const nodeOf = (node) =>
  {
    const out = { name: node.name || node.type };
    gltf.nodes.push(out);
    const index = gltf.nodes.length - 1;
    if (node.name) frameNodes.set(node.name, index);
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
        gltf.nodes.push({ name: c.name, mesh: meshOf(readMesh(c, named)) });
        children.push(gltf.nodes.length - 1);
      }
    }
    if (children.length) out.children = children;
    return index;
  };
  // An AnimationSet: each Animation names a frame ({ Frame }) and has keys
  // for how it moves. A frame that moves is given its translation, rotation
  // and scale (from its matrix), as glTF does not move a node that has a
  // matrix.
  const addAnimation = (set) =>
  {
    const animation = { name: set.name, samplers: [], channels: [] };
    const asSeconds = (frames) => frames / FRAMES_PER_SECOND;
    for (const a of set.children.filter((c) => c.type === 'Animation'))
    {
      const target = frameNodes.get(a.refs[0]);
      if (target === undefined) throw new Error(`animation ${a.name} moves ${a.refs[0] || 'nothing'}, which is not a frame`);
      const node = gltf.nodes[target];
      if (node.matrix)
      {
        Object.assign(node, decompose(node.matrix));
        delete node.matrix;
      }
      for (const k of a.children.filter((c) => c.type === 'AnimationKey'))
      {
        const type = k.values[0];
        if (type !== 0 && type !== 1 && type !== 2) throw new Error(`animation ${a.name} has matrix keys, which are not read`);
        const keys = readKeys(k);
        const times = Float32Array.from(keys.map((key) => asSeconds(key.time)));
        let path;
        let size;
        const out = [];
        for (const key of keys)
        {
          const v = key.values;
          if (type === 2)
          {
            path = 'translation';
            size = 3;
            out.push(-v[0], v[1], v[2]);
          }
          else if (type === 1)
          {
            path = 'scale';
            size = 3;
            out.push(v[0], v[1], v[2]);
          }
          else
          {
            // (w, x, y, z) in the .x, which turns the other way round; the
            // mirror in x keeps x and flips y and z: here (x, y, z, w).
            path = 'rotation';
            size = 4;
            out.push(-v[1], v[2], v[3], v[0]);
          }
        }
        const accessor = (array, type2, extra) =>
        {
          gltf.accessors.push({ bufferView: addView(array), componentType: 5126, count: array.length / (type2 === 'SCALAR' ? 1 : size), type: type2, ...extra });
          return gltf.accessors.length - 1;
        };
        const input = accessor(times, 'SCALAR', { min: [Math.min(...times)], max: [Math.max(...times)] });
        const output = accessor(Float32Array.from(out), size === 3 ? 'VEC3' : 'VEC4', {});
        animation.samplers.push({ input, output, interpolation: 'LINEAR' });
        animation.channels.push({ sampler: animation.samplers.length - 1, target: { node: target, path } });
      }
    }
    if (!gltf.animations) gltf.animations = [];
    gltf.animations.push(animation);
  };
  for (const r of roots)
  {
    if (r.type === 'Frame') gltf.scenes[0].nodes.push(nodeOf(r));
    else if (r.type === 'Mesh')
    {
      gltf.nodes.push({ name: r.name, mesh: meshOf(readMesh(r, named)) });
      gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
    }
  }
  for (const set of roots.filter((r) => r.type === 'AnimationSet')) addAnimation(set);
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

// The .glb made from the bytes of a .x file.
export function xToGlb(bytes, name, options = {})
{
  const head = String.fromCharCode(...bytes.subarray(0, 16));
  if (!head.startsWith('xof ')) throw new Error(`${name} is not a .x file`);
  const format = head.slice(8, 12);
  if (format === 'txt ') return convert(parse(tokenize(Buffer.from(bytes).toString('latin1').slice(16))), name, options);
  if (format === 'bin ') return convert(parse(tokenizeBinary(bytes)), name, options);
  throw new Error(`${name} is a ${format.trim()} .x file: only txt and bin are read`);
}

if (process.argv[1] === fileURLToPath(import.meta.url))
{
  const [input, output] = process.argv.slice(2);
  if (!input || !output)
  {
    console.error('usage: node tools/x2gltf.mjs model.x model.glb');
    process.exit(1);
  }
  // A texture the .x names that is not beside it is left out.
  const missing = [];
  const resolveTexture = (file) =>
  {
    const folder = join(dirname(input), dirname(file));
    if (!existsSync(folder)) return null;
    const found = readdirSync(folder).find((f) => f.toLowerCase() === basename(file).toLowerCase());
    return found ? join(dirname(file), found).replace(/^\.\//, '') : null;
  };
  writeFileSync(output, xToGlb(new Uint8Array(readFileSync(input)), basename(input), { resolveTexture, missing }));
  console.log(`${input} -> ${output}`);
  if (missing.length) console.log(`left out, not found beside the .x: ${missing.join(', ')}`);
}
