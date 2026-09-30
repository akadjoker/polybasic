#!/usr/bin/env node
// PolyBasic command line.
//
//   polybasic run game.pb [--frames N] [--fake-time]
//   polybasic build game.pb [-o game.js]
//   polybasic --js game.pb
//
// `run` compiles and runs a program with the Node host. A program with an
// Update Function keeps running at 60 updates per second until it calls End
// (or Ctrl+C); --frames stops it after N updates.

import { readFileSync, writeFileSync } from 'node:fs';
import { compile, CompileError } from '../src/compiler/index.js';
import { loadProgram, runProgram, NodeHost } from '../src/runtime/index.js';

const USAGE = `Usage:
  polybasic run <file.pb> [--frames N] [--fake-time]   compile and run
  polybasic build <file.pb> [-o out.js]                write the JavaScript module
  polybasic --js <file.pb>                             print the generated JavaScript
`;

function main(argv)
{
  const args = [...argv];
  let command = args.shift();
  if (!command || command === '-h' || command === '--help')
  {
    process.stdout.write(USAGE);
    return 0;
  }
  if (command === '--js') command = 'js';

  const file = args.shift();
  if (!file)
  {
    process.stderr.write(USAGE);
    return 2;
  }
  const option = (name) =>
  {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };

  let result;
  try
  {
    const source = readFileSync(file, 'utf8');
    result = compile(source, { file, readFile: (path) => readFileSync(path, 'utf8') });
  }
  catch (e)
  {
    if (e instanceof CompileError)
    {
      process.stderr.write(e.format() + '\n');
      return 1;
    }
    if (e.code === 'ENOENT')
    {
      process.stderr.write(`Cannot open ${file}\n`);
      return 1;
    }
    throw e;
  }
  for (const w of result.warnings)
  {
    process.stderr.write(`${w.file}:${w.line}:${w.column}: warning: ${w.message}\n`);
  }

  switch (command)
  {
    case 'js':
      process.stdout.write(result.js);
      return 0;
    case 'build':
    {
      const out = option('-o') || file.replace(/\.pb$/i, '') + '.js';
      writeFileSync(out, result.js);
      process.stdout.write(`Wrote ${out}\n`);
      return 0;
    }
    case 'run':
      return run(result.js, {
        maxUpdates: option('--frames') ? Number(option('--frames')) : 0,
        fakeTime: args.includes('--fake-time')
      });
    default:
      process.stderr.write(`Unknown command '${command}'\n${USAGE}`);
      return 2;
  }
}

async function run(js, { maxUpdates, fakeTime })
{
  const module = await loadProgram(js);
  const host = new NodeHost({ fakeTime });
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  const result = await runProgram(module, host, { maxUpdates, signal: controller.signal });
  return result.status === 'error' ? 1 : 0;
}

Promise.resolve(main(process.argv.slice(2))).then((code) =>
{
  process.exitCode = code;
});
