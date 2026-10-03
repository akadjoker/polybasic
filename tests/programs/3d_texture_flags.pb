; Blitz3D texture flags: they are kept, clamp the edges, and a sphere or a
; cube map is refused (a sphere map is kept).
tex = CreateTexture(4, 4, 255, 255, 255, TEX_ALPHA + TEX_CLAMPU)
TexturePixel tex, 0, 0, 255, 0, 0, 128
masked = CreateTexture(8, 8, 0, 0, 0, TEX_MASKED)
loaded = LoadTexture("assets/tile.png", 1 + 8)
Print "flags " + TEX_COLOR + " " + TEX_ALPHA + " " + TEX_MASKED + " " + TEX_MIPMAP + " " + TEX_CLAMPU + " " + TEX_CLAMPV
cube = CreateCube()
EntityTexture cube, tex
EntityTexture cube, masked
Print "ok so far"
sphere = LoadTexture("assets/tile.png", 64 + 1)
Print "sphere map " + TEX_SPHEREMAP
LoadTexture "assets/tile.png", 128
