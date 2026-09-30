; Sprites - a campfire at night: glowing sparks, soft smoke, and signposts
; that always stand up and face you.
;
; Left/Right turn the view. Space puts more wood on the fire.
;
; A sprite is a square that turns to face the camera. The sparks glow
; (EntityBlend 3 adds them to what is behind), the smoke blends by its
; alpha, and the posts use SpriteViewMode 4: upright, turning only with the
; camera's yaw, as trees and signs far away do. Every picture is painted
; by the program.

Graphics3D 800, 600

Const MAX_SPARKS = 90
Const MAX_SMOKE = 30

Type Spark
  Field s
  Field vx#, vy#, vz#, life#
End Type

Type Smoke
  Field s
  Field vx#, life#, turn#
End Type

Global turn, glow, puff, flame, fire#, clock#

turn = CreatePivot()
camera = CreateCamera(turn)
CameraClsColor camera, 12, 16, 34
PositionEntity camera, 0, 2.6, -9
RotateEntity camera, 12, 0, 0
AmbientLight 30, 32, 50

; The fire lights the ground around it.
flame = CreateLight(LIGHT_POINT)
PositionEntity flame, 0, 1, 0
LightColor flame, 255, 150, 60
LightRange flame, 9

ground = CreatePlane(4)
ScaleEntity ground, 20, 1, 20
EntityColor ground, 90, 80, 70

; Logs.
For i = 0 To 3
  log = CreateCylinder(10)
  ScaleEntity log, 0.12, 0.7, 0.12
  RotateEntity log, 90, i * 45, 0
  PositionEntity log, 0, 0.15, 0
  EntityColor log, 90, 60, 40
Next

; A round glow, bright in the middle: sparks and the fire's heart.
glow = CreateTexture(32, 32, 0, 0, 0)
For y = 0 To 31
  For x = 0 To 31
    d# = Sqr((x - 15.5) * (x - 15.5) + (y - 15.5) * (y - 15.5)) / 15.5
    If d < 1
      k# = (1 - d) * (1 - d)
      TexturePixel glow, x, y, 255 * k, 190 * k, 90 * k
    EndIf
  Next
Next

; A puff of smoke: white, solid in the middle, fading to nothing (each
; puff is tinted grey with EntityColor).
puff = CreateTexture(32, 32, 255, 255, 255, TEX_ALPHA)
For y = 0 To 31
  For x = 0 To 31
    d# = Sqr((x - 15.5) * (x - 15.5) + (y - 15.5) * (y - 15.5)) / 15.5
    a = 0
    If d < 1 Then a = 150 * (1 - d * d)
    TexturePixel puff, x, y, 255, 255, 255, a
  Next
Next

; The heart of the fire: two big glows.
heart = CreateSprite()
EntityTexture heart, glow
EntityBlend heart, 3
PositionEntity heart, 0, 0.6, 0
ScaleSprite heart, 1.2, 1.2
heart2 = CreateSprite()
EntityTexture heart2, glow
EntityBlend heart2, 3
PositionEntity heart2, 0, 0.9, 0
ScaleSprite heart2, 0.7, 1.1

; Signposts all around: upright sprites (view mode 4), their foot on the
; ground (HandleSprite 0, -1).
sign = CreateTexture(32, 64, 0, 0, 0, TEX_MASKED)
For y = 0 To 63
  For x = 0 To 31
    If x >= 14 And x <= 17 Then TexturePixel sign, x, y, 120, 85, 50
    If y >= 6 And y <= 22 And x >= 2 And x <= 29 Then TexturePixel sign, x, y, 200, 160, 100
    If y >= 12 And y <= 15 And x >= 7 And x <= 24 Then TexturePixel sign, x, y, 90, 60, 40
  Next
Next
For i = 0 To 7
  post = CreateSprite()
  EntityTexture post, sign
  EntityFX post, 0                ; lit by the fire, not glowing
  SpriteViewMode post, 4
  HandleSprite post, 0, -1
  ScaleSprite post, 0.5, 1
  ang# = i * 45 + 20
  PositionEntity post, Cos(ang) * 3.6, 0, Sin(ang) * 3.6
Next

fire = 1

Function Update()
  If KeyDown(KEY_LEFT) Then TurnEntity turn, 0, 1.2, 0
  If KeyDown(KEY_RIGHT) Then TurnEntity turn, 0, -1.2, 0
  If KeyHit(KEY_SPACE) Then fire = 2.5
  ; The fire settles back down after a log.
  fire = Max(1, fire - DeltaTime() * 0.5)
  clock = clock + DeltaTime()
  LightRange flame, 8 + fire * 2 + Sin(clock * 900) * 0.5

  ; New sparks and smoke, more when the fire is high.
  If Rnd(1) < 0.5 * fire Then AddSpark()
  If Rnd(1) < 0.12 * fire Then AddSmoke()

  For p.Spark = Each Spark
    p\life = p\life - DeltaTime()
    If p\life <= 0
      FreeEntity p\s
      Delete p
    Else
      p\vy = p\vy - 1.5 * DeltaTime()
      TranslateEntity p\s, p\vx * DeltaTime(), p\vy * DeltaTime(), p\vz * DeltaTime()
      EntityAlpha p\s, Min(1, p\life)
    EndIf
  Next
  For m.Smoke = Each Smoke
    m\life = m\life + DeltaTime()
    If m\life > 5
      FreeEntity m\s
      Delete m
    Else
      ; Rises, drifts, grows and fades.
      TranslateEntity m\s, m\vx * DeltaTime(), 0.8 * DeltaTime(), 0
      grow# = 0.4 + m\life * 0.35
      ScaleSprite m\s, grow, grow
      RotateSprite m\s, m\turn * m\life
      EntityAlpha m\s, 1 - m\life / 5
    EndIf
  Next
End Function

Function AddSpark()
  count = 0
  For p.Spark = Each Spark
    count = count + 1
  Next
  If count >= MAX_SPARKS Then Return
  p.Spark = New Spark
  p\s = CreateSprite()
  EntityTexture p\s, glow
  EntityBlend p\s, 3
  ScaleSprite p\s, 0.06, 0.06
  PositionEntity p\s, Rnd(-0.3, 0.3), 0.5, Rnd(-0.3, 0.3)
  p\vx = Rnd(-0.4, 0.4)
  p\vy = Rnd(1.5, 3.2)
  p\vz = Rnd(-0.4, 0.4)
  p\life = Rnd(1, 2.2)
End Function

Function AddSmoke()
  count = 0
  For m.Smoke = Each Smoke
    count = count + 1
  Next
  If count >= MAX_SMOKE Then Return
  m.Smoke = New Smoke
  m\s = CreateSprite()
  EntityTexture m\s, puff
  EntityColor m\s, 120, 112, 118
  PositionEntity m\s, Rnd(-0.2, 0.2), 1.3, Rnd(-0.2, 0.2)
  m\vx = Rnd(0.1, 0.4)
  m\turn = Rnd(-40, 40)
End Function

Function Draw()
  Color 240, 230, 210
  FontSize 22
  Text 16, 14, "Sprites"
  FontSize 15
  Text 16, 46, "Sparks glow (EntityBlend 3), smoke blends (TEX_ALPHA),"
  Text 16, 66, "the signs stand upright (SpriteViewMode 4)"
  Text 16, GraphicsHeight() - 28, "Left/Right turn the view   Space more wood"
End Function
