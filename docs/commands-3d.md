# PolyBasic 3D, 2D and input commands

These commands come with the 3D engine. They work the same in the browser
(drawn with WebGL) and in Node.js (a headless engine that keeps the whole
scene but draws nothing, which is what the tests use).

- [The basics](#the-basics)
- [Screen](#screen)
- [Cameras](#cameras)
- [Lights](#lights)
- [Shapes and pivots](#shapes-and-pivots)
- [Looks](#looks)
- [Textures](#textures)
- [Moving and turning](#moving-and-turning)
- [Hierarchy and lifetime](#hierarchy-and-lifetime)
- [Keyboard and mouse](#keyboard-and-mouse)
- [2D drawing](#2d-drawing)
- [Constants](#constants)
- [What happens in a frame](#what-happens-in-a-frame)

## The basics

**Entities.** Everything in the 3D world is an entity: cameras, lights,
shapes and pivots (invisible points that other entities can hang from).
The `Create...` commands return a **handle**, an Int such as `7`, that
you keep in a variable and pass to the other commands. Handles are never
reused within a run. `0` means "no entity" (for example "no parent").
Using a handle after `FreeEntity`, or passing a texture handle where an
entity is expected, stops the program with a clear runtime error.

**Space.** X points right, Y up and Z forward, into the screen. A new
camera sits at the origin looking along +Z, so things in front of it have a
positive Z. Distances have no fixed unit; the built-in shapes are 2 units
across (from -1 to 1), so think of one unit as half a metre.

**Angles** are in degrees:

| Angle | Axis | Positive means |
|-------|------|----------------|
| pitch | X    | the nose tilts down |
| yaw   | Y    | the entity turns left |
| roll  | Z    | the top tilts left |

They are applied roll first, then pitch, then yaw. `EntityPitch` is always
between -90 and 90.

**Local and global.** Every entity can have a parent. Its position,
rotation and scale are stored relative to the parent ("local"). Commands
that take an `isGlobal` flag work in world coordinates when it is `True`.

**Colours** are three Ints from 0 to 255 (red, green, blue).

## Screen

| Command | What it does |
|---------|--------------|
| `Graphics3D width, height` | Sets the screen size in pixels. The picture is scaled to fit the page, keeping this shape. Without it the screen is 800 x 600. |
| `GraphicsWidth%()` `GraphicsHeight%()` | The screen size. |
| `ClsColor r, g, b` | The background when there is no camera. |
| `FPS%()` | Frames drawn in the last second. |

## Cameras

| Command | What it does |
|---------|--------------|
| `CreateCamera%(parent = 0)` | A camera. Every camera draws the world; with several, they draw in order of `EntityOrder`, which with viewports gives split screens. |
| `CameraClsColor camera, r, g, b` | Background colour (default black). |
| `CameraRange camera, near#, far#` | Nearest and furthest distance drawn (default 0.1 and 1000). |
| `CameraFOV camera, degrees#` | Vertical field of view (default 60). |
| `CameraViewport camera, x, y, width, height` | Draw into this part of the screen only (pixels, from the top-left). |

## Lights

| Command | What it does |
|---------|--------------|
| `CreateLight%(kind = LIGHT_DIRECTIONAL, parent = 0)` | A directional light shines along its entity's forward axis, like the sun: turn it with `RotateEntity`. A point light (`LIGHT_POINT`) shines in every direction from where it is. |
| `LightColor light, r, g, b` | Colour and brightness (default white). |
| `LightRange light, range#` | How far a point light reaches (default 10). |
| `AmbientLight r, g, b` | Light that comes from everywhere, so unlit sides are not black (default 64, 64, 64). |

## Shapes and pivots

All shapes fit in the -1..1 cube and are centred on their entity. Shapes of
the same kind share their geometry, so a thousand cubes cost little.

| Command | Shape |
|---------|-------|
| `CreatePivot%(parent = 0)` | Nothing visible: a point to position, turn and hang other entities from. |
| `CreateCube%(parent = 0)` | A cube. |
| `CreateSphere%(segments = 16, parent = 0)` | A sphere; more segments look rounder. |
| `CreateCylinder%(segments = 16, solid = True, parent = 0)` | A cylinder along Y; `solid = False` leaves the ends open. |
| `CreateCone%(segments = 16, solid = True, parent = 0)` | A cone pointing up. |
| `CreatePlane%(divisions = 1, parent = 0)` | A flat square in X and Z, facing up. |
| `CreateTorus%(segments = 24, thickness# = 0.25, parent = 0)` | A ring lying flat. |

## Looks

| Command | What it does |
|---------|--------------|
| `EntityColor entity, r, g, b` | The surface colour (default white). |
| `EntityAlpha entity, alpha#` | 1 is solid, 0 invisible. |
| `EntityShininess entity, shininess#` | 0 matte to 1 very shiny. |
| `EntityFX entity, flags` | Add up `FX_FULLBRIGHT` (ignores lights, glows), `FX_FLAT` (faceted shading), `FX_TWOSIDED` (draws the back of faces too). |
| `EntityTexture entity, texture` | Wraps a texture around the shape; `0` removes it. The texture is tinted by the entity colour. |
| `EntityOrder entity, order` | Lower orders draw first (cameras too). |

Each entity has its own look: `CopyEntity` copies it, and changing the copy
leaves the original alone.

## Textures

| Command | What it does |
|---------|--------------|
| `LoadTexture%(file$)` | Starts loading a PNG or JPG and returns its handle at once. Nothing waits: shapes using it show their plain colour until the image arrives, usually a frame or two later. The path is relative to the program's `.pb` file. |
| `TextureLoaded%(texture)` | 1 once the image is in. |
| `CreateTexture%(width, height, r = 255, g = 255, b = 255)` | A texture filled with one colour, to paint on. |
| `CreateCheckerTexture%(size, cells, r1, g1, b1, r2 = 255, g2 = 255, b2 = 255)` | A square checkerboard of `cells` x `cells` squares. |
| `TexturePixel texture, x, y, r, g, b` | Paints one pixel of a created texture; (0, 0) is the top-left. |
| `ScaleTexture texture, u#, v#` | Repeats the texture `u` times across and `v` times down. |
| `FreeTexture texture` | Releases it. |

## Moving and turning

| Command | What it does |
|---------|--------------|
| `PositionEntity entity, x#, y#, z#, isGlobal = False` | Puts the entity at a position. |
| `MoveEntity entity, x#, y#, z#` | Moves along the entity's own axes: `MoveEntity ship, 0, 0, 1` is one step forward, wherever the ship faces. |
| `TranslateEntity entity, x#, y#, z#, isGlobal = False` | Moves along the parent's axes (or the world's), ignoring the entity's own rotation. |
| `RotateEntity entity, pitch#, yaw#, roll#, isGlobal = False` | Sets the rotation. |
| `TurnEntity entity, pitch#, yaw#, roll#, isGlobal = False` | Turns by these angles, about the entity's own axes (or the world axes). |
| `PointEntity entity, target, roll# = 0` | Turns the entity so it faces another one. |
| `ScaleEntity entity, x#, y#, z#` | Stretches the entity (and its children). Scale is always relative to the parent. |
| `EntityX#(entity, isGlobal = False)`, `EntityY#`, `EntityZ#` | Position. |
| `EntityPitch#(entity, isGlobal = False)`, `EntityYaw#`, `EntityRoll#` | Rotation. |
| `EntityDistance#(entity, other)` | Distance between two entities in the world. |

## Hierarchy and lifetime

| Command | What it does |
|---------|--------------|
| `EntityParent entity, parent, isGlobal = True` | Attaches the entity to a parent (`0` detaches it). With `isGlobal` it stays where it is on screen; with `False` it keeps its local values and so moves with the new parent. |
| `GetParent%(entity)` | The parent, or 0. |
| `CountChildren%(entity)` `GetChild%(entity, index)` | The children, numbered from 1. |
| `HideEntity entity` `ShowEntity entity` `EntityHidden%(entity)` | Hidden entities (and their children) are not drawn, but still move and exist. |
| `FreeEntity entity` | Removes the entity and all its children. |
| `CopyEntity%(entity, parent = 0)` | A copy, with copies of its children. |
| `EntityExists%(entity)` | 1 if the handle is a live entity. |
| `NameEntity entity, name$` `EntityName$(entity)` | A name, for your own bookkeeping. |

Collisions, picking with the mouse, physics and loading models are coming
in the next phase. Until then, `EntityDistance` and comparing positions are
enough for simple games (see `examples/block-rain.pb`).

## Keyboard and mouse

Input is read once at the start of every Update, so all the Updates of a
game see a consistent picture, and a key press is reported by `KeyHit` in
exactly one Update, however the frames fall.

| Command | What it does |
|---------|--------------|
| `KeyDown%(key)` | 1 while the key is held. A tap shorter than one Update still counts. |
| `KeyHit%(key)` | How many times the key was pressed since the last Update (usually 0 or 1). Holding a key does not repeat. |
| `KeyUp%(key)` | 1 in the Update after the key was released. |
| `MouseX%()` `MouseY%()` | Pointer position in screen pixels (Graphics3D coordinates). |
| `MouseDown%(button = MOUSE_LEFT)` | 1 while the button is held. |
| `MouseHit%(button = MOUSE_LEFT)` | Presses since the last Update. |
| `MouseXSpeed%()` `MouseYSpeed%()` | How far the pointer moved since the last Update. |
| `MouseWheel%()` | Wheel steps since the last Update (positive = away from you). |
| `LockPointer on = True` | Hides the pointer and keeps it in the game on the next click, for mouse-look; `MouseXSpeed` and `MouseYSpeed` keep working. `LockPointer False` releases it. |

On a touch screen the first finger is the mouse: touching is
`MouseDown(MOUSE_LEFT)`, and dragging moves `MouseX`/`MouseY`.

Keys typed into a text box on the same page (such as the playground's
editor) are not game input.

## 2D drawing

Draw these in `Draw()`. They go on a transparent layer over the 3D picture,
which is cleared before every `Draw`. Coordinates are screen pixels from
the top-left; text stays sharp at any page size.

| Command | What it does |
|---------|--------------|
| `Color r, g, b` | Colour for the next shapes and text (default white). It stays until changed. |
| `FontSize size` | Text height in pixels (default 16). |
| `Text x, y, text$, centerX = False, centerY = False` | Writes text with its top-left at (x, y), or centred on it. |
| `TextWidth%(text$)` | Width of a text at the current size. |
| `Rect x, y, width, height, solid = True` | A rectangle, filled or outlined. |
| `Oval x, y, width, height, solid = True` | An ellipse inside that rectangle. |
| `Line x1, y1, x2, y2` | A line. |
| `Plot x, y` | One pixel. |

## Constants

| Name | Value |
|------|-------|
| `KEY_A` ... `KEY_Z` | 65 ... 90 |
| `KEY_0` ... `KEY_9` | 48 ... 57 |
| `KEY_LEFT` `KEY_UP` `KEY_RIGHT` `KEY_DOWN` | 37 38 39 40 |
| `KEY_SPACE` `KEY_ENTER` `KEY_ESCAPE` `KEY_TAB` `KEY_BACKSPACE` | 32 13 27 9 8 |
| `KEY_SHIFT` `KEY_CONTROL` `KEY_ALT` | 16 17 18 (either side) |
| `KEY_F1` ... `KEY_F12` | 112 ... 123 |
| `MOUSE_LEFT` `MOUSE_RIGHT` `MOUSE_MIDDLE` | 1 2 3 |
| `LIGHT_DIRECTIONAL` `LIGHT_POINT` | 1 2 |
| `FX_FULLBRIGHT` `FX_FLAT` `FX_TWOSIDED` | 1 4 16 |

The names are built in: a program cannot declare its own `Const KEY_LEFT`.

## What happens in a frame

1. For every Update that is due (60 per second): the keyboard and mouse are
   read, then your `Update()` runs.
2. The world matrices of everything that moved are brought up to date, and
   the 3D scene is drawn by every camera.
3. The 2D layer is cleared and your `Draw()` runs on top.

A program that builds a scene but has no `Update` or `Draw` shows that scene
once, then finishes.

### Inside the engine

three.js only draws. The scene graph, the maths, input and the 2D layer are
PolyBasic's own (`src/engine/`). The renderer sits behind a small interface
(`src/engine/render/backend.js`): each frame it receives the list of
cameras, lights and shapes with their world matrices, and it keeps its own
GPU copies of meshes, materials and textures. Two backends exist: three.js
for the browser and a null one that records what it was asked to draw.
Swapping the renderer means writing one more class there; nothing else
changes.
