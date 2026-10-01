; Tutorial 5 - A free-look camera: fly anywhere.
;
; Drag with the mouse (or a finger) to look, or click the right button to
; take the mouse (Esc gives it back). WASD or the arrows fly forward,
; back and sideways, Q/E go down and up, Shift flies faster. R goes back
; to the start.
;
; Unlike the first-person camera, nothing holds it to the ground: forward
; is wherever it looks, up and down included. The camera keeps its own
; yaw and pitch, and is turned to them every step (no roll creeps in).

Graphics3D 800, 600

Const FLY# = 8.0
Const FAST# = 25.0
Const LOOK# = 0.2

Global camera, yaw#, pitch#

camera = CreateCamera()
CameraClsColor camera, 140, 180, 225
CameraRange camera, 0.1, 400

sun = CreateLight()
RotateEntity sun, 45, -40, 0
LightShadows sun, True, 60
AmbientLight 110, 115, 130

ground = CreatePlane(16)
ScaleEntity ground, 100, 1, 100
grid = CreateCheckerTexture(64, 8, 110, 150, 90, 100, 140, 80)
ScaleTexture grid, 0.04, 0.04
EntityTexture ground, grid

; Something to fly round: towers of blocks, a ring, a few trees.
SeedRnd 3
For i = 1 To 14
  x# = Rnd(-40, 40)
  z# = Rnd(-40, 40)
  h = Rand(2, 8)
  For level = 0 To h - 1
    block = CreateCube()
    PositionEntity block, x, 1 + level * 2, z
    TurnEntity block, 0, level * 12, 0
    EntityColor block, 150 + level * 12, 120 + Rand(0, 60), 200 - level * 15
  Next
Next
ring = CreateTorus(48, 0.12)
ScaleEntity ring, 8, 8, 8
RotateEntity ring, 90, 0, 0
PositionEntity ring, 0, 12, 10
EntityColor ring, 250, 200, 60
oak = CreateTree(TREE_OAK)
For i = 1 To 8
  t = CopyEntity(oak)
  PositionEntity t, Rnd(-45, 45), 0, Rnd(-45, 45)
Next
FreeEntity oak

Start()

Function Start()
  PositionEntity camera, 0, 5, -30
  yaw = 0
  pitch = 5
End Function

Function Update()
  If KeyHit(KEY_R) Then Start()
  If MouseHit(MOUSE_RIGHT) Then LockPointer True

  ; Look while dragging, or while the game holds the mouse.
  If PointerLocked() Or MouseDown(MOUSE_LEFT)
    yaw = yaw - MouseXSpeed() * LOOK
    pitch = Max(-89, Min(89, pitch + MouseYSpeed() * LOOK))
  EndIf
  RotateEntity camera, pitch, yaw, 0

  rate# = FLY
  If KeyDown(KEY_SHIFT) Then rate = FAST
  s# = rate * DeltaTime()
  ; MoveEntity goes along the camera's own axes: forward is where it
  ; looks, up and down included.
  If KeyDown(KEY_W) Or KeyDown(KEY_UP) Then MoveEntity camera, 0, 0, s
  If KeyDown(KEY_S) Or KeyDown(KEY_DOWN) Then MoveEntity camera, 0, 0, -s
  If KeyDown(KEY_A) Or KeyDown(KEY_LEFT) Then MoveEntity camera, -s, 0, 0
  If KeyDown(KEY_D) Or KeyDown(KEY_RIGHT) Then MoveEntity camera, s, 0, 0
  ; Q/E go straight down and up in the world.
  If KeyDown(KEY_Q) Then TranslateEntity camera, 0, -s, 0, True
  If KeyDown(KEY_E) Then TranslateEntity camera, 0, s, 0, True
  ; Not below the ground.
  If EntityY(camera) < 0.5 Then PositionEntity camera, EntityX(camera), 0.5, EntityZ(camera)
End Function

Function Draw()
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "5. Free-look camera"
  FontSize 15
  Text 16, 46, "At " + Int(EntityX(camera)) + ", " + Int(EntityY(camera)) + ", " + Int(EntityZ(camera)) + "   yaw " + Int(yaw) + "   pitch " + Int(pitch)
  Text 16, GraphicsHeight() - 48, "Drag to look (right click: take the mouse)   WASD fly   Q/E down/up"
  Text 16, GraphicsHeight() - 28, "Shift faster   R back to the start"
End Function
