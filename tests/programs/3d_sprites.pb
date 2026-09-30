; Sprites and EntityBlend on the headless engine.
s = CreateSprite()
RotateSprite s, 45
ScaleSprite s, 2, 1
HandleSprite s, 0, -1
SpriteViewMode s, 4
EntityBlend s, 3
glow = LoadSprite("assets/tile.png")
cut = LoadSprite("assets/tile.png", TEX_MASKED)
c = CopyEntity(s)
SpriteViewMode c, 2
Print "sprites " + s + " " + glow + " " + cut + " " + c
cube = CreateCube()
EntityBlend cube, 2
Print "ok so far"
SpriteViewMode s, 5
