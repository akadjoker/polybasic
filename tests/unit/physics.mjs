// Physics: loading the backend only for programs that need it, the shapes
// bodies get, directions of pushes and turns, and repeatability.

import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { loadRapier } from '../../src/node.js';
import { assert, near, nearAll } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

async function load(source)
{
  return loadProgram(compile(source, { file: 'test.pb' }).js);
}

// Runs a program on an engine with Rapier; `spy` sees every body created.
async function run(source, { maxUpdates = 0, spy = null } = {})
{
  let loads = 0;
  const engine = new Engine({
    loadPhysics: async () =>
    {
      loads++;
      const backend = await loadRapier();
      if (spy)
      {
        const create = backend.createBody.bind(backend);
        backend.createBody = (desc) =>
        {
          spy.push(desc);
          return create(desc);
        };
      }
      return backend;
    }
  });
  const host = new CaptureHost();
  const result = await runProgram(await load(source), host, { engine, maxUpdates });
  return { engine, host, result, loads: () => loads };
}

test('physics is loaded only by programs that use it, once, before main', async () =>
{
  const without = await run('c = CreateCube()\nPrint "no physics"\n');
  assert(without.loads() === 0, 'loaded for a program without physics');
  const withIt = await run('c = CreateCube()\nEntityBody c\nPrint "body " + EntityHasBody(c)\n');
  assert(withIt.loads() === 1, `loaded ${withIt.loads()} times`);
  assert(withIt.host.output === 'body 1\n', JSON.stringify(withIt.host.output));
});

test('without a physics engine the commands say so', async () =>
{
  const host = new CaptureHost();
  const r = await runProgram(await load('c = CreateCube()\nEntityBody c\n'), host, { engine: new Engine() });
  assert(r.status === 'error', r.status);
  assert(/Physics is not available here/.test(r.error.message), r.error.message);
});

test('the physics world is released when the run ends', async () =>
{
  const { engine, result } = await run('c = CreateCube()\nEntityBody c\nFunction Update()\n  If FrameCount() = 3 Then End\nEnd Function\n');
  assert(result.status === 'ended', result.status);
  assert(engine.physics.backend === null, 'backend still there');
});

test('shapes: what SHAPE_AUTO picks, and the sizes from mesh, scale and box', async () =>
{
  const bodies = [];
  await run(`
s = CreateSphere()
ScaleEntity s, 2, 2, 2
EntityBody s
c = CreateCube()
ScaleEntity c, 2, 1, 3
EntityBody c
y = CreateCylinder()
EntityBody y
p = CreatePivot()
EntityRadius p, 0.7
EntityBody p
f = CreateCube()
EntityBody f, BODY_STATIC
k = CreateCube()
ScaleEntity k, 1, 2, 1
EntityBody k, BODY_DYNAMIC, SHAPE_CAPSULE
b = CreatePivot()
EntityBox b, -1, 0, -1, 2, 4, 2
EntityBody b
; A model made of parts: a pivot with two cubes side by side.
m = CreatePivot()
PositionEntity m, 10, 0, 0
a1 = CreateCube(m)
PositionEntity a1, -1, 0, 0
a2 = CreateCube(m)
PositionEntity a2, 1, 0, 0
EntityBody m
h = CreateCone()
EntityBody h, BODY_DYNAMIC, SHAPE_HULL
`, { spy: bodies });
  const [sphere, cube, cylinder, pivot, fixed, capsule, box, model, hull] = bodies;
  assert(sphere.shape.kind === 'sphere', sphere.shape.kind);
  near(sphere.shape.radius, 2, 1e-6, 'sphere radius');
  assert(cube.shape.kind === 'box', cube.shape.kind);
  nearAll(cube.shape.half, [2, 1, 3], 1e-6, 'box half size');
  assert(cylinder.shape.kind === 'cylinder' && Math.abs(cylinder.shape.radius - 1) < 1e-6, JSON.stringify(cylinder.shape));
  assert(pivot.shape.kind === 'sphere', pivot.shape.kind);
  near(pivot.shape.radius, 0.7, 1e-6, 'pivot radius');
  assert(fixed.type === 'static' && fixed.shape.kind === 'mesh', `${fixed.type} ${fixed.shape.kind}`);
  assert(fixed.shape.indices.length === 36, `mesh triangles ${fixed.shape.indices.length / 3}`);
  assert(capsule.shape.kind === 'capsule', capsule.shape.kind);
  near(capsule.shape.radius, 1, 1e-6, 'capsule radius');
  near(capsule.shape.halfHeight, 1, 1e-6, 'capsule half height');
  assert(box.shape.kind === 'box', box.shape.kind);
  nearAll(box.shape.half, [1, 2, 1], 1e-6, 'EntityBox half size');
  nearAll(box.offset, [0, 2, 0], 1e-6, 'EntityBox centre');
  assert(model.shape.kind === 'box', model.shape.kind);
  nearAll(model.shape.half, [2, 1, 1], 1e-6, 'model half size');
  nearAll(model.position, [10, 0, 0], 1e-6, 'model body position');
  nearAll(model.offset, [0, 0, 0], 1e-6, 'model offset');
  assert(hull.shape.kind === 'hull' && hull.shape.points.length > 30, hull.shape.kind);
});

test('pushes and turns go the way PolyBasic angles do', async () =>
{
  const { host } = await run(`
PhysicsGravity 0, 0, 0
Global a, b
a = CreateCube()
EntityBody a
BodyDamping a, 0, 0
b = CreateCube()
PositionEntity b, 10, 0, 0
EntityBody b
BodyDamping b, 0, 0
Function Update()
  If FrameCount() = 1
    ; Big enough that the cube keeps turning (a very slow body falls
    ; asleep and stops).
    ApplyTorque a, 0, 3000, 0
    ApplyImpulse b, 0, 0, 3
  EndIf
  If FrameCount() = 31
    Print (EntityYaw(a) > 0) + " " + (BodyYawSpeed(a) > 0) + " " + (EntityZ(b) > 0) + " " + BodyVZ(b)
    End
  EndIf
End Function
`);
  assert(host.output === '1 1 1 3.0\n', JSON.stringify(host.output));
});

test('the same program gives the same motion every time', async () =>
{
  const source = `
floor = CreatePlane()
ScaleEntity floor, 10, 1, 10
EntityBody floor, BODY_STATIC
For i = 1 To 12
  c = CreateCube()
  ScaleEntity c, 0.4, 0.4, 0.4
  PositionEntity c, (i Mod 3) * 0.5, 2 + i, (i Mod 2) * 0.3
  TurnEntity c, i * 10, i * 7, 0
  EntityBody c
Next
Function Update()
End Function
`;
  const a = await run(source, { maxUpdates: 180 });
  const b = await run(source, { maxUpdates: 180 });
  const ma = a.engine.world.entities.map((e) => Array.from(e.worldMatrix.e));
  const mb = b.engine.world.entities.map((e) => Array.from(e.worldMatrix.e));
  assert(JSON.stringify(ma) === JSON.stringify(mb), 'two runs differ');
  // And something did happen: the cubes fell and piled up.
  const heights = a.engine.world.entities.filter((e) => e.kind === 'mesh').map((e) => e.worldPosition().y);
  assert(Math.max(...heights) < 8, `cubes did not fall: ${heights}`);
});

test('a body with a parent moves its entity in the world', async () =>
{
  const { engine } = await run(`
Global base, ball
base = CreatePivot()
PositionEntity base, 5, 0, 0
TurnEntity base, 0, 90, 0
ball = CreateSphere(8, base)
PositionEntity ball, 0, 10, 0
EntityBody ball
Function Update()
End Function
`, { maxUpdates: 30 });
  const ball = engine.world.entities.find((e) => e.kind === 'mesh');
  const p = ball.worldPosition();
  near(p.x, 5, 1e-6, 'world x kept');
  // Falling for half a second under 19.6: about 1/2 g t^2 = 2.45 (the
  // exact figure depends on the integrator's steps).
  near(p.y, 10 - 0.5 * 19.6 * 0.25, 0.05, 'world y');
  assert(ball.parent !== null, 'lost its parent');
});

export default unit;
