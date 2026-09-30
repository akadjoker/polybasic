; Tutorial 2 - Controlling an animation.
;
; A glTF model brings its animations with it. Pick one and play it:
;   1 2 3 4    play animation 1 to 4 (the names are listed on screen)
;   Up/Down    faster / slower (a negative speed plays it backwards)
;   P          pause and go on (a speed of 0 holds it still)
;   Left/Right while paused: step through it, a frame at a time
;   Space      jump: played once (ANIM_ONCE), then back to what was playing
;   Q/E        turn the model
;
; The character is by Kenney (CC0), in assets/kenney.

Graphics3D 800, 600

Global guy, current, speed#, paused, jumping, previous

camera = CreateCamera()
CameraClsColor camera, 170, 200, 235
PositionEntity camera, 0, 1.4, -3.4
RotateEntity camera, 10, 0, 0

light = CreateLight()
RotateEntity light, 40, -30, 0
AmbientLight 130, 130, 140

floor = CreatePlane()
ScaleEntity floor, 6, 1, 6
EntityColor floor, 120, 160, 100

guy = LoadMesh("assets/kenney/character.glb")
TurnEntity guy, 0, 180, 0      ; face the camera

speed = 1
; Animations can be started in the main body: they begin as soon as the
; model has arrived.
current = 2
Animate guy, current, ANIM_LOOP, speed

Function Update()
  ; The model is in from the first Update on: now its animations can be
  ; counted and named.
  For n = 1 To Min(4, CountAnimations(guy))
    If KeyHit(KEY_0 + n)
      current = n
      jumping = False
      paused = False
      Animate guy, current, ANIM_LOOP, speed
    EndIf
  Next

  ; KeyHit counts the presses since the last step (quick taps add up).
  presses = KeyHit(KEY_UP) - KeyHit(KEY_DOWN)
  If presses <> 0 Then SetSpeed(speed + 0.25 * presses)

  If KeyHit(KEY_P)
    paused = Not paused
    ; Animate starts from the beginning: keep the time and go back to it.
    t# = AnimTime(guy)
    If paused
      ; Speed 0 holds the pose where it is.
      Animate guy, current, ANIM_LOOP, 0
    Else
      Animate guy, current, ANIM_LOOP, speed
    EndIf
    SetAnimTime guy, t
  EndIf
  If paused
    ; One frame of 1/30 s each way, wrapping round at the ends.
    frame# = 1 / 30.0
    length# = AnimLength(guy, current)
    If KeyHit(KEY_RIGHT) Then SetAnimTime guy, Wrap(AnimTime(guy) + frame, length)
    If KeyHit(KEY_LEFT) Then SetAnimTime guy, Wrap(AnimTime(guy) - frame, length)
  EndIf

  ; A jump plays once; when it has ended (Animating is 0), go back.
  ; (Compare numbers with > or <>: And works bit by bit on Ints, so
  ; "KeyHit(KEY_SPACE) And jump" is 1 And 4, which is 0.)
  jump = FindAnimation(guy, "jump")
  If KeyHit(KEY_SPACE) And jump > 0 And Not jumping
    jumping = True
    previous = current
    current = jump
    Animate guy, jump, ANIM_ONCE, speed
  EndIf
  If jumping And Not Animating(guy)
    jumping = False
    current = previous
    Animate guy, current, ANIM_LOOP, speed
  EndIf

  If KeyDown(KEY_Q) Then TurnEntity guy, 0, 90 * DeltaTime(), 0
  If KeyDown(KEY_E) Then TurnEntity guy, 0, -90 * DeltaTime(), 0
End Function

Function SetSpeed(s#)
  speed = Max(-3, Min(3, s))
  If paused Then Return
  ; The same animation at the new speed, from where it is.
  t# = AnimTime(guy)
  If jumping
    Animate guy, current, ANIM_ONCE, speed
  Else
    Animate guy, current, ANIM_LOOP, speed
  EndIf
  SetAnimTime guy, t
End Function

; t brought into 0 .. length.
Function Wrap#(t#, length#)
  While t < 0
    t = t + length
  Wend
  While t >= length
    t = t - length
  Wend
  Return t
End Function

Function Draw()
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "2. Controlling an animation"
  FontSize 15
  y = 46
  For n = 1 To CountAnimations(guy)
    If n = current Then Color 200, 40, 40 Else Color 20, 30, 50
    Text 16, y, n + "  " + AnimationName(guy, n) + "  (" + AnimLength(guy, n) + " s)"
    y = y + 20
  Next
  Color 20, 30, 50
  Text 16, y + 10, "Speed " + speed + "   time " + Left(Str(AnimTime(guy)), 5) + " s"
  If paused Then Text 16, y + 30, "Paused: Left/Right step through it"
  Text 16, GraphicsHeight() - 48, "1-4 pick   Up/Down speed   P pause   Space jump"
  Text 16, GraphicsHeight() - 28, "Q/E turn the model"
End Function
