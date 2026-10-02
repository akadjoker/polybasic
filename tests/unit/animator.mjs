// The animator (src/engine/model/animator.js): crossfades, layers with bone
// masks, one-shots that go back to a loop, and the commands for them, on a
// model built here whose poses are worked out by hand.
//
// Node A moves along glTF +Y with "up" (0 to 10 in a second) and along +Z
// with "side"; node B, A's child, turns a quarter round Y with "turn".

import { readGltf } from '../../src/engine/model/gltf.js';
import { newModel } from '../../src/engine/model/model.js';
import { MeshData } from '../../src/engine/scene/mesh.js';
import { EditableMesh } from '../../src/engine/scene/editable.js';
import { ANIM_LOOP, ANIM_ONCE } from '../../src/engine/model/animation.js';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { assert, near, nearAll } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });
const STEP = 1 / 60;

function file()
{
  const floats = [];
  const views = [];
  const accessors = [];
  const add = (values, type, extra = {}) =>
  {
    views.push({ buffer: 0, byteOffset: floats.length * 4, byteLength: values.length * 4 });
    floats.push(...values);
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[type];
    accessors.push({ bufferView: views.length - 1, componentType: 5126, count: values.length / size, type, ...extra });
    return accessors.length - 1;
  };
  const times = add([0, 1], 'SCALAR', { min: [0], max: [1] });
  const up = add([0, 0, 0, 0, 10, 0], 'VEC3');
  const side = add([0, 0, 0, 0, 0, 10], 'VEC3');
  const s = Math.SQRT1_2;
  const turn = add([0, 0, 0, 1, 0, s, 0, s], 'VEC4');
  const clip = (name, node, path, output) => ({
    name,
    samplers: [{ input: times, output, interpolation: 'LINEAR' }],
    channels: [{ sampler: 0, target: { node, path } }]
  });
  const bytes = new Uint8Array(new Float32Array(floats).buffer);
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'A', children: [1] }, { name: 'B', translation: [0, 1, 0] }],
    buffers: [{ byteLength: bytes.length, uri: 'data:application/octet-stream;base64,' + Buffer.from(bytes).toString('base64') }],
    bufferViews: views,
    accessors,
    animations: [clip('up', 0, 'translation', up), clip('side', 0, 'translation', side), clip('turn', 1, 'rotation', turn)]
  };
  return new TextEncoder().encode(JSON.stringify(json));
}

async function model()
{
  const data = await readGltf(file(), 'file:///m/anim.gltf', { loadFile: null, loadImage: null, decodeImage: null, track: () => {}, warn: () => {} });
  const engine = new Engine();
  const root = engine.world.createEntity('pivot');
  root.model = newModel();
  engine.models.build(root, data);
  const [a, b] = root.model.nodes;
  const steps = (n) =>
  {
    for (let i = 0; i < n; i++) engine.models.step(STEP);
  };
  return { engine, root, a, b, steps };
}

test('a transition blends from the old animation, still playing, into the new one', async () =>
{
  const { engine, root, a, steps } = await model();
  engine.models.play(root, 1, ANIM_LOOP, 1);
  steps(30);
  near(a.position.y, 5, 1e-6, 'half way up');
  engine.models.play(root, 2, ANIM_LOOP, 1, 0.5);
  nearAll([a.position.y, a.position.z], [5, 0], 1e-6, 'the blend starts where it was');
  steps(15);
  // "up" at 0.75 s (7.5 high) and "side" at 0.25 s (2.5 along), half each.
  nearAll([a.position.y, a.position.z], [3.75, 1.25], 1e-6, 'half way through the blend');
  steps(15);
  nearAll([a.position.y, a.position.z], [0, 5], 1e-6, 'only "side" once the blend is over');
  assert(!root.model.animator.layers[0].previous, 'the old animation was not let go');
});

test('a layer with a bone mask moves only that bone, over the layer below', async () =>
{
  const { engine, root, a, b, steps } = await model();
  engine.models.play(root, 2, ANIM_LOOP, 1);
  root.model.animator.mask(1, 1, 1);
  engine.models.play(root, 3, ANIM_LOOP, 1, 0, 1);
  steps(30);
  near(a.position.z, 5, 1e-6, 'layer 0 still moves A');
  // Half of a quarter turn about Y, mirrored: (0, -sin 22.5, 0, cos 22.5).
  const h = Math.PI / 8;
  nearAll([b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w], [0, -Math.sin(h), 0, Math.cos(h)], 1e-6, 'layer 1 turns B');
  // The same layer with a mask that leaves B out moves nothing.
  root.model.animator.mask(1, 1, 0);
  steps(1);
  nearAll([b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w], [0, 0, 0, 1], 1e-6, 'masked out, B rests');
  root.model.animator.mask(1, 1, 0.5);
  steps(13);
  // At half weight B is the normalized blend of its rest and the layer's
  // turn at the layer's time (a quarter turn in a second).
  const t = engine.models.layerState(root, 1).time;
  const half = t * Math.PI / 4;
  const q = [0, -Math.sin(half), 0, Math.cos(half)];
  const mixed = [0, q[1] * 0.5, 0, 1 * 0.5 + q[3] * 0.5];
  const len = Math.hypot(...mixed);
  nearAll([b.rotation.x, b.rotation.y, b.rotation.z, b.rotation.w], mixed.map((v) => v / len), 1e-6, 'half weight');
});

test('a one-shot goes back to the loop it is given; a stopped model keeps its pose', async () =>
{
  const { engine, root, a, steps } = await model();
  engine.models.play(root, 1, ANIM_ONCE, 2, 0, 0, 2);
  steps(29);
  near(a.position.y, 290 / 30, 1e-6, 'nearly up, twice as fast');
  assert(engine.models.layerState(root).clip.name === 'up', 'still the one-shot');
  // 30 steps of 2/60 add up to a hair under 1 s: it ends on the next.
  steps(2);
  const st = engine.models.layerState(root);
  assert(st.clip.name === 'side' && st.mode === ANIM_LOOP && st.playing, `then ${JSON.stringify({ name: st.clip.name, mode: st.mode })}`);
  const from = engine.models.layerState(root).time;
  steps(15);
  near(a.position.z, (from + 0.5) * 10, 1e-6, '"side" plays at the speed the one-shot had');
  engine.models.play(root, 0, 0, 1);
  a.position.set(1, 2, 3);
  steps(10);
  nearAll([a.position.x, a.position.y, a.position.z], [1, 2, 3], 1e-9, 'nothing plays: the node is left alone');
});

test('a copy plays on its own, with the masks of the original', async () =>
{
  const { engine, root, steps } = await model();
  engine.models.play(root, 1, ANIM_LOOP, 1);
  root.model.animator.mask(1, 1, 1);
  const copy = engine.world.copyEntity(root, null);
  engine.models.copy(root, copy);
  engine.models.play(root, 1, ANIM_LOOP, 1);
  engine.models.play(copy, 2, ANIM_LOOP, 1);
  steps(30);
  const [a] = root.model.nodes;
  const [c] = copy.model.nodes;
  nearAll([a.position.y, a.position.z, c.position.y, c.position.z], [5, 0, 0, 5], 1e-6, 'each its own animation');
  assert(copy.model.animator.layers[1].mask[1] === 1 && copy.model.animator.layers[1].mask !== root.model.animator.layers[1].mask, 'the mask is copied, not shared');
});

test('the commands: transitions in steps, layers, masks by bone name, one-shots', async () =>
{
  const source = `
Global m, a, b
m = LoadMesh(Later$("anim.gltf"))
Function Update()
  f = FrameCount()
  If f = 1
    a = FindChild(m, "A")
    b = FindChild(m, "B")
    Animate m, FindAnimation(m, "up")
  EndIf
  If f = 31
    Animate m, FindAnimation(m, "side"), ANIM_LOOP, 1, 30
    Print "blending from y " + EntityY(a)
  EndIf
  If f = 46 Then Print "half way: y " + EntityY(a) + " z " + EntityZ(a)
  If f = 61
    Print "after: y " + EntityY(a) + " z " + EntityZ(a) + " playing " + Animating(m) + " at " + AnimTime(m)
    AnimLayerMask m, 1, "b"
    AnimateOnce m, FindAnimation(m, "turn"), 0, 1, 0, 1
  EndIf
  If f = 91 Then Print "layer 1 playing " + Animating(m, 1) + ", yaw " + EntityYaw(b)
  If f = 123
    Print "layer 1 done " + (1 - Animating(m, 1)) + " at " + AnimTime(m, 1) + ", layer 0 playing " + Animating(m)
    AnimLayerMask m, 1, "nose"
  EndIf
End Function
Function Later$(name$)
  Return name
End Function
`;
  const module = await loadProgram(compile(source, { file: 'test.pb' }).js);
  const engine = new Engine({ baseUrl: 'mem:/x.pb', loadFile: async () => file() });
  const host = new CaptureHost();
  const r = await runProgram(module, host, { engine, maxUpdates: 200 });
  const out = host.output;
  assert(out.includes('blending from y 5.0'), out);
  assert(out.includes('half way: y 3.75 z 1.25'), out);
  assert(out.includes('after: y 0.0 z 5.0 playing 1 at 0.5'), out);
  // Half of the quarter turn after 30 steps.
  assert(out.includes('layer 1 playing 1, yaw 45.0'), out);
  assert(out.includes('layer 1 done 1 at 1.0, layer 0 playing 1'), out);
  assert(r.status === 'error' && /AnimLayerMask: model \d+ has no bone or part named "nose"/.test(r.error.message), `${r.status} ${r.error && r.error.message}`);
});

test('LoadAnimSeq: an animation from another file, matched by bone name, numbered at once', async () =>
{
  const source = `
Global fox, run, walk, later
fox = LoadMesh("fox.glb")
run = LoadAnimSeq(fox, "fox-run.glb")
walk = LoadAnimSeq(fox, "fox.glb", "walk")
later = LoadAnimSeq(fox, Later$("fox-run.glb"))
Print "numbers " + run + " " + walk + " " + later + " of " + CountAnimations(fox) + ": " + AnimationName(fox, run) + ", " + AnimationName(fox, walk)
Print "none: " + LoadAnimSeq(fox, "fox.glb", "dance")
Function Update()
  If FrameCount() = 1
    Print "later: " + AnimationName(fox, later) + " " + AnimLength(fox, later)
    End
  EndIf
End Function
Function Later$(name$)
  Return name
End Function
`;
  const result = compile(source, { file: 'test.pb' });
  assert(result.js.includes('["loadanimseq","fox-run.glb"]'), 'the quoted file is not read before main');
  const module = await loadProgram(result.js);
  const dir = new URL('../../examples/assets/fox/', import.meta.url);
  const engine = new Engine({ baseUrl: new URL('x.pb', dir).href, loadFile: (u) => readFile(fileURLToPath(u)) });
  const host = new CaptureHost();
  const r = await runProgram(module, host, { engine });
  const out = host.output;
  assert(r.status === 'ended', `${r.status} ${r.error ? r.error.message : ''}\n${out}`);
  assert(out.includes('numbers 4 5 6 of 6: Run, Walk'), out);
  assert(/LoadAnimSeq: "fox.glb" has no animation named "dance"/.test(out) && out.includes('none: 7'), out);
  assert(out.includes('later: Run 1.15833'), out);

  // The Run read from fox-run.glb poses the fox as fox.glb's own Run.
  const fox = engine.world.entities.find((e) => e.model);
  const own = fox.model.clips.findIndex((c) => c.name === 'Run') + 1;
  const pose = (clip) =>
  {
    engine.models.play(fox, clip, ANIM_LOOP, 1);
    engine.models.setTime(fox, 0.4);
    return fox.model.nodes.map((n) => (n ? [n.position.x, n.position.y, n.position.z, n.rotation.x, n.rotation.y, n.rotation.z, n.rotation.w] : [])).flat();
  };
  nearAll(pose(4), pose(own), 1e-9, 'the same pose');
});

test('LoadAnimSeq says when a file\'s nodes are not the model\'s', async () =>
{
  const source = 'fox = LoadMesh("fox.glb")\nPrint LoadAnimSeq(fox, "anim.gltf")\n';
  const module = await loadProgram(compile(source, { file: 'test.pb' }).js);
  const dir = new URL('../../examples/assets/fox/', import.meta.url);
  const engine = new Engine({ baseUrl: new URL('x.pb', dir).href, loadFile: async (u) => (u.endsWith('anim.gltf') ? file() : readFile(fileURLToPath(u))) });
  const host = new CaptureHost();
  await runProgram(module, host, { engine });
  assert(/LoadAnimSeq: no node of "anim.gltf" that "up" moves has a name the model has/.test(host.output), host.output);
});

test('a model part made editable keeps its submeshes, their materials and its skin data', () =>
{
  const data = new MeshData(
    [0, 0, 0, 1, 0, 0, 0, 1, 0, 5, 0, 0, 6, 0, 0, 5, 1, 0],
    new Array(18).fill(0),
    new Array(12).fill(0),
    [0, 2, 1, 3, 5, 4]
  );
  data.submeshes = [{ start: 0, count: 3, material: 1 }, { start: 3, count: 3, material: 0 }];
  data.joints = Uint16Array.from([0, 0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0, 5, 1, 0, 0]);
  data.weights = Float32Array.from([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0]);
  const m = EditableMesh.from(data);
  assert(m.surfaces.length === 2, `${m.surfaces.length} surfaces`);
  assert(JSON.stringify(m.submeshes) === JSON.stringify([{ start: 0, count: 3, material: 1 }, { start: 3, count: 3, material: 0 }]), JSON.stringify(m.submeshes));
  // Vertices are numbered in the order the triangles use them: compare
  // corner by corner.
  const corner = (mesh, k, size, arr) => Array.from(arr.subarray(mesh.indices[k] * size, mesh.indices[k] * size + size));
  for (let k = 0; k < 6; k++)
  {
    nearAll(corner(m, k, 3, m.positions), corner(data, k, 3, data.positions), 0, `corner ${k} position`);
    nearAll(corner(m, k, 4, m.joints), corner(data, k, 4, data.joints), 0, `corner ${k} joints`);
    nearAll(corner(m, k, 4, m.weights), corner(data, k, 4, data.weights), 0, `corner ${k} weights`);
  }
  m.surfaces[1].addVertex(9, 9, 9, 0, 0);
  assert(m.weights[6 * 4] === 1 && m.joints.length === 7 * 4, 'a new vertex of a skinned part follows joint 0');
});

export default unit;
