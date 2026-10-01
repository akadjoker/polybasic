; Terrains as in Blitz3D: heights 0..1 in steps of 1/255, the grid wraps,
; TerrainY between grid points, collisions and picks on the surface.
Const HEIGHTMAP$ = "../../examples/assets/blitz3d/driver/heightmap_256.bmp"
Global t, ball, bumpy

t = CreateTerrain(8)
Print "size " + TerrainSize(t) + ", flat: " + TerrainHeight(t, 3, 3)
ModifyTerrain t, 2, 2, 1
ModifyTerrain t, 3, 2, 0.5
Print "heights: " + TerrainHeight(t, 2, 2) + " " + TerrainHeight(t, 3, 2)
Print "halfway between them: " + TerrainY(t, 2.5, 99, 2)
ModifyTerrain t, 0, 0, 0.25
Print "the grid wraps: " + TerrainHeight(t, 8, 8) + " = " + TerrainHeight(t, 0, 0) + ", outside: " + TerrainHeight(t, 9, 2)
ScaleEntity t, 10, 20, 10
PositionEntity t, -40, 0, -40
Print "scaled and moved: TerrainY at the peak " + TerrainY(t, -20, 0, -20) + ", TerrainX " + TerrainX(t, -20, 0, -20)

bumpy = LoadTerrain(HEIGHTMAP)
Print "loaded " + TerrainSize(bumpy) + " x " + TerrainSize(bumpy) + ", corner " + TerrainHeight(bumpy, 0, 0) + ", middle " + TerrainHeight(bumpy, 128, 128)
PositionEntity bumpy, 500, 0, 0
EntityPickMode bumpy, PICK_POLYGON
If LinePick(628, 10, 128, 0, -20, 0) Then Print "a pick lands at y " + PickedY()
TerrainShading bumpy, True
TerrainDetail bumpy, 2000, True

; A ball dropped onto the loaded terrain stops on its surface.
Collisions 1, 2, COLLIDE_POLYGON, RESPONSE_SLIDE
EntityType bumpy, 2
ball = CreatePivot()
EntityRadius ball, 0.5
EntityType ball, 1
PositionEntity ball, 628, 5, 128

Function Update()
  ; Read before moving: this step's move is resolved after Update.
  If FrameCount() = 60
    x# = EntityX(ball)
    z# = EntityZ(ball)
    Print "the ball rests at " + x + ", " + EntityY(ball) + ", " + z + " (the ground under it is " + TerrainY(bumpy, x, 0, z) + ")"
    Print "not a power of 2:"
    CreateTerrain 100
  EndIf
  TranslateEntity ball, 0, -0.1, 0
End Function
