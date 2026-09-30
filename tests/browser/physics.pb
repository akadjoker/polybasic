; Browser check: a pile of falling cubes and balls on a floor and a ramp.
; Run for a fixed number of updates, the entity transforms must match the
; same run in Node.
Graphics3D 800, 600
cam = CreateCamera()
PositionEntity cam, 0, 6, -14
RotateEntity cam, 20, 0, 0
light = CreateLight()
RotateEntity light, 50, -30, 0

floor = CreatePlane()
ScaleEntity floor, 10, 1, 10
EntityColor floor, 90, 110, 130
EntityBody floor, BODY_STATIC
ramp = CreateCube()
PositionEntity ramp, -3, 2, 2
ScaleEntity ramp, 3, 0.2, 2
RotateEntity ramp, 0, 0, -25
EntityColor ramp, 200, 150, 90
EntityBody ramp, BODY_STATIC

For i = 1 To 16
  If i Mod 3 = 0
    thing = CreateSphere(12)
    ScaleEntity thing, 0.5, 0.5, 0.5
    EntityColor thing, 240, 90, 80
  Else
    thing = CreateCube()
    ScaleEntity thing, 0.45, 0.45, 0.45
    EntityColor thing, 80, 170, 240
  EndIf
  PositionEntity thing, -4 + (i Mod 4) * 0.9, 4 + i * 0.8, 1.5 + (i Mod 3) * 0.4
  TurnEntity thing, i * 13, i * 29, i * 7
  EntityBody thing
  BodyBounce thing, 0.3
Next

Function Update()
End Function
