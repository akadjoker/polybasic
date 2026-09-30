// Runs a compiled program: the main body once, then (when the program has
// an Update or Draw Function) the frame loop.
//
// The loop uses a fixed time step: Update runs 60 times per second of
// host time, however fast the display refreshes, and Draw runs once per
// displayed frame. When the host falls far behind (a background tab, a
// breakpoint), the missed time is dropped instead of running hundreds of
// Updates in a burst.

import { createRuntime, STEP_MS } from './runtime.js';
import { PolyRuntimeError, EndSignal } from './errors.js';

const MAX_UPDATES_PER_FRAME = 5;

// Loads the text of a compiled program as a module. A data: URL works in
// Node and in browsers and needs no file on disk.
export async function loadProgram(js)
{
  const url = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(js);
  return import(url);
}

// options:
//   maxUpdates  stop after this many Update calls (tests, `--frames`)
//   signal      an AbortSignal that stops the loop (the playground's Stop)
//   commands    extra command factories (see runtime.js)
//   engine      an object that joins the frame loop (the 3D engine):
//               commands(rt), beginStep() before each Update, endStep()
//               after it, renderFrame() once per frame after the Updates,
//               and beginDraw() / endDraw() around Draw. Optionally
//               prepare(uses), called with the program's $uses before
//               main, and whenReady(), called after main: each returns a
//               promise to wait for, or null when there is nothing to wait
//               for (then main still runs at once, as without an engine),
//               and stop() once the run is over.
//
// Resolves to { status, updates, error? } where status is
//   'finished'  main body done and there is no Update/Draw
//   'ended'     the program ran End
//   'stopped'   maxUpdates reached or the signal fired
//   'error'     a runtime error; `error` has { message, file, line }
export async function runProgram(module, host, options = {})
{
  try
  {
    return await run(module, host, options);
  }
  finally
  {
    if (options.engine && options.engine.stop) options.engine.stop();
  }
}

async function run(module, host, options)
{
  const rt = createRuntime(host, options);
  const engine = options.engine || null;
  const result = { status: 'finished', updates: 0 };
  const aborted = () => Boolean(options.signal && options.signal.aborted);

  const fail = (e) =>
  {
    if (e instanceof EndSignal)
    {
      result.status = 'ended';
      return result;
    }
    result.status = 'error';
    result.error = describeError(e, module);
    host.error(formatError(result.error));
    return result;
  };

  // Things the program needs before it starts (the physics engine), and
  // the files its main body started loading (models, textures): the first
  // Update sees them all in place.
  const wait = async (promise) =>
  {
    if (options.signal)
    {
      // Stop must work even while a file never arrives.
      const signal = options.signal;
      await Promise.race([promise, new Promise((resolve) =>
      {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', resolve, { once: true });
      })]);
    }
    else await promise;
    if (aborted())
    {
      result.status = 'stopped';
      return false;
    }
    return true;
  };

  let program;
  try
  {
    // Only a real promise is awaited: without one, main runs right here,
    // inside the runProgram call.
    const preparing = engine && engine.prepare ? engine.prepare(module.$uses || []) : null;
    if (preparing && !await wait(preparing)) return result;
    program = module.create(rt);
    program.main();
    const loading = engine && engine.whenReady ? engine.whenReady() : null;
    if (loading && !await wait(loading)) return result;
  }
  catch (e)
  {
    return fail(e);
  }
  if (!program.update && !program.draw)
  {
    // A program that set up a scene but has no frame functions still gets
    // one picture of it.
    if (engine && engine.graphicsSet)
    {
      try
      {
        engine.renderFrame();
        engine.beginDraw();
        engine.endDraw();
      }
      catch (e)
      {
        return fail(e);
      }
    }
    return result;
  }

  return new Promise((resolve) =>
  {
    let last = null;
    let pending = 0;
    let handle = null;

    const stop = (status) =>
    {
      result.status = status;
      if (handle !== null) host.cancelFrame(handle);
      resolve(result);
    };
    if (options.signal)
    {
      if (options.signal.aborted) return stop('stopped');
      options.signal.addEventListener('abort', () => stop('stopped'), { once: true });
    }

    const frame = (time) =>
    {
      handle = null;
      if (options.signal && options.signal.aborted) return;
      // The first frame always runs one Update, so Draw never shows a
      // world that was not updated yet.
      if (last === null) pending = STEP_MS;
      else pending += time - last;
      last = time;
      try
      {
        let n = 0;
        // The small tolerance absorbs rounding in the frame times, so a
        // host ticking at exactly 60 Hz gets exactly one Update per frame.
        while (pending >= STEP_MS - 0.01 && n < MAX_UPDATES_PER_FRAME)
        {
          pending -= STEP_MS;
          n++;
          if (engine) engine.beginStep();
          if (program.update)
          {
            rt.frameCount++;
            result.updates++;
            program.update();
          }
          if (engine && engine.endStep) engine.endStep();
          if (options.maxUpdates && result.updates >= options.maxUpdates) break;
        }
        if (n === MAX_UPDATES_PER_FRAME) pending = 0;
        if (engine)
        {
          engine.renderFrame();
          engine.beginDraw();
        }
        if (program.draw) program.draw();
        if (engine) engine.endDraw();
      }
      catch (e)
      {
        resolve(fail(e));
        return;
      }
      if (options.maxUpdates && result.updates >= options.maxUpdates)
      {
        stop('stopped');
        return;
      }
      handle = host.requestFrame(frame);
    };
    handle = host.requestFrame(frame);
  });
}

// Works out where in the .pb source an error happened by finding the
// innermost stack frame that belongs to the generated module and looking
// its line up in the module's line map. This costs nothing until an error
// happens: the generated code carries no line bookkeeping.
export function describeError(e, module)
{
  let message;
  if (e instanceof PolyRuntimeError) message = e.message;
  else if (e instanceof RangeError && /call stack/i.test(e.message)) message = 'Stack overflow (a Function keeps calling itself without stopping)';
  else message = `Internal error: ${e && e.message ? e.message : String(e)}`;

  const where = locate(e, module);
  return { message, file: where ? where.file : null, line: where ? where.line : null };
}

function locate(e, module)
{
  const stack = e && typeof e.stack === 'string' ? e.stack : '';
  const url = module.$url;
  const map = module.$map;
  if (!url || !map) return null;
  for (const text of stack.split('\n'))
  {
    const at = text.indexOf(url);
    if (at < 0) continue;
    const m = /^:(\d+):(\d+)/.exec(text.slice(at + url.length));
    if (!m) continue;
    const jsLine = Number(m[1]) - 1;
    const line = map.lines[jsLine];
    if (!line) continue;
    const file = map.files[map.fileOf ? map.fileOf[jsLine] : 0];
    return { file, line };
  }
  return null;
}

export function formatError(error)
{
  const where = error.file ? ` (${error.file}, line ${error.line})` : '';
  return `Runtime error${where}: ${error.message}`;
}
