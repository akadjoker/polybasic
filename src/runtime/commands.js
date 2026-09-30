// The core command library: output, strings, maths, random numbers, time.
//
// Every command is a plain function named like its lower-case PolyBasic
// name. The compiler has already converted the arguments to the types in
// the signature (src/compiler/builtins.js), so Ints arrive as whole numbers,
// Floats as numbers and Strings as strings.

import { runtimeError } from './errors.js';

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

// The random generator is the Park-Miller "minimal standard" generator
// (the one Blitz used), so a given SeedRnd always gives the same sequence
// on every platform.
const RND_A = 48271;
const RND_M = 2147483647;
const RND_Q = 44488;
const RND_R = 3399;

export function createCoreCommands(rt)
{
  let seed = 0x1234;

  const random = () =>
  {
    seed = RND_A * (seed % RND_Q) - RND_R * Math.floor(seed / RND_Q);
    if (seed < 0) seed += RND_M;
    return (seed & 65535) / 65536 + 0.5 / 65536;
  };

  const needCount = (name, n) =>
  {
    if (n < 0) throw runtimeError(`${name} needs a count of 0 or more, not ${n}`);
  };

  return {
    // ---------------------------------------------------------- output
    print(text)
    {
      rt.host.write(text + '\n');
    },
    write(text)
    {
      rt.host.write(text);
    },
    debuglog(text)
    {
      rt.host.debug(text);
    },
    runtimeerror(message)
    {
      throw runtimeError(message);
    },

    // --------------------------------------------------------- strings
    len(text)
    {
      return text.length;
    },
    left(text, count)
    {
      needCount('Left', count);
      return text.slice(0, count);
    },
    right(text, count)
    {
      needCount('Right', count);
      return count === 0 ? '' : text.slice(-count);
    },
    mid(text, start, count)
    {
      if (start < 1) throw runtimeError(`Mid needs a start position of 1 or more, not ${start}`);
      return count < 0 ? text.slice(start - 1) : text.slice(start - 1, start - 1 + count);
    },
    instr(text, find, from)
    {
      if (from < 1) throw runtimeError(`Instr needs a start position of 1 or more, not ${from}`);
      return text.indexOf(find, from - 1) + 1;
    },
    replace(text, find, replacement)
    {
      return find === '' ? text : text.split(find).join(replacement);
    },
    upper(text)
    {
      return text.toUpperCase();
    },
    lower(text)
    {
      return text.toLowerCase();
    },
    trim(text)
    {
      return text.replace(/^[\s\0-\x1f]+|[\s\0-\x1f]+$/g, '');
    },
    lset(text, size)
    {
      needCount('LSet', size);
      return text.length >= size ? text.slice(0, size) : text.padEnd(size, ' ');
    },
    rset(text, size)
    {
      needCount('RSet', size);
      return text.length >= size ? text.slice(text.length - size) : text.padStart(size, ' ');
    },
    chr(code)
    {
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    },
    asc(text)
    {
      return text.length ? text.codePointAt(0) : -1;
    },
    hex(value)
    {
      return (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
    },
    bin(value)
    {
      return (value >>> 0).toString(2).padStart(32, '0');
    },
    string(text, count)
    {
      return count > 0 ? text.repeat(count) : '';
    },

    // ----------------------------------------------------------- maths
    sin: (d) => Math.sin(d * DEG),
    cos: (d) => Math.cos(d * DEG),
    tan: (d) => Math.tan(d * DEG),
    asin: (v) => Math.asin(v) * RAD,
    acos: (v) => Math.acos(v) * RAD,
    atan: (v) => Math.atan(v) * RAD,
    atan2: (y, x) => Math.atan2(y, x) * RAD,
    sqr: Math.sqrt,
    floor: Math.floor,
    ceil: Math.ceil,
    exp: Math.exp,
    log: Math.log,
    log10: Math.log10,

    // Rnd(10) gives 0 to 10, Rnd(5, 10) gives 5 to 10.
    rnd(from, to)
    {
      return random() * (to - from) + from;
    },
    // Rand(6) gives 1 to 6, Rand(-3, 3) gives -3 to 3.
    rand(from, to)
    {
      if (to < from) [from, to] = [to, from];
      return (Math.floor(random() * (to - from + 1)) + from) | 0;
    },
    seedrnd(value)
    {
      seed = (value & 0x7fffffff) || 1;
    },
    rndseed()
    {
      return seed;
    },

    // ------------------------------------------------------------ time
    millisecs()
    {
      return Math.floor(rt.host.now()) | 0;
    },
    // Update runs at a fixed rate, so the step is always the same; games
    // can still multiply speeds by it to read in "units per second".
    deltatime()
    {
      return rt.stepMs / 1000;
    },
    framecount()
    {
      return rt.frameCount;
    }
  };
}
