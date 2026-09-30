; Paint Shapes - point at a shape to see its name, click it to paint it.
;
; Mouse or finger: point at a shape; click or tap to paint it a new colour.
; Right click (or P) switches between picking the exact triangles and a
; simple sphere around each shape, to see the difference.

Graphics3D 800, 600

Type Shape
  Field mesh
  Field spin#
  Field r, g, b
End Type

Global camera, hovered, sphereMode, painted

camera = CreateCamera()
CameraClsColor camera, 28, 30, 44
PositionEntity camera, 0, 6.5, -10
RotateEntity camera, 34, 0, 0

sun = CreateLight()
RotateEntity sun, 45, -35, 0
AmbientLight 70, 70, 90

floor = CreatePlane()
ScaleEntity floor, 7, 1, 6
PositionEntity floor, 0, -1.2, 0.5
EntityTexture floor, CreateCheckerTexture(64, 8, 50, 54, 76, 62, 68, 94)

; Nine shapes on a 3 x 3 grid.
Dim names$(9)
names(1) = "cube" : names(2) = "sphere" : names(3) = "cone"
names(4) = "cylinder" : names(5) = "torus" : names(6) = "flat cube"
names(7) = "egg" : names(8) = "ring" : names(9) = "tower"
For i = 1 To 9
  s.Shape = New Shape
  Select i
    Case 1, 6: s\mesh = CreateCube()
    Case 2, 7: s\mesh = CreateSphere(24)
    Case 3: s\mesh = CreateCone(24)
    Case 4, 9: s\mesh = CreateCylinder(24)
    Default: s\mesh = CreateTorus(32, 0.3)
  End Select
  If i = 6 Then ScaleEntity s\mesh, 0.8, 0.3, 0.8 Else ScaleEntity s\mesh, 0.7, 0.7, 0.7
  If i = 7 Then ScaleEntity s\mesh, 0.55, 0.8, 0.55
  If i = 8 Then ScaleEntity s\mesh, 0.9, 0.9, 0.9
  If i = 9 Then ScaleEntity s\mesh, 0.35, 1.1, 0.35
  ; Columns left to right, rows from the back (Int division: 0, 0, 0, 1, ...).
  PositionEntity s\mesh, ((i - 1) Mod 3 - 1) * 3.2, 0, ((i - 1) / 3 - 1) * -3.0 + 0.5
  NameEntity s\mesh, names(i)
  EntityPickMode s\mesh, PICK_POLYGON
  EntityRadius s\mesh, 0.9
  s\spin = Rnd(0.3, 1.2)
  s\r = 200 : s\g = 205 : s\b = 220
  EntityColor s\mesh, s\r, s\g, s\b
  EntityShininess s\mesh, 0.4
Next

Function Update()
  ; Which shape is under the pointer?
  hovered = CameraPick(camera, MouseX(), MouseY())

  If MouseHit(MOUSE_RIGHT) Or KeyHit(KEY_P)
    sphereMode = 1 - sphereMode
    For s.Shape = Each Shape
      If sphereMode Then EntityPickMode s\mesh, PICK_SPHERE Else EntityPickMode s\mesh, PICK_POLYGON
    Next
  EndIf

  For s.Shape = Each Shape
    TurnEntity s\mesh, 0, s\spin, 0
    If s\mesh = hovered
      If MouseHit(MOUSE_LEFT)
        s\r = Rand(60, 255) : s\g = Rand(60, 255) : s\b = Rand(60, 255)
        painted = painted + 1
      EndIf
      ; A lighter shade while pointed at.
      EntityColor s\mesh, Min(255, s\r + 50), Min(255, s\g + 50), Min(255, s\b + 50)
    Else
      EntityColor s\mesh, s\r, s\g, s\b
    EndIf
  Next
End Function

Function Draw()
  Color 235, 240, 255
  FontSize 18
  Text 16, 14, "Point at a shape, click to paint it"
  Color 150, 160, 190
  FontSize 14
  If sphereMode Then mode$ = "spheres (EntityRadius)" Else mode$ = "exact triangles"
  Text 16, 40, "Picking: " + mode$ + "   (right click or P to switch)"
  Text 16, 60, "Shapes painted: " + painted

  If hovered
    ; A label over the shape: its position projected onto the screen.
    If CameraProject(camera, EntityX(hovered), EntityY(hovered) + 1.1, EntityZ(hovered))
      Color 255, 220, 120
      FontSize 16
      Text ProjectedX(), ProjectedY(), EntityName(hovered), True, True
    EndIf
    ; And a small marker where the pointer meets its surface.
    If CameraProject(camera, PickedX(), PickedY(), PickedZ())
      Color 255, 255, 255
      Oval ProjectedX() - 4, ProjectedY() - 4, 8, 8, False
    EndIf
    Color 150, 160, 190
    FontSize 14
    Text 16, GraphicsHeight() - 28, "Distance " + Int(PickedDistance() * 100) / 100.0 + "   surface normal " + Int(PickedNX() * 10) / 10.0 + ", " + Int(PickedNY() * 10) / 10.0 + ", " + Int(PickedNZ() * 10) / 10.0
  EndIf
End Function
