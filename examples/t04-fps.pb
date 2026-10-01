; Tutorial 4 - A first-person camera.
;
; Click the screen to take the mouse (Esc gives it back); then the mouse
; looks around. Without taking it, drag with the mouse (or a finger) to
; look. WASD or the arrows walk, Shift runs, Space jumps.
;
; The body turns left and right (yaw), the camera on it looks up and down
; (pitch): so walking forward stays level whatever the camera looks at.
; The body is an ellipsoid that collides with the walls and the floor.

Graphics3D 800, 600

Const TYPE_PLAYER = 1
Const TYPE_WORLD = 2
Const WALK# = 4.0
Const RUN# = 8.0
Const JUMP# = 7.0
Const GRAVITY# = 20.0
Const LOOK# = 0.15            ; degrees per pixel the mouse moves

Global body, camera, tilt#, fall#, onGround

; The body: an invisible ellipsoid the size of a person (1.7 high), the
; camera at eye height on it.
body = CreatePivot()
EntityRadius body, 0.4, 0.85
EntityType body, TYPE_PLAYER
PositionEntity body, 0, 1, -8
camera = CreateCamera(body)
PositionEntity camera, 0, 0.65, 0
CameraClsColor camera, 150, 190, 230
CameraRange camera, 0.05, 200

sun = CreateLight()
RotateEntity sun, 55, -35, 0
LightShadows sun, True, 30
AmbientLight 110, 110, 125

Collisions TYPE_PLAYER, TYPE_WORLD, COLLIDE_POLYGON, RESPONSE_SLIDE_NO_DOWNHILL

; --- A walled courtyard with pillars and crates ---------------------------

floor = CreatePlane(8)
ScaleEntity floor, 20, 1, 20
tiles = CreateCheckerTexture(64, 2, 170, 165, 150, 150, 145, 130)
ScaleTexture tiles, 0.1, 0.1
EntityTexture floor, tiles
EntityType floor, TYPE_WORLD

bricks = CreateCheckerTexture(64, 4, 180, 110, 80, 160, 95, 70)
For side = 0 To 3
  wall = CreateCube()
  ScaleEntity wall, 20, 2.5, 0.5
  TurnEntity wall, 0, side * 90, 0
  MoveEntity wall, 0, 2.5, 20
  EntityTexture wall, bricks
  EntityType wall, TYPE_WORLD
Next

For i = 0 To 7
  pillar = CreateCylinder(16)
  ScaleEntity pillar, 0.6, 3, 0.6
  a# = i * 45
  PositionEntity pillar, Cos(a) * 9, 3, Sin(a) * 9
  EntityColor pillar, 220, 215, 200
  EntityType pillar, TYPE_WORLD
Next

wood = CreateCheckerTexture(32, 2, 190, 140, 80, 170, 120, 65)
Data 2, 3, 1, -3, 5, 0.6, 4, 5, 0.6, -6, -2, 1, 5, -6, 0.8, 0, 0, 0
Repeat
  Read x#, z#, s#
  If s = 0 Then Exit
  crate = CreateCube()
  ScaleEntity crate, s, s, s
  PositionEntity crate, x, s, z
  TurnEntity crate, 0, x * 13, 0
  EntityTexture crate, wood
  EntityType crate, TYPE_WORLD
Forever

Function Update()
  ; Click to take the mouse for looking (the browser gives it back on Esc).
  If MouseHit(MOUSE_LEFT) Then LockPointer True

  ; Look, while the game holds the mouse or while dragging: left/right
  ; turns the body, up/down tilts the camera, held between straight down
  ; and straight up.
  If PointerLocked() Or MouseDown(MOUSE_LEFT)
    TurnEntity body, 0, -MouseXSpeed() * LOOK, 0
    tilt = Max(-85, Min(85, tilt + MouseYSpeed() * LOOK))
  EndIf
  RotateEntity camera, tilt, 0, 0

  ; Standing on something?
  onGround = 0
  For i = 1 To CountCollisions(body)
    If CollisionNY(body, i) > 0.6 Then onGround = 1
  Next
  If onGround And fall < 0 Then fall = 0

  ; Walk along the body's own axes: forward is where it faces.
  x# = 0
  z# = 0
  If KeyDown(KEY_A) Or KeyDown(KEY_LEFT) Then x = x - 1
  If KeyDown(KEY_D) Or KeyDown(KEY_RIGHT) Then x = x + 1
  If KeyDown(KEY_W) Or KeyDown(KEY_UP) Then z = z + 1
  If KeyDown(KEY_S) Or KeyDown(KEY_DOWN) Then z = z - 1
  If x <> 0 Or z <> 0
    ; Diagonals no faster than straight on.
    length# = Sqr(x * x + z * z)
    speed# = WALK
    If KeyDown(KEY_SHIFT) Then speed = RUN
    x = x / length * speed * DeltaTime()
    z = z / length * speed * DeltaTime()
  EndIf
  If onGround And KeyHit(KEY_SPACE) Then fall = JUMP
  fall = fall - GRAVITY * DeltaTime()
  MoveEntity body, x, 0, z
  ; Falling is straight down in the world, whatever the body faces.
  TranslateEntity body, 0, fall * DeltaTime(), 0, True
End Function

Function Draw()
  ; A cross in the middle of the screen.
  cx = GraphicsWidth() / 2
  cy = GraphicsHeight() / 2
  Color 255, 255, 255
  Line cx - 8, cy, cx + 8, cy
  Line cx, cy - 8, cx, cy + 8

  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "4. First-person camera"
  FontSize 15
  Text 16, 46, "Looking " + Int(EntityYaw(body)) + " degrees round, " + Int(-tilt) + " up"
  Text 16, GraphicsHeight() - 28, "Click: take the mouse (Esc gives it back)   WASD walk   Shift run   Space jump"
End Function
