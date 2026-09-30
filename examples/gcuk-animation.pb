; Object Animation - Paul Gerfen's Blitz3D tutorial (GCUK_Tuts/animation.bb,
; www.gamecoding.co.uk), ported.
;
; A gargoyle walks towards you (frames 32 to 46 of its MD2 file), then
; stands and breathes (frames 0 to 31).

Graphics3D 800, 600

Global man, dist

camera = CreateCamera()
CameraViewport camera, 0, 0, 800, 600

light = CreateLight()

man = LoadMD2("assets/blitz3d/gcuk/gargoyle.md2")
PositionEntity man, 0, -35, 600
RotateEntity man, 0, 180, 0

AnimateMD2 man, ANIM_LOOP, 0.1, 32, 46

Function Update()
  If dist < 970 Then MoveEntity man, 0, 0, 0.5
  If dist = 970 Then AnimateMD2 man, ANIM_LOOP, 0.05, 0, 31
  dist = dist + 1
End Function

Function Draw()
  Text 320, 500, "An Animated MD2 Demo"
End Function
