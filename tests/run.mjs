// PolyBasic test runner.
//
//   node tests/run.mjs            run everything
//   node tests/run.mjs --update   rewrite tests/expected/*.out from the
//                                 current output (review the diff!)
//   node tests/run.mjs name       only golden programs whose name contains
//                                 "name"
//
// Golden tests: every tests/programs/*.pb is compiled and run with a
// capturing host on fake time; the text it prints (plus compile errors,
// warnings and runtime errors, formatted as the CLI shows them) must match
// tests/expected/<name>.out exactly. Programs with an Update Function run
// until End, or are stopped after 1000 updates.
//
// Unit tests below check the pieces the golden files cannot see: the
// command table, the shape of the generated code and the frame loop.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile, CompileError, CORE_COMMANDS } from '../src/compiler/index.js';
import { loadProgram, runProgram, CaptureHost, NodeHost, Host, createRuntime } from '../src/runtime/index.js';
import { parseSignature } from '../src/compiler/builtins.js';

const here = dirname(fileURLToPath(import.meta.url));
const programsDir = join(here, 'programs');
const expectedDir = join(here, 'expected');
const args = process.argv.slice(2);
const update = args.includes('--update');
const filter = args.find((a) => !a.startsWith('--')) || '';

let passed = 0;
let failed = 0;

function report(name, ok, detail)
{
  if (ok) passed++;
  else
  {
    failed++;
    console.log(`FAIL ${name}`);
    if (detail) console.log(detail.replace(/^/gm, '    '));
  }
}

// Compiles and runs one program the way the CLI would, returning all of the
// text a user would see.
async function runGolden(file)
{
  const source = readFileSync(join(programsDir, file), 'utf8');
  let output = '';
  let result;
  try
  {
    result = compile(source, { file, readFile: (p) => readFileSync(join(programsDir, p), 'utf8') });
  }
  catch (e)
  {
    if (e instanceof CompileError) return e.format() + '\n';
    throw e;
  }
  for (const w of result.warnings) output += `${w.file}:${w.line}:${w.column}: warning: ${w.message}\n`;
  const host = new CaptureHost();
  const run = await runProgram(await loadProgram(result.js), host, { maxUpdates: 1000 });
  output += host.output;
  if (run.status === 'stopped') output += `[stopped after ${run.updates} updates]\n`;
  if (run.status === 'ended') output += '[ended]\n';
  return output;
}

function diff(expected, actual)
{
  const e = expected.split('\n');
  const a = actual.split('\n');
  for (let i = 0; i < Math.max(e.length, a.length); i++)
  {
    if (e[i] !== a[i]) return `line ${i + 1}\n  expected: ${JSON.stringify(e[i])}\n  actual:   ${JSON.stringify(a[i])}`;
  }
  return '';
}

async function goldenTests()
{
  const files = readdirSync(programsDir).filter((f) => f.endsWith('.pb') && f.includes(filter)).sort();
  for (const file of files)
  {
    const name = file.replace(/\.pb$/, '');
    const expectedPath = join(expectedDir, name + '.out');
    let actual;
    try
    {
      actual = await runGolden(file);
    }
    catch (e)
    {
      report(name, false, e.stack);
      continue;
    }
    if (update)
    {
      writeFileSync(expectedPath, actual);
      passed++;
      continue;
    }
    if (!existsSync(expectedPath))
    {
      report(name, false, 'missing expected output (run with --update)');
      continue;
    }
    const expected = readFileSync(expectedPath, 'utf8');
    report(name, expected === actual, diff(expected, actual));
  }
}

// ------------------------------------------------------------ unit tests

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

function assert(cond, message)
{
  if (!cond) throw new Error(message);
}

async function compileAndLoad(source)
{
  const { js } = compile(source, { file: 'test.pb' });
  return { js, module: await loadProgram(js) };
}

test('every command signature has a runtime implementation', () =>
{
  const rt = createRuntime(new Host());
  const keys = CORE_COMMANDS.map((s) => parseSignature(s).key);
  for (const k of keys) assert(typeof rt.commands[k] === 'function', `no implementation for ${k}`);
  for (const k of Object.keys(rt.commands)) assert(keys.includes(k), `implementation without signature: ${k}`);
});

test('compile errors carry file, line and column', () =>
{
  try
  {
    compile('x = 1\nPrint y$ - 2\n', { file: 'err.pb' });
  }
  catch (e)
  {
    assert(e instanceof CompileError, 'not a CompileError');
    assert(e.file === 'err.pb' && e.line === 2 && e.column === 10, `bad position ${e.file}:${e.line}:${e.column}`);
    return;
  }
  throw new Error('no error thrown');
});

test('generated code is plain synchronous JavaScript', async () =>
{
  const { js } = await compileAndLoad(`
Function Fib(n)
  If n < 2 Then Return n
  Return Fib(n - 1) + Fib(n - 2)
End Function
Function Update()
  Print Fib(10)
End Function
total = 0
For i = 1 To 1000
  total = total + i
Next
`);
  assert(!/\basync\b|\bawait\b|\byield\b/.test(js), 'found async code');
  assert(js.includes('function fn_fib(l_n)'), 'Fib is not a plain function');
  assert(js.includes('for (l_i = 1; l_i <= 1000; l_i = (l_i + 1) | 0)'), 'For did not become a JavaScript for loop');
});

test('a program without Update runs once and finishes', async () =>
{
  const { module } = await compileAndLoad('Print "once"\n');
  const host = new CaptureHost();
  const r = await runProgram(module, host);
  assert(r.status === 'finished' && r.updates === 0, `status ${r.status}, updates ${r.updates}`);
  assert(host.output === 'once\n', `output ${JSON.stringify(host.output)}`);
});

const COUNTER = `
Global frames, draws
Function Update()
  frames = frames + 1
End Function
Function Draw()
  draws = draws + 1
  If frames Mod 20 = 0 Then Print frames + " " + draws + " " + FrameCount() + " " + MilliSecs()
End Function
`;

test('60 Update calls with the Node host, each frame yields to the event loop', async () =>
{
  const { module } = await compileAndLoad(COUNTER);
  const host = new CaptureHost();
  // A probe that runs on every turn of the event loop. If a frame did not
  // hand control back, the probe count would not move between frames.
  let probe = 0;
  let running = true;
  const tick = () =>
  {
    probe++;
    if (running) setImmediate(tick);
  };
  setImmediate(tick);
  const seen = [];
  const request = host.requestFrame.bind(host);
  host.requestFrame = (cb) => request((t) =>
  {
    seen.push(probe);
    cb(t);
  });
  const r = await runProgram(module, host, { maxUpdates: 60 });
  running = false;
  assert(r.status === 'stopped' && r.updates === 60, `status ${r.status}, updates ${r.updates}`);
  assert(host.output === '20 20 20 333\n40 40 40 666\n60 60 60 1000\n', `output ${JSON.stringify(host.output)}`);
  assert(seen.length === 60, `frames ${seen.length}`);
  for (let i = 1; i < seen.length; i++) assert(seen[i] > seen[i - 1], `frame ${i} did not yield`);
});

test('fixed step: a 30 Hz display gets two Updates per Draw, 120 Hz one every other frame', async () =>
{
  for (const [hz, updates, draws] of [[30, 60, 30], [120, 60, 120]])
  {
    const { module } = await compileAndLoad(COUNTER + 'Function Report()\nEnd Function\n');
    const host = new CaptureHost();
    let t = 0;
    host.requestFrame = (cb) => setImmediate(() => cb(t += 1000 / hz));
    const r = await runProgram(module, host, { maxUpdates: updates });
    const lines = host.output.trim().split('\n');
    const last = lines[lines.length - 1].split(' ').map(Number);
    assert(r.updates === updates, `${hz} Hz: updates ${r.updates}`);
    assert(Math.abs(last[1] - draws * last[0] / updates) <= 1, `${hz} Hz: ${host.output}`);
  }
});

test('real-time Node host paces Updates at about 60 per second', async () =>
{
  const { module } = await compileAndLoad(COUNTER);
  const host = new NodeHost({ out: () => {} });
  const start = performance.now();
  const r = await runProgram(module, host, { maxUpdates: 12 });
  const ms = performance.now() - start;
  assert(r.updates === 12, `updates ${r.updates}`);
  assert(ms > 150 && ms < 1000, `12 updates took ${ms.toFixed(0)} ms`);
});

test('End inside Update stops the loop', async () =>
{
  const { module } = await compileAndLoad('Global n\nFunction Update()\n n = n + 1\n If n = 5 Then End\nEnd Function\n');
  const r = await runProgram(module, new CaptureHost(), { maxUpdates: 100 });
  assert(r.status === 'ended' && r.updates === 5, `status ${r.status}, updates ${r.updates}`);
});

test('an AbortSignal stops a running program', async () =>
{
  const { module } = await compileAndLoad('Function Update()\nEnd Function\n');
  const controller = new AbortController();
  const host = new CaptureHost();
  const request = host.requestFrame.bind(host);
  let frames = 0;
  host.requestFrame = (cb) => request((t) =>
  {
    if (++frames === 10) controller.abort();
    cb(t);
  });
  const r = await runProgram(module, host, { signal: controller.signal });
  assert(r.status === 'stopped' && r.updates === 9, `status ${r.status}, updates ${r.updates}`);
});

test('runtime errors in Update report the .pb line', async () =>
{
  const { module } = await compileAndLoad('Global n\nFunction Update()\n  n = n + 1\n  If n = 3\n    x = 10 / (n - 3)\n  EndIf\nEnd Function\n');
  const r = await runProgram(module, new CaptureHost(), { maxUpdates: 10 });
  assert(r.status === 'error', `status ${r.status}`);
  assert(r.error.line === 5 && r.error.file === 'test.pb', `line ${r.error.line} in ${r.error.file}`);
  assert(r.updates === 3, `updates ${r.updates}`);
});

async function unitTests()
{
  if (filter) return;
  for (const t of unit)
  {
    try
    {
      await t.fn();
      report(t.name, true);
    }
    catch (e)
    {
      report(t.name, false, e.stack || String(e));
    }
  }
}

await goldenTests();
const goldenCount = passed + failed;
await unitTests();
console.log(`${passed} passed, ${failed} failed (${goldenCount} golden programs, ${passed + failed - goldenCount} unit tests)`);
process.exitCode = failed ? 1 : 0;
