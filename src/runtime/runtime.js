// The runtime object handed to a compiled program's `create($rt)`.
//
// It holds the helpers the generated code calls (integer division with a
// zero check, bounds checks, Type object lists, conversions), the Data table
// and the command implementations. A fresh runtime is created for every run,
// so two programs never share state.

import { floatToInt, stringToInt, stringToFloat, floatToString } from './convert.js';
import { runtimeError, EndSignal } from './errors.js';
import { createCoreCommands } from './commands.js';

// The fixed time step of Update, in milliseconds.
export const STEP_MS = 1000 / 60;

export function createRuntime(host, options = {})
{
  const rt = {
    host,
    frameCount: 0,
    stepMs: STEP_MS,
    data: { values: [], kinds: [], next: 0 },
    helpers: null,
    commands: null,
    typeList,
    setData(values, kinds)
    {
      rt.data = { values, kinds, next: 0 };
    },
    restore()
    {
      rt.data.next = 0;
    }
  };
  rt.helpers = createHelpers(rt);
  rt.commands = createCoreCommands(rt);
  // Later phases (graphics, 3D, input) add their commands here.
  for (const extra of options.commands || []) Object.assign(rt.commands, extra(rt));
  return rt;
}

// Each Type keeps its objects in a doubly linked list, in creation order
// (For Each walks it from First to Last). The list is found through the
// class prototype so `New` needs no extra argument.
function typeList(ctor, name)
{
  const list = { name, first: null, last: null };
  ctor.prototype.$list = list;
  return list;
}

const ARRAY_KINDS = {
  int: (n) => new Int32Array(n),
  float: (n) => new Float64Array(n),
  string: (n) => new Array(n).fill(''),
  object: (n) => new Array(n).fill(null)
};

// A Dim array: flat storage plus the size of each dimension. `Dim a(10)`
// holds indices 0 to 10.
class DimArray
{
  constructor(kind, sizes, name)
  {
    this.name = name;
    this.created = sizes.length > 0;
    this.dims = sizes.map((n) =>
    {
      if (n < -1) throw runtimeError(`Array '${name}' cannot have a negative size (${n})`);
      return n + 1;
    });
    this.s0 = this.dims[0] || 0;
    this.s1 = this.dims[1] || 0;
    let total = 1;
    for (const d of this.dims) total *= d;
    if (total > 0x7fffffff) throw runtimeError(`Array '${name}' is too big`);
    this.data = ARRAY_KINDS[kind](this.created ? total : 0);
  }
}

function createHelpers(rt)
{
  const outOfBounds = (i, n, name) =>
  {
    if (name && n === 0) return runtimeError(`Array '${name}' has not been created with Dim yet`);
    return runtimeError(`Index ${i} is out of bounds${name ? ` for array '${name}'` : ''} (valid: 0 to ${n - 1})`);
  };

  const unlink = (o) =>
  {
    const list = o.$list;
    if (o.$prev !== null) o.$prev.$next = o.$next;
    else list.first = o.$next;
    if (o.$next !== null) o.$next.$prev = o.$prev;
    else list.last = o.$prev;
  };

  const append = (o) =>
  {
    const list = o.$list;
    o.$prev = list.last;
    o.$next = null;
    if (list.last !== null) list.last.$next = o;
    else list.first = o;
    list.last = o;
  };

  const obj = (o) =>
  {
    if (o === null) throw runtimeError('Object is Null (it was never created, or was set to Null)');
    if (!o.$alive) throw runtimeError('Object has been deleted');
    return o;
  };

  const readValue = () =>
  {
    const d = rt.data;
    if (d.next >= d.values.length) throw runtimeError('Out of Data: Read has used every Data value');
    const i = d.next++;
    return [d.values[i], d.kinds[i]];
  };

  return {
    $idiv(a, b)
    {
      if (b === 0) throw runtimeError('Division by zero');
      return (a / b) | 0;
    },
    $imod(a, b)
    {
      if (b === 0) throw runtimeError('Division by zero (Mod 0)');
      return (a % b) | 0;
    },
    $f2i: floatToInt,
    $s2i: stringToInt,
    $s2f: stringToFloat,
    $fstr: floatToString,

    $ix(i, n)
    {
      if (i >>> 0 >= n) throw outOfBounds(i, n, null);
      return i;
    },
    $ix1(a, i)
    {
      if (i >>> 0 >= a.s0) throw outOfBounds(i, a.s0, a.name);
      return i;
    },
    $ix2(a, i, j)
    {
      if (i >>> 0 >= a.s0) throw outOfBounds(i, a.s0, a.name);
      if (j >>> 0 >= a.s1) throw outOfBounds(j, a.s1, a.name);
      return i * a.s1 + j;
    },
    $ixn(a, idx)
    {
      if (idx.length !== a.dims.length) throw outOfBounds(idx[0], 0, a.name);
      let flat = 0;
      for (let k = 0; k < idx.length; k++)
      {
        if (idx[k] >>> 0 >= a.dims[k]) throw outOfBounds(idx[k], a.dims[k], a.name);
        flat = flat * a.dims[k] + idx[k];
      }
      return flat;
    },
    $dim(kind, sizes, name)
    {
      return new DimArray(kind, sizes, name);
    },
    $vec(kind, n)
    {
      return ARRAY_KINDS[kind](n);
    },

    // Objects. A deleted object behaves as Null: it compares equal to Null
    // and using it is an error. It keeps its `$next` link so a For Each
    // loop that deletes the current object can still move on.
    $obj: obj,
    $new(o)
    {
      append(o);
      return o;
    },
    $delete(o)
    {
      if (o === null || !o.$alive) return;
      unlink(o);
      o.$alive = false;
    },
    $deleteEach(list)
    {
      for (let o = list.first; o !== null; o = o.$next) o.$alive = false;
      list.first = null;
      list.last = null;
    },
    $insert(o, target, before)
    {
      obj(o);
      obj(target);
      if (o === target) return;
      if (o.$list !== target.$list) throw runtimeError('Insert cannot move an object into a list of another Type');
      unlink(o);
      const list = o.$list;
      if (before)
      {
        o.$prev = target.$prev;
        o.$next = target;
        if (target.$prev !== null) target.$prev.$next = o;
        else list.first = o;
        target.$prev = o;
      }
      else
      {
        o.$next = target.$next;
        o.$prev = target;
        if (target.$next !== null) target.$next.$prev = o;
        else list.last = o;
        target.$next = o;
      }
    },
    $next(o)
    {
      if (o === null) return null;
      let n = o.$next;
      while (n !== null && !n.$alive) n = n.$next;
      return n;
    },
    $after(o)
    {
      return obj(o).$next;
    },
    $before(o)
    {
      return obj(o).$prev;
    },
    $isNull(o)
    {
      return o === null || !o.$alive;
    },
    $same(a, b)
    {
      const aNull = a === null || !a.$alive;
      const bNull = b === null || !b.$alive;
      return aNull || bNull ? aNull && bNull : a === b;
    },

    // Data / Read. Each value keeps the type it was written with and is
    // converted to the type of the variable it is read into.
    $readInt()
    {
      const [v, kind] = readValue();
      return kind === 'int' ? v : kind === 'float' ? floatToInt(v) : stringToInt(v);
    },
    $readFloat()
    {
      const [v, kind] = readValue();
      return kind === 'string' ? stringToFloat(v) : v;
    },
    $readString()
    {
      const [v, kind] = readValue();
      return kind === 'string' ? v : kind === 'int' ? String(v) : floatToString(v);
    },

    $end()
    {
      throw new EndSignal();
    }
  };
}
