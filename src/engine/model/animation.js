// Playing a model's node animations: each channel moves one node entity
// (its position, rotation or scale, relative to its parent) along
// keyframes, with the interpolation the file asks for.

export const ANIM_STOP = 0;
export const ANIM_LOOP = 1;
export const ANIM_ONCE = 2;
export const ANIM_PINGPONG = 3;

// The value of a channel at time t (seconds), written into out (3 or 4
// numbers).
export function sample(channel, t, out)
{
  const { times, values, interpolation } = channel;
  const size = channel.path === 'rotation' ? 4 : 3;
  const cubic = interpolation === 'CUBICSPLINE';
  // Cubic spline keys hold in-tangent, value, out-tangent.
  const stride = cubic ? size * 3 : size;
  const valueAt = (k, i) => values[k * stride + (cubic ? size : 0) + i];
  const n = times.length;
  if (n === 0) return out;
  if (t <= times[0] || n === 1)
  {
    for (let i = 0; i < size; i++) out[i] = valueAt(0, i);
    return out;
  }
  if (t >= times[n - 1])
  {
    for (let i = 0; i < size; i++) out[i] = valueAt(n - 1, i);
    return out;
  }
  // The last key at or before t.
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1)
  {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const t0 = times[lo];
  const dt = times[hi] - t0;
  const u = dt > 0 ? (t - t0) / dt : 0;

  if (interpolation === 'STEP')
  {
    for (let i = 0; i < size; i++) out[i] = valueAt(lo, i);
    return out;
  }
  if (cubic)
  {
    // Hermite spline (glTF 2.0, appendix C).
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    for (let i = 0; i < size; i++)
    {
      const p0 = valueAt(lo, i);
      const p1 = valueAt(hi, i);
      const m0 = values[lo * stride + size * 2 + i] * dt;   // out-tangent of lo
      const m1 = values[hi * stride + i] * dt;              // in-tangent of hi
      out[i] = h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
    }
    if (size === 4) normalize4(out);
    return out;
  }
  if (size === 4) return slerp(out, lo, hi, u, valueAt);
  for (let i = 0; i < size; i++) out[i] = valueAt(lo, i) + (valueAt(hi, i) - valueAt(lo, i)) * u;
  return out;
}

function slerp(out, a, b, u, valueAt)
{
  let bx = valueAt(b, 0);
  let by = valueAt(b, 1);
  let bz = valueAt(b, 2);
  let bw = valueAt(b, 3);
  const ax = valueAt(a, 0);
  const ay = valueAt(a, 1);
  const az = valueAt(a, 2);
  const aw = valueAt(a, 3);
  let cos = ax * bx + ay * by + az * bz + aw * bw;
  // The short way round.
  if (cos < 0)
  {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  let wa;
  let wb;
  if (cos > 0.9995)
  {
    wa = 1 - u;
    wb = u;
  }
  else
  {
    const angle = Math.acos(cos);
    const s = Math.sin(angle);
    wa = Math.sin((1 - u) * angle) / s;
    wb = Math.sin(u * angle) / s;
  }
  out[0] = ax * wa + bx * wb;
  out[1] = ay * wa + by * wb;
  out[2] = az * wa + bz * wb;
  out[3] = aw * wa + bw * wb;
  return normalize4(out);
}

function normalize4(q)
{
  const len = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  for (let i = 0; i < 4; i++) q[i] /= len;
  return q;
}

// Moves the nodes of a model to where an animation has them at time t.
export function pose(model, animation, t)
{
  const v = [0, 0, 0, 0];
  for (const ch of animation.channels)
  {
    const e = model.nodes[ch.node];
    if (!e || !e.alive) continue;
    sample(ch, t, v);
    if (ch.path === 'translation') e.position.set(v[0], v[1], v[2]);
    else if (ch.path === 'rotation') e.rotation.set(v[0], v[1], v[2], v[3]);
    else if (ch.path === 'scale') e.scale.set(v[0], v[1], v[2]);
    e.worldDirty = false;
    e.touch();
  }
}

// Advances a playing animation by dt seconds. Returns false when it has
// stopped (ANIM_ONCE reached the end).
export function advance(state, animation, dt)
{
  const length = animation.duration;
  if (length <= 0)
  {
    state.time = 0;
    return state.mode !== ANIM_ONCE;
  }
  if (state.mode === ANIM_LOOP)
  {
    state.time = ((state.time + dt * state.speed) % length + length) % length;
    return true;
  }
  if (state.mode === ANIM_ONCE)
  {
    state.time += dt * state.speed;
    if (state.time >= length || state.time <= 0)
    {
      state.time = Math.max(0, Math.min(length, state.time));
      return false;
    }
    return true;
  }
  // Ping-pong: forwards, then backwards, and so on.
  state.time += dt * state.speed * state.direction;
  while (state.time > length || state.time < 0)
  {
    if (state.time > length) state.time = 2 * length - state.time;
    else state.time = -state.time;
    state.direction = -state.direction;
  }
  return true;
}
