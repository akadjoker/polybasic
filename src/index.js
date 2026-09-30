// PolyBasic: the language (compiler + runtime) together with the 3D engine.
//
// `compile` and `runProgram` here are the ones to use: they add the engine's
// commands and constants to the core language, and give every run an
// engine (headless by default, see createBrowserEngine for a canvas).

import { compile as compileCore } from './compiler/index.js';
import { runProgram as runCore, loadProgram } from './runtime/index.js';
import { Engine, ENGINE_COMMANDS, ENGINE_CONSTANTS } from './engine/index.js';

export { CompileError, CORE_COMMANDS, SPECIAL_COMMANDS, KEYWORDS, parseSignature } from './compiler/index.js';
export {
  loadProgram, describeError, formatError, createRuntime, STEP_MS,
  Host, NodeHost, CaptureHost, BrowserHost, PolyRuntimeError, EndSignal
} from './runtime/index.js';
export * from './engine/index.js';

export function compile(source, options = {})
{
  return compileCore(source, {
    ...options,
    commands: [...ENGINE_COMMANDS, ...(options.commands || [])],
    constants: { ...ENGINE_CONSTANTS, ...(options.constants || {}) }
  });
}

// Like the runtime's runProgram, with a headless Engine when none is given.
export function runProgram(module, host, options = {})
{
  return runCore(module, host, { ...options, engine: options.engine || new Engine() });
}

// Compiles `source`, loads it and runs it on `host`. Compile errors are
// thrown (CompileError); runtime results come back from runProgram.
export async function runSource(source, host, options = {})
{
  const { js, warnings } = compile(source, options);
  const module = await loadProgram(js);
  const result = await runProgram(module, host, options);
  return { ...result, warnings };
}
