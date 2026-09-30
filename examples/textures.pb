; Texture flags - a fence, a stained-glass window and a tiled sign.
;
; Left/Right turn the view.
; 1 the fence with or without TEX_MASKED, 2 the window with or without
; TEX_ALPHA, 3 the sign with or without TEX_CLAMPU + TEX_CLAMPV.
;
; The same pictures are painted into two textures each, one with the flag
; and one without, and the keys swap them: the difference is the flag.

Graphics3D 800, 600

Global turn, fence, window, sign
Global fenceMasked, fencePlain, glassAlpha, glassPlain, signClamped, signTiled
Global masked, alpha, clamped, clock#

turn = CreatePivot()
camera = CreateCamera(turn)
CameraClsColor camera, 170, 200, 230
PositionEntity camera, 0, 2.2, -8
RotateEntity camera, 8, 0, 0

light = CreateLight()
RotateEntity light, 40, -30, 0
AmbientLight 120, 120, 130

floor = CreatePlane(4)
ScaleEntity floor, 12, 1, 12
EntityTexture floor, CreateCheckerTexture(64, 8, 120, 160, 90, 100, 140, 75)

; Flat panels (planes stood up), seen from both sides.

; Something colourful behind, to be seen through the fence and the glass.
Global ball
ball = CreateSphere(24)
PositionEntity ball, 0, 1.3, 3
ScaleEntity ball, 1.1, 1.1, 1.1
EntityColor ball, 240, 120, 40

; --- The fence: planks, with black gaps between them ---------------------
fenceMasked = CreateTexture(64, 64, 0, 0, 0, TEX_MASKED)
fencePlain = CreateTexture(64, 64, 0, 0, 0)
PaintFence(fenceMasked)
PaintFence(fencePlain)

Function PaintFence(t)
  For y = 0 To 63
    For x = 0 To 63
      ; Four upright planks with pointed tops, two rails across them.
      plank = (x Mod 16) >= 2 And (x Mod 16) <= 13
      top = y >= Abs((x Mod 16) - 7.5) * 0.8
      rail = (y >= 20 And y <= 25) Or (y >= 46 And y <= 51)
      If (plank And top) Or rail
        grain = 20 * Sin(y * 25 + x * 3)
        TexturePixel t, x, y, 170 + grain, 120 + grain, 70
      EndIf
    Next
  Next
End Function

fence = CreatePlane()
RotateEntity fence, -90, 0, 0
ScaleEntity fence, 1.4, 1, 1.2
PositionEntity fence, -3.2, 1.2, 0
EntityFX fence, FX_TWOSIDED

; --- The window: coloured panes, half see-through, dark lead lines -------
glassAlpha = CreateTexture(64, 64, 0, 0, 0, TEX_ALPHA)
glassPlain = CreateTexture(64, 64, 0, 0, 0)
PaintGlass(glassAlpha)
PaintGlass(glassPlain)

Function PaintGlass(t)
  For y = 0 To 63
    For x = 0 To 63
      If x Mod 16 < 2 Or y Mod 16 < 2 Or x = 63 Or y = 63
        TexturePixel t, x, y, 40, 40, 45, 255          ; lead: solid
      Else
        Select ((x / 16) + (y / 16) * 2) Mod 4
          Case 0
            TexturePixel t, x, y, 230, 60, 60, 110
          Case 1
            TexturePixel t, x, y, 60, 120, 230, 110
          Case 2
            TexturePixel t, x, y, 250, 210, 60, 110
          Default
            TexturePixel t, x, y, 90, 200, 110, 110
        End Select
      EndIf
    Next
  Next
End Function

window = CreatePlane()
RotateEntity window, -90, 0, 0
ScaleEntity window, 1.2, 1, 1.2
PositionEntity window, 0, 1.3, 0
EntityFX window, FX_TWOSIDED

; --- The sign: a picture with a border, 3 x 3 times over it ---------------
signClamped = CreateTexture(32, 32, 250, 250, 240, TEX_CLAMPU + TEX_CLAMPV)
signTiled = CreateTexture(32, 32, 250, 250, 240)
PaintSign(signClamped)
PaintSign(signTiled)

Function PaintSign(t)
  For y = 0 To 31
    For x = 0 To 31
      edge = x < 3 Or y < 3 Or x > 28 Or y > 28
      d# = Sqr((x - 15.5) * (x - 15.5) + (y - 15.5) * (y - 15.5))
      If edge
        TexturePixel t, x, y, 40, 90, 170
      ElseIf d < 8
        TexturePixel t, x, y, 220, 50, 60
      EndIf
    Next
  Next
  ; Three times across and down: tiled, or once with its edge pixels
  ; carried on beyond it.
  ScaleTexture t, 3, 3
End Function

sign = CreatePlane()
RotateEntity sign, -90, 0, 0
ScaleEntity sign, 1.2, 1, 1.2
PositionEntity sign, 3.2, 1.3, 0
EntityFX sign, FX_TWOSIDED

masked = True
alpha = True
clamped = True
Apply()

Function Apply()
  If masked
    EntityTexture fence, fenceMasked
  Else
    EntityTexture fence, fencePlain
  EndIf
  If alpha
    EntityTexture window, glassAlpha
  Else
    EntityTexture window, glassPlain
  EndIf
  If clamped
    EntityTexture sign, signClamped
  Else
    EntityTexture sign, signTiled
  EndIf
End Function

Function Update()
  If KeyDown(KEY_LEFT) Then TurnEntity turn, 0, 1.2, 0
  If KeyDown(KEY_RIGHT) Then TurnEntity turn, 0, -1.2, 0
  If KeyHit(KEY_1) Then masked = Not masked
  If KeyHit(KEY_2) Then alpha = Not alpha
  If KeyHit(KEY_3) Then clamped = Not clamped
  Apply()
  ; The ball bobs behind, so what shows through changes.
  clock = clock + DeltaTime()
  PositionEntity ball, Sin(clock * 50) * 3.5, 1.3, 3
End Function

Function Flag$(on, name$)
  If on Then Return name
  Return "no flag"
End Function

Function Draw()
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "Texture flags"
  FontSize 15
  Text 16, 46, "1  fence: " + Flag(masked, "TEX_MASKED (black left out)")
  Text 16, 66, "2  window: " + Flag(alpha, "TEX_ALPHA (panes see-through)")
  Text 16, 86, "3  sign: " + Flag(clamped, "TEX_CLAMPU + TEX_CLAMPV (edges carried on)")
  Text 16, GraphicsHeight() - 28, "Left/Right turn the view"
End Function
