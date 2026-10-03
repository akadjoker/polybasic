; Teapot - one of the Blitz3D samples (zlib licence), ported.
;
; A teapot that turns and reflects a picture of the world around it: its
; texture is a sphere map (TEX_SPHEREMAP), a picture of a mirror ball, and
; every point of the teapot shows the part of it that the eye's ray lands on
; once the teapot's surface has reflected it. The reflection moves as the
; teapot turns. The teapot is teapot.x, converted to glTF with
; tools/x2gltf.mjs; the picture comes with the sample.

Graphics3D 800, 600

Global teapot

teapot = LoadMesh("assets/blitz3d/teapot/teapot.glb")
tex = LoadTexture("assets/blitz3d/teapot/spheremap.bmp", TEX_COLOR + TEX_SPHEREMAP)
EntityTexture teapot, tex
EntityFX teapot, FX_FULLBRIGHT

camera = CreateCamera()
PositionEntity camera, 0, 0, -3

Function Update()
  TurnEntity teapot, 0.5, 0.7, 1.1
End Function

Function Draw()
  Color 255, 255, 255
  FontSize 14
  Text 10, 10, "Teapot demo"
  Text 10, 28, "Features spherical reflection mapping"
End Function
