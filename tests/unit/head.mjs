// The Head (examples/head.pb) run on the headless engine: the head follows
// its path (a straight stretch is a straight line), the room it reflects is
// put on it at step 574 of the film and taken off when the film starts
// again.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { nodeEngineOptions } from '../../src/node.js';
import { assert } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

const FILE = fileURLToPath(new URL('../../examples/head.pb', import.meta.url));

// Runs the program for `updates` Updates, printing where the head is in the
// last one; returns the output and the engine.
async function play(updates)
{
  let source = readFileSync(FILE, 'utf8');
  source = source.replace('Function Update()', 'Function FilmUpdate()');
  const report = `
Function Update()
  FilmUpdate
  If FrameCount() = ${updates}
    Print "step " + stepNow + " clock " + clock
    Print "pitch " + EntityPitch(head)
    Print "y " + EntityY(head)
    Print "z " + EntityZ(head)
    End
  EndIf
End Function
`;
  const at = source.indexOf('Function Draw()');
  source = source.slice(0, at) + report + '\n' + source.slice(at);
  const module = await loadProgram(compile(source, { file: FILE }).js);
  const engine = new Engine(nodeEngineOptions(FILE));
  const host = new CaptureHost();
  const result = await runProgram(module, host, { engine, maxUpdates: updates + 5 });
  assert(result.status !== 'error', `the program stopped with an error: ${result.error && result.error.message}`);
  return { out: host.output, engine };
}

const number = (out, name) =>
{
  const m = new RegExp(`${name} (-?[\\d.]+)`).exec(out);
  assert(m, `no "${name}" in:\n${out}`);
  return Number(m[1]);
};

// The picture the head wears.
const skin = (engine) =>
{
  const urls = new Set();
  for (const e of engine.world.entities)
  {
    const t = e.material && e.material.texture;
    if (t && t.url) urls.add(t.url.split('/').pop());
  }
  return urls;
};

test('a straight stretch of the path is a straight line (step 150 to 170: the pitch goes from -25.7 to -27.4)', async () =>
{
  const { out } = await play(398);
  const step = number(out, 'step');
  const clock = number(out, 'clock');
  const at = step + (clock - Math.floor(clock));
  assert(at > 160 && at < 160.5, `the film is at ${at}, not about 160`);
  const expected = -25.7 + ((at - 150) / 20) * (-27.4 + 25.7);
  assert(Math.abs(number(out, 'pitch') - expected) < 0.01, `pitch ${number(out, 'pitch')}, a straight line gives ${expected.toFixed(3)}`);
  assert(Math.abs(number(out, 'y') + 0.18) < 0.01 && Math.abs(number(out, 'z') + 0.45) < 0.01, `the head is at y ${number(out, 'y')} z ${number(out, 'z')}`);
});

test('the head wears its face, then the room it reflects from step 574, and its face again when the film starts over', async () =>
{
  const early = skin((await play(200)).engine);
  assert(early.has('face.jpg') && !early.has('reflection.jpg'), `early: ${[...early]}`);
  // 24 steps a second at 60 Updates a second: step 574 is at Update 1433.
  const late = skin((await play(1500)).engine);
  assert(late.has('reflection.jpg'), `late: ${[...late]}`);
  // The film is 1000 steps long: back at its start after 2500 Updates.
  const again = skin((await play(2600)).engine);
  assert(again.has('face.jpg') && !again.has('reflection.jpg'), `again: ${[...again]}`);
});

export default unit;
