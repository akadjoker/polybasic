// Hosts connect a running program to the platform: where text goes, what
// time it is and when the next frame should run. The runner (runner.js)
// owns the frame loop and asks the host for frames; the program itself
// never waits.
//
//   write(text)          text from Print / Write (Print adds the newline)
//   debug(text)          DebugLog output
//   error(text)          a runtime error report
//   now()                milliseconds from an arbitrary start
//   requestFrame(fn)     call fn(timeMs) when the next frame is due;
//                        returns a handle for cancelFrame
//   cancelFrame(handle)
//
// Later phases add input state and a drawing surface to this interface.

const FRAME_MS = 1000 / 60;

// Runs a callback on the next turn of the event loop (after pending I/O and
// timers), which is what "yield to the platform" means outside a browser.
const nextTurn = typeof setImmediate === 'function'
  ? (fn) => setImmediate(fn)
  : (fn) => setTimeout(fn, 0);
const cancelTurn = typeof clearImmediate === 'function'
  ? (h) => clearImmediate(h)
  : (h) => clearTimeout(h);

export class Host
{
  write(text)
  {
  }

  debug(text)
  {
    this.write(text + '\n');
  }

  error(text)
  {
    this.write(text + '\n');
  }

  now()
  {
    return performance.now();
  }

  requestFrame(callback)
  {
    return setTimeout(() => callback(this.now()), FRAME_MS);
  }

  cancelFrame(handle)
  {
    clearTimeout(handle);
  }
}

// Node.js host. With `fakeTime: true` the clock only moves when a frame
// runs (exactly 1/60 s per frame) and frames run back to back, which makes
// runs repeatable: tests and `polybasic run --frames N` use it. Without it,
// frames are paced by a real 60 Hz timer.
export class NodeHost extends Host
{
  constructor(options = {})
  {
    super();
    this.fakeTime = Boolean(options.fakeTime);
    this.clock = 0;
    this.frames = 0;
    this.out = options.out || ((text) => process.stdout.write(text));
    this.err = options.err || ((text) => process.stderr.write(text));
    this.start = performance.now();
    this.nextFrameAt = 0;
  }

  write(text)
  {
    this.out(text);
  }

  debug(text)
  {
    this.err(text + '\n');
  }

  error(text)
  {
    this.err(text + '\n');
  }

  now()
  {
    return this.fakeTime ? this.clock : performance.now() - this.start;
  }

  requestFrame(callback)
  {
    if (this.fakeTime)
    {
      return nextTurn(() =>
      {
        // Computed from the frame count, not accumulated, so the clock
        // reads exactly 1000 after 60 frames.
        this.frames++;
        this.clock = this.frames * 1000 / 60;
        callback(this.clock);
      });
    }
    // Aim at a steady 60 Hz grid rather than "16 ms after the last frame",
    // so timer lateness does not add up.
    const now = this.now();
    this.nextFrameAt = Math.max(this.nextFrameAt + FRAME_MS, now);
    return setTimeout(() => callback(this.now()), this.nextFrameAt - now);
  }

  cancelFrame(handle)
  {
    if (this.fakeTime) cancelTurn(handle);
    else clearTimeout(handle);
  }
}

// Collects output in a string, with fake time. Used by the test suite and
// handy for embedding.
export class CaptureHost extends NodeHost
{
  constructor()
  {
    super({ fakeTime: true, out: (t) => { this.output += t; }, err: (t) => { this.output += t; } });
    this.output = '';
  }
}

// Browser host: frames come from requestAnimationFrame, text goes to a
// callback (or is appended to an element).
export class BrowserHost extends Host
{
  constructor(options = {})
  {
    super();
    const target = options.output;
    if (typeof target === 'function') this.out = target;
    else if (target) this.out = (text) => { target.textContent += text; };
    else this.out = (text) => console.log(text.replace(/\n$/, ''));
    this.onError = options.onError || ((text) => console.error(text));
  }

  write(text)
  {
    this.out(text);
  }

  debug(text)
  {
    console.log(text);
  }

  error(text)
  {
    this.onError(text);
  }

  requestFrame(callback)
  {
    return requestAnimationFrame(callback);
  }

  cancelFrame(handle)
  {
    cancelAnimationFrame(handle);
  }
}
