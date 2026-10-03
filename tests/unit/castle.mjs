// Castle (examples/castle.pb) played by bots on the headless engine: the
// player stands on the courtyard floor, shots that hit the castle leave
// bullet holes and sparks, shots that hit the hills dig into the terrain,
// and the chase camera settles behind the player. The program is run as it
// is, with a bot added that presses keys.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { nodeEngineOptions } from '../../src/node.js';
import { assert } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

const FILE = fileURLToPath(new URL('../../examples/castle.pb', import.meta.url));

// The program with a bot in front of its Update. `script` is the bot's
// body: it can set botFire (a single press), botForward and botJump, read
// FrameCount(), and Print; `setup` runs at the second update.
function withBot(script, setup = '')
{
  let source = readFileSync(FILE, 'utf8');
  source = source.replace('Function Update()\n  clock', 'Function GameUpdate()\n  clock');
  source = source.replace('If KeyHit(KEY_ALT) Or', 'If botFire Or KeyHit(KEY_ALT) Or');
  source = source.replace('If KeyDown(KEY_A)\n', 'If KeyDown(KEY_A) Or botForward\n');
  source = source.replace('If KeyHit(KEY_SPACE)\n', 'If KeyHit(KEY_SPACE) Or botJump\n');
  const bot = `
Global botFire, botForward, botJump

Function Update()
  f = FrameCount()
  botFire = False
  botJump = False
  If f = 2
${setup}
  EndIf
${script}
  GameUpdate
End Function
`;
  const at = source.indexOf('Function Draw()');
  return source.slice(0, at) + bot + '\n' + source.slice(at);
}

async function play(source, updates)
{
  const module = await loadProgram(compile(source, { file: FILE }).js);
  const engine = new Engine(nodeEngineOptions(FILE));
  const host = new CaptureHost();
  const result = await runProgram(module, host, { engine, maxUpdates: updates });
  assert(result.status !== 'error', `the program stopped with an error: ${result.error && result.error.message}`);
  return host.output;
}

const number = (out, name) =>
{
  const m = new RegExp(`${name} (-?[\\d.]+)`).exec(out);
  assert(m, `no "${name}" in:\n${out}`);
  return Number(m[1]);
};

test('the player settles on the courtyard floor and the camera settles behind it', async () =>
{
  const out = await play(withBot(`
  If f = 300
    ty# = TerrainY(land, EntityX(player), 0, EntityZ(player))
    Print "y " + EntityY(player)
    Print "ground " + ty
    Print "behind " + Sqr((EntityX(camera) - EntityX(camTarget, True)) ^ 2 + (EntityY(camera) - EntityY(camTarget, True)) ^ 2 + (EntityZ(camera) - EntityZ(camTarget, True)) ^ 2)
    Print "cameraDistance " + Sqr((EntityX(camera) - EntityX(player)) ^ 2 + (EntityY(camera) - EntityY(player)) ^ 2 + (EntityZ(camera) - EntityZ(player)) ^ 2)
    End
  EndIf`), 320);
  // Dropped from 10 and stopped by the floor of the courtyard (its ellipsoid
  // is 1.5 high, on a floor about 3.4 up): not through it, not still falling.
  const y = number(out, 'y');
  assert(y > 3 && y < 7, `the player is at y ${y}`);
  assert(number(out, 'behind') < 0.5, `the camera is ${number(out, 'behind')} from where it wants to be`);
  // 3 up and 10 behind.
  assert(Math.abs(number(out, 'cameraDistance') - Math.hypot(3, 10)) < 0.6, `the camera is ${number(out, 'cameraDistance')} from the player`);
});

test('a shot at the castle leaves a bullet hole and a spark, and the bullet is gone', async () =>
{
  // Facing the wall of the courtyard, as the sample starts.
  const out = await play(withBot(`
  If f = 120 Then botFire = True
  If f = 125 Then Print "bullets " + CountBullets()
  If f = 260
    Print "holes " + CountHoles()
    Print "bulletsAfter " + CountBullets()
    Print "sparks " + CountSparks()
  EndIf
  If f = 800
    Print "holesLater " + CountHoles()
    Print "sparksLater " + CountSparks()
    End
  EndIf`).replace('Function Draw()', `Function CountBullets()
  n = 0
  For b.Bullet = Each Bullet
    n = n + 1
  Next
  Return n
End Function

Function CountHoles()
  n = 0
  For h.Hole = Each Hole
    n = n + 1
  Next
  Return n
End Function

Function CountSparks()
  n = 0
  For s.Spark = Each Spark
    n = n + 1
  Next
  Return n
End Function

Function Draw()`), 820);
  assert(number(out, 'bullets') === 1, `${number(out, 'bullets')} bullets in the air after a shot`);
  assert(number(out, 'holes') >= 1, `no bullet hole after the shot hit the wall:\n${out}`);
  assert(number(out, 'bulletsAfter') === 0, 'the bullet is still there after it hit');
  // A hole fades in 200 steps (400 updates) and a spark lasts 24 steps: both
  // are gone by the end.
  assert(number(out, 'holesLater') === 0 && number(out, 'sparksLater') === 0, `a hole or a spark never ended:\n${out}`);
});

test('shots that hit the hills dig into the terrain', async () =>
{
  // On the hill south of the castle, facing it: the shots meet the slope.
  const out = await play(withBot(`
  If f = 200 Then Print "before " + Sum()
  If f = 200 Or f = 215 Or f = 230 Or f = 245 Then botFire = True
  If f = 500
    Print "after " + Sum()
    End
  EndIf`, `    PositionEntity player, 0, 80, -300
    RotateEntity player, 0, 0, 0
    ResetEntity player
    playerY = 80`).replace('Function Draw()', `Function Sum#()
  total# = 0
  For x = 0 To 255
    For z = 0 To 255
      total = total + TerrainHeight(land, x, z)
    Next
  Next
  Return total
End Function

Function Draw()`), 520);
  const before = number(out, 'before');
  const after = number(out, 'after');
  assert(before - after > 0.019, `the terrain went from ${before} to ${after}: no crater`);
});

export default unit;
