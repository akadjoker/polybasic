// The runner's engine hooks: prepare before main, waiting for the files the
// main body started loading, endStep after every Update, and the $uses list
// the compiler writes.

import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { assert } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

async function load(source)
{
  return loadProgram(compile(source, { file: 'test.pb' }).js);
}

// A promise with its resolve function, to settle a load by hand.
function deferred()
{
  let resolve;
  const promise = new Promise((r) =>
  {
    resolve = r;
  });
  return { promise, resolve };
}

test('the generated module lists the commands it calls', async () =>
{
  const module = await load('c = CreateCube()\nPositionEntity c, 1, 2, 3\nPrint Abs(-2)\n');
  const uses = module.$uses;
  assert(Array.isArray(uses), '$uses is missing');
  for (const name of ['createcube', 'positionentity', 'print']) assert(uses.includes(name), `${name} not in ${uses}`);
  assert(!uses.includes('createsphere'), 'lists a command that is not called');
});

test('prepare runs before main and main waits for it', async () =>
{
  const module = await load('Print "main"\n');
  const engine = new Engine();
  const gate = deferred();
  const seen = [];
  engine.prepare = (uses) =>
  {
    seen.push(uses.join(','));
    return gate.promise;
  };
  const host = new CaptureHost();
  const run = runProgram(module, host, { engine });
  await new Promise((r) => setImmediate(r));
  assert(host.output === '', `main ran before prepare finished: ${JSON.stringify(host.output)}`);
  gate.resolve();
  const r = await run;
  assert(r.status === 'finished', r.status);
  assert(host.output === 'main\n', JSON.stringify(host.output));
  assert(seen[0] === 'print', `prepare got ${seen[0]}`);
});

test('without anything to wait for, main runs inside the runProgram call', async () =>
{
  const module = await load('Print "now"\n');
  const host = new CaptureHost();
  const run = runProgram(module, host);
  assert(host.output === 'now\n', 'main did not run synchronously');
  await run;
});

test('the first Update waits for files started in main, later loads do not block', async () =>
{
  const module = await load(`
Global early, late
early = LoadTexture("early.png")
Function Update()
  If FrameCount() = 1 Then Print "update 1: early " + TextureLoaded(early) : late = LoadTexture("late.png")
  If FrameCount() = 2 Then Print "update 2: late " + TextureLoaded(late)
  If FrameCount() = 3 Then End
End Function
`);
  const files = new Map();
  const loadFile = (url) =>
  {
    const d = deferred();
    files.set(url, d);
    return d.promise;
  };
  const engine = new Engine({ loadFile });
  const host = new CaptureHost();
  const run = runProgram(module, host, { engine, maxUpdates: 10 });
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
  assert(host.output === '', `Update ran before the texture arrived: ${JSON.stringify(host.output)}`);
  files.get('early.png').resolve(new Uint8Array(4));
  const r = await run;
  assert(r.status === 'ended', r.status);
  assert(host.output === 'update 1: early 1\nupdate 2: late 0\n', JSON.stringify(host.output));
});

test('endStep runs after every Update, also when there is only a Draw', async () =>
{
  for (const [source, expected] of [
    ['Function Update()\n  Write "u "\nEnd Function\n', 'u e u e u e '],
    ['Global n\nFunction Draw()\n  Write "d "\n  n = n + 1\n  If n = 3 Then End\nEnd Function\n', 'e d e d e d ']
  ])
  {
    const module = await load(source);
    const engine = new Engine();
    const host = new CaptureHost();
    engine.endStep = () => host.write('e ');
    await runProgram(module, host, { engine, maxUpdates: 3 });
    assert(host.output === expected, JSON.stringify(host.output));
  }
});

test('stopping while the program waits for its files ends the run', async () =>
{
  const module = await load('t = LoadTexture("slow.png")\nFunction Update()\n  Print "never"\nEnd Function\n');
  const engine = new Engine({ loadFile: () => new Promise(() => {}) });
  const controller = new AbortController();
  const host = new CaptureHost();
  const run = runProgram(module, host, { engine, signal: controller.signal });
  await new Promise((r) => setImmediate(r));
  controller.abort();
  // The load never settles: the run must not hang on it.
  const r = await Promise.race([run, new Promise((r2) => setTimeout(() => r2({ status: 'hung' }), 500))]);
  assert(r.status === 'stopped', `status ${r.status}`);
  assert(host.output === '', JSON.stringify(host.output));
});

export default unit;
