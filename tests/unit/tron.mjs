// Tron (examples/tron.pb) steered by a bot on the headless engine: the wall
// of light grows only while the bike turns (a pair of corners every third
// step and one more when the turn ends), and the floor follows the bike.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { nodeEngineOptions } from '../../src/node.js';
import { assert } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

const FILE = fileURLToPath(new URL('../../examples/tron.pb', import.meta.url));

// The program with a bot: it keeps left from step 21 to step 60 and prints
// where things are at step 100.
function withBot()
{
  let source = readFileSync(FILE, 'utf8');
  source = source.replace('Function Update()', 'Function GameUpdate()');
  source = source.replace('If KeyDown(KEY_LEFT) Then turn = 5', 'If botLeft Then turn = 5');
  const bot = `
Global botLeft

Function Update()
  f = FrameCount()
  botLeft = (f > 20 And f <= 60)
  GameUpdate
  If f = 100
    Print "vertices " + CountVertices(trailSurface)
    Print "bike " + EntityX(bike) + " " + EntityZ(bike) + " yaw " + EntityYaw(bike)
    Print "grid " + EntityX(grid) + " " + EntityZ(grid)
    End
  EndIf
End Function
`;
  const at = source.indexOf('Function Draw()');
  return source.slice(0, at) + bot + '\n' + source.slice(at);
}

test('the wall of light grows with the turns, the bike turns left and the floor follows it', async () =>
{
  const module = await loadProgram(compile(withBot(), { file: FILE }).js);
  const engine = new Engine(nodeEngineOptions(FILE));
  const host = new CaptureHost();
  const result = await runProgram(module, host, { engine, maxUpdates: 120 });
  assert(result.status !== 'error', `the program stopped with an error: ${result.error && result.error.message}`);
  const out = host.output;

  // 40 steps of turning: 13 pairs (every third step) and one when it ends,
  // on top of the four corners it starts with.
  assert(/vertices 32\b/.test(out), `the wall has the wrong number of corners:\n${out}`);

  // 5 degrees a step to the left for 40 steps is 200 degrees.
  const bike = /bike (-?[\d.]+) (-?[\d.]+) yaw (-?[\d.]+)/.exec(out);
  assert(bike, `no bike line:\n${out}`);
  const yaw = ((Number(bike[3]) % 360) + 360) % 360;
  assert(Math.abs(yaw - 200) < 0.01, `the bike faces ${yaw} degrees, not 200`);

  // One unit forward a step, 5 degrees to the left a step for steps 21 to
  // 60: the position worked out apart, with forward = (-sin yaw, cos yaw).
  let x = 0;
  let z = 0;
  let angle = 0;
  for (let step = 1; step <= 100; step++)
  {
    if (step >= 21 && step <= 60) angle += 5;
    x -= Math.sin((angle * Math.PI) / 180);
    z += Math.cos((angle * Math.PI) / 180);
  }
  assert(Math.abs(Number(bike[1]) - x) < 0.01 && Math.abs(Number(bike[2]) - z) < 0.01, `the bike is at ${bike[1]} ${bike[2]}, not ${x.toFixed(3)} ${z.toFixed(3)}`);

  // The floor is on a cell of 10 units and within one cell of the bike.
  const grid = /grid (-?[\d.]+) (-?[\d.]+)/.exec(out);
  assert(grid, `no grid line:\n${out}`);
  assert(Number(grid[1]) % 10 === 0 && Number(grid[2]) % 10 === 0, `the floor is not on a cell: ${grid[1]} ${grid[2]}`);
  assert(Math.abs(Number(grid[1]) - Number(bike[1])) < 10 && Math.abs(Number(grid[2]) - Number(bike[2])) < 10, 'the floor did not follow the bike');
});

test('going straight adds nothing to the wall', async () =>
{
  let source = withBot().replace('botLeft = (f > 20 And f <= 60)', 'botLeft = False');
  const module = await loadProgram(compile(source, { file: FILE }).js);
  const host = new CaptureHost();
  await runProgram(module, host, { engine: new Engine(nodeEngineOptions(FILE)), maxUpdates: 120 });
  assert(/vertices 4\b/.test(host.output), `the wall grew on a straight line:\n${host.output}`);
});

export default unit;
