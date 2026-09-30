// How a sound in the 3D world is heard: louder close by, from the left or
// the right, and higher while it comes closer (Doppler). Worked out here,
// the same in Node and in the browser, from the listener's and the
// emitter's world matrices; the backends only apply the result.
//
// Settings (CreateListener):
//   rolloff    how fast the sound fades with distance (0: it does not)
//   doppler    how strong the Doppler effect is (0: none, 1: real)
//   distance   how many metres one world unit is (PolyBasic's default is
//              0.5, as for physics: the built-in shapes are 2 units, a
//              metre, across)

export const SPEED_OF_SOUND = 343;   // metres a second

// The sound at `emitter` (a world matrix) as heard by the listener (a world
// matrix): { gain, pan, rate }. The velocities are in world units a
// second; pass zeros where they are not known.
export function hear(listener, emitter, listenerVelocity, emitterVelocity, settings)
{
  const l = listener.e;
  const s = emitter.e;
  const metres = settings.distance > 0 ? settings.distance : 1;
  // From the listener to the sound, in metres.
  const dx = (s[12] - l[12]) * metres;
  const dy = (s[13] - l[13]) * metres;
  const dz = (s[14] - l[14]) * metres;
  const d = Math.hypot(dx, dy, dz);

  // Fades as 1 / distance past one metre (the "inverse" distance model).
  const rolloff = Math.max(0, settings.rolloff);
  const gain = 1 / (1 + rolloff * (Math.max(d, 1) - 1));

  // Left or right: how much of the way to the sound is along the
  // listener's own X axis (its right).
  let pan = 0;
  if (d > 1e-6)
  {
    const rx = l[0];
    const ry = l[1];
    const rz = l[2];
    const rl = Math.hypot(rx, ry, rz) || 1;
    pan = Math.max(-1, Math.min(1, (dx * rx + dy * ry + dz * rz) / (rl * d)));
  }

  // Doppler: the parts of both velocities along the line between them.
  let rate = 1;
  const doppler = Math.max(0, settings.doppler);
  if (doppler > 0 && d > 1e-6)
  {
    const ux = dx / d;
    const uy = dy / d;
    const uz = dz / d;
    const limit = SPEED_OF_SOUND * 0.5;
    const clamp = (v) => Math.max(-limit, Math.min(limit, v));
    const toward = clamp(doppler * metres * (listenerVelocity[0] * ux + listenerVelocity[1] * uy + listenerVelocity[2] * uz));
    const away = clamp(doppler * metres * (emitterVelocity[0] * ux + emitterVelocity[1] * uy + emitterVelocity[2] * uz));
    rate = (SPEED_OF_SOUND + toward) / (SPEED_OF_SOUND + away);
  }
  return { gain, pan, rate };
}
