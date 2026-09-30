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
- [Models and animation](#models-and-animation)
- [Picking](#picking)
- [Collisions](#collisions)
- [Physics](#physics)
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
| `LoadTexture%(file$)` | Starts loading a PNG or JPG and returns its handle at once. Nothing waits, but files started in the main body are in before the first `Update`. One loaded later shows the plain colour until its image arrives, usually a frame or two. The path is relative to the program's `.pb` file. A file that cannot be loaded is reported in the console. |
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

## Models and animation

Models are glTF 2.0 files, `.gltf` or `.glb` (the format most free 3D
models come in; Blender, for example, exports it). The Kenney models in
`examples/assets/kenney` (CC0) are ready to use.

| Command | What it does |
|---------|--------------|
| `LoadMesh%(file$, parent = 0)` | Starts loading a model and returns its handle at once: a pivot the model's parts will hang from. Models loaded in the main body are in before the first `Update`. The path is relative to the program's `.pb` file. A file that cannot be loaded is reported in the console. |
| `MeshLoaded%(entity)` | 1 once the model is in. |
| `FindChild%(entity, name$)` | A part of the model (any entity below it) by its name in the file, not case-sensitive; 0 if there is none. `EntityName$` gives a part's name. |
| `CountAnimations%(entity)` `AnimationName$(entity, index)` | The model's animations, numbered from 1. |
| `FindAnimation%(entity, name$)` | An animation's number by its name (not case-sensitive), 0 if there is none. |
| `Animate entity, animation = 1, mode = ANIM_LOOP, speed# = 1` | Plays an animation: `ANIM_LOOP` over and over, `ANIM_ONCE` to the end and stop there, `ANIM_PINGPONG` forwards and back. A negative speed plays it backwards; `Animate entity, 0` stops. |
| `Animating%(entity)` | 1 while an animation plays (0 once `ANIM_ONCE` reached the end). |
| `AnimTime#(entity)` `SetAnimTime entity, time#` | Where the animation is, in seconds; setting it shows that moment. |
| `AnimLength#(entity, animation = 1)` | How long an animation is, in seconds. |

**Parts.** Every node of the file becomes an entity below the model's pivot,
with the node's name, so the usual commands work on the parts: `EntityColor
FindChild(robot, "arm-left"), 255, 0, 0`. Move, turn and scale the model
through its pivot.

**Setting up in the main body.** A model's parts only exist once it has
arrived: in the main body `CountChildren` is still 0, `FindChild` finds
nothing and `CountAnimations` and the like report that the model is still
loading; from the first `Update` on, everything is there. The commands that need the parts to do their job wait
for the model instead, and run as soon as it is in, in the order they were
given: `CopyEntity` (the copy gets its own parts), `EntityBody` (and the
`Body...`, `Apply...` and `Set...Velocity` commands that follow it) and
`Animate`. So a program can load, copy, give bodies and start animations
all in its main body.

**What is read.** Meshes with their normals, texture coordinates and vertex
colours; materials (base colour and texture, transparency, double-sided,
unlit, texture transforms); textures in separate PNG/JPG files or inside the
`.glb`; the node tree; node animations (moving, turning and scaling parts,
which is how the Kenney character walks). Not read yet: skinned meshes
(bones) and morph targets, which show in their rest pose with a note in the
console, cameras and lights in the file, and compressed files (Draco,
meshopt, Basis textures), which are reported as errors.

**Space.** glTF is right-handed, PolyBasic left-handed. Models are mirrored
across X as they load, so a model's front is along +Z (forward, like any
entity) and its left side is on your left: turn a model 180 degrees to face
a camera that looks at it along +Z.

**Copies.** `CopyEntity` of a model shares its mesh data and file, so a
hundred coins cost little; each copy has its own parts, looks and animation.

## Picking

Picking finds what is on a line: what the mouse points at, what a gun
would hit, whether one thing can see another. Only entities with a pick
mode are found, and hidden entities never are.

| Command | What it does |
|---------|--------------|
| `EntityPickMode entity, mode, obscurer = True` | How the entity is picked: `PICK_SPHERE` (a sphere of its `EntityRadius`), `PICK_BOX` (its `EntityBox`, or the box around its mesh), `PICK_POLYGON` (its exact triangles, both sides) or `PICK_NONE`. `obscurer = False` keeps it out of `EntityVisible`. For a model, the mode covers all its parts and a pick names the model. |
| `EntityRadius entity, x#, y# = 0` | The sphere for `PICK_SPHERE`, and the ellipsoid for collisions: `x` wide (X and Z), `y` high; `y = 0` makes it a sphere. In world units, not changed by scale. Default 1. |
| `EntityBox entity, x#, y#, z#, width#, height#, depth#` | The box for `PICK_BOX` (and `COLLIDE_BOX`), in the entity's own space (so it turns and scales with it). Default: the box around its mesh, or -1..1. |
| `CameraPick%(camera, x#, y#)` | The entity at screen pixel (x, y) as the camera sees it (`MouseX()`, `MouseY()` for the pointer), or 0. |
| `LinePick%(x#, y#, z#, dx#, dy#, dz#, radius# = 0)` | The first entity on the line from (x, y, z) to (x + dx, y + dy, z + dz), or 0. With a radius, the first thing a ball of that size moving along the line would touch. |
| `EntityPick%(entity, range#)` | The first entity straight ahead of an entity (along its +Z), up to `range` away. The entity itself is left out. |
| `EntityVisible%(entity, other)` | 1 if nothing that is an obscurer is on the straight line between the two. |
| `PickedEntity%()` | What the last pick found, or 0. |
| `PickedX#()` `PickedY#()` `PickedZ#()` | Where it was hit (for a line with a radius: where the ball touched). |
| `PickedNX#()` `PickedNY#()` `PickedNZ#()` | The surface's direction there, facing back along the line. |
| `PickedTime#()` `PickedDistance#()` | How far along the line (0 to 1), and the distance from its start. |
| `CameraProject%(camera, x#, y#, z#)` | Puts a world point on the screen: 1 if it is in front of the camera, and then `ProjectedX#()` and `ProjectedY#()` are its pixel, `ProjectedZ#()` its distance in front. For labels over 3D things in `Draw`. |

## Collisions

Collisions stop things from moving through each other. You give entities a
collision type (a number you choose, such as 1 for the player and 2 for
walls) and say which types meet which, and how. After every `Update`, each
entity that moved is swept from where it was to where the program put it,
as an ellipsoid of its `EntityRadius`; if it would pass through something
of a type it meets, it stops there or slides along it. Fast things do not
pass through thin walls.

| Command | What it does |
|---------|--------------|
| `EntityType entity, type` | The entity's collision type, 1 to 999 (0: none). |
| `GetEntityType%(entity)` | Its type. |
| `Collisions srcType, dstType, method, response` | Entities of `srcType` that move are stopped by those of `dstType`. The method is what they meet: `COLLIDE_SPHERE` (the other's `EntityRadius` sphere), `COLLIDE_POLYGON` (its mesh triangles, or a model's), `COLLIDE_BOX` (its `EntityBox`, from the outside). The response: `RESPONSE_STOP`, `RESPONSE_SLIDE` (slide along what was hit), or `RESPONSE_SLIDE_NO_DOWNHILL` (slide, but a floor or ramp does not turn a fall into sliding, so a character does not slip down slopes under gravity). |
| `ClearCollisions` | Forgets all the `Collisions` rules. |
| `ResetEntity entity` | Makes the entity's next move a jump: after `PositionEntity` to teleport it, so it is not swept all the way there. |
| `CountCollisions%(entity)` | How many things it ran into in the last step. |
| `CollisionEntity%(entity, index)` | The entity it ran into (numbered from 1). |
| `CollisionX#(entity, index)` `CollisionY#` `CollisionZ#` | Where they touched. |
| `CollisionNX#(entity, index)` `CollisionNY#` `CollisionNZ#` | The surface's direction there: `CollisionNY > 0.6` means it stands on a floor. |
| `EntityCollided%(entity, type)` | The first entity of that type it ran into in the last step, or 0. |

The ellipsoid is always upright (it does not turn with the entity) and
centred on the entity's position: for a character standing on its feet,
make a pivot the ellipsoid and hang the model below it (see
`examples/coin-hop.pb`). With `COLLIDE_SPHERE` the moving entity is a sphere
of its `x` radius. The things it meets are taken where they are: only the
entity that moved is swept.

Collisions happen after `Update`, so what an `Update` reads (positions,
`CountCollisions`...) is the result of the moves made in the previous one.
Positions set in the main body are jumps, not moves.

## Physics

![Crate Tower (examples/crates.pb)](screenshots/crates.png)

Physics makes things fall, tumble, bounce and push each other, with the
Rapier physics engine underneath. You give entities a body; after every
`Update` the physics world advances by one step of 1/60 s and moves the
entities with dynamic bodies. A program that uses a physics command waits,
before its main body runs, for the physics engine to load (in the browser
a separate file, only fetched by programs that need it).

| Command | What it does |
|---------|--------------|
| `EntityBody entity, kind = BODY_DYNAMIC, shape = SHAPE_AUTO` | Gives the entity a body. `BODY_DYNAMIC` moves by physics; `BODY_STATIC` never moves (floors, walls); `BODY_KINEMATIC` is moved by the program and pushes dynamic bodies out of its way (lifts, paddles). |
| `FreeBody entity` `EntityHasBody%(entity)` | Removes the body (the entity stays); is there one? |
| `PhysicsGravity x#, y#, z#` | Gravity, in units per second per second. Default 0, -19.6, 0: 9.8 m/s² with one unit as half a metre. |
| `BodyMass entity, mass#` | Default 1 for every dynamic body, whatever its size. |
| `BodyFriction entity, friction#` | 0 is ice; default 0.5. |
| `BodyBounce entity, bounce#` | 0 does not bounce (default), 1 bounces back as high. |
| `BodyDamping entity, linear#, angular#` | Air resistance for moving and turning (default 0 and 0.05). |
| `BodyLockRotation entity, pitch, yaw, roll` | `True` stops all turning about that world axis (pitch: X, yaw: Y, roll: Z). A thing that must stay upright locks pitch and roll; a character steered by the program, all three. |
| `ApplyImpulse entity, x#, y#, z#` | A sudden push (a kick, a jump): the velocity changes by it divided by the mass. |
| `ApplyForce entity, x#, y#, z#` | A push during the next step only (an engine: call it every `Update`). |
| `ApplyTorque entity, pitch#, yaw#, roll#` | A twist during the next step only. |
| `SetVelocity entity, x#, y#, z#` | Sets the velocity, in units per second. |
| `SetAngularVelocity entity, pitch#, yaw#, roll#` | Sets the turning speed, in degrees per second about the world axes, with the same signs as `TurnEntity`. |
| `BodyVX#(entity)` `BodyVY#` `BodyVZ#` | The velocity. |
| `BodyPitchSpeed#(entity)` `BodyYawSpeed#` `BodyRollSpeed#` | The turning speed, in degrees per second. |
| `CountContacts%(entity)` `ContactEntity%(entity, index)` | The bodies it touches, numbered from 1. |

**Shapes.** A body's shape is worked out when `EntityBody` is called, from
the entity's mesh (for a model, all its parts), `EntityBox` or `EntityRadius`
and its scale at that moment:

| Shape | What it is |
|-------|------------|
| `SHAPE_AUTO` | The default: a sphere or a cylinder for those built-in shapes; the exact triangles for a static or kinematic body; a box around a dynamic one; for a pivot with nothing below it, a sphere of its `EntityRadius`. |
| `SHAPE_BOX` `SHAPE_SPHERE` `SHAPE_CAPSULE` `SHAPE_CYLINDER` | That shape around the mesh (capsules and cylinders stand along Y). |
| `SHAPE_HULL` | The tightest convex shape around the mesh's points (convex: no hollows). |
| `SHAPE_MESH` | The exact triangles: only for static and kinematic bodies. |

**Moving bodies by hand.** `PositionEntity`, `TurnEntity` and the rest
still work: on a dynamic or static body it is a jump, on a kinematic one a
move that pushes. Bodies of children follow their place in the world.
`CopyEntity` does not copy bodies.

Physics and collisions are separate: use collisions for characters you
steer and physics for things that should tumble; an entity should have one
or the other.

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
| `PICK_NONE` `PICK_SPHERE` `PICK_POLYGON` `PICK_BOX` | 0 1 2 3 |
| `COLLIDE_SPHERE` `COLLIDE_POLYGON` `COLLIDE_BOX` | 1 2 3 |
| `RESPONSE_STOP` `RESPONSE_SLIDE` `RESPONSE_SLIDE_NO_DOWNHILL` | 1 2 3 |
| `BODY_STATIC` `BODY_DYNAMIC` `BODY_KINEMATIC` | 1 2 3 |
| `SHAPE_AUTO` `SHAPE_BOX` `SHAPE_SPHERE` `SHAPE_CAPSULE` `SHAPE_CYLINDER` `SHAPE_HULL` `SHAPE_MESH` | 0 to 6 |
| `ANIM_STOP` `ANIM_LOOP` `ANIM_ONCE` `ANIM_PINGPONG` | 0 1 2 3 |

The names are built in: a program cannot declare its own `Const KEY_LEFT`.

## What happens in a frame

Before the first frame, a program that uses physics waits for the physics
engine, its main body runs, and then the files it started loading (models,
textures) arrive. Then, every frame:

1. For every Update that is due (60 per second): the keyboard and mouse are
   read, your `Update()` runs, and then the world takes one step: model
   animations move on, physics moves the bodies, and collisions sweep the
   entities that moved.
2. The world matrices of everything that moved are brought up to date, and
   the 3D scene is drawn by every camera.
3. The 2D layer is cleared and your `Draw()` runs on top.

A program that builds a scene but has no `Update` or `Draw` shows that scene
once, then finishes.

### Inside the engine

three.js only draws. The scene graph, the maths, input, the 2D layer,
picking and collisions (`src/engine/collide/`) and the glTF reader
(`src/engine/model/`) are PolyBasic's own (`src/engine/`). The renderer sits behind a small interface
(`src/engine/render/backend.js`): each frame it receives the list of
cameras, lights and shapes with their world matrices, and it keeps its own
GPU copies of meshes, materials and textures. Two backends exist: three.js
for the browser and a null one that records what it was asked to draw.
Swapping the renderer means writing one more class there; nothing else
changes.

Physics works the same way: the physics commands talk to PolyBasic's own
layer (`src/engine/physics/physics.js`), which talks to a small backend
interface (`src/engine/physics/backend.js`). Rapier is the backend today,
in one file (`src/engine/physics/rapier/`); the browser build puts it in
`dist/physics.js`, loaded only by programs that use physics.
