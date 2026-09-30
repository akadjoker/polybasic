; spin.pb - the "hello world" of PolyBasic 3D: a textured cube turning in
; the light, with a little text on top.

Graphics3D 800, 600

Global cube

camera = CreateCamera()
CameraClsColor camera, 24, 28, 40
PositionEntity camera, 0, 0, -5

light = CreateLight()
RotateEntity light, 35, -40, 0      ; shine down, from the left
AmbientLight 70, 70, 80

cube = CreateCube()
EntityTexture cube, LoadTexture("assets/tile.png")
RotateEntity cube, 20, 0, 0

Function Update()
  TurnEntity cube, 0, 1, 0          ; one degree per update: 60 per second
End Function

Function Draw()
  Color 230, 235, 255
  FontSize 22
  Text GraphicsWidth() / 2, 30, "Hello, PolyBasic 3D", True
  FontSize 14
  Color 150, 160, 190
  Text 10, GraphicsHeight() - 24, "yaw " + Int(EntityYaw(cube)) + "   fps " + FPS()
End Function
