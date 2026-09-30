// Tiny assertion helpers for the unit tests.

export function assert(cond, message)
{
  if (!cond) throw new Error(message);
}

export function near(actual, expected, eps = 1e-6, what = 'value')
{
  if (Math.abs(actual - expected) > eps) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

export function nearAll(actual, expected, eps = 1e-6, what = 'values')
{
  const a = Array.from(actual);
  const e = Array.from(expected);
  if (a.length !== e.length) throw new Error(`${what}: length ${a.length} vs ${e.length}`);
  for (let i = 0; i < a.length; i++)
  {
    if (Math.abs(a[i] - e[i]) > eps) throw new Error(`${what}[${i}]: expected ${e[i]}, got ${a[i]}\n  expected ${e.map((v) => +v.toFixed(6)).join(', ')}\n  actual   ${a.map((v) => +v.toFixed(6)).join(', ')}`);
  }
}
