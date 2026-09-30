// Value conversions shared by the runtime and the compiler's constant
// folder, so `Const X = 2.5` folds to exactly what the program would compute.
//
// PolyBasic values are plain JavaScript values: Int is a number kept in
// 32-bit range (operations wrap), Float is a double, String is a string.

// Float to Int rounds to the nearest integer, halves to even, the way the
// FPU of Blitz's day did: Int(2.5) = 2, Int(3.5) = 4, Int(-2.5) = -2.
export function floatToInt(x)
{
  if (x !== x) return 0;
  let r = Math.round(x);
  if (r - x === 0.5 && (r % 2 !== 0)) r -= 1;
  return r | 0;
}

// String to Int reads a leading whole number and ignores the rest:
// "42abc" is 42, "abc" is 0.
export function stringToInt(s)
{
  const n = parseInt(s, 10);
  return n === n ? n | 0 : 0;
}

export function stringToFloat(s)
{
  const n = parseFloat(s);
  return n === n ? n : 0;
}

// Floats print with 6 significant digits and always keep a decimal point,
// so 10.0 prints as "10.0", 1/3 as "0.333333" and 1e10 as "1.0e+10".
// This keeps output stable across platforms and readable for beginners.
export function floatToString(x)
{
  if (x !== x) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return '0.0';

  const exp = Math.floor(Math.log10(Math.abs(Number(x.toPrecision(6)))));
  if (exp < -4 || exp >= 8)
  {
    // Scientific form: mantissa trimmed like the plain form.
    const [mant, e] = x.toExponential(5).split('e');
    return trimZeros(mant) + 'e' + (e[0] === '-' ? '-' : '+') + e.slice(1).replace(/^[+-]/, '');
  }
  const decimals = Math.max(0, 5 - exp);
  return trimZeros(x.toFixed(decimals));
}

function trimZeros(text)
{
  if (!text.includes('.')) return text + '.0';
  text = text.replace(/0+$/, '');
  return text.endsWith('.') ? text + '0' : text;
}
