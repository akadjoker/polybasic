; Tutorial 3 - Walking a character.
;
; Arrows/WASD walk (the way the camera looks), Shift runs, Space jumps.
; Q/E or dragging with the mouse turn the camera round the character.
;
; Three things work together here:
;   collisions  keep the character on the ground and out of the boxes;
;   animations  follow what it does (idle, walk, jump);
;   the camera  hangs behind it from a pivot that follows it smoothly,
;               and comes closer instead of going into a wall.
;
; The character is by Kenney (CC0), in assets/kenney.

Graphics3D 800, 600

Const TYPE_PLAYER = 1
Const TYPE_WORLD = 2
Const WALK# = 3.0
Const RUN# = 6.0
Const JUMP# = 8.0
Const GRAVITY# = 20.0

Global player, guy, rig, camera, fall#, onGround, pose$, heading#

camera = CreateCamera()
CameraClsColor camera, 160, 200, 235

sun = CreateLight()
RotateEntity sun, 50, -30, 0
LightShadows sun, True, 30
AmbientLight 120, 120, 130

Collisions TYPE_PLAYER, TYPE_WORLD, COLLIDE_POLYGON, RESPONSE_SLIDE_NO_DOWNHILL

; --- A small yard to walk in -------------------------------------------

floor = CreatePlane(8)
ScaleEntity floor, 15, 1, 15
checker = CreateCheckerTexture(64, 8, 140, 180, 110, 120, 160, 95)
ScaleTexture checker, 4, 4
EntityTexture floor, checker
EntityType floor, TYPE_WORLD

; Boxes to walk round and climb on: x, z, then width, height and depth.
; (A cube is 2 across, so it is scaled by half of each.)
Data 4, 4, 2.5, 0.6, 2.5
Data 6.5, 6.5, 2, 1.2, 2
Data -5, 5, 4, 0.8, 1.5
Data -7, -2, 1.5, 2.5, 5
Data 0, 11, 10, 2, 1
Data 0, 0, 0, 0, 0
Repeat
  Read x#, z#, w#, h#, d#
  If w = 0 Then Exit
  box = CreateCube()
  ScaleEntity box, w / 2, h / 2, d / 2
  PositionEntity box, x, h / 2, z
  EntityColor box, 200, 170, 120
  EntityType box, TYPE_WORLD
  EntityPickMode box, PICK_BOX     ; the camera looks for it (see Update)
Forever

; A ramp up to the first box: a flat box tilted up.
ramp = CreateCube()
ScaleEntity ramp, 1, 0.08, 1.6
RotateEntity ramp, -12, 0, 0
PositionEntity ramp, 4, 0.3, 1.3
EntityColor ramp, 170, 150, 120
EntityType ramp, TYPE_WORLD
EntityPickMode ramp, PICK_BOX

; --- The character ------------------------------------------------------

; What collides is an invisible ellipsoid (the pivot); the model hangs
; below it with its feet at the bottom.
player = CreatePivot()
EntityRadius player, 0.32, 0.55
EntityType player, TYPE_PLAYER
PositionEntity player, 0, 1, -3
guy = LoadMesh("assets/kenney/character.glb", player)
PositionEntity guy, 0, -0.55, 0

; --- The camera ---------------------------------------------------------

; `rig` follows the player; the camera sits behind it and looks at it.
; Turning the rig turns the camera round the player.
rig = CreatePivot()
EntityParent camera, rig
RotateEntity camera, 18, 0, 0
Const BACK# = 5.5          ; how far behind the camera sits
Const HIGH# = 2.5          ; and how high

Function Update()
  ; Standing on something? (a contact whose surface faces up)
  onGround = 0
  For i = 1 To CountCollisions(player)
    If CollisionNY(player, i) > 0.6 Then onGround = 1
  Next
  If onGround And fall < 0 Then fall = 0

  ; The camera turns with Q/E or a drag.
  If KeyDown(KEY_Q) Then TurnEntity rig, 0, 100 * DeltaTime(), 0
  If KeyDown(KEY_E) Then TurnEntity rig, 0, -100 * DeltaTime(), 0
  If MouseDown(MOUSE_LEFT) Then TurnEntity rig, 0, -MouseXSpeed() * 0.4, 0

  ; The keys, as a direction on the ground.
  kx# = 0
  kz# = 0
  If KeyDown(KEY_LEFT) Or KeyDown(KEY_A) Then kx = kx - 1
  If KeyDown(KEY_RIGHT) Or KeyDown(KEY_D) Then kx = kx + 1
  If KeyDown(KEY_UP) Or KeyDown(KEY_W) Then kz = kz + 1
  If KeyDown(KEY_DOWN) Or KeyDown(KEY_S) Then kz = kz - 1
  moving = kx <> 0 Or kz <> 0
  speed# = WALK
  If KeyDown(KEY_SHIFT) Then speed = RUN

  dx# = 0
  dz# = 0
  If moving
    ; Turn the keys by the camera's heading: "up" walks away from it.
    yaw# = EntityYaw(rig)
    ; Forward for a yaw is (-Sin(yaw), Cos(yaw)); right is (Cos(yaw), Sin(yaw)).
    dx = kx * Cos(yaw) - kz * Sin(yaw)
    dz = kx * Sin(yaw) + kz * Cos(yaw)
    length# = Sqr(dx * dx + dz * dz)
    dx = dx / length * speed
    dz = dz / length * speed
    ; Face the way it walks, turning there smoothly.
    target# = ATan2(-dx, dz)
    heading = heading + DeltaAngle(heading, target) * Min(1, 12 * DeltaTime())
    RotateEntity guy, 0, heading, 0
  EndIf

  If onGround And KeyHit(KEY_SPACE) Then fall = JUMP
  fall = fall - GRAVITY * DeltaTime()
  TranslateEntity player, dx * DeltaTime(), fall * DeltaTime(), dz * DeltaTime()

  ; The animation follows what it does.
  If Not onGround
    Play("jump", ANIM_ONCE, 1)
  ElseIf moving
    Play("walk", ANIM_LOOP, speed / WALK)
  Else
    Play("idle", ANIM_LOOP, 1)
  EndIf

  If EntityY(player) < -10
    PositionEntity player, 0, 1, -3
    ResetEntity player
    fall = 0
  EndIf

  ; The rig catches up with the player a little each step: a smooth
  ; follow instead of a stiff one.
  k# = Min(1, 8 * DeltaTime())
  PositionEntity rig, EntityX(rig) + (EntityX(player) - EntityX(rig)) * k, EntityY(rig) + (EntityY(player) - EntityY(rig)) * k, EntityZ(rig) + (EntityZ(player) - EntityZ(rig)) * k

  ; The camera does not go into walls: put it where it wants to be, look
  ; along the line from the player's head to it, and if something is in
  ; the way, bring it in front of that.
  PositionEntity camera, 0, HIGH, -BACK
  hx# = EntityX(rig)
  hy# = EntityY(rig) + 0.5
  hz# = EntityZ(rig)
  ; (With a radius, the pick is a ball of that size moving along the line:
  ; stopping where it touches keeps the camera that far off the wall. It is
  ; smaller than the character's own radius, 0.32, so it never starts out
  ; already touching the wall the character stands against.)
  If LinePick(hx, hy, hz, EntityX(camera, True) - hx, EntityY(camera, True) - hy, EntityZ(camera, True) - hz, 0.2)
    t# = Max(0.02, PickedTime())
    PositionEntity camera, 0, 0.5 + (HIGH - 0.5) * t, -BACK * t
  EndIf
  ; With its back to a wall there is no room behind it: rather than look
  ; from inside its head, hide the character while the camera is that close.
  If EntityDistance(camera, player) < 1.2
    HideEntity guy
  Else
    ShowEntity guy
  EndIf
End Function

; The shortest turn from angle a to angle b, in -180 .. 180.
Function DeltaAngle#(a#, b#)
  d# = b - a
  While d > 180
    d = d - 360
  Wend
  While d < -180
    d = d + 360
  Wend
  Return d
End Function

; Starts an animation unless it is already the one playing (starting it
; again every step would hold it at its first frame).
Global speedNow#
Function Play(name$, mode, speed#)
  If pose = name And speedNow = speed Then Return
  pose = name
  speedNow = speed
  Animate guy, FindAnimation(guy, name), mode, speed
End Function

Function Draw()
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "3. Walking a character"
  FontSize 15
  If onGround Then state$ = "on the ground" Else state$ = "in the air"
  Text 16, 46, "Animation: " + pose + "   " + state
  Text 16, GraphicsHeight() - 28, "Arrows/WASD walk   Shift run   Space jump   Q/E or drag: camera"
End Function
