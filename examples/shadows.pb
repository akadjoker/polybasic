; Shadows - the sun and a lamp cast shadows; the shapes can opt out.
;
; Left/Right turn the view, A/D turn the sun.
; 1 sun shadows on/off, 2 lamp shadows on/off,
; 3 the red column casts no shadow, 4 the floor takes none.
;
; A light casts shadows once LightShadows is on. Every shape then casts and
; receives them, unless its EntityFX has FX_NOSHADOWCAST or FX_NOSHADOWRECV.

Graphics3D 800, 600

Global turn, camera, sun, lamp, lampOrbit, column, floor
Global sunOn, lampOn, columnCasts, floorTakes

turn = CreatePivot()
camera = CreateCamera(turn)
CameraClsColor camera, 150, 185, 225
PositionEntity camera, 0, 7, -13
RotateEntity camera, 26, 0, 0

AmbientLight 70, 75, 90

; The sun: a directional light, turned with A/D.
sun = CreateLight()
LightColor sun, 255, 240, 215
RotateEntity sun, 45, -30, 0

; A small orange lamp going round in circles.
lampOrbit = CreatePivot()
lamp = CreateLight(LIGHT_POINT, lampOrbit)
PositionEntity lamp, 3.5, 2.2, 0
LightColor lamp, 255, 150, 60
LightRange lamp, 9
bulb = CreateSphere(12, lamp)
ScaleEntity bulb, 0.15, 0.15, 0.15
EntityColor bulb, 255, 200, 120
EntityFX bulb, FX_FULLBRIGHT + FX_NOSHADOWCAST

floor = CreatePlane(8)
ScaleEntity floor, 12, 1, 12
EntityColor floor, 200, 200, 190

; Things to cast shadows: a ring of shapes around a tall red column.
column = CreateCylinder(20)
ScaleEntity column, 0.4, 2, 0.4
PositionEntity column, 0, 2, 0
EntityColor column, 220, 60, 50
For i = 0 To 5
  Select i Mod 3
    Case 0
      s = CreateCube()
    Case 1
      s = CreateSphere(20)
    Default
      s = CreateCone(20)
  End Select
  a# = i * 60
  PositionEntity s, Cos(a) * 3, 0.7, Sin(a) * 3
  ScaleEntity s, 0.6, 0.7, 0.6
  TurnEntity s, 0, a, 0
  EntityColor s, 90 + i * 25, 160, 230 - i * 25
Next
arch = CreateTorus(32, 0.18)
RotateEntity arch, 90, 0, 0
PositionEntity arch, -5, 1.4, 3
ScaleEntity arch, 1.4, 1.4, 1.4
EntityColor arch, 240, 210, 80

sunOn = True
lampOn = True
columnCasts = True
floorTakes = True
Apply()

; Sets the lights and the shapes' flags from the switches.
Function Apply()
  LightShadows sun, sunOn, 24
  LightShadows lamp, lampOn
  If columnCasts
    EntityFX column, 0
  Else
    EntityFX column, FX_NOSHADOWCAST
  EndIf
  If floorTakes
    EntityFX floor, 0
  Else
    EntityFX floor, FX_NOSHADOWRECV
  EndIf
End Function

Function Update()
  If KeyDown(KEY_LEFT) Then TurnEntity turn, 0, 1.2, 0
  If KeyDown(KEY_RIGHT) Then TurnEntity turn, 0, -1.2, 0
  If KeyDown(KEY_A) Then TurnEntity sun, 0, 1.5, 0, True
  If KeyDown(KEY_D) Then TurnEntity sun, 0, -1.5, 0, True
  TurnEntity lampOrbit, 0, 0.8, 0

  If KeyHit(KEY_1) Then sunOn = Not sunOn
  If KeyHit(KEY_2) Then lampOn = Not lampOn
  If KeyHit(KEY_3) Then columnCasts = Not columnCasts
  If KeyHit(KEY_4) Then floorTakes = Not floorTakes
  Apply()
End Function

Function OnOff$(on)
  If on Then Return "on"
  Return "off"
End Function

Function Draw()
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "Shadows"
  FontSize 15
  Text 16, 46, "1  sun shadows: " + OnOff(sunOn)
  Text 16, 66, "2  lamp shadows: " + OnOff(lampOn)
  Text 16, 86, "3  red column casts: " + OnOff(columnCasts)
  Text 16, 106, "4  floor takes shadows: " + OnOff(floorTakes)
  Text 16, GraphicsHeight() - 28, "Left/Right turn the view   A/D turn the sun"
End Function
