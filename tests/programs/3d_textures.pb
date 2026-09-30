; Textures and materials on the headless engine.
Global tex, loaded
cube = CreateCube()
tex = LoadTexture("assets/none.png")
Print "handle " + tex + ", loaded right away: " + TextureLoaded(tex)
checker = CreateCheckerTexture(64, 8, 255, 0, 0)
TexturePixel checker, 0, 0, 0, 255, 0
ScaleTexture checker, 2, 2
EntityTexture cube, checker
EntityColor cube, 255, 128, 0
EntityAlpha cube, 0.5
EntityShininess cube, 0.8
EntityFX cube, FX_FULLBRIGHT Or FX_FLAT
EntityTexture cube, 0
Print "constants " + FX_FULLBRIGHT + " " + FX_FLAT + " " + FX_TWOSIDED + " " + LIGHT_POINT + " " + KEY_SPACE + " " + KEY_Z

Function Update()
  ; LoadTexture never blocks: the image shows up a frame or so later.
  If TextureLoaded(tex) And Not loaded
    loaded = 1
    Print "loaded by frame " + FrameCount()
  EndIf
  If FrameCount() = 3 Then End
End Function
