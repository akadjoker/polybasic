// A tiny benchmark: confirms the generated code runs at plain JavaScript
// speed (no per-statement bookkeeping, no async in hot paths).
//
//   node tests/bench.mjs

import { compile } from '../src/compiler/index.js';
import { loadProgram, runProgram, CaptureHost } from '../src/runtime/index.js';

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
