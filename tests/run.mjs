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
import { compile, CompileError, loadProgram, runProgram, CaptureHost, Engine } from '../src/index.js';
import { nodeEngineOptions } from '../src/node.js';


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
  const engine = new Engine(nodeEngineOptions(join(programsDir, file)));
  const run = await runProgram(await loadProgram(result.js), host, { maxUpdates: 1000, engine });
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
//
// Each module in tests/unit exports an array of { name, fn }.

async function unitTests()
{
  if (filter) return;
  const unit = [];
  for (const file of readdirSync(join(here, 'unit')).filter((f) => f.endsWith('.mjs')).sort())
  {
    const tests = (await import(new URL(`unit/${file}`, import.meta.url))).default;
    if (!Array.isArray(tests)) continue;
    for (const t of tests) unit.push({ ...t, name: `${file.replace(/\.mjs$/, '')}: ${t.name}` });
  }
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
