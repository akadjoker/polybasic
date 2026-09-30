# PolyBasic language reference (phase 1)

PolyBasic is a small BASIC for making games. It is compiled to JavaScript and
runs in the browser or in Node.js. It borrows the feel of Blitz Basic: short
programs, no ceremony, type sigils (`%` `#` `$`), `Type` objects and
`For Each`. It is not a Blitz clone, and the places where it behaves
differently are listed at the end.

- [How a PolyBasic program runs](#how-a-polybasic-program-runs)
- [Source files](#source-files)
- [Values and types](#values-and-types)
- [Variables](#variables)
- [Operators](#operators)
- [Control flow](#control-flow)
- [Functions](#functions)
- [Arrays](#arrays)
- [Types and objects](#types-and-objects)
- [Data, Read and Restore](#data-read-and-restore)
- [Include](#include)
- [Errors](#errors)
- [Built-in commands](#built-in-commands)
- [Differences from Blitz Basic](#differences-from-blitz-basic)

## How a PolyBasic program runs

A web page must never block: the browser needs to get control back many times
a second to draw, read the keyboard and stay responsive. So a PolyBasic game
does not own an endless loop. Instead:

1. **The main program runs once.** Everything outside a `Function` is the
   setup: create objects, load data, set Globals.
2. **Then the host calls your frame functions**, if you wrote them:
   - `Function Update()` runs **60 times per second**, at a fixed rate, and
     holds the game logic. The time step is always the same, so a game
     behaves identically on a 60 Hz laptop and a 144 Hz monitor.
     `DeltaTime#()` returns that step in seconds (1/60), which is handy for
     writing speeds in "units per second".
   - `Function Draw()` runs once per displayed frame, after the Updates for
     that frame. In phase 2 the 3D scene is drawn automatically; Draw is for
     2D things drawn on top (and, for now, for printing).
3. **`End` stops the program**: no more Update or Draw calls.

A program with no `Update` and no `Draw` simply runs its main part and
finishes. That is the normal shape for console programs and tests.

```
Global x#

Print "Setting up"           ; runs once

Function Update()            ; 60 times a second
  x = x + 90 * DeltaTime()   ; 90 units per second
  If x > 300 Then End
End Function

Function Draw()              ; once per frame
  If FrameCount() Mod 60 = 0 Then Print "x = " + x
End Function
```

Because the main program and the frame functions are different functions,
anything they share must be **Global** (see [Variables](#variables)). The
compiler warns when a Function reads a variable that only exists in the main
program.

If the display is slower than 60 Hz, several Updates run before one Draw; if
it is faster, some frames have no Update. When the host falls far behind
(for example a hidden browser tab), the missed time is dropped rather than
replayed in a burst.

Every compiled function is ordinary synchronous JavaScript, so there is no
waiting inside a program: there is no `Flip`, `Delay`, `WaitKey` or blocking
`Input`. Frames are the only way time passes.

## Source files

- Files use the `.pb` extension and are plain text (UTF-8).
- One statement per line; several statements can share a line when separated
  by `:`.
- `;` starts a comment that runs to the end of the line.
- Keywords, variable names, function names and Type names **ignore case**:
  `PRINT`, `print` and `Print` are the same, and so are `score` and `Score`.
- Names start with a letter or `_` and contain letters, digits and `_`.
  Keywords (`Next`, `First`, `Each`, ...) cannot be used as names.
- Some keywords are two words: `End If`, `Else If`, `End Function`,
  `End Type`, `End Select`. The joined forms `EndIf`, `ElseIf`,
  `EndFunction`, `EndType`, `EndSelect` work too.

## Values and types

| Type   | Sigil | Holds                                   | Starts as |
|--------|-------|-----------------------------------------|-----------|
| Int    | `%`   | whole numbers, 32-bit (-2147483648 to 2147483647) | `0` |
| Float  | `#`   | numbers with a fraction (double precision) | `0.0` |
| String | `$`   | text                                    | `""`      |
| object | `.T`  | a reference to an object of Type `T`, or `Null` | `Null` |

Literals:

- Ints: `42`, `$FF` (hex), `%1010` (binary). `$FFFFFFFF` is `-1`.
- Floats: `1.5`, `.5`, `3.` (there is no exponent notation).
- Strings: `"text"`. There are no escape sequences; use `Chr(34)` for a
  quote.
- `True` is `1`, `False` is `0`, `Pi` is 3.14159..., `Null` is "no object".

### Conversions

Int, Float and String convert into each other automatically wherever one is
expected (an assignment, a parameter, an operator):

- Float to Int **rounds to the nearest whole number, halves to even**:
  `2.7` becomes `3`, `2.5` becomes `2`, `3.5` becomes `4`. Use `Floor` or
  `Ceil` when you want a specific direction.
- String to Int or Float reads the number at the start of the text and
  ignores the rest: `"42 apples"` is `42`, `"abc"` is `0`.
- Int to String is the plain number. Float to String uses 6 significant
  digits and always shows a decimal point: `10.0`, `0.333333`, `1.5`,
  `1.23457e+8`.
- Objects never convert to numbers or strings.

`Int(x)`, `Float(x)` and `Str(x)` make a conversion explicit.

## Variables

A name can carry a sigil the first time it appears: `lives` (Int), `speed#`
(Float), `name$` (String), `player.Ship` (a `Ship` object). After that the
sigil is optional, but if you write one it must match. A name used without
any declaration is created on the spot as a local variable of the current
Function (or of the main program).

```
Const MAX_ENEMIES = 20, TITLE$ = "Rocks"
Global score, player.Ship, speed# = 2.5
Local count = 0, label$
```

- **`Const`** names a value that never changes. The value must be known
  when compiling (numbers, strings, other Consts and operators on them).
  Consts are visible everywhere.
- **`Global`** variables are visible in the main program and in every
  Function. `Global` can only be written in the main program. The
  declaration is valid everywhere in the file (even above it); a starting
  value (`= 2.5`) is assigned when that line runs.
- **`Local`** declares a variable of the current Function (or main
  program). `Local x` resets `x` to its starting value each time the line
  runs. Declaring a Local after the name was already used is an error.
- Variables of the main program that are not `Global` are **not** visible
  inside Functions. This is the most common beginner mistake, so the
  compiler warns when a Function reads such a name before assigning it.

## Operators

From lowest to highest precedence:

| Level | Operators                  | Notes |
|-------|----------------------------|-------|
| 1     | `And` `Or` `Xor`           | bitwise on Ints; comparisons give 0/1, so they also work as logic |
| 2     | `Not`                      | 1 if the operand is 0 (or an empty string, or Null), else 0 |
| 3     | `=` `<>` `<` `>` `<=` `>=` | give 1 or 0 |
| 4     | `+` `-`                    | `+` also joins strings |
| 5     | `Shl` `Shr` `Sar`          | shift left, logical shift right, arithmetic shift right |
| 6     | `*` `/` `Mod`              | |
| 7     | `^`                        | power, always a Float |
| 8     | unary `-` `+` `~`          | `~` flips all bits |

Operators of the same level work left to right (`2 ^ 3 ^ 2` is 64).
Unary minus binds tighter than `^`, so `-2 ^ 2` is `4.0`. Shifts sit between
`+` and `*`: `1 + 2 Shl 3` is `1 + (2 Shl 3)` = 17.

`Not` sits above `And`/`Or`, so `Not a And b` means `(Not a) And b`, while
`Not x = 7` means `Not (x = 7)`.

**Result types.** If either side of `+` is a String, the other side is
converted and the texts are joined (`"score: " + 10`). Otherwise, if either
side is a Float (or the operator is `^`), the result is a Float; otherwise it
is an Int. Only `+` works on Strings.

**Int arithmetic is 32-bit and wraps around**: `2147483647 + 1` is
`-2147483648`. Int division truncates toward zero (`7 / 2` is `3`,
`-7 / 2` is `-3`) and dividing an Int by zero is a runtime error. Float
division by zero gives `Infinity`. `Mod` keeps the sign of the left side
(`-7 Mod 3` is `-1`) and works on Floats too (`7.5 Mod 2` is `1.5`).
Watch out for `1 / 3`: both sides are Ints, so it is `0`; write `1.0 / 3`.

**Comparisons** work on numbers, on Strings (by character codes, so
`"Zebra" < "apple"`) and on objects (only `=` and `<>`; a deleted object
equals `Null`).

`And` and `Or` evaluate both sides. Write `If p <> Null` in its own If
before reading `p\x` when `p` may be Null.

Constant expressions are computed by the compiler with exactly the same
rules, so `Const BIG = 2147483647 + 1` is `-2147483648`, and a constant
division by zero is reported as a compile error.

## Control flow

**Conditions** (If, While, Until) are true when the value is not 0. An
object is true when it is not Null. Strings are not allowed as conditions
(compare them instead: `If name$ <> ""`).

```
If lives = 0 Then Print "Game over"
If x > 10 Then Print "right" Else Print "left"
If hit Then lives = lives - 1 : Print "ouch"      ; both run when hit

If score > 100
  Print "great"
ElseIf score > 50
  Print "good"
Else
  Print "keep trying"
EndIf
```

A single-line If ends at the end of the line; its `Then`/`Else` parts can
hold several statements separated by `:`. A block If has nothing after
`Then` (which is optional) and ends with `EndIf`.

**Loops**

```
For i = 1 To 10            ; Int loop, Step 1
Next
For i = 10 To 0 Step -2    ; counting down
Next i                     ; the name after Next is optional
For t# = 0 To 1 Step 0.25  ; Float loop
Next

While x < 100
  x = x + 1
Wend

Repeat
  n = n + 1
Until n = 10

Repeat
  If Done() Then Exit
Forever
```

- The loop variable of a For must be a simple Int or Float variable.
- `Step` must be a constant (so the loop knows which way it counts) and
  cannot be 0. Without Step it is 1.
- The `To` value is evaluated again before every pass, so a loop can extend
  its own limit.
- If the start is already past the end, the body does not run. After the
  loop, the variable holds the first value that failed the test.
- `Exit` leaves the innermost loop (For, For Each, While or Repeat).

**Select**

```
Select key$
  Case "a", "left"
    x = x - 1
  Case "d", "right"
    x = x + 1
  Default
    Print "?"
End Select
```

The value is evaluated once and compared with each Case in order; the first
match runs and there is no fall-through. `Default` is optional and must be
the last. Case values are converted to the type of the Select value. Select
works on Ints, Floats and Strings. `Exit` inside a Select leaves the loop
around it.

## Functions

```
Function Distance#(x1#, y1#, x2# = 0, y2# = 0)
  Return Sqr((x2 - x1) ^ 2 + (y2 - y1) ^ 2)
End Function

Function Spawn.Enemy(x#, y#)
  Local e.Enemy = New Enemy
  e\x = x : e\y = y
  Return e
End Function

d# = Distance(3, 4)
Spawn 10, 20          ; called as a statement, the result is dropped
Spawn(30, 40)
```

- The sigil after the name is the return type; with none, the Function
  returns an Int. `.Type` returns an object.
- Parameters are passed by value. Default values must be constants, and
  only trailing parameters can be left out in a call.
- `Return` without a value (or reaching `End Function`) returns 0, `0.0`,
  `""` or `Null`. `Return` is only allowed inside Functions.
- A Function can be called before it is declared, and can call itself.
- Functions are declared at the top level of a file, not inside other
  blocks. Their names cannot be the name of a built-in command.
- As a statement, `Name args` and `Name(args)` are the same. When the first
  argument starts with a bracket, as in `Show (1 + 2) * 3, 4`, the bracket
  belongs to the argument.

## Arrays

**Dim arrays** can have any number of dimensions and can be resized:

```
Dim map(19, 14)          ; indices 0..19 and 0..14
Dim names$(n)            ; the size can be any expression
map(3, 4) = 1
Dim map(39, 29)          ; resize: the contents are cleared
```

- `Dim a(10)` has **11** elements, 0 to 10.
- Dim arrays are always global, even when the Dim line is inside a
  Function, and are used like function calls: `map(x, y)`.
- Using an array before its first `Dim` has run, or an index outside the
  bounds, is a runtime error.
- An Int array stores 32-bit values, a Float array Floats, and so on
  (`Dim grid$(3)` for Strings, `Dim ships.Ship(9)` for objects).

**Fixed-size arrays** use square brackets and have one dimension:

```
Local pos#[3]            ; pos[0] .. pos[3]
Global inventory$[9]
Type Hero
  Field stats[5]
End Type
h\stats[2] = 10
```

The size must be a constant; an out-of-range constant index is a compile
error and any other one a runtime error. A `[ ]` array cannot be assigned or
passed as a whole.

## Types and objects

```
Type Enemy
  Field x#, y#
  Field hp
  Field name$
  Field target.Player      ; a reference to another object
  Field path[7]            ; a fixed-size array field
End Type

e.Enemy = New Enemy        ; fields start at 0 / "" / Null
e\hp = 3
e\target = Null
```

- `New T` creates an object and adds it to the end of **T's list**. Every
  Type keeps all of its live objects in creation order.
- `For e.Enemy = Each Enemy ... Next` visits every object in list order.
  Deleting the current object inside the loop is safe; the loop continues
  with the next one. (If the variable is a new name, `For e = Each Enemy`
  also works.)
- `First T` and `Last T` are the first and last objects (or Null).
  `After e` and `Before e` are the neighbours of `e` (or Null).
- `Delete e` removes an object. `Delete Each T` removes all objects of T.
  Deleting Null or an already deleted object does nothing.
- `Insert a Before b` / `Insert a After b` move `a` within the list.
- A deleted object **compares equal to Null** everywhere, even through other
  variables that still refer to it. Reading or writing a field of a Null or
  deleted object is a runtime error.
- Fields are reached with `\`: `e\target\x`. A bracketed expression can be
  used too: `(First Enemy)\hp`.
- Objects can be compared with `=` and `<>` only, and never convert to
  numbers or strings. `Not e` is 1 when `e` is Null.

## Data, Read and Restore

```
Data 10, 20, "ship", 2.5
Read a, b, name$, speed#
Restore                    ; back to the first Data value
```

- `Data` lists constants; all Data lines of the program form one list, in
  source order, wherever they are in the main program. Data cannot appear
  inside a Function (Read and Restore can).
- `Read` takes the next value and converts it to the variable's type.
  Reading past the end is a runtime error.
- `Restore` goes back to the first value. There are no labels, so there is
  no `Restore label`.

## Include

```
Include "lib/vectors.pb"
```

The file's text is compiled as if it were written at that point, at the top
level of the main program. Paths are relative to the file that contains the
Include. Each file is included at most once, however many times it is named.
Errors in an included file report that file's name and line.

## Errors

**Compile errors** stop compilation at the first problem and give the file,
line and column:

```
game.pb:12:7: error: 'x' is an Int but is used here as a Float
```

**Warnings** do not stop compilation (for example a Function reading a
main-program variable that is not Global).

**Runtime errors** stop the program and name the source line:

```
Runtime error (game.pb, line 30): Index 12 is out of bounds for array 'map' (valid: 0 to 11)
```

Runtime errors include: Int division by zero, array index out of bounds or
array not created yet, using a Null or deleted object, reading past the last
Data value, stack overflow from runaway recursion, bad arguments to string
commands, and `RuntimeError "message"` from your own code.

## Built-in commands

Commands with a return value are used in expressions; the others are
statements. Angles are in degrees.

| Command | Result |
|---------|--------|
| `Print text$ = ""` | writes the text and a new line |
| `Write text$` | writes the text without a new line |
| `DebugLog text$` | writes to the debug log (stderr in Node, the console in a browser) |
| `RuntimeError message$` | stops the program with an error |
| `Len%(text$)` | number of characters |
| `Left$(text$, count)` `Right$(text$, count)` | first / last characters |
| `Mid$(text$, start, count = -1)` | characters from `start` (1 = first); -1 means to the end |
| `Instr%(text$, find$, from = 1)` | position of `find$` (1 = first), 0 if not found |
| `Replace$(text$, find$, with$)` | every occurrence replaced |
| `Upper$(text$)` `Lower$(text$)` `Trim$(text$)` | case change; spaces removed at both ends |
| `LSet$(text$, size)` `RSet$(text$, size)` | padded with spaces (or cut) to `size`, left or right aligned |
| `Chr$(code)` `Asc%(text$)` | character from a code / code of the first character (-1 for "") |
| `Hex$(value)` `Bin$(value)` | 8 hex digits / 32 binary digits |
| `String$(text$, count)` | the text repeated |
| `Sin# Cos# Tan#(degrees#)` | trigonometry in degrees |
| `ASin# ACos# ATan#(value#)` `ATan2#(y#, x#)` | inverse trigonometry, in degrees |
| `Sqr#` `Floor#` `Ceil#` `Exp#` `Log#` `Log10#` | square root, rounding down / up, e^x, natural log, base-10 log |
| `Abs(x)` `Sgn(x)` `Min(a, b)` `Max(a, b)` | keep Ints as Ints and Floats as Floats |
| `Int%(x)` `Float#(x)` `Str$(x)` | conversions (Int rounds halves to even) |
| `Rnd#(from#, to# = 0)` | random Float; `Rnd(10)` gives 0 to 10 |
| `Rand%(from, to = 1)` | random Int, both ends included; `Rand(6)` gives 1 to 6 |
| `SeedRnd seed` `RndSeed%()` | set / read the random seed; a seed always gives the same sequence |
| `MilliSecs%()` | milliseconds since the program started |
| `DeltaTime#()` | the fixed Update step in seconds (1/60) |
| `FrameCount%()` | how many times Update has run |

## Differences from Blitz Basic

PolyBasic keeps Blitz's feel but not every detail. The differences are
deliberate:

- **No blocking loop.** The host drives `Update`/`Draw`; `Flip`, `Delay`,
  `WaitKey`, `WaitTimer` and `Input` do not exist. This is how the web
  works, and it keeps the generated code plain and fast.
- **No `Goto`, `Gosub` or labels.** Use loops, `Exit` and Functions. As a
  consequence `Restore` has no label and always goes back to the start.
- **`Not` binds tighter than `And`/`Or`**: in Blitz `Not a And b` meant
  `Not (a And b)`, which surprised almost everyone.
- **Floats are 64-bit** (JavaScript numbers), so they are more precise than
  Blitz's 32-bit floats; printing still uses 6 significant digits. Ints stay
  32-bit with wrap-around, as in Blitz.
- **Strings are Unicode**; `Chr`/`Asc` use Unicode code points.
- **Conditions**: Floats are tested for "not 0.0" directly (Blitz rounded
  them to an Int first, so `If 0.4` was false); Strings are not accepted as
  conditions; objects are (true when not Null).
- **Dim arrays can be declared anywhere** (they are always global) and may be
  used in the source above their `Dim` line.
- **Globals are hoisted**: a `Global` declared further down the file is
  already known above it.
- **`Local x` resets `x`** each time the line runs.
- **Type sigils must touch the name** (`x%`, not `x %`), which is what lets
  `$FF` and `%101` be read as numbers anywhere else.
- **`Min`, `Max` and `DeltaTime` are new**; `Handle`/`Object`, banks, files
  and the graphics commands are not in phase 1.
- Reversed comparison spellings (`=<`, `=>`, `><`) are not accepted.
- `Next` may name its loop variable (`Next i`), and it is checked.
