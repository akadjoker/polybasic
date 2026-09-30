// Ribbon trails: the sheet a moving blade leaves behind it (a sword's
// swing, a comet's tail, the wake of a jet), fading with age.
//
// The blade is 2 to 8 entities strung along it. After every step each
// one's world position is sampled, as often as the fastest of them has
// moved `step` units, and the ribbon is the surface between the lines they
// trace. Between samples it follows ONE smooth curve through the middle of
// the blade, every point keeping its offset from it: curves of their own
// would cross on a fast reversal and fold the ribbon over. The texture's U
// runs across the blade, V along the distance travelled.

import { MeshData } from './mesh.js';
import { Aabb } from '../math/aabb.js';

export const MAX_BLADE = 8;
// Enough for a fast swing to keep its whole life; if even these run out,
// the oldest kept sample becomes the faded end, so the tail still fades
// out instead of stopping short.
export const MAX_SAMPLES = 256;

// Colours come as 0..255 on screen and are kept linear for the mesh.
const linear = (c) =>
{
  const v = Math.max(0, Math.min(255, c)) / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};

export class Trail
{
  constructor(entity, blade)
  {
    this.entity = entity;        // the trail's own entity, which carries the mesh
    this.blade = blade;          // [Entity], base first
    this.samples = [];           // { points: [[x, y, z]], age, distance }, oldest first
    this.last = null;            // blade points the sampling has reached
    this.current = null;         // blade points now (drawn up to, not sampled yet)
    this.distance = 0;
    this.currentDistance = 0;
    this.seeded = false;
    this.emitting = true;
    this.life = 0.35;            // seconds a sample lasts
    this.step = 0.08;            // units the fastest point moves between samples
    this.smooth = 12;            // pieces between two samples
    this.start = [1, 1, 1, 1];   // linear RGBA at the head
    this.end = [1, 1, 1, 0];     // and where it has faded out
    this.fadeSet = false;        // until TrailFadeColor, the tail fades in the head's colour
    this.mesh = new MeshData([], [], [], []);
    this.mesh.colors = new Float32Array(0);
  }

  setColors(r1, g1, b1, a1, r2, g2, b2, a2)
  {
    this.start = [linear(r1), linear(g1), linear(b1), Math.max(0, Math.min(1, a1))];
    this.end = [linear(r2), linear(g2), linear(b2), Math.max(0, Math.min(1, a2))];
  }

  setEmitting(on)
  {
    if (this.emitting === on) return;
    // Stopping keeps the last stretch it had reached.
    if (!on && this.current && this.samples.length && this.moved(this.current, this.samples[this.samples.length - 1].points) > 1e-4)
    {
      this.push(this.current, this.currentDistance);
    }
    this.emitting = on;
    this.seeded = false;
    this.current = null;
  }

  clear()
  {
    this.samples.length = 0;
    this.distance = 0;
    this.currentDistance = 0;
    this.seeded = false;
    this.current = null;
    this.build();
  }

  // How far the furthest-moving point of two blade positions is apart.
  moved(a, b)
  {
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1], a[i][2] - b[i][2]));
    return d;
  }

  push(points, distance)
  {
    if (this.samples.length === MAX_SAMPLES) this.samples.shift();
    this.samples.push({ points: points.map((p) => p.slice()), age: 0, distance });
  }

  // One step of `dt` seconds, after the world has moved.
  update(dt)
  {
    for (const s of this.samples) s.age += dt;
    while (this.samples.length && this.samples[0].age >= this.life) this.samples.shift();
    const alive = this.blade.length >= 2 && this.blade.every((e) => e.alive);
    if (this.emitting && alive)
    {
      const now = this.blade.map((e) =>
      {
        const w = e.worldMatrix.e;
        return [w[12], w[13], w[14]];
      });
      this.current = now;
      if (!this.seeded || !this.samples.length)
      {
        this.push(now, this.distance);
        this.last = now.map((p) => p.slice());
        this.currentDistance = this.distance;
        this.seeded = true;
      }
      else
      {
        // The fastest point sets the pace: the tip of a swung blade covers
        // far more ground than its base.
        const travel = this.moved(now, this.last);
        const steps = travel > 0 ? Math.floor(travel / this.step) : 0;
        for (let k = 1; k <= steps; k++)
        {
          const t = Math.min(this.step * k / travel, 1);
          const stepped = this.last.map((p, i) => [p[0] + (now[i][0] - p[0]) * t, p[1] + (now[i][1] - p[1]) * t, p[2] + (now[i][2] - p[2]) * t]);
          this.distance += this.moved(stepped, this.samples[this.samples.length - 1].points);
          this.push(stepped, this.distance);
        }
        if (steps > 0)
        {
          const t = Math.min(this.step * steps / travel, 1);
          this.last = this.last.map((p, i) => [p[0] + (now[i][0] - p[0]) * t, p[1] + (now[i][1] - p[1]) * t, p[2] + (now[i][2] - p[2]) * t]);
        }
        const tail = this.samples[this.samples.length - 1];
        this.currentDistance = tail.distance + this.moved(now, tail.points);
      }
    }
    this.build();
  }

  // The sample at `index`, the blade as it is now just past the last one.
  renderSample(index)
  {
    if (index < this.samples.length) return this.samples[index];
    return { points: this.current, age: 0, distance: this.currentDistance };
  }

  centre(sample)
  {
    const c = [0, 0, 0];
    for (const p of sample.points)
    {
      c[0] += p[0];
      c[1] += p[1];
      c[2] += p[2];
    }
    const n = sample.points.length;
    return [c[0] / n, c[1] / n, c[2] / n];
  }

  // Between `from` and `to`: one Hermite curve through the blade's middle,
  // with tangents kept short where the path turns sharply, and the points'
  // offsets from the middle blended smoothly. build() does the same inline,
  // for speed; the tests hold the two to each other.
  interpolate(before, from, to, after, t)
  {
    const tangent = (p, q, r) =>
    {
      const inc = [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      const out = [r[0] - q[0], r[1] - q[1], r[2] - q[2]];
      const li = Math.hypot(...inc);
      const lo = Math.hypot(...out);
      if (li < 1e-4 || lo < 1e-4 || inc[0] * out[0] + inc[1] * out[1] + inc[2] * out[2] <= 0) return [0, 0, 0];
      const d = [inc[0] / li + out[0] / lo, inc[1] / li + out[1] / lo, inc[2] / li + out[2] / lo];
      const ld = Math.hypot(...d);
      if (ld < 1e-4) return [0, 0, 0];
      const m = Math.min(li, lo) / ld;
      return [d[0] * m, d[1] * m, d[2] * m];
    };
    const cb = this.centre(before);
    const cf = this.centre(from);
    const ct = this.centre(to);
    const ca = this.centre(after);
    const tf = tangent(cb, cf, ct);
    const tt = tangent(cf, ct, ca);
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    const centre = [0, 1, 2].map((n) => h00 * cf[n] + h10 * tf[n] + h01 * ct[n] + h11 * tt[n]);
    const blend = t * t * (3 - 2 * t);
    const points = from.points.map((p, i) => [0, 1, 2].map((n) =>
    {
      const a = p[n] - cf[n];
      const b = to.points[i][n] - ct[n];
      return centre[n] + a + (b - a) * blend;
    }));
    return { points, age: from.age + (to.age - from.age) * t, distance: from.distance + (to.distance - from.distance) * t };
  }

  // Rebuilds the mesh from the samples: two triangles per piece and per
  // gap between blade points, coloured by age. Written for speed: the
  // middles and tangents are worked out once per sample, and everything
  // goes straight into arrays of the right size.
  build()
  {
    let count = this.samples.length;
    if (this.current && count && this.moved(this.current, this.samples[count - 1].points) > 1e-4) count++;
    const strips = this.blade.length - 1;
    const pieces = count >= 2 ? (count - 1) * this.smooth : 0;
    const corners = pieces * strips * 6;
    const positions = new Float32Array(corners * 3);
    const uvs = new Float32Array(corners * 2);
    const colors = new Float32Array(corners * 4);
    if (pieces)
    {
      const n = this.blade.length;
      const samples = [];
      for (let i = 0; i < count; i++) samples.push(this.renderSample(i));
      // Middles and limited tangents of the samples.
      const mid = new Float64Array(count * 3);
      for (let i = 0; i < count; i++)
      {
        const c = this.centre(samples[i]);
        mid[i * 3] = c[0];
        mid[i * 3 + 1] = c[1];
        mid[i * 3 + 2] = c[2];
      }
      const tan = new Float64Array(count * 3);
      for (let i = 0; i < count; i++)
      {
        const p = Math.max(i - 1, 0);
        const q = Math.min(i + 1, count - 1);
        const ix = mid[i * 3] - mid[p * 3];
        const iy = mid[i * 3 + 1] - mid[p * 3 + 1];
        const iz = mid[i * 3 + 2] - mid[p * 3 + 2];
        const ox = mid[q * 3] - mid[i * 3];
        const oy = mid[q * 3 + 1] - mid[i * 3 + 1];
        const oz = mid[q * 3 + 2] - mid[i * 3 + 2];
        const li = Math.hypot(ix, iy, iz);
        const lo = Math.hypot(ox, oy, oz);
        if (li < 1e-4 || lo < 1e-4 || ix * ox + iy * oy + iz * oz <= 0) continue;
        const dx = ix / li + ox / lo;
        const dy = iy / li + oy / lo;
        const dz = iz / li + oz / lo;
        const ld = Math.hypot(dx, dy, dz);
        if (ld < 1e-4) continue;
        const m = Math.min(li, lo) / ld;
        tan[i * 3] = dx * m;
        tan[i * 3 + 1] = dy * m;
        tan[i * 3 + 2] = dz * m;
      }
      const first = samples[0].distance;
      const span = Math.max(samples[count - 1].distance - first, 1e-4);
      const oldest = this.samples.length ? this.samples[0].age : 0;
      const life = this.samples.length === MAX_SAMPLES ? Math.max(oldest, 1e-4) : this.life;
      // One cross-section of the ribbon: the blade's points, age, distance.
      const sectionA = new Float64Array(n * 3);
      const sectionB = new Float64Array(n * 3);
      let ageA = 0;
      let ageB = 0;
      let distA = 0;
      let distB = 0;
      const at = (out, seg, t) =>
      {
        const from = samples[seg];
        const to = samples[seg + 1];
        const t2 = t * t;
        const t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        const blend = t2 * (3 - 2 * t);
        const f = seg * 3;
        const g = f + 3;
        for (let k = 0; k < 3; k++)
        {
          const centre = h00 * mid[f + k] + h10 * tan[f + k] + h01 * mid[g + k] + h11 * tan[g + k];
          for (let i = 0; i < n; i++)
          {
            const a = from.points[i][k] - mid[f + k];
            const b = to.points[i][k] - mid[g + k];
            out[i * 3 + k] = centre + a + (b - a) * blend;
          }
        }
        return [from.age + (to.age - from.age) * t, from.distance + (to.distance - from.distance) * t];
      };
      let v = 0;
      const put = (section, i, u, age, dist) =>
      {
        const fade = Math.max(0, Math.min(1, 1 - age / life));
        positions[v * 3] = section[i * 3];
        positions[v * 3 + 1] = section[i * 3 + 1];
        positions[v * 3 + 2] = section[i * 3 + 2];
        uvs[v * 2] = u;
        uvs[v * 2 + 1] = (dist - first) / span;
        for (let k = 0; k < 4; k++) colors[v * 4 + k] = this.end[k] + (this.start[k] - this.end[k]) * fade;
        v++;
      };
      for (let seg = 0; seg + 1 < count; seg++)
      {
        [ageA, distA] = at(sectionA, seg, 0);
        for (let d = 1; d <= this.smooth; d++)
        {
          [ageB, distB] = at(sectionB, seg, d / this.smooth);
          for (let i = 0; i < strips; i++)
          {
            const u0 = i / strips;
            const u1 = (i + 1) / strips;
            put(sectionA, i, u0, ageA, distA);
            put(sectionA, i + 1, u1, ageA, distA);
            put(sectionB, i, u0, ageB, distB);
            put(sectionB, i + 1, u1, ageB, distB);
            put(sectionB, i, u0, ageB, distB);
            put(sectionA, i + 1, u1, ageA, distA);
          }
          sectionA.set(sectionB);
          ageA = ageB;
          distA = distB;
        }
      }
    }
    const m = this.mesh;
    m.positions = positions;
    // Lit by nothing (FX_FULLBRIGHT): the normals only need to exist.
    if (m.normals.length !== positions.length) m.normals = new Float32Array(positions.length);
    m.uvs = uvs;
    m.colors = colors;
    if (m.indices.length !== corners)
    {
      m.indices = new Uint32Array(corners);
      for (let i = 0; i < corners; i++) m.indices[i] = i;
    }
    m.submeshes = [{ start: 0, count: corners, material: 0 }];
    m.bounds = new Aabb().fromPositions(positions);
    m.version++;
  }
}
