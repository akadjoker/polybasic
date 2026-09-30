; Crate Tower - knock the tower down with heavy balls.
;
; Mouse or finger: click or tap to throw a ball at that spot.
; Left/Right turn the view, R builds a new tower.
;
; Everything that falls, tumbles and bounces here is the physics engine:
; the program only gives each thing a body and throws the balls.

Graphics3D 800, 600

Const LEVELS = 6
Const ACROSS = 4

Type Crate
  Field mesh
  Field x#, y#, z#     ; where it was built
End Type

Type Ball
  Field mesh
  Field age#
End Type

Global camera, turn, crateTexture, thrown

turn = CreatePivot()
camera = CreateCamera(turn)
CameraClsColor camera, 120, 170, 220
PositionEntity camera, 0, 4, -11
RotateEntity camera, 14, 0, 0

sun = CreateLight()
RotateEntity sun, 50, -40, 0
AmbientLight 90, 96, 110

; The ground: a static body, it never moves.
ground = CreateCube()
ScaleEntity ground, 7, 0.25, 7
PositionEntity ground, 0, -0.25, 0
EntityColor ground, 110, 150, 90
EntityBody ground, BODY_STATIC
EntityPickMode ground, PICK_BOX

crateTexture = CreateCheckerTexture(64, 4, 190, 140, 80, 160, 110, 60)
BuildTower()

Function BuildTower()
  For c.Crate = Each Crate
    FreeEntity c\mesh
  Next
  Delete Each Crate
  For level = 0 To LEVELS - 1
    For i = 0 To ACROSS - 1
      c.Crate = New Crate
      c\mesh = CreateCube()
      ScaleEntity c\mesh, 0.45, 0.45, 0.45
      ; Every other row is shifted by half a crate, like bricks.
      c\x = (i - (ACROSS - 1) / 2.0) * 0.92 + (level Mod 2) * 0.3
      c\y = 0.46 + level * 0.92
      c\z = 1.5
      PositionEntity c\mesh, c\x, c\y, c\z
      EntityTexture c\mesh, crateTexture
      EntityPickMode c\mesh, PICK_BOX
      EntityBody c\mesh
      BodyFriction c\mesh, 0.8
    Next
  Next
End Function

Function Throw(x#, y#, z#)
  b.Ball = New Ball
  b\mesh = CreateSphere(16)
  ScaleEntity b\mesh, 0.35, 0.35, 0.35
  EntityColor b\mesh, 70, 70, 80
  EntityShininess b\mesh, 0.8
  ; From just below the camera, towards the target.
  sx# = EntityX(camera, True)
  sy# = EntityY(camera, True) - 0.8
  sz# = EntityZ(camera, True)
  PositionEntity b\mesh, sx, sy, sz
  EntityBody b\mesh, BODY_DYNAMIC, SHAPE_SPHERE
  BodyMass b\mesh, 4
  dx# = x - sx
  dy# = y - sy
  dz# = z - sz
  length# = Sqr(dx * dx + dy * dy + dz * dz)
  ; 22 units a second, aimed a little high to allow for the drop.
  SetVelocity b\mesh, dx / length * 22, dy / length * 22 + length * 0.4, dz / length * 22
  thrown = thrown + 1
End Function

Function Update()
  If KeyDown(KEY_LEFT) Then TurnEntity turn, 0, 1.5, 0
  If KeyDown(KEY_RIGHT) Then TurnEntity turn, 0, -1.5, 0
  If KeyHit(KEY_R) Then BuildTower()

  If MouseHit()
    ; Aim at whatever is under the pointer, or at the tower.
    If CameraPick(camera, MouseX(), MouseY())
      Throw(PickedX(), PickedY(), PickedZ())
    Else
      Throw(0, 2.5, 1.5)
    EndIf
  EndIf

  ; Old balls go away.
  For b.Ball = Each Ball
    b\age = b\age + DeltaTime()
    If b\age > 10 Or EntityY(b\mesh) < -20
      FreeEntity b\mesh
      Delete b
    EndIf
  Next
End Function

Function Draw()
  total = 0
  down = 0
  For c.Crate = Each Crate
    total = total + 1
    dx# = EntityX(c\mesh) - c\x
    dy# = EntityY(c\mesh) - c\y
    dz# = EntityZ(c\mesh) - c\z
    If dx * dx + dy * dy + dz * dz > 0.25 Then down = down + 1
  Next
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "Knocked over " + down + " of " + total
  FontSize 15
  Text 16, 44, "Balls thrown " + thrown
  Text 16, GraphicsHeight() - 28, "Click to throw   Left/Right turn   R new tower"
  If down = total And total > 0
    Color 255, 255, 255
    FontSize 40
    Text GraphicsWidth() / 2, GraphicsHeight() / 2, "All down!", True, True
  EndIf
  ; A cross at the pointer.
  Color 255, 255, 255
  Line MouseX() - 8, MouseY(), MouseX() + 8, MouseY()
  Line MouseX(), MouseY() - 8, MouseX(), MouseY() + 8
End Function
