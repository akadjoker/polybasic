; Block Rain - dodge the falling blocks for as long as you can.
;
; Keyboard: Left/Right (or A/D) and Up/Down (or W/S) move the ball.
; Mouse or finger: hold and drag to steer the ball.
; Space, Enter, a click or a tap starts a game.

Graphics3D 800, 600

Const HALF_WIDTH# = 6.0      ; the platform spans -6..6 in x
Const HALF_DEPTH# = 2.5      ; and -2.5..2.5 in z
Const BALL_Y# = 0.7
Const SPAWN_Y# = 14.0

Type Block
  Field mesh             ; the falling cube
  Field shadow           ; the dark disc showing where it will land
  Field speed#
  Field spin#
End Type

Global ball, camera, platform
Global state$ = "title"
Global score, best, lives
Global spawnTimer#, spawnEvery#, fallSpeed#
Global flash, shake#

; --- The scene --------------------------------------------------------

camera = CreateCamera()
CameraClsColor camera, 16, 20, 34
CameraFOV camera, 55
PositionEntity camera, 0, 8, -10.5
RotateEntity camera, 34, 0, 0

sun = CreateLight()
RotateEntity sun, 50, -30, 0
LightColor sun, 255, 245, 230
AmbientLight 60, 66, 90

platform = CreateCube()
ScaleEntity platform, HALF_WIDTH + 0.4, 0.2, HALF_DEPTH + 0.4
floor = CreateCheckerTexture(128, 8, 60, 70, 100, 80, 92, 128)
ScaleTexture floor, 1 / 3.0, 1
EntityTexture platform, floor

; A glowing rim along the front edge
rim = CreateCube(platform)
ScaleEntity rim, 1, 0.3, 0.02
PositionEntity rim, 0, 0.2, -1.02
EntityColor rim, 80, 220, 255
EntityFX rim, FX_FULLBRIGHT

ball = CreateSphere(20)
NameEntity ball, "ball"
ScaleEntity ball, 0.5, 0.5, 0.5
EntityColor ball, 255, 200, 60
EntityShininess ball, 0.7

; A few pillars in the distance, for depth
For i = -2 To 2
  pillar = CreateCylinder(12)
  ScaleEntity pillar, 0.6, 4, 0.6
  PositionEntity pillar, i * 7, -2, 16 + Abs(i) * 2
  EntityColor pillar, 50, 58, 90
Next

ResetGame()
state = "title"

; --- Game logic -------------------------------------------------------

Function ResetGame()
  For b.Block = Each Block
    FreeEntity b\mesh
    FreeEntity b\shadow
  Next
  Delete Each Block
  score = 0
  lives = 3
  spawnTimer = 0
  spawnEvery = 0.9
  fallSpeed = 5
  PositionEntity ball, 0, BALL_Y, -1
  state = "playing"
End Function

Function Spawn()
  b.Block = New Block
  b\mesh = CreateCube()
  size# = Rnd(0.35, 0.7)
  ScaleEntity b\mesh, size, size, size
  x# = Rnd(-HALF_WIDTH + 0.5, HALF_WIDTH - 0.5)
  z# = Rnd(-HALF_DEPTH + 0.5, HALF_DEPTH - 0.5)
  PositionEntity b\mesh, x, SPAWN_Y, z
  RotateEntity b\mesh, Rnd(360), Rnd(360), 0
  Select Rand(4)
    Case 1: EntityColor b\mesh, 255, 90, 90
    Case 2: EntityColor b\mesh, 90, 200, 255
    Case 3: EntityColor b\mesh, 170, 120, 255
    Default: EntityColor b\mesh, 120, 240, 150
  End Select
  b\shadow = CreateCylinder(16)
  ScaleEntity b\shadow, size, 0.01, size
  PositionEntity b\shadow, x, 0.21, z
  EntityColor b\shadow, 0, 0, 0
  EntityAlpha b\shadow, 0.35
  b\speed = fallSpeed * Rnd(0.8, 1.3)
  b\spin = Rnd(-4, 4)
End Function

Function MoveBall()
  dx# = 0
  dz# = 0
  If KeyDown(KEY_LEFT) Or KeyDown(KEY_A) Then dx = dx - 1
  If KeyDown(KEY_RIGHT) Or KeyDown(KEY_D) Then dx = dx + 1
  If KeyDown(KEY_UP) Or KeyDown(KEY_W) Then dz = dz + 1
  If KeyDown(KEY_DOWN) Or KeyDown(KEY_S) Then dz = dz - 1
  stepSize# = 7 * DeltaTime()
  x# = EntityX(ball) + dx * stepSize
  z# = EntityZ(ball) + dz * stepSize

  ; Mouse or finger: the ball chases the point under the pointer.
  If MouseDown()
    targetX# = (MouseX() / Float(GraphicsWidth()) - 0.5) * 2 * (HALF_WIDTH + 1.5)
    targetZ# = (0.72 - MouseY() / Float(GraphicsHeight())) * 9
    x = x + (targetX - x) * 0.25
    z = z + (targetZ - z) * 0.25
    dx = targetX - EntityX(ball)
  EndIf

  x = Max(-HALF_WIDTH + 0.5, Min(HALF_WIDTH - 0.5, x))
  z = Max(-HALF_DEPTH + 0.5, Min(HALF_DEPTH - 0.5, z))
  ; Roll: turn about the world axes by the distance travelled.
  TurnEntity ball, (z - EntityZ(ball)) * 115, 0, -(x - EntityX(ball)) * 115, True
  PositionEntity ball, x, BALL_Y, z
End Function

Function UpdateBlocks()
  For b.Block = Each Block
    TranslateEntity b\mesh, 0, -b\speed * DeltaTime(), 0
    TurnEntity b\mesh, b\spin, b\spin * 0.7, 0
    y# = EntityY(b\mesh)
    ; The shadow grows darker as the block comes closer.
    EntityAlpha b\shadow, 0.15 + 0.5 * (1 - y / SPAWN_Y)

    If y < BALL_Y + 0.9 And y > 0
      dx# = Abs(EntityX(b\mesh) - EntityX(ball))
      dz# = Abs(EntityZ(b\mesh) - EntityZ(ball))
      If dx < 0.85 And dz < 0.85
        lives = lives - 1
        flash = 12
        shake = 0.4
        FreeEntity b\mesh
        FreeEntity b\shadow
        Delete b
        If lives = 0
          state = "over"
          If score > best Then best = score
        EndIf
      EndIf
    ElseIf y < -2
      score = score + 1
      FreeEntity b\mesh
      FreeEntity b\shadow
      Delete b
    EndIf
  Next
End Function

Function Update()
  wantStart = KeyHit(KEY_SPACE) Or KeyHit(KEY_ENTER) Or MouseHit()
  If state <> "playing"
    If wantStart Then ResetGame()
    TurnEntity ball, 0, 1, 0
    Return
  EndIf

  MoveBall()
  spawnTimer = spawnTimer + DeltaTime()
  If spawnTimer >= spawnEvery
    spawnTimer = 0
    Spawn()
    ; Faster and denser as the score climbs.
    spawnEvery = Max(0.22, spawnEvery * 0.985)
    fallSpeed = Min(16, fallSpeed + 0.08)
  EndIf
  UpdateBlocks()

  If flash > 0 Then flash = flash - 1
  shake = shake * 0.85
  PositionEntity camera, Rnd(-shake, shake), 8 + Rnd(-shake, shake), -10.5
  If flash > 0 Then EntityColor ball, 255, 80, 80 Else EntityColor ball, 255, 200, 60
End Function

; --- The 2D layer ------------------------------------------------------

Function Draw()
  w = GraphicsWidth()
  h = GraphicsHeight()
  FontSize 22
  Color 235, 240, 255
  Text 20, 16, "Score " + score
  Color 150, 160, 190
  FontSize 16
  Text 20, 44, "Best " + best
  For i = 1 To 3
    If i <= lives Then Color 255, 90, 110 Else Color 60, 66, 90
    Oval w - 20 - i * 30, 18, 22, 22
  Next

  If state = "title" Or state = "over"
    Color 0, 0, 0
    Rect 0, h / 2 - 90, w, 170
    Color 255, 210, 80
    FontSize 48
    If state = "title" Then Text w / 2, h / 2 - 40, "BLOCK RAIN", True, True Else Text w / 2, h / 2 - 40, "GAME OVER", True, True
    Color 235, 240, 255
    FontSize 18
    Text w / 2, h / 2 + 14, "Arrows / WASD, or drag with the mouse or a finger", True, True
    Text w / 2, h / 2 + 44, "Space, click or tap to play", True, True
  EndIf
End Function
