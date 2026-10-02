// Dead Field (examples/zombies.pb) played by bots on the headless engine:
// one aims at the nearest zombie's head and shoots, one stands still. The
// game is run as it is, with a bot added to it that sets where the player
// looks and when it fires.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compile, loadProgram, runProgram, CaptureHost, Engine } from '../../src/index.js';
import { nodeEngineOptions } from '../../src/node.js';
import { assert } from './assert.mjs';

const unit = [];
const test = (name, fn) => unit.push({ name, fn });

const FILE = fileURLToPath(new URL('../../examples/zombies.pb', import.meta.url));

// The game with a bot in front of its Update. `shoots`: whether the bot
// aims and fires.
function withBot(shoots)
{
  let source = readFileSync(FILE, 'utf8');
  source = source.replace('Function Update()\n  dt# = DeltaTime()', 'Function GameUpdate()\n  dt# = DeltaTime()');
  source = source.replace('If (KeyDown(KEY_F) Or', 'If (botFire Or KeyDown(KEY_F) Or');
  const bot = `
Global botFire

Function Update()
  botFire = False
  If FrameCount() = 2 Then NewGame
  If ${shoots ? 'True' : 'False'} And (state = GAME_WAVE Or state = GAME_REST)
    near# = 99999
    target.Zombie = Null
    For z.Zombie = Each Zombie
      If z\\state <> ZS_DYING And z\\state <> ZS_RISE
        dx# = EntityX(z\\pivot, True) - px
        dz# = EntityZ(z\\pivot, True) - pz
        d# = dx * dx + dz * dz
        If d < near Then near = d : target = z
      EndIf
    Next
    If target <> Null
      hx# = (EntityX(target\\head1, True) + EntityX(target\\head2, True)) / 2
      hy# = (EntityY(target\\head1, True) + EntityY(target\\head2, True)) / 2
      hz# = (EntityZ(target\\head1, True) + EntityZ(target\\head2, True)) / 2
      dx = hx - px
      dz = hz - pz
      yaw = ATan2(-dx, dz)
      pitch = ATan2(py + EYE - hy, Sqr(dx * dx + dz * dz))
      botFire = True
    EndIf
  EndIf
  GameUpdate
  If FrameCount() Mod 300 = 0 Then Print "wave " + wave + " score " + score + " headshots " + headshots + " health " + Int(health) + " state " + state
  If state = GAME_OVER And stateTimer < 0
    Print "over wave " + wave + " score " + score
    End
  EndIf
End Function
`;
  const at = source.indexOf('Function Draw()');
  return source.slice(0, at) + bot + '\n' + source.slice(at);
}

async function play(source, updates)
{
  const module = await loadProgram(compile(source, { file: FILE }).js);
  const engine = new Engine(nodeEngineOptions(FILE));
  const host = new CaptureHost();
  const result = await runProgram(module, host, { engine, maxUpdates: updates });
  assert(result.status !== 'error', `the game stopped with an error: ${result.error && result.error.message}`);
  return host.output;
}

test('a bot that shoots heads clears waves, scores headshots and goes on to the next wave', async () =>
{
  const out = await play(withBot(true), 2400);
  const last = out.trim().split('\n').filter((l) => l.startsWith('wave ')).pop();
  const [, wave, , score, , headshots] = last.split(' ');
  assert(Number(wave) >= 2, `still at wave ${wave}: ${last}`);
  assert(Number(headshots) > 0 && Number(score) > 100, `no headshots or score: ${last}`);
});

test('a player who stands still is caught and killed by the zombies', async () =>
{
  const out = await play(withBot(false), 3000);
  assert(/over wave 1 score 0/.test(out), `the zombies never got to the player:\n${out}`);
});

export default unit;
