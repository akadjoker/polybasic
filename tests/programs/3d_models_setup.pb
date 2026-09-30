; A model set up in the main body, before it has arrived: commands that
; need its parts wait for it, and a model picks and collides as a whole.
Const KENNEY$ = "../../examples/assets/kenney/"
Global ground, coin, copy1, copy2, crate, ball

ground = LoadMesh(Asset("platform-large.glb"))
EntityPickMode ground, PICK_POLYGON
EntityType ground, 2
EntityBody ground, BODY_STATIC

coin = LoadMesh(Asset("coin.glb"))
copy1 = CopyEntity(coin)
PositionEntity copy1, 1, 2, 0
copy2 = CopyEntity(copy1)
PositionEntity copy2, -1, 2, 0
Animate coin, 1

crate = LoadMesh(Asset("brick.glb"))
PositionEntity crate, 0, 3, 1.5
EntityBody crate
BodyMass crate, 2
SetVelocity crate, 1, 0, 0
Print "in main: loaded " + MeshLoaded(crate) + ", has a body " + EntityHasBody(crate) + ", vx " + BodyVX(crate) + ", copies have " + CountChildren(copy1) + " parts"

; A ball that collides with the ground model.
ball = CreatePivot()
EntityRadius ball, 0.3
EntityType ball, 1
Collisions 1, 2, COLLIDE_POLYGON, RESPONSE_STOP
PositionEntity ball, 1.5, 2, -1.5

Function Update()
  f = FrameCount()
  If f = 1
    Print "first Update: copies have " + CountChildren(copy1) + " and " + CountChildren(copy2) + " parts, their own: " + (GetChild(copy1, 1) <> GetChild(coin, 1))
    Print "copy 2 kept its place: " + EntityX(copy2) + ", the coin model has no animations: animating " + Animating(coin)
    Print "the crate got its body, mass 2 and the push: vx " + BodyVX(crate)
    ; Picking a model gives the model, not the part that was hit.
    Print "picked the ground model: " + (LinePick(0, 5, 0, 0, -10, 0) = ground) + " at y " + PickedY()
  EndIf
  If f = 60
    Print "the ball stopped on the ground model: " + (EntityCollided(ball, 2) = ground) + ", y " + EntityY(ball)
    Print "the crate landed on it: " + (ContactEntity(crate, 1) = ground) + ", y " + (Abs(EntityY(crate) - 0.5) < 0.02)
    End
  EndIf
  TranslateEntity ball, 0, -0.2, 0
End Function

; A name made at run time, not in quotes: the model arrives after main.
Function Asset$(name$)
  Return KENNEY + name
End Function
