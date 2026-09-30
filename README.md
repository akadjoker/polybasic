# PolyBasic

PolyBasic is a friendly BASIC for making games in the browser. You write
short, readable programs in the spirit of Blitz Basic (type sigils, `Type`
objects, `For Each`) and PolyBasic compiles them to plain, fast JavaScript.

This is phase 1: the language, the compiler, the core runtime and the
command line. The 3D engine comes next (see the roadmap).

```
; bounce.pb
Type Ball
  Field x#, y#, speed#
End Type

Global bounces

For i = 1 To 3
  b.Ball = New Ball
  b\x = i * 100
  b\speed = 60 * i
Next

; Update runs 60 times a second, after the setup above has run once.
Function Update()
  For b.Ball = Each Ball
    b\y = b\y + b\speed * DeltaTime()
    If b\y > 200 Or b\y < 0
      b\speed = -b\speed
      bounces = bounces + 1
    EndIf
  Next
  If bounces >= 10 Then End
End Function

; Draw runs once per displayed frame.
Function Draw()
  If FrameCount() Mod 30 = 0 Then Print "bounces so far: " + bounces
End Function
```

## How programs run

The main part of a program runs once, as the setup. If the program has a
`Function Update()`, the host then calls it 60 times per second at a fixed
rate, and calls `Function Draw()` (if present) once per displayed frame.
`End` stops everything. A program without Update runs once and finishes,
which is how console programs and tests work.

The program never waits or blocks: the browser (or Node.js) owns the loop.
That is why there is no `Flip`, `Delay` or `WaitKey`, and why every compiled
function is ordinary synchronous JavaScript. The full story is in
[docs/language.md](docs/language.md#how-a-polybasic-program-runs).

## Using it

Requires Node.js 20 or newer. There are no runtime dependencies.

```
npm install
node bin/polybasic.mjs run examples/bounce.pb      # run at 60 updates per second
node bin/polybasic.mjs run game.pb --frames 120    # stop after 120 updates
node bin/polybasic.mjs run game.pb --fake-time     # frames back to back, repeatable
node bin/polybasic.mjs build game.pb -o game.js    # write the JavaScript module
node bin/polybasic.mjs run game.js                 # run a built module
node bin/polybasic.mjs --js game.pb                # print the generated JavaScript
```

From JavaScript:

```js
import { compile, loadProgram, runProgram, BrowserHost } from 'polybasic';

const { js, warnings } = compile(source, { file: 'game.pb' });
const program = await loadProgram(js);
const result = await runProgram(program, new BrowserHost({ output: preElement }));
```

`compile` throws a `CompileError` with `file`, `line`, `column` and a plain
message. `runProgram` resolves with the program's status (`finished`,
`ended`, `stopped` or `error`, with the `.pb` line of a runtime error).

## Tests

```
npm test        # golden programs in tests/programs, plus unit tests
npm run lint    # ESLint (Allman braces)
npm run bench   # a few timings against hand-written JavaScript
```

Each `tests/programs/*.pb` is compiled and run, and everything it prints
(including compile errors, warnings and runtime errors) is compared with
`tests/expected/*.out`. After an intended change, `node tests/run.mjs
--update` rewrites the expected files; review the diff before committing.

## Layout

```
bin/polybasic.mjs        command line
src/compiler/            lexer, parser, semantic pass, code generator
src/runtime/             runtime helpers, commands, hosts, frame-loop runner
docs/language.md         the language reference
tests/                   golden programs, runner, benchmark
```

## Roadmap

1. **Language and runtime** (this phase): compiler to JavaScript, core
   commands, Node and browser hosts, the Update/Draw frame model.
2. **3D engine**: a scene graph, cameras, lights, collisions and physics
   behind PolyBasic's own commands. Rendering goes through a swappable
   backend, three.js first; physics sits behind our own API, Rapier first.
   Models are loaded from glTF only.
3. **Web playground**: edit, run and share programs in the browser, with
   errors pointing at the right line.
4. **Games**: original example games written in PolyBasic.

## Licence

PolyBasic is released under the MIT licence (see [LICENSE](LICENSE)).
Parts of the compiler are derived from the Blitz3D compiler, (c) Blitz
Research Ltd, zlib licence; see [LICENSE-THIRD-PARTY](LICENSE-THIRD-PARTY).
