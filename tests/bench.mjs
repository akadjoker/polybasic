// A tiny benchmark: confirms the generated code runs at plain JavaScript
// speed (no per-statement bookkeeping, no async in hot paths), and times
// the engine's collisions and picking on a busy scene.
//
//   node tests/bench.mjs

import { compile } from '../src/compiler/index.js';
import { loadProgram, runProgram, CaptureHost } from '../src/runtime/index.js';
import { World } from '../src/engine/scene/world.js';
import { createPlane, createCube } from '../src/engine/scene/mesh.js';
import { Collisions } from '../src/engine/collide/collisions.js';
import { pickLine } from '../src/engine/collide/picking.js';
import { Vec3 } from '../src/engine/math/vec3.js';

const CASES = [
  {
    name: 'fib(27), recursive',
    source: `
Function Fib(n)
  If n < 2 Then Return n
  Return Fib(n - 1) + Fib(n - 2)
End Function
Print Fib(27)
`,
    reference()
    {
      const fib = (n) => (n < 2 ? n : (fib(n - 1) + fib(n - 2)) | 0);
      return fib(27);
    }
  },
  {
    name: '10M iteration Int loop',
    source: `
total = 0
For i = 1 To 10000000
  total = total + i Mod 7
Next
Print total
`,
    reference()
    {
      let total = 0;
      for (let i = 1; i <= 10000000; i++) total = (total + (i % 7)) | 0;
      return total;
    }
  },
  {
    name: '10M iteration Float loop',
    source: `
x# = 0
For i = 1 To 10000000
  x = x + Sin(i) * 0.5
Next
Print x
`,
    reference()
    {
      let x = 0;
      for (let i = 1; i <= 10000000; i++) x += Math.sin(i * Math.PI / 180) * 0.5;
      return x;
    }
  },
  {
    name: 'For Each over 1000 objects x 2000',
    source: `
Type P
  Field x#, v#
End Type
For i = 1 To 1000
  p.P = New P
  p\\v = i
Next
For frame = 1 To 2000
  For p.P = Each P
    p\\x = p\\x + p\\v * 0.001
  Next
Next
Print Int((First P)\\x)
`,
    reference()
    {
      const list = [];
      for (let i = 1; i <= 1000; i++) list.push({ x: 0, v: i });
      for (let f = 1; f <= 2000; f++) for (const p of list) p.x += p.v * 0.001;
      return Math.round(list[0].x);
    }
  },
  {
    name: 'Dim array sieve to 2M, 5 passes',
    source: `
Const N = 2000000
Dim flags(N)
For pass = 1 To 5
  For i = 0 To N : flags(i) = 1 : Next
  count = 0
  For i = 2 To N
    If flags(i)
      count = count + 1
      If i <= 1414
        j = i * i
        While j <= N
          flags(j) = 0
          j = j + i
        Wend
      EndIf
    EndIf
  Next
Next
Print count
`,
    reference()
    {
      const N = 2000000;
      const flags = new Int32Array(N + 1);
      let count = 0;
      for (let pass = 1; pass <= 5; pass++)
      {
        flags.fill(1);
        count = 0;
        for (let i = 2; i <= N; i++)
        {
          if (flags[i])
          {
            count++;
            if (i <= 1414) for (let j = i * i; j <= N; j += i) flags[j] = 0;
          }
        }
      }
      return count;
    }
  }
];

function time(fn)
{
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

for (const c of CASES)
{
  const { js } = compile(c.source, { file: 'bench.pb' });
  const module = await loadProgram(js);
  const host = new CaptureHost();
  const start = performance.now();
  await runProgram(module, host);
  const ms = performance.now() - start;
  let line = `${c.name.padEnd(36)} PolyBasic ${ms.toFixed(1).padStart(7)} ms`;
  if (c.reference)
  {
    const ref = time(c.reference);
    line += `   hand-written JS ${ref.ms.toFixed(1).padStart(7)} ms`;
  }
  console.log(`${line}   -> ${host.output.trim()}`);
}

// ------------------------------------------------------------- engine

// A bumpy ground of 8192 triangles, 50 boxes and 100 walkers with
// ellipsoids that bump into the ground, the boxes and each other.
function busyScene()
{
  const world = new World();
  const collisions = new Collisions(world);
  collisions.set(1, 2, 2, 3);
  collisions.set(1, 3, 3, 2);
  collisions.set(1, 1, 1, 2);
  const ground = world.createMesh(createPlane(64));
  ground.setScale(50, 1, 50);
  ground.collisionType = 2;
  ground.pickMode = 2;
  const m = ground.mesh;
  for (let i = 1; i < m.positions.length; i += 3) m.positions[i] = Math.sin(m.positions[i - 1] * 9) * 0.05;
  m.version++;
  for (let i = 0; i < 50; i++)
  {
    const b = world.createMesh(createCube());
    b.setPosition((i % 10) * 8 - 40, 1, Math.floor(i / 10) * 8 - 20, false);
    b.collisionType = 3;
    b.pickMode = 3;
  }
  const walkers = [];
  for (let i = 0; i < 100; i++)
  {
    const p = world.createEntity('pivot');
    p.radiusX = 0.4;
    p.radiusY = 0.8;
    p.collisionType = 1;
    p.pickMode = 1;
    p.setPosition((i % 10) * 7 - 32, 2, Math.floor(i / 10) * 7 - 32, false);
    walkers.push(p);
  }
  collisions.resetAll();
  return { world, collisions, walkers };
}

{
  const { collisions, walkers } = busyScene();
  const steps = 300;
  const start = performance.now();
  for (let s = 0; s < steps; s++)
  {
    for (const p of walkers) p.translate(Math.sin(s * 0.05 + p.id) * 0.15, -0.1, Math.cos(s * 0.05 + p.id) * 0.15, true);
    collisions.update();
  }
  const ms = (performance.now() - start) / steps;
  console.log(`${'collisions: 100 walkers, busy scene'.padEnd(36)} ${ms.toFixed(2).padStart(7)} ms per step`);
}

{
  const { world } = busyScene();
  const rays = 20000;
  let hits = 0;
  const start = performance.now();
  for (let i = 0; i < rays; i++)
  {
    const a = i * 0.618;
    const origin = new Vec3(Math.cos(a) * 30, 20, Math.sin(a) * 30);
    const line = new Vec3(-Math.cos(a) * 60, -25, -Math.sin(a) * 60);
    if (pickLine(world, origin, line, 0).entity) hits++;
  }
  const ms = performance.now() - start;
  console.log(`${'picking: rays across the busy scene'.padEnd(36)} ${(ms / rays * 1000).toFixed(1).padStart(7)} us per ray (${hits} of ${rays} hit)`);
}
