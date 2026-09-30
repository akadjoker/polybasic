// Every example compiles without warnings and runs 300 Updates on the
// headless engine, with its files and physics as in `polybasic run`,
// without a runtime error or a warning (a file that did not load, say).

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { nodeEngineOptions } from '../../src/node.js';
import { assert } from './assert.mjs';

const dir = new URL('../../examples/', import.meta.url);

export default readdirSync(dir).filter((f) => f.endsWith('.pb')).sort().map((file) => ({
  name: `examples/${file} runs headless`,
  async fn()
  {
    const { js, warnings } = compile(readFileSync(new URL(file, dir), 'utf8'), { file });
    assert(warnings.length === 0, `warnings: ${warnings.map((w) => w.message).join('; ')}`);
    const host = new CaptureHost();
    const engine = new Engine(nodeEngineOptions(fileURLToPath(new URL(file, dir))));
    const debug = [];
    host.debug = (text) => debug.push(text);
    const result = await runProgram(await loadProgram(js), host, { engine, maxUpdates: 300 });
    assert(result.status !== 'error', `${result.error && result.error.message} (line ${result.error && result.error.line})`);
    assert(debug.length === 0, `engine warnings: ${debug.join('; ')}`);
  }
}));
