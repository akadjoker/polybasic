// Makes the PolyBasic trailer: captures the scenes of tools/trailer/scenes.mjs
// frame by frame, draws the cards, and puts video and narration together
// with ffmpeg.
//
//   node tools/trailer/trailer.mjs --work DIR --voices name=DIR[,name=DIR...] [--out DIR] [--fps 30]
//
// DIR of a voice holds <scene id>.wav for every scene (see make-voice.py).
// Needs ffmpeg: set TRAILER_FFMPEG to its path. Frames already in
// <work>/frames are kept, so a stopped run goes on where it was.

import { mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { SCENES } from './scenes.mjs';
import { serve, capture } from './capture.mjs';
import { renderCards } from './cards.mjs';

const FFMPEG = process.env.TRAILER_FFMPEG || 'ffmpeg';
const LEAD = 0.4;       // seconds before the narration starts in a scene
const TAIL = 1.0;       // seconds of picture after it
const FADE = 0.3;

function args()
{
  const out = { fps: 30 };
  const a = process.argv.slice(2);
  for (let i = 0; i < a.length; i += 2) out[a[i].replace(/^--/, '')] = a[i + 1];
  if (!out.work || !out.voices) throw new Error('usage: node tools/trailer/trailer.mjs --work DIR --voices name=DIR[,name=DIR...] [--out DIR] [--fps 30]');
  out.fps = Number(out.fps);
  out.work = resolve(out.work);
  out.out = resolve(out.out || out.work);
  out.voices = out.voices.split(',').map((v) => ({ name: v.split('=')[0], dir: resolve(v.split('=')[1]) }));
  return out;
}

// Seconds of audio in a PCM .wav file.
async function wavSeconds(file)
{
  const b = await readFile(file);
  let at = 12;
  let rate = 0;
  let bytesPerFrame = 0;
  while (at + 8 <= b.length)
  {
    const id = b.toString('latin1', at, at + 4);
    const size = b.readUInt32LE(at + 4);
    if (id === 'fmt ')
    {
      rate = b.readUInt32LE(at + 12);
      bytesPerFrame = b.readUInt16LE(at + 20);
    }
    if (id === 'data') return Math.min(size, b.length - at - 8) / (rate * bytesPerFrame);
    at += 8 + size + (size & 1);
  }
  throw new Error(`${file}: no audio data`);
}

function ffmpeg(argv)
{
  return new Promise((ok, fail) =>
  {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...argv], { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg ${argv.join(' ')} failed (${code})`))));
  });
}

// How long each scene is: its narration (the longest of the voices) plus
// the lead and tail, or its minimum.
async function plan(voices, fps)
{
  const scenes = [];
  let start = 0;
  for (const scene of SCENES)
  {
    let said = 0;
    for (const v of voices) said = Math.max(said, await wavSeconds(join(v.dir, `${scene.id}.wav`)));
    const seconds = Math.max(scene.min, LEAD + said + TAIL);
    const frames = Math.round(seconds * fps);
    scenes.push({ ...scene, said, frames, seconds: frames / fps, start });
    start += frames / fps;
  }
  return { scenes, total: start };
}

// Presses and releases keys, and clicks, on the frames a clip asks for.
function inputsFor(clip, fps)
{
  const at = (s) => Math.round(s * fps);
  const events = new Map();
  const add = (frame, fn) => events.set(frame, [...(events.get(frame) || []), fn]);
  for (const [key, from, to] of clip.keys || [])
  {
    add(at(from), (page) => page.keyboard.down(key));
    add(at(to), (page) => page.keyboard.up(key).catch(() => {}));
  }
  for (const [x, y, when] of clip.clicks || [])
  {
    add(at(when), async (page) =>
    {
      await page.mouse.move(x, y);
      await page.mouse.down();
    });
    add(at(when) + 2, (page) => page.mouse.up());
  }
  return async (page, frame) =>
  {
    for (const fn of events.get(frame) || []) await fn(page);
  };
}

async function main()
{
  const o = args();
  await mkdir(o.out, { recursive: true });
  const { scenes, total } = await plan(o.voices, o.fps);
  for (const s of scenes) console.log(`${s.id.padEnd(10)} ${s.seconds.toFixed(2)} s (narration ${s.said.toFixed(2)} s)`);
  console.log(`total ${total.toFixed(1)} s`);

  const { server, base } = await serve();
  const browser = await chromium.launch();
  try
  {
    await renderCards({ browser, base, outDir: join(o.work, 'cards') });
    for (const s of scenes)
    {
      if (!s.clips) continue;
      const each = Math.floor(s.frames / s.clips.length);
      for (let c = 0; c < s.clips.length; c++)
      {
        const dir = join(o.work, 'frames', s.id, String(c));
        const frames = c === s.clips.length - 1 ? s.frames - each * c : each;
        const have = existsSync(dir) ? (await readdir(dir)).length : 0;
        if (have === frames)
        {
          console.log(`${s.id}/${c}: ${frames} frames kept`);
          continue;
        }
        await rm(dir, { recursive: true, force: true });
        const clip = s.clips[c];
        const t = Date.now();
        await capture({ base, browser, program: clip.program, outDir: dir, frames, fps: o.fps, onFrame: inputsFor(clip, o.fps) });
        console.log(`${s.id}/${c}: ${frames} frames of ${clip.program} in ${((Date.now() - t) / 1000).toFixed(1)} s`);
      }
    }
  }
  finally
  {
    await browser.close();
    server.close();
  }

  // One video file for each scene.
  const parts = [];
  for (const s of scenes)
  {
    const file = join(o.work, `scene-${s.id}.mp4`);
    const fade = `fade=t=in:st=0:d=${FADE},fade=t=out:st=${(s.seconds - FADE).toFixed(3)}:d=${FADE}`;
    const encode = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '21', '-preset', 'medium', '-r', String(o.fps)];
    if (s.card)
    {
      const zoom = `zoompan=z='min(zoom+0.0004,1.05)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1280x720:fps=${o.fps}`;
      const card = ['-loop', '1', '-framerate', String(o.fps), '-i', join(o.work, 'cards', `${s.card}.png`)];
      if (s.live)
      {
        // The frames of another scene, cropped to 4:3 and put in the card's screen.
        const [x, y, w, h] = s.live.box;
        const screen = ['-framerate', String(o.fps), '-i', join(o.work, 'frames', s.live.scene, '0', '%05d.jpg')];
        const graph = `[1:v]crop=${s.live.crop},scale=${w}:${h}[screen];[0:v][screen]overlay=${x}:${y}[card];[card]${zoom},${fade}[v]`;
        await ffmpeg([...card, ...screen, '-filter_complex', graph, '-map', '[v]', '-t', s.seconds.toFixed(3), ...encode, file]);
      }
      else await ffmpeg([...card, '-t', s.seconds.toFixed(3), '-vf', `${zoom},${fade}`, ...encode, file]);
    }
    else
    {
      const lists = [];
      for (let c = 0; c < s.clips.length; c++) lists.push(['-framerate', String(o.fps), '-i', join(o.work, 'frames', s.id, String(c), '%05d.jpg')]);
      const joined = s.clips.map((_, c) => `[${c}:v]`).join('') + `concat=n=${s.clips.length}:v=1:a=0,${fade}[v]`;
      await ffmpeg([...lists.flat(), '-filter_complex', joined, '-map', '[v]', ...encode, file]);
    }
    parts.push(file);
  }
  const list = join(o.work, 'scenes.txt');
  await writeFile(list, parts.map((f) => `file '${f}'`).join('\n'));
  const silent = join(o.work, 'trailer-silent.mp4');
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);

  // The narration of each voice, every scene's line placed at its start.
  for (const v of o.voices)
  {
    const inputs = scenes.flatMap((s) => ['-i', join(v.dir, `${s.id}.wav`)]);
    const delays = scenes.map((s, i) => `[${i}:a]aresample=48000,adelay=${Math.round((s.start + LEAD) * 1000)}|${Math.round((s.start + LEAD) * 1000)}[a${i}]`);
    const mix = `${scenes.map((_, i) => `[a${i}]`).join('')}amix=inputs=${scenes.length}:normalize=0,volume=0.8,alimiter=limit=0.9,apad[a]`;
    const narration = join(o.work, `narration-${v.name}.wav`);
    await ffmpeg([...inputs, '-filter_complex', `${delays.join(';')};${mix}`, '-map', '[a]', '-t', total.toFixed(3), narration]);
    const final = join(o.out, `polybasic-trailer-${v.name}.mp4`);
    await ffmpeg(['-i', silent, '-i', narration, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', final]);
    console.log(`wrote ${final}`);
  }
}

main().catch((e) =>
{
  console.error(e.stack || e.message);
  process.exit(1);
});
