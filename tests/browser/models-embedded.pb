; Browser check: the Kenney character with its texture stored inside the
; .glb, turned to face the camera, on a platform.
; models-external.pb and models-embedded.pb must
; draw the same picture.
Graphics3D 800, 600
cam = CreateCamera()
PositionEntity cam, 0, 1.4, -2.2
RotateEntity cam, 18, 0, 0
CameraClsColor cam, 150, 190, 230
light = CreateLight()
RotateEntity light, 40, 30, 0
AmbientLight 120, 120, 120
platform = LoadMesh("../../examples/assets/kenney/platform.glb")
guy = LoadMesh("../output/character-embedded.glb")
TurnEntity guy, 0, 180, 0
PositionEntity guy, 0, 0.5, 0

Function Update()
  If FrameCount() = 5 Then Print "ready"
End Function
