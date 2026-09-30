; Browser check: CameraPick must name the entity drawn at each pixel, and
; CameraProject must land on it. Shapes in flat, fully bright colours on
; black, seen by a turned camera through a viewport.
Graphics3D 800, 600
Global cam
cam = CreateCamera()
CameraViewport cam, 100, 50, 600, 500
CameraFOV cam, 70
PositionEntity cam, 1, 2, -6
RotateEntity cam, 12, -8, 3

Dim shapes(5)
shapes(1) = CreateCube()
PositionEntity shapes(1), -2, 0, 4
TurnEntity shapes(1), 20, 30, 10
EntityColor shapes(1), 255, 0, 0
shapes(2) = CreateSphere(24)
PositionEntity shapes(2), 1.5, 1, 6
ScaleEntity shapes(2), 1.5, 0.8, 1
EntityColor shapes(2), 0, 255, 0
shapes(3) = CreateCylinder(24)
PositionEntity shapes(3), 3, -1, 3
RotateEntity shapes(3), 0, 0, 60
EntityColor shapes(3), 0, 0, 255
shapes(4) = CreateTorus(32, 0.3)
PositionEntity shapes(4), -1, 2.5, 8
RotateEntity shapes(4), -60, 0, 0
ScaleEntity shapes(4), 2, 2, 2
EntityColor shapes(4), 255, 255, 0
shapes(5) = CreatePlane()
PositionEntity shapes(5), 0, -2, 6
ScaleEntity shapes(5), 8, 1, 8
EntityColor shapes(5), 255, 0, 255
For i = 1 To 5
  EntityFX shapes(i), FX_FULLBRIGHT
  EntityPickMode shapes(i), PICK_POLYGON
Next

Function Update()
  If FrameCount() = 3
    ; One line per sample: pixel x, y and the entity picked at its centre.
    For y = 53 To 545 Step 9
      For x = 103 To 695 Step 9
        Print x + " " + y + " " + CameraPick(cam, x + 0.5, y + 0.5)
      Next
    Next
    For i = 1 To 5
      CameraProject cam, EntityX(shapes(i)), EntityY(shapes(i)), EntityZ(shapes(i))
      Print "project " + shapes(i) + " " + ProjectedX() + " " + ProjectedY()
    Next
    Print "done"
  EndIf
End Function
