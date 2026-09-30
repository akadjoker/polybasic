; glTF models (Kenney, CC0) with picking, collisions, physics and animation.
Const KENNEY$ = "../../examples/assets/kenney/"
Global platform, guy, ball, crate, walker

platform = LoadMesh(KENNEY + "platform-large.glb")
guy = LoadMesh(KENNEY + "character.glb")
PositionEntity guy, 0, 3, 0
Print "right after LoadMesh: loaded " + MeshLoaded(platform) + ", children " + CountChildren(platform)

Function Update()
  f = FrameCount()
  If f = 1
    Print "platform: loaded " + MeshLoaded(platform) + ", part '" + EntityName(GetChild(platform, 1)) + "'"
    Print "character parts: " + EntityName(GetChild(guy, 1)) + " > " + EntityName(GetChild(GetChild(guy, 1), 1))
    Print "animations: " + CountAnimations(guy) + ", walk is number " + FindAnimation(guy, "walk")

    ; Picking the platform's triangles from above.
    top = GetChild(platform, 1)
    EntityPickMode top, PICK_POLYGON
    If LinePick(0.3, 5, 0.2, 0, -10, 0) = top Then Print "platform top at y " + PickedY() + ", normal y " + PickedNY()

    ; A ball with collisions dropped on the model's triangles.
    ball = CreatePivot()
    EntityRadius ball, 0.25
    EntityType ball, 1
    Collisions 1, 2, COLLIDE_POLYGON, RESPONSE_STOP
    EntityType top, 2
    PositionEntity ball, -0.4, 2, 0.3
    ResetEntity ball

    ; Physics: the platform model as exact triangles, the character as a
    ; box around all its parts.
    EntityBody platform, BODY_STATIC
    EntityBody guy
    BodyLockRotation guy, 1, 1, 1

    ; A left leg is on the model's left: negative x.
    Print "left leg x " + EntityX(FindChild(guy, "leg-left")) + ", right leg x " + EntityX(FindChild(guy, "leg-right"))
    Animate guy, FindAnimation(guy, "walk")
  EndIf
  If f = 60
    Print "ball resting on the platform: y " + (Abs(EntityY(ball) - (PickedY() + 0.25)) < 0.001) + ", touching " + (CountCollisions(ball) > 0 Or EntityCollided(ball, 2) > 0)
    Print "character standing on the platform: feet near y " + (Abs(EntityY(guy) - PickedY()) < 0.05) + ", touches it " + (ContactEntity(guy, 1) = platform)
    Print "walking: " + Animating(guy) + ", the left leg swings: " + (EntityPitch(FindChild(guy, "leg-left")) <> 0)
    End
  EndIf
  ; Moved last: the checks above read where the previous steps left it.
  TranslateEntity ball, 0, -0.1, 0
End Function
