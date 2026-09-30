# Tutorials

Six small programs, from moving a box with the keys to the cameras of
first-person and third-person games. Each is under **Tutorials** in the
playground (the file is in `examples/`): open it, run it, then change it.
This page explains what each one does and why, a few lines of code at a
time. The commands are all in [commands-3d.md](commands-3d.md); the
language in [language.md](language.md).

Every program here has the same shape: the main part sets the scene up
once, `Function Update()` runs 60 times a second and moves things, and
`Function Draw()` writes on top of the picture.

1. [Moving with the keys](#1-moving-with-the-keys)
2. [Controlling an animation](#2-controlling-an-animation)
3. [Walking a character](#3-walking-a-character)
4. [A first-person camera](#4-a-first-person-camera)
5. [A free-look camera](#5-a-free-look-camera)
6. [An orbit camera](#6-an-orbit-camera)

## 1. Moving with the keys

`examples/t01-move.pb`

There are two ways to move something with the keys, and games use both.

**Along its own axes**: a tank, a car, a spaceship. Left and right turn it;
up drives it forward, which is wherever it faces now:

```
TurnEntity tank, 0, -KeyX() * TURN * DeltaTime(), 0
MoveEntity tank, 0, 0, KeyZ() * SPEED * DeltaTime()
```

`MoveEntity` goes along the entity's own axes: its +Z is its forward. A
positive yaw turns left, so the right key (+1) turns by a negative angle.

**Along the world's axes**: a ball, a top-down character. The keys are
directions on the map, whichever way it faces:

```
TranslateEntity ball, KeyX() * SPEED * DeltaTime(), 0, KeyZ() * SPEED * DeltaTime(), True
```

`True` means the world's axes. (Without it, `TranslateEntity` goes along the
parent's axes; for an entity without a parent that is the same.)

**`DeltaTime()`**: `Update` runs 60 times a second, and `DeltaTime()` is that
step, 1/60 s. Multiplying a speed in units per second by it gives how far
to go in one step. Programs written this way say their speeds in units per
second, which is easier to think about than "per step".

Try: make the tank strafe sideways with A/D instead of turning
(`MoveEntity tank, KeyX() * SPEED * DeltaTime(), 0, ...`).

## 2. Controlling an animation

`examples/t02-animation.pb`

A glTF model brings its animations with it. `Animate` plays one:

```
Animate guy, animation, ANIM_LOOP, speed
```

- `animation` is a number from 1 to `CountAnimations(guy)`;
  `FindAnimation(guy, "walk")` finds one by its name, and
  `AnimationName(guy, n)` gives a name back.
- `ANIM_LOOP` plays it over and over; `ANIM_ONCE` to the end, where it
  stops; `ANIM_PINGPONG` forwards and back.
- `speed` 1 is as made, 2 twice as fast, -1 backwards, 0 holds it still.

`AnimTime(guy)` is where it is, in seconds, and `SetAnimTime` goes there:
that is how the paused animation is stepped through a frame at a time.
`Animate` always starts from the beginning, so to change the speed of what
is playing without a jump, keep the time and go back to it:

```
t# = AnimTime(guy)
Animate guy, current, ANIM_LOOP, speed
SetAnimTime guy, t
```

**Playing something once, then going back.** A jump plays with
`ANIM_ONCE`; `Animating(guy)` is 1 while it plays and 0 once it has
reached its end, and then the loop that was playing starts again.

**A trap worth knowing.** `And` and `Or` work bit by bit on Ints (as in
Blitz3D), so they make good logic only with 0 and 1. `FindAnimation` gives
4 for the jump, and `KeyHit(KEY_SPACE) And jump` is `1 And 4`, which is 0.
Compare instead: `KeyHit(KEY_SPACE) And jump > 0`.

**Counting presses.** `KeyHit` says how many times a key was pressed since
the last step; two quick taps can land in the same step. Use the count
when it matters: `speed = speed + 0.25 * KeyHit(KEY_UP)`.

## 3. Walking a character

`examples/t03-character.pb`

A character in a game is three things working together.

**What collides is not the model.** The model hangs from an invisible
pivot with an ellipsoid, `EntityRadius player, 0.32, 0.55`, which is what
the collisions move and stop; the model's feet are at the bottom of it:

```
player = CreatePivot()
EntityRadius player, 0.32, 0.55
EntityType player, TYPE_PLAYER
guy = LoadMesh("assets/kenney/character.glb", player)
PositionEntity guy, 0, -0.55, 0
Collisions TYPE_PLAYER, TYPE_WORLD, COLLIDE_POLYGON, RESPONSE_SLIDE_NO_DOWNHILL
```

Standing on the ground is a collision whose surface faces up
(`CollisionNY(player, i) > 0.6`). Gravity is a speed that grows downwards
every step and goes back to 0 on the ground; a jump sets it upwards.

**The keys follow the camera.** Up walks away from the camera, whichever
way it has been turned. The key direction is turned by the camera's yaw:

```
dx = kx * Cos(yaw) - kz * Sin(yaw)
dz = kx * Sin(yaw) + kz * Cos(yaw)
```

and the model turns to face the way it walks (`ATan2(-dx, dz)` is that
direction as a yaw), smoothly, a part of the way each step.

**The animation follows what it does**: `jump` in the air, `walk` when
moving (faster when running), `idle` otherwise. A small `Play` function
starts an animation only when it changes, because starting it again every
step would hold it at its first frame.

**The camera** hangs from a pivot, `rig`, that catches up with the
player a little each step (smooth, not stiff), and that Q/E or a drag
turn. It does not go into walls: a `LinePick` from the player's head to
where the camera wants to be finds what is in the way, and the camera
stops in front of it. With a radius, the pick is a ball moving along the
line; stopping where it touches keeps the camera that far off the wall.
When the character stands with its back to a wall there is no room behind
it, so it is hidden while the camera is that close.

## 4. A first-person camera

`examples/t04-fps.pb`

The player is a body (an ellipsoid the size of a person) with the camera
at eye height on it. The two turn separately:

- the **body** turns left and right (yaw), so walking forward stays level;
- the **camera** tilts up and down (pitch), held between straight down and
  straight up.

```
TurnEntity body, 0, -MouseXSpeed() * LOOK, 0
tilt = Max(-85, Min(85, tilt + MouseYSpeed() * LOOK))
RotateEntity camera, tilt, 0, 0
```

**Taking the mouse.** `LockPointer True` hides the pointer and keeps it
in the game on the next click, so the mouse can turn round forever;
`MouseXSpeed()` and `MouseYSpeed()` still say how far it moved. The player's
Esc gives it back, and `PointerLocked()` says whether the game has it. The
program only looks around while it has the mouse or while a button is
held, so that moving the pointer over the page does not turn the view (and
a finger can drag to look on a touch screen).

Walking uses `MoveEntity` (the body's own axes); falling uses
`TranslateEntity ..., True` (straight down in the world, whatever the body
faces).

## 5. A free-look camera

`examples/t05-freelook.pb`

A camera that flies: forward is wherever it looks, up and down included.
It keeps its own yaw and pitch and is turned to them every step with
`RotateEntity camera, pitch, yaw, 0`. Adding small turns with `TurnEntity`
instead would, after a while, tilt the horizon (turns about the camera's
own axes mix yaw and pitch into roll).

`MoveEntity camera, 0, 0, s` flies forward along its own axes; Q/E use
`TranslateEntity ..., True` to go straight down and up in the world.

## 6. An orbit camera

`examples/t06-orbit.pb`

How 3D model viewers and many strategy games look at things: the camera
hangs from a pivot at the middle of what it looks at.

```
RotateEntity pivot, pitch, yaw, 0          ; swings the camera round
PositionEntity camera, 0, 0, -distance     ; how far: the zoom
```

The camera is a child of the pivot, so turning the pivot swings it round,
and it always faces the middle. `MouseWheel()` zooms, by a tenth of the
distance for each step of the wheel, which feels the same near and far.

When a new model has arrived (`MeshLoaded`), the camera stands back by the
model's size: `MeshWidth`, `MeshHeight` and `MeshDepth` measure a loaded
model too, all its parts together.
