; Ribbon trails - a sword's swing, comets, and a ribbon you draw.
;
; Space swings the sword. Hold the mouse button (or a finger) and move to
; draw with light. 1 short, 2 medium, 3 long trails.
;
; A trail is the ribbon between two points (two pivots) as they move: it
; grows smoothly where they went and fades with age.

Graphics3D 800, 600

Type Comet
  Field body, trail, orbit
  Field speed#
End Type

Global camera, hand, blade, swordTrail, swing#, board, wand, wandTrail, life#, drawing

camera = CreateCamera()
CameraClsColor camera, 8, 10, 24
PositionEntity camera, 0, 1, -9

light = CreateLight()
RotateEntity light, 30, -30, 0
AmbientLight 60, 60, 80

; --- The sword -----------------------------------------------------------------

; The hand turns; the blade hangs from it. The trail runs between a point
; near the hilt and the tip.
hand = CreatePivot()
PositionEntity hand, -2.8, -1.2, 0
blade = CreateCube(hand)
ScaleEntity blade, 0.06, 1.3, 0.02
PositionEntity blade, 0, 1.6, 0
EntityColor blade, 220, 225, 235
EntityShininess blade, 1
guard = CreateCube(hand)
ScaleEntity guard, 0.35, 0.05, 0.08
PositionEntity guard, 0, 0.3, 0
EntityColor guard, 200, 160, 60
grip = CreateCylinder(8, True, hand)
ScaleEntity grip, 0.05, 0.25, 0.05
EntityColor grip, 90, 50, 30
near = CreatePivot(hand)
PositionEntity near, 0, 0.6, 0
tip = CreatePivot(hand)
PositionEntity tip, 0, 2.9, 0
swordTrail = CreateTrail(near, tip)
TrailColor swordTrail, 120, 200, 255
TrailFadeColor swordTrail, 40, 60, 255, 0
RotateEntity hand, 0, 0, 60

; --- Comets --------------------------------------------------------------------

For i = 0 To 2
  c.Comet = New Comet
  c\orbit = CreatePivot()
  PositionEntity c\orbit, 2.2, 1, 0
  RotateEntity c\orbit, 60 * i - 50, 0, 25 * i - 20
  c\body = CreateSphere(10, c\orbit)
  PositionEntity c\body, 1.6 + i * 0.35, 0, 0
  ScaleEntity c\body, 0.1, 0.1, 0.1
  EntityFX c\body, FX_FULLBRIGHT
  a = CreatePivot(c\body)
  PositionEntity a, 0, 1.2, 0          ; in the body's space: 0.12 above
  b = CreatePivot(c\body)
  PositionEntity b, 0, -1.2, 0
  c\trail = CreateTrail(a, b)
  c\speed = 90 + i * 35
  Select i
    Case 0
      EntityColor c\body, 255, 200, 120
      TrailColor c\trail, 255, 160, 60
    Case 1
      EntityColor c\body, 160, 255, 200
      TrailColor c\trail, 60, 255, 150
    Default
      EntityColor c\body, 255, 150, 230
      TrailColor c\trail, 255, 80, 200
  End Select
Next

; --- The wand: follows the pointer on an invisible board -----------------------

board = CreatePlane()
RotateEntity board, -90, 0, 0
ScaleEntity board, 20, 1, 20
PositionEntity board, 0, 0, 1
EntityAlpha board, 0
EntityPickMode board, PICK_POLYGON
wand = CreatePivot()
w1 = CreatePivot(wand)
PositionEntity w1, 0, 0.12, 0
w2 = CreatePivot(wand)
PositionEntity w2, 0, -0.12, 0
wandTrail = CreateTrail(w1, w2)
TrailColor wandTrail, 255, 240, 140
TrailFadeColor wandTrail, 255, 60, 30, 0
TrailEmit wandTrail, False

SetLife(0.6)

Function SetLife(seconds#)
  life = seconds
  TrailLife swordTrail, seconds * 0.5
  For c.Comet = Each Comet
    TrailLife c\trail, seconds
  Next
  TrailLife wandTrail, seconds * 2
End Function

Function Update()
  If KeyHit(KEY_1) Then SetLife(0.25)
  If KeyHit(KEY_2) Then SetLife(0.6)
  If KeyHit(KEY_3) Then SetLife(1.5)

  ; A swing: from the right shoulder over to the left, and back to rest.
  If KeyHit(KEY_SPACE) And swing <= 0 Then swing = 1
  If swing > 0
    swing = swing - DeltaTime() * 2.2
    If swing < 0 Then swing = 0
    t# = 1 - swing
    RotateEntity hand, 0, 0, 60 - 150 * Sin(t * 180)
  EndIf

  For c.Comet = Each Comet
    TurnEntity c\orbit, 0, c\speed * DeltaTime(), 0
  Next

  ; Drawing: the wand goes where the pointer is on the board while the
  ; button is held; letting go stops the ribbon, which fades.
  If MouseDown(MOUSE_LEFT)
    If CameraPick(camera, MouseX(), MouseY()) = board
      If Not drawing
        ; A jump to the new spot, not a stroke from the old one.
        ClearTrail wandTrail
        PositionEntity wand, PickedX(), PickedY(), PickedZ()
        TrailEmit wandTrail, True
        drawing = True
      Else
        PositionEntity wand, PickedX(), PickedY(), PickedZ()
      EndIf
    EndIf
  ElseIf drawing
    TrailEmit wandTrail, False
    drawing = False
  EndIf
End Function

Function Draw()
  Color 230, 235, 255
  FontSize 22
  Text 16, 14, "Ribbon trails"
  FontSize 15
  Text 16, 46, "Trails last " + life + " s (the sword's half, your ribbon's twice)"
  Text 16, GraphicsHeight() - 28, "Space swing   Hold the mouse and move to draw   1 2 3 trail length"
End Function
