// The engine inside the frame loop: input sampled per Update, the 2D
// overlay, what reaches the render backend, and LoadTexture.

import { compile, loadProgram, runProgram, CaptureHost, Engine, NullBackend, NullOverlay, Input, KEYS } from '../../src/index.js';
import { assert, near, nearAll } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

async function load(source)
{
  return loadProgram(compile(source, { file: 'test.pb' }).js);
}

// A capture host that calls `before(frame)` just before each frame runs:
// the place where a real browser would deliver input events.
function scriptedHost(before)
{
  const host = new CaptureHost();
  const request = host.requestFrame.bind(host);
  let frame = 0;
  host.requestFrame = (cb) => request((t) =>
  {
    before(++frame);
    cb(t);
  });
  return host;
}

test('KeyHit is true in exactly one Update per press, KeyDown while held, KeyUp once', async () =>
{
  const module = await load(`
Global hits, downs, ups
Function Update()
  hits = hits + KeyHit(KEY_SPACE)
  downs = downs + KeyDown(KEY_SPACE)
  ups = ups + KeyUp(KEY_SPACE)
  If FrameCount() = 10 Then Print hits + " " + downs + " " + ups : End
End Function
`);
  const input = new Input();
  const engine = new Engine({ input });
  const host = scriptedHost((frame) =>
  {
    if (frame === 2) input.keyDown(KEYS.KEY_SPACE);
    if (frame === 3) input.keyDown(KEYS.KEY_SPACE);      // auto-repeat: not a new press
    if (frame === 5) input.keyUp(KEYS.KEY_SPACE);
    if (frame === 7)
    {
      // A tap shorter than one frame still counts.
      input.keyDown(KEYS.KEY_SPACE);
      input.keyUp(KEYS.KEY_SPACE);
    }
  });
  await runProgram(module, host, { engine });
  assert(host.output === '2 4 2\n', `hits downs ups: ${JSON.stringify(host.output)}`);
});

test('a press is seen by one Update even when a frame runs several', async () =>
{
  const module = await load('Function Update()\n  If KeyHit(KEY_LEFT) Then Print "hit " + FrameCount()\nEnd Function\n');
  const input = new Input();
  const engine = new Engine({ input });
  const host = new CaptureHost();
  let t = 0;
  let frame = 0;
  // A 20 Hz display: the first frame runs one Update, the next ones three.
  host.requestFrame = (cb) => setImmediate(() =>
  {
    if (++frame === 2) input.keyDown(KEYS.KEY_LEFT);
    cb(t += 50);
  });
  const r = await runProgram(module, host, { engine, maxUpdates: 12 });
  assert(r.updates === 12, `updates ${r.updates}`);
  assert(host.output === 'hit 2\n', `one hit, in the first Update of frame 2: ${JSON.stringify(host.output)}`);
});

test('mouse position, speed, buttons and wheel per Update', async () =>
{
  const module = await load(`
Function Update()
  If FrameCount() >= 2 And FrameCount() <= 4
    Print MouseX() + "," + MouseY() + " speed " + MouseXSpeed() + "," + MouseYSpeed() + " down " + MouseDown() + " hit " + MouseHit(MOUSE_LEFT) + " wheel " + MouseWheel()
  EndIf
  If FrameCount() = 4 Then End
End Function
`);
  const input = new Input();
  const engine = new Engine({ input });
  const host = scriptedHost((frame) =>
  {
    if (frame === 2)
    {
      input.pointerMove(100, 50);
      input.pointerMove(110, 60);
      input.buttonDown(1);
      input.wheelTurn(-1);
    }
    if (frame === 3) input.pointerMove(120, 60);
    if (frame === 4) input.buttonUp(1);
  });
  await runProgram(module, host, { engine });
  const expected = '110,60 speed 110,60 down 1 hit 1 wheel -1\n120,60 speed 10,0 down 1 hit 0 wheel 0\n120,60 speed 0,0 down 0 hit 0 wheel 0\n[ended]\n';
  assert(host.output + '[ended]\n' === expected, JSON.stringify(host.output));
});

test('Draw writes to the 2D overlay, which is cleared every frame', async () =>
{
  const module = await load(`
Function Update()
End Function
Function Draw()
  Color 255, 0, 0
  Text 10, 20, "frame " + FrameCount()
  Rect 1, 2, 3, 4, False
  Line 0, 0, 5, 5
  If FrameCount() = 2 Then Print TextWidth("hello")
End Function
`);
  const overlay = new NullOverlay();
  const engine = new Engine({ overlay });
  const host = new CaptureHost();
  await runProgram(module, host, { engine, maxUpdates: 3 });
  assert(overlay.frames === 3, `overlay frames ${overlay.frames}`);
  assert(JSON.stringify(overlay.ops) === JSON.stringify([
    ['text', 10, 20, 'frame 3', [255, 0, 0], 16],
    ['rect', 1, 2, 3, 4, false, [255, 0, 0]],
    ['line', 0, 0, 5, 5, [255, 0, 0]]
  ]), JSON.stringify(overlay.ops));
  assert(host.output === '48\n', host.output);
});

test('the backend gets one render per frame, with cameras, lights and meshes', async () =>
{
  const module = await load(`
Global cube
cam = CreateCamera()
CameraFOV cam, 70
light = CreateLight(LIGHT_POINT)
cube = CreateCube()
hidden = CreateSphere()
HideEntity hidden
For i = 1 To 50 : CreateCube() : Next
Function Update()
  TurnEntity cube, 0, 2, 0
End Function
`);
  const backend = new NullBackend();
  backend.init(null);
  const engine = new Engine({ backend });
  await runProgram(module, new CaptureHost(), { engine, maxUpdates: 30 });
  assert(backend.frames === 30, `frames ${backend.frames}`);
  const f = backend.lastFrame;
  assert(f.cameras.length === 1 && f.cameras[0].fov === 70, 'camera');
  assert(f.lights.length === 1 && f.lights[0].type === 2, 'light');
  assert(f.items.length === 51, `items ${f.items.length}`);
  assert(backend.meshes.size === 1, `51 cubes share one mesh (${backend.meshes.size})`);
  // After 30 updates of 2 degrees the cube has turned 60 degrees left.
  const w = f.items[0].world;
  near(w[8], -Math.sin(Math.PI / 3), 1e-9, 'forward x');
  near(w[10], Math.cos(Math.PI / 3), 1e-9, 'forward z');
});

test('shadows reach the backend: lights that cast them, entities that cast and receive', async () =>
{
  const module = await load(`
Global sun, lamp, box, ground, copy
cam = CreateCamera()
sun = CreateLight()
LightShadows sun, True, 25
lamp = CreateLight(LIGHT_POINT)
LightShadows lamp
box = CreateCube()
ground = CreatePlane()
EntityFX ground, FX_NOSHADOWCAST
EntityFX box, FX_FULLBRIGHT Or FX_NOSHADOWRECV
copy = CopyEntity(box)
Function Update()
  If FrameCount() = 2 Then LightShadows lamp, False
End Function
`);
  const backend = new NullBackend();
  backend.init(null);
  const engine = new Engine({ backend });
  await runProgram(module, new CaptureHost(), { engine, maxUpdates: 3 });
  const f = backend.lastFrame;
  const [sun, lamp] = f.lights;
  assert(sun.shadows === 25 && lamp.shadows === 0, `lights: ${JSON.stringify(f.lights.map((l) => l.shadows))}`);
  const [box, ground, copy] = f.items;
  assert(box.castShadow && !box.receiveShadow, `box: ${JSON.stringify(box)}`);
  assert(!ground.castShadow && ground.receiveShadow, 'ground');
  assert(copy.castShadow && !copy.receiveShadow, 'a copy keeps the shadow flags');
  const result = await runProgram(await load('l = CreateLight()\nLightShadows l, True, 0\n'), new CaptureHost(), { engine: new Engine() });
  assert(result.status === 'error' && /area above 0/.test(result.error.message), JSON.stringify(result));
});

test('grass: painted onto what is under it, never onto steep ground, up to 8 pushers', async () =>
{
  const module = await load(`
Global meadow, count, slope
; A platform 2 high, 10 wide; beside it a ramp at 70 degrees (too steep)
; and one at 45 (not).
deck = CreateCube()
ScaleEntity deck, 5, 1, 5
PositionEntity deck, 0, 1, 0
; Ramps are planes: a box's narrow top edge would be flat ground of its own.
ramp = CreatePlane()
ScaleEntity ramp, 5, 1, 5
RotateEntity ramp, 0, 0, 70
PositionEntity ramp, 20, 0, 0
gentle = CreatePlane()
ScaleEntity gentle, 5, 1, 5
RotateEntity gentle, 0, 0, 45
PositionEntity gentle, -20, 0, 0
meadow = CreateGrass()
count = PaintGrass(meadow, 0, 0, 3, 500, deck)
slope = CreateGrass()
Print PaintGrass(slope, 20, 0, 2, 200, ramp)
Print CountGrass(meadow)
Print PaintGrass(slope, -20, 0, 2, 200, gentle)
`);
  const engine = new Engine();
  const host = new CaptureHost();
  const result = await runProgram(module, host, { engine });
  assert(result.status !== 'error', result.error && result.error.message);
  const [onRamp, planted, onGentle] = host.output.trim().split('\n').map(Number);
  assert(planted === 500 && onRamp === 0 && onGentle === 200, `planted ${planted}, on the steep ramp ${onRamp}, on the gentle one ${onGentle}`);
  const field = engine.world.entities.find((e) => e.grass && e.grass.count);
  const t = field.grass.tufts;
  for (let i = 0; i < field.grass.count; i++)
  {
    near(t[i * 5 + 1], 2, 1e-5, `tuft ${i} height`);
    assert(Math.hypot(t[i * 5], t[i * 5 + 2]) <= 3 + 1e-6, `tuft ${i} outside the disc`);
  }
  const many = await runProgram(await load(`g = CreateGrass()
For i = 1 To 9
  GrassPush g, CreatePivot(), 1
Next
`), new CaptureHost(), { engine: new Engine() });
  assert(many.status === 'error' && /at most 8/.test(many.error.message), JSON.stringify(many));
});

test('a program with a scene but no Update still renders one frame', async () =>
{
  const module = await load('CreateCamera()\nCreateCube()\n');
  const backend = new NullBackend();
  backend.init(null);
  const r = await runProgram(module, new CaptureHost(), { engine: new Engine({ backend }) });
  assert(r.status === 'finished' && backend.frames === 1, `status ${r.status}, frames ${backend.frames}`);
});

test('LoadTexture returns at once and resolves the path against the program', async () =>
{
  let asked = null;
  let finish;
  const engine = new Engine({
    baseUrl: 'https://example.com/games/spin.pb',
    loadImage: (url) =>
    {
      asked = url;
      return new Promise((resolve) => { finish = () => resolve({ width: 16, height: 8 }); });
    }
  });
  const t = engine.loadTexture('assets/tile.png');
  assert(asked === 'https://example.com/games/assets/tile.png', asked);
  assert(!t.loaded && t.version === 0, 'not loaded yet');
  finish();
  await new Promise((r) => setTimeout(r, 0));
  assert(t.loaded && t.width === 16 && t.version === 1, 'loaded later');
});

test('Graphics3D sets the screen size used by the frame and GraphicsWidth', async () =>
{
  const module = await load('Graphics3D 320, 200\nPrint GraphicsWidth() + "x" + GraphicsHeight()\n');
  const backend = new NullBackend();
  backend.init(null);
  const host = new CaptureHost();
  await runProgram(module, host, { engine: new Engine({ backend }) });
  assert(host.output === '320x200\n', host.output);
  nearAll(backend.calls.filter((c) => c[0] === 'resize').pop().slice(1, 3), [320, 200]);
});

export default unit;
