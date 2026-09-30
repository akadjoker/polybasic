; Coin Hop - jump across the platforms and pick up every coin.
;
; Arrows or WASD run, Space jumps. Fall off and you start again.
;
; The character and the platforms are glTF models by Kenney (CC0), in
; assets/kenney. The character walks into the platforms' own triangles:
; collisions keep it on top, and its walk, idle and jump animations come
; from the model file.

Graphics3D 800, 600

Const TYPE_PLAYER = 1
Const TYPE_GROUND = 2
Const GRAVITY# = 20.0
Const JUMP# = 7.5
Const SPEED# = 3.2
Const KENNEY$ = "assets/kenney/"

Type Coin
  Field mesh
End Type

Global player, guy, camera, fallSpeed#, onGround, pose$
Global coinModel, collected, total, timer#

; --- The level ----------------------------------------------------------

camera = CreateCamera()
CameraClsColor camera, 150, 200, 240
CameraRange camera, 0.1, 200
sun = CreateLight()
RotateEntity sun, 55, -30, 0
AmbientLight 140, 140, 150

Collisions TYPE_PLAYER, TYPE_GROUND, COLLIDE_POLYGON, RESPONSE_SLIDE_NO_DOWNHILL

; x, y, z and model of each platform.
Data 0, 0, 0, "platform-large"
Data 0, 0.8, 4.2, "platform"
Data 3.4, 1.4, 5.8, "platform-medium"
Data 6.8, 2.0, 4.2, "platform"
Data 6.4, 1.2, 0.8, "platform-medium"
Data 3.6, 0.6, -2.4, "platform"
Data -3.8, 0.5, 1.8, "platform-medium"
Data -4.2, 1.4, 5.6, "platform"
Data -99

Repeat
  Read x#
  If x = -99 Then Exit
  Read y#, z#, file$
  p = LoadMesh(KENNEY + file + ".glb")
  PositionEntity p, x, y, z
  ; The whole model collides: the triangles of all its parts.
  EntityType p, TYPE_GROUND
  ; A coin above every platform but the first.
  If x <> 0 Or z <> 0 Then AddCoin(x, y + 1.0, z)
Forever
AddCoin(-1.2, 1.0, -1.2)
AddCoin(1.2, 1.0, -1.2)

; Some clouds, for looks only.
For i = 1 To 6
  cloud = LoadMesh(KENNEY + "cloud.glb")
  PositionEntity cloud, Rnd(-14, 14), Rnd(5, 9), Rnd(8, 20)
  ScaleEntity cloud, 2.5, 1.2, 2.5
Next

; --- The player -----------------------------------------------------------

; The player is an invisible ellipsoid (what collides); the model hangs
; below it with its feet at the bottom of the ellipsoid.
player = CreatePivot()
EntityRadius player, 0.32, 0.55
EntityType player, TYPE_PLAYER
guy = LoadMesh(KENNEY + "character.glb", player)
PositionEntity guy, 0, -0.55, 0
Respawn()

Function AddCoin(x#, y#, z#)
  If coinModel = 0
    coinModel = LoadMesh(KENNEY + "coin.glb")
    HideEntity coinModel
  EndIf
  c.Coin = New Coin
  ; The model is loaded once; every coin is a copy of it (a copy made
  ; before the model has arrived gets its parts when it does).
  c\mesh = CopyEntity(coinModel)
  ShowEntity c\mesh
  PositionEntity c\mesh, x, y, z
  ScaleEntity c\mesh, 1.6, 1.6, 1.6
  total = total + 1
End Function

Function Respawn()
  PositionEntity player, 0, 2, -1
  ; A jump, not a move through the world.
  ResetEntity player
  fallSpeed = 0
End Function

; --- Every step -------------------------------------------------------------

Function Update()
  ; Standing on something? The collisions of the last step say so: a
  ; contact whose surface faces up.
  onGround = 0
  For i = 1 To CountCollisions(player)
    If CollisionNY(player, i) > 0.6 Then onGround = 1
  Next
  If onGround And fallSpeed < 0 Then fallSpeed = 0

  dx# = 0
  dz# = 0
  If KeyDown(KEY_LEFT) Or KeyDown(KEY_A) Then dx = dx - 1
  If KeyDown(KEY_RIGHT) Or KeyDown(KEY_D) Then dx = dx + 1
  If KeyDown(KEY_UP) Or KeyDown(KEY_W) Then dz = dz + 1
  If KeyDown(KEY_DOWN) Or KeyDown(KEY_S) Then dz = dz - 1
  moving = dx <> 0 Or dz <> 0
  If moving
    length# = Sqr(dx * dx + dz * dz)
    dx = dx / length * SPEED
    dz = dz / length * SPEED
    ; Face the way we run: yaw 0 looks along +Z, positive yaw turns left.
    RotateEntity guy, 0, ATan2(-dx, dz), 0
  EndIf
  If onGround And KeyHit(KEY_SPACE) Then fallSpeed = JUMP

  fallSpeed = fallSpeed - GRAVITY * DeltaTime()
  TranslateEntity player, dx * DeltaTime(), fallSpeed * DeltaTime(), dz * DeltaTime()

  If Not onGround
    Play("jump", ANIM_ONCE)
  ElseIf moving
    Play("walk", ANIM_LOOP)
  Else
    Play("idle", ANIM_LOOP)
  EndIf

  If EntityY(player) < -8 Then Respawn()

  For c.Coin = Each Coin
    TurnEntity c\mesh, 0, 3, 0
    If EntityDistance(player, c\mesh) < 0.8
      FreeEntity c\mesh
      Delete c
      collected = collected + 1
    EndIf
  Next
  If collected < total Then timer = timer + DeltaTime()

  ; The camera follows from behind and above.
  PositionEntity camera, EntityX(player), EntityY(player) + 3.5, EntityZ(player) - 6.5
  PointEntity camera, player
End Function

; Starts an animation unless it is already the one playing.
Function Play(name$, mode)
  If pose = name Then Return
  pose = name
  Animate guy, FindAnimation(guy, name), mode
End Function

; --- The 2D layer -------------------------------------------------------------

Function Draw()
  Color 30, 40, 70
  FontSize 22
  Text 16, 14, "Coins " + collected + " / " + total
  FontSize 15
  Text 16, 44, "Time " + Int(timer * 10) / 10.0 + " s"
  Text 16, GraphicsHeight() - 28, "Arrows or WASD run, Space jumps"
  If collected = total
    Color 255, 255, 255
    FontSize 40
    Text GraphicsWidth() / 2, GraphicsHeight() / 2 - 20, "You got them all!", True, True
  EndIf
End Function
