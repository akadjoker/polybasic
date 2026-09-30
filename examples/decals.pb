; Decals - paint splats and scorch marks pressed onto whatever you click.
;
; Left click: a splat of paint. Right click (or S + click): a scorch mark.
; Left/Right turn the view. C cleans everything.
;
; CreateDecal cuts a square of texture to the shapes under it: it wraps
; over the edge of the floor onto the wall, sits flat on the ball, and one
; pressed onto the sliding crate goes with it.

Graphics3D 800, 600

Const MAX_MARKS = 60

Type Mark
  Field e
End Type

Global turn, camera, crate, splat, scorch, marks, clock#

turn = CreatePivot()
camera = CreateCamera(turn)
CameraClsColor camera, 60, 70, 90
PositionEntity camera, 0, 4, -8
RotateEntity camera, 22, 0, 0

light = CreateLight()
RotateEntity light, 50, -25, 0
LightShadows light, True, 20
AmbientLight 100, 100, 115

; A floor with a wall behind and one to the left.
floor = CreatePlane(8)
ScaleEntity floor, 6, 1, 6
EntityColor floor, 210, 205, 195
back = CreateCube()
ScaleEntity back, 6, 2.5, 0.2
PositionEntity back, 0, 2.5, 6.2
EntityColor back, 190, 200, 215
left = CreateCube()
ScaleEntity left, 0.2, 2.5, 6
PositionEntity left, -6.2, 2.5, 0
EntityColor left, 190, 200, 215

ball = CreateSphere(32)
ScaleEntity ball, 1.2, 1.2, 1.2
PositionEntity ball, -2.2, 1.2, 1.5
EntityColor ball, 235, 235, 235

steps = CreateCube()
ScaleEntity steps, 1, 0.5, 1
PositionEntity steps, 2.8, 0.5, 3
EntityColor steps, 180, 170, 150
top = CreateCube()
ScaleEntity top, 1, 0.5, 0.5
PositionEntity top, 2.8, 1.5, 3.5
EntityColor top, 180, 170, 150

; This crate slides from side to side: marks on it go along.
crate = CreateCube()
ScaleEntity crate, 0.7, 0.7, 0.7
EntityColor crate, 200, 150, 90

; Clicks find the shapes by their triangles.
EntityPickMode floor, PICK_POLYGON
EntityPickMode back, PICK_POLYGON
EntityPickMode left, PICK_POLYGON
EntityPickMode ball, PICK_POLYGON
EntityPickMode steps, PICK_POLYGON
EntityPickMode top, PICK_POLYGON
EntityPickMode crate, PICK_POLYGON

; --- The pictures ----------------------------------------------------------

; A splat: a white blob with a ragged edge and a few drops, on nothing.
; Each splat is coloured with EntityColor.
splat = CreateTexture(64, 64, 255, 255, 255, TEX_ALPHA)
For y = 0 To 63
  For x = 0 To 63
    dx# = x - 31.5
    dy# = y - 31.5
    r# = Sqr(dx * dx + dy * dy)
    a# = ATan2(dy, dx)
    edge# = 18 + 4 * Sin(a * 5) + 3 * Sin(a * 13 + 40)
    alpha = 0
    If r < edge Then alpha = 235
    ; Drops thrown out along a few directions.
    For k = 0 To 5
      da# = k * 60 + 17
      cx# = 31.5 + Cos(da) * (24 + k Mod 3 * 2)
      cy# = 31.5 + Sin(da) * (24 + k Mod 3 * 2)
      If (x - cx) * (x - cx) + (y - cy) * (y - cy) < 6 + k Mod 2 * 4 Then alpha = 235
    Next
    TexturePixel splat, x, y, 255, 255, 255, alpha
  Next
Next

; A scorch mark: dark in the middle, white (no change) around it. It is
; drawn multiplying what is under it (EntityBlend 2), so it darkens, and
; lit by nothing (FX_FULLBRIGHT), so its white is exactly no change.
scorch = CreateTexture(64, 64, 255, 255, 255)
For y = 0 To 63
  For x = 0 To 63
    dx# = x - 31.5
    dy# = y - 31.5
    r# = Sqr(dx * dx + dy * dy) / 31.5
    a# = ATan2(dy, dx)
    r = r * (1 + 0.12 * Sin(a * 7) + 0.08 * Sin(a * 3 + 50))
    If r < 1
      dark# = r * r
      TexturePixel scorch, x, y, 30 + 225 * dark, 25 + 230 * dark, 20 + 235 * dark
    EndIf
  Next
Next

Function Update()
  If KeyDown(KEY_LEFT) Then TurnEntity turn, 0, 1.2, 0
  If KeyDown(KEY_RIGHT) Then TurnEntity turn, 0, -1.2, 0
  If KeyHit(KEY_C) Then CleanUp()

  clock = clock + DeltaTime()
  PositionEntity crate, Sin(clock * 40) * 2.5, 0.7, -1.5

  leftClick = MouseHit(MOUSE_LEFT)
  burn = MouseHit(MOUSE_RIGHT) Or (leftClick And KeyDown(KEY_S))
  paint = leftClick And Not KeyDown(KEY_S)
  If burn Or paint
    hit = CameraPick(camera, MouseX(), MouseY())
    If hit Then Press(hit, burn)
  EndIf
End Function

; A mark where the pointer picked `hit`. On the crate it becomes the crate's
; own (it moves with it); anywhere else it is pressed onto everything there.
Function Press(hit, burn)
  target = 0
  If hit = crate Then target = crate
  m.Mark = New Mark
  If burn
    m\e = CreateDecal(scorch, PickedX(), PickedY(), PickedZ(), PickedNX(), PickedNY(), PickedNZ(), Rnd(1.2, 1.8), Rnd(360), target)
    ; Multiplied, and lit by nothing: its white leaves the surface as it is.
    EntityBlend m\e, 2
    EntityFX m\e, FX_FULLBRIGHT
  Else
    m\e = CreateDecal(splat, PickedX(), PickedY(), PickedZ(), PickedNX(), PickedNY(), PickedNZ(), Rnd(0.8, 1.4), Rnd(360), target)
    Select Rand(1, 5)
      Case 1
        EntityColor m\e, 230, 50, 60
      Case 2
        EntityColor m\e, 40, 120, 230
      Case 3
        EntityColor m\e, 250, 200, 40
      Case 4
        EntityColor m\e, 60, 190, 90
      Default
        EntityColor m\e, 170, 70, 210
    End Select
  EndIf
  marks = marks + 1
  ; The oldest goes when there are too many.
  If marks > MAX_MARKS
    old.Mark = First Mark
    FreeEntity old\e
    Delete old
    marks = marks - 1
  EndIf
End Function

Function CleanUp()
  For m.Mark = Each Mark
    FreeEntity m\e
  Next
  Delete Each Mark
  marks = 0
End Function

Function Draw()
  Color 240, 240, 250
  FontSize 22
  Text 16, 14, "Decals"
  FontSize 15
  Text 16, 46, "Marks " + marks + " (the oldest goes after " + MAX_MARKS + ")"
  Text 16, GraphicsHeight() - 48, "Click: paint   Right click or S + click: scorch"
  Text 16, GraphicsHeight() - 28, "Left/Right turn the view   C clean up"
End Function
