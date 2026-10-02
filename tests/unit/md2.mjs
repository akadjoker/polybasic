// MD2 models: files built here byte by byte, read as Blitz3D reads them
// (md2rep.cpp), and played with its rules (md2model.cpp).

import { readMd2, md2Mesh, Md2Player } from '../../src/engine/model/md2.js';
import { MD2_NORMALS } from '../../src/engine/model/md2-normals.js';
import { ANIM_STOP, ANIM_LOOP, ANIM_PINGPONG, ANIM_ONCE } from '../../src/engine/model/animation.js';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { assert, near, nearAll } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

// An MD2 file. frames: [{ scale, move, verts: [[x, y, z, normal], ...] }]
// in the file's axes; tris: [[v0, v1, v2, uv0, uv1, uv2]].
function md2File({ skin = [64, 32], uvs, tris, frames, version = 8 })
{
  const nv = frames[0].verts.length;
  const frameSize = 40 + nv * 4;
  const uvAt = 68;
  const triAt = uvAt + uvs.length * 4;
  const frameAt = triAt + tris.length * 12;
  const end = frameAt + frames.length * frameSize;
  const bytes = new Uint8Array(end);
  const v = new DataView(bytes.buffer);
  const header = [0x32504449, version, skin[0], skin[1], frameSize, 0, nv, uvs.length, tris.length, 0, frames.length, 68, uvAt, triAt, frameAt, end, end];
  header.forEach((x, i) => v.setInt32(i * 4, x, true));
  uvs.forEach(([s, t], i) =>
  {
    v.setInt16(uvAt + i * 4, s, true);
    v.setInt16(uvAt + i * 4 + 2, t, true);
  });
  tris.forEach((t, i) => t.forEach((x, j) => v.setUint16(triAt + i * 12 + j * 2, x, true)));
  frames.forEach((f, i) =>
  {
    const at = frameAt + i * frameSize;
    [...f.scale, ...f.move].forEach((x, j) => v.setFloat32(at + j * 4, x, true));
    f.verts.forEach((p, j) => bytes.set(p, at + 40 + j * 4));
  });
  return bytes;
}

// Four file vertices, two triangles; vertex 2 is used with two texture
// coordinates, so it becomes two vertices. Frame k moves every vertex up
// by k * 10 (in the file's z, which is Blitz3D's y).
function square(frameCount = 3)
{
  const frames = [];
  for (let k = 0; k < frameCount; k++)
  {
    frames.push({
      scale: [0.5, 0.25, 1],
      move: [1, 2, k * 10],
      verts: [[0, 0, 0, 5], [4, 0, 0, 5], [4, 8, 0, 5], [0, 8, k, 6]]
    });
  }
  return md2File({ uvs: [[0, 0], [64, 0], [64, 32], [0, 32], [32, 16]], tris: [[0, 1, 2, 0, 1, 2], [0, 2, 3, 0, 4, 3]], frames });
}

test('the file: vertices per (vertex, texture coordinate), axes turned, triangles turned round', () =>
{
  const md2 = readMd2(square());
  assert(md2.vertexCount === 5, `${md2.vertexCount} vertices`);
  assert(md2.frames.length === 3, `${md2.frames.length} frames`);
  // Triangle (0, 1, 2) becomes (0, 2, 1); the second uses vertex 2 with
  // texture coordinate 4, a new vertex (3), and vertex 3 (4).
  assert([...md2.indices].join() === '0,2,1,0,4,3', [...md2.indices].join());
  nearAll(md2.uvs, [0, 0, 1, 0, 1, 1, 0.5, 0.5, 0, 1], 1e-6, 'uvs over the skin size');
  const mesh = md2Mesh(md2);
  // File (x, y, z) = (4, 8, 0) scaled (0.5, 0.25, 1) and moved (1, 2, 0)
  // is (3, 4, 0); Blitz3D's axes: (y, z, x) = (4, 0, 3).
  nearAll(mesh.positions.slice(6, 9), [4, 0, 3], 1e-6, 'vertex 2 in frame 0');
  const n = 5 * 3;
  nearAll(mesh.normals.slice(0, 3), [MD2_NORMALS[n + 1], MD2_NORMALS[n + 2], MD2_NORMALS[n]], 1e-6, 'normal 5 with its axes turned');
  // Frame 2 lifts vertex 3 a further 2: the top is 20 + 2.
  nearAll([md2.box.min.y, md2.box.max.y], [0, 22], 1e-6, 'the box covers every frame');
});

test('files that cannot be read say why', () =>
{
  const bad = (bytes, text) =>
  {
    let message = '';
    try
    {
      readMd2(bytes);
    }
    catch (err)
    {
      message = err.message;
    }
    assert(message.includes(text), `expected "${text}", got "${message}"`);
  };
  bad(new Uint8Array(10), 'too short');
  bad(new Uint8Array(68), 'not an MD2 file');
  bad(md2File({ uvs: [[0, 0]], tris: [[0, 0, 0, 0, 0, 0]], frames: [{ scale: [1, 1, 1], move: [0, 0, 0], verts: [[0, 0, 0, 0]] }], version: 7 }), 'version 7');
  bad(square().slice(0, 150), 'cut short');
  bad(md2File({ uvs: [[0, 0]], tris: [[0, 1, 0, 0, 0, 0]], frames: [{ scale: [1, 1, 1], move: [0, 0, 0], verts: [[0, 0, 0, 0]] }] }), 'uses vertex 1 of 1');
  const none = square();
  new DataView(none.buffer).setInt32(40, 0, true);
  bad(none, 'no frames');
});

// Where vertex 0 is up (its y), frame k being k * 10.
const height = (player) => player.mesh.positions[1];

test('playing: loops wrap as Blitz3D wraps them, ping-pong turns, once stops', () =>
{
  const md2 = readMd2(square(5));
  const loop = new Md2Player(md2, md2Mesh(md2));
  loop.start(0, 4, ANIM_LOOP, 1.5, 0);
  const times = [];
  for (let i = 0; i < 4; i++)
  {
    loop.step();
    times.push(loop.time);
  }
  // 0 -> 1.5 -> 3 -> 4.5 (past the last: minus the length, 4) -> 2.
  nearAll(times, [1.5, 3, 0.5, 2], 1e-6, 'loop times');
  near(height(loop), 20, 1e-5, 'frame 2 shown');
  loop.start(0, 4, ANIM_LOOP, 0.5, 0);
  for (let i = 0; i < 7; i++) loop.step();
  // At 3.5 the next frame would be 4, the last, which in a loop is the
  // first: halfway between frames 3 and 0.
  near(loop.time, 3.5, 1e-6, 'loop time');
  near(height(loop), 15, 1e-5, 'between frame 3 and frame 0');

  const pp = new Md2Player(md2, md2Mesh(md2));
  pp.start(1, 3, ANIM_PINGPONG, 1, 0);
  const pts = [];
  for (let i = 0; i < 6; i++)
  {
    pp.step();
    pts.push(pp.time);
  }
  nearAll(pts, [2, 3, 2, 1, 2, 3], 1e-6, 'ping-pong times');

  const once = new Md2Player(md2, md2Mesh(md2));
  once.start(3, 1, ANIM_ONCE, -1, 0);
  near(once.time, 3, 1e-6, 'backwards starts at the last frame');
  once.step();
  once.step();
  assert(once.animating, 'stopped early');
  once.step();
  assert(!once.animating && once.time === 1, `once ended at ${once.time}, animating ${once.animating}`);
  near(height(once), 10, 1e-5, 'frame 1 shown');

  const still = new Md2Player(md2, md2Mesh(md2));
  still.start(4, 4, ANIM_LOOP, 1, 0);
  assert(!still.animating, 'one frame is not an animation');
  near(height(still), 40, 1e-5, 'shows frame 4');
  const before = still.mesh.pose;
  still.step();
  assert(still.mesh.pose === before, 'a model that is not playing is not posed again');
  near(still.frameCount, 5, 0, 'frame count');
  assert(ANIM_STOP === 0 && ANIM_LOOP === 1 && ANIM_PINGPONG === 2 && ANIM_ONCE === 3, 'Blitz3D mode values');
});

test('a transition blends from where the model was to the new first frame', () =>
{
  const md2 = readMd2(square(5));
  const p = new Md2Player(md2, md2Mesh(md2));
  p.start(4, 4, ANIM_LOOP, 0, 0);
  near(height(p), 40, 1e-5, 'at frame 4');
  p.start(1, 3, ANIM_LOOP, 1, 4);
  near(height(p), 40, 1e-5, 'the transition starts where it was');
  p.step();
  near(height(p), 32.5, 1e-5, 'a quarter of the way to frame 1');
  p.step();
  p.step();
  near(height(p), 17.5, 1e-5, 'three quarters');
  near(p.time, 1, 1e-6, 'the animation waits for the transition');
  p.step();
  // The transition is over and the animation moves on in the same step.
  near(p.time, 2, 1e-6, 'then plays');
  near(height(p), 20, 1e-5, 'frame 2');
});

async function run(source, files)
{
  const module = await loadProgram(compile(source, { file: 'test.pb' }).js);
  const engine = new Engine({
    baseUrl: 'mem:/x.pb',
    loadFile: async (url) =>
    {
      const name = url.slice(url.lastIndexOf('/') + 1);
      if (!files[name]) throw new Error('no such file');
      return files[name];
    }
  });
  const host = new CaptureHost();
  const r = await runProgram(module, host, { engine, maxUpdates: 50 });
  return { r, out: host.output, engine };
}

test('in a program: quoted names load at once, others before the first Update; copies start afresh', async () =>
{
  const { r, out } = await run(`
Global a, b, c
a = LoadMD2("square.md2")
Print "at once: " + MD2AnimLength(a)
b = LoadMD2(Later$("other.md2"))
Print "later: " + MD2AnimLength(b)
AnimateMD2 b, ANIM_ONCE, 1, 0, 2
AnimateMD2 a, ANIM_LOOP, 0.5
c = CopyEntity(a)
Print "missing: " + LoadMD2("gone.md2")
Function Update()
  If FrameCount() = 1 Then Print "b " + MD2AnimTime(b) + " " + MD2Animating(b) + ", a " + MD2AnimTime(a) + ", copy " + MD2AnimTime(c) + " " + MD2Animating(c)
  If FrameCount() = 2
    EntityPickMode b, PICK_POLYGON
    AnimateMD2 b, ANIM_LOOP, 0, 3, 3
    If LinePick(3, 100, 2, 0, -200, 0) = b Then Print "picked at " + PickedY()
  EndIf
  If FrameCount() = 3
    AnimateMD2 b, ANIM_LOOP, 0, 1, 1
    ; A slanted line that meets the square at a height of 10 but passes
    ; beside where it was at 30: only a tree built for the new pose finds it.
    If LinePick(3, 110, -48, 0, -200, 100) = b Then Print "then at " + PickedY()
  EndIf
  If FrameCount() = 4
    Print "b " + MD2AnimTime(b) + " " + MD2Animating(b) + ", a " + MD2AnimTime(a)
    t = CreateCube()
    AnimateMD2 t
  EndIf
End Function
Function Later$(name$)
  Return name
End Function
`, { 'square.md2': square(5), 'other.md2': square(5) });
  const lines = out.split('\n');
  assert(lines[0] === 'at once: 5', lines[0]);
  assert(lines[1] === 'later: 0', lines[1]);
  assert(/LoadMD2: could not load "gone.md2"/.test(out), out);
  assert(out.includes('missing: 0'), out);
  assert(out.includes('b 0.0 1, a 0.0, copy 0.0 0'), out);
  // Frame 3 of the square lies at a height of 30: picks see the pose.
  assert(out.includes('picked at 30.0'), out);
  assert(out.includes('then at 10.0'), out);
  assert(out.includes('b 1.0 0, a 1.5'), out);
  assert(r.status === 'error' && /Entity \d+ is not an MD2 model/.test(r.error.message), `${r.status} ${r.error && r.error.message}`);
});

export default unit;
