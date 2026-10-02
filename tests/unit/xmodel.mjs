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

export default unit;
