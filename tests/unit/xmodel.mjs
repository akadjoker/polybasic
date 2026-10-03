// DirectX .x models turned into .glb by tools/x2gltf.mjs: the text and the
// binary format of the same model give the same file.

import { xToGlb, tokenizeBinary } from '../../tools/x2gltf.mjs';
import { assert } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

const TEXT = `xof 0303txt 0032
template Foo { <11111111-2222-3333-4444-555555555555> DWORD n; }
Mesh Quad {
  4;
  0;0;0;, 1;0;0;, 1;1;0;, 0;1;0;;
  1;
  4;0,1,2,3;;
  MeshNormals {
    4;
    0;0;-1;, 0;0;-1;, 0;0;-1;, 0;0;-1;;
    1;
    4;0,1,2,3;;
  }
  MeshTextureCoords {
    4;
    0;1;, 1;1;, 1;0;, 0;0;;
  }
  MeshMaterialList {
    1;
    1;
    0;;
    Material {
      1;0.5;0.25;1;;
      8;
      0;0;0;;
      0;0;0;;
      TextureFilename { "Textures\\\\tex.bmp"; }
    }
  }
}
`;

// The same model as 16-bit tokens.
function binary()
{
  const out = [];
  const u16 = (n) => out.push(n & 255, n >> 8);
  const u32 = (n) => out.push(n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24);
  const f32 = (n) => out.push(...new Uint8Array(new Float32Array([n]).buffer));
  const name = (s) =>
  {
    u16(1);
    u32(s.length);
    out.push(...[...s].map((c) => c.charCodeAt(0)));
  };
  const string = (s) =>
  {
    u16(2);
    u32(s.length);
    out.push(...[...s].map((c) => c.charCodeAt(0)));
    u16(20);
  };
  const ints = (...v) =>
  {
    u16(6);
    u32(v.length);
    v.forEach(u32);
  };
  const floats = (...v) =>
  {
    u16(7);
    u32(v.length);
    v.forEach(f32);
  };
  out.push(...[...'xof 0302bin 0032'].map((c) => c.charCodeAt(0)));
  // template Foo { <guid> DWORD n; }
  u16(31);
  name('Foo');
  u16(10);
  u16(5);
  out.push(...new Array(16).fill(7));
  u16(41);
  name('n');
  u16(20);
  u16(11);
  name('Mesh');
  name('Quad');
  u16(10);
  ints(4);
  floats(0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0);
  ints(1, 4, 0, 1, 2, 3);
  name('MeshNormals');
  u16(10);
  ints(4);
  floats(0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1);
  ints(1, 4, 0, 1, 2, 3);
  u16(11);
  name('MeshTextureCoords');
  u16(10);
  ints(4);
  floats(0, 1, 1, 1, 1, 0, 0, 0);
  u16(11);
  name('MeshMaterialList');
  u16(10);
  ints(1, 1, 0);
  name('Material');
  u16(10);
  floats(1, 0.5, 0.25, 1, 8, 0, 0, 0, 0, 0, 0);
  name('TextureFilename');
  u16(10);
  string('Textures\\\\tex.bmp');
  u16(11);
  u16(11);
  u16(11);
  u16(11);
  return Uint8Array.from(out);
}

test('a binary .x gives the file its text twin gives', () =>
{
  const a = xToGlb(new TextEncoder().encode(TEXT), 'quad.x');
  const b = xToGlb(binary(), 'quad.x');
  assert(a.length === b.length && a.every((x, i) => x === b[i]), 'the two files differ');
  const json = JSON.parse(new TextDecoder().decode(a.subarray(20, 20 + new DataView(a.buffer, a.byteOffset).getUint32(12, true))));
  assert(json.images[0].uri === 'Textures/tex.bmp', `texture path ${json.images[0].uri}: backslashes become slashes`);
});

test('binary tokens: templates are skipped, lists give their numbers', () =>
{
  const tokens = tokenizeBinary(binary());
  assert(tokens[0].w === 'Mesh', 'the template is skipped');
  assert(tokens.filter((t) => t.n !== undefined).length === 1 + 12 + 6 + 1 + 12 + 6 + 1 + 8 + 3 + 11, 'numbers');
  assert(tokens.some((t) => t.s === 'Textures\\\\tex.bmp'), 'the string');
});

test('files that cannot be read say why', () =>
{
  const bad = (bytes, text) =>
  {
    let message = '';
    try
    {
      xToGlb(bytes, 'bad.x');
    }
    catch (err)
    {
      message = err.message;
    }
    assert(message.includes(text), `expected "${text}", got "${message}"`);
  };
  bad(new TextEncoder().encode('not a model at all'), 'not a .x file');
  bad(new TextEncoder().encode('xof 0302bzip0032 and then compressed data'), 'bzip');
  const cut = binary();
  cut[16] = 99;
  bad(cut, 'unknown token');
});

function jsonOf(glb)
{
  return JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer, glb.byteOffset).getUint32(12, true))));
}

// The numbers of an accessor of a .glb (all floats here).
function floatsOf(glb, json, index)
{
  const accessor = json.accessors[index];
  const view = json.bufferViews[accessor.bufferView];
  const binary = 20 + new DataView(glb.buffer, glb.byteOffset).getUint32(12, true) + 8;
  const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[accessor.type];
  const bytes = glb.slice(binary + view.byteOffset, binary + view.byteOffset + accessor.count * size * 4);
  return Array.from(new Float32Array(bytes.buffer));
}

// A frame turned 30 degrees about y and moved to (1, 2, 3), moved by an
// animation whose first key is that same pose: the .x's matrix and its
// quaternion say the same thing, so the glTF the animation makes must start
// where the node does.
const ANIMATED = (() =>
{
  const half = (30 * Math.PI) / 360;
  const w = Math.cos(half);
  const y = Math.sin(half);
  // Row vectors: the matrix holds the standard rotation matrix of the
  // quaternion (w, 0, y, 0) as it is, with the position in the last row.
  const c = 1 - 2 * y * y;
  const sy = 2 * w * y;
  return `xof 0303txt 0032
Frame Arm {
  FrameTransformMatrix {
    ${c}, 0, ${sy}, 0,
    0, 1, 0, 0,
    ${-sy}, 0, ${c}, 0,
    1, 2, 3, 1;;
  }
}
AnimationSet Walk {
  Animation Move {
    { Arm }
    AnimationKey { 2; 2; 0; 3; 1, 2, 3;;, 10; 3; 4, 5, 6;;; }
    AnimationKey { 0; 2; 0; 4; ${w}, 0, ${y}, 0;;, 10; 4; 1, 0, 0, 0;;; }
  }
}
`;
})();

test('an animation set moves its frames: keys in frames become seconds, the pose at the first key is the node\'s own', () =>
{
  const glb = xToGlb(new TextEncoder().encode(ANIMATED), 'arm.x');
  const json = jsonOf(glb);
  assert(json.animations && json.animations.length === 1 && json.animations[0].name === 'Walk', 'one animation, named Walk');
  const node = json.nodes.find((n) => n.name === 'Arm');
  assert(!node.matrix && node.translation && node.rotation && node.scale, 'an animated frame is given translation, rotation and scale, not a matrix');
  assert(node.scale.every((v) => Math.abs(v - 1) < 1e-6), `the scale is ${node.scale}`);

  const animation = json.animations[0];
  const channel = (path) => animation.channels.find((c) => c.target.path === path && c.target.node === json.nodes.indexOf(node));
  const move = channel('translation');
  const turn = channel('rotation');
  assert(move && turn, 'a channel for the position and one for the rotation');

  const times = floatsOf(glb, json, animation.samplers[move.sampler].input);
  assert(Math.abs(times[0]) < 1e-9 && Math.abs(times[1] - 10 / 60) < 1e-6, `key times ${times}: frames over 60`);
  const positions = floatsOf(glb, json, animation.samplers[move.sampler].output);
  assert(positions.slice(0, 3).join() === '-1,2,3' && positions.slice(3, 6).join() === '-4,5,6', `positions ${positions}: x is mirrored`);
  assert(node.translation.join() === '-1,2,3', `the node starts at ${node.translation}`);

  // The quaternion of the first key is the node's own rotation (a quaternion
  // and its opposite are one rotation).
  const first = floatsOf(glb, json, animation.samplers[turn.sampler].output).slice(0, 4);
  const same = first.every((v, i) => Math.abs(v - node.rotation[i]) < 1e-6) || first.every((v, i) => Math.abs(v + node.rotation[i]) < 1e-6);
  assert(same, `first key ${first} is not the node's rotation ${node.rotation}`);
  assert(json.animations[0].samplers.every((s) => s.interpolation === 'LINEAR'), 'linear keys');
});

test('a mesh may point to its materials by name, and a texture is looked for as the disk has it', () =>
{
  const text = `xof 0303txt 0032
Frame Body {
  Material Red {
    1;0;0;1;;
    8;
    0;0;0;;
    0;0;0;;
    TextureFileName { "FACE.BMP"; }
  }
  Material Gone {
    0;1;0;1;;
    8;
    0;0;0;;
    0;0;0;;
    TextureFileName { "nothere.bmp"; }
  }
  Mesh Tri {
    3;
    0;0;0;, 1;0;0;, 0;1;0;;
    1;
    3;0,1,2;;
    MeshMaterialList {
      2;
      1;
      1;;
      { Gone }
      { Red }
    }
  }
}
`;
  const missing = [];
  const glb = xToGlb(new TextEncoder().encode(text), 'tri.x', { resolveTexture: (f) => (f.toLowerCase() === 'face.bmp' ? 'face.bmp' : null), missing });
  const json = jsonOf(glb);
  assert(json.materials.length === 1, `${json.materials.length} materials: only the one the triangle uses`);
  assert(json.images.length === 1 && json.images[0].uri === 'face.bmp', `images ${JSON.stringify(json.images)}: the name as the disk has it`);
  const colour = json.materials[0].pbrMetallicRoughness.baseColorFactor;
  assert(colour[0] > 0.99 && colour[1] === 0, `the colour is ${colour}: the list's second material (Red) is the face's`);
  const again = [];
  xToGlb(new TextEncoder().encode(text), 'tri.x', { resolveTexture: () => null, missing: again });
  assert(again.join() === 'FACE.BMP', `missing ${again}: the one the face uses (the other material is not used)`);
});

export default unit;
