; Skinned fox - one mesh on a skeleton, several animations, blended.
;
; 1 Survey  2 Walk  3 Run   T blend on/off   Space look round once
; H head layer on/off: the head and neck play Survey over the rest
;
; Run comes from a file of its own (fox-run.glb), matched to the fox's
; bones by their names. The fox is by PixelMannen (CC0), rigged and
; animated by tomkranis (CC BY 4.0); see assets/fox/README.md.

Graphics3D 800, 600

Global fox, buddy, survey, walk, run, playing, blend, head, ground, follow

; The camera hangs from a pivot that follows the fox without turning.
follow = CreatePivot()
camera = CreateCamera(follow)
CameraClsColor camera, 175, 205, 235
PositionEntity camera, 120, 110, -230
middle = CreatePivot(follow)
PositionEntity middle, 0, 45, 0
PointEntity camera, middle
light = CreateLight()
RotateEntity light, 50, -30, 0
AmbientLight 90, 90, 100

ground = CreatePlane()
ScaleEntity ground, 2000, 1, 2000
EntityColor ground, 120, 160, 95

fox = LoadMesh("assets/fox/fox.glb")
survey = FindAnimation(fox, "Survey")
walk = FindAnimation(fox, "Walk")
run = LoadAnimSeq(fox, "assets/fox/fox-run.glb")
TurnEntity fox, 0, 90, 0

; A second fox, with an animation of its own.
buddy = CopyEntity(fox)
PositionEntity buddy, -150, 0, 260
Animate buddy, run, ANIM_LOOP, 0.8

blend = True
playing = walk
Animate fox, walk

Function Steps()
  If blend Then Return 18
  Return 0
End Function

Function Update()
  If KeyHit(KEY_1) Then playing = survey : Animate fox, survey, ANIM_LOOP, 1, Steps()
  If KeyHit(KEY_2) Then playing = walk : Animate fox, walk, ANIM_LOOP, 1, Steps()
  If KeyHit(KEY_3) Then playing = run : Animate fox, run, ANIM_LOOP, 1, Steps()
  If KeyHit(KEY_T) Then blend = Not blend
  If KeyHit(KEY_SPACE) Then AnimateOnce fox, survey, playing, 1, Steps()
  If KeyHit(KEY_H)
    head = Not head
    If head
      AnimLayerMask fox, 1, "b_Neck_04"
      AnimateLayer fox, 1, survey, ANIM_LOOP, 1, Steps()
    Else
      AnimateLayer fox, 1, 0
    EndIf
  EndIf

  ; The fox walks round in a circle at the speed its legs go.
  If playing = walk Then pace# = 0.9
  If playing = run Then pace# = 3.2
  If playing = survey Then pace# = 0
  MoveEntity fox, 0, 0, pace
  TurnEntity fox, 0, pace * 0.35, 0
  TurnEntity buddy, 0, -1.2, 0
  MoveEntity buddy, 0, 0, 2.6
  PositionEntity follow, EntityX(fox), 0, EntityZ(fox)
End Function

Function Draw()
  Color 20, 30, 50
  FontSize 22
  Text 16, 14, "Skinned fox"
  FontSize 15
  If blend Then b$ = "on" Else b$ = "off"
  If head Then h$ = "on" Else h$ = "off"
  Text 16, 46, "playing " + AnimationName(fox, playing) + " at " + Int(AnimTime(fox) * 100) / 100.0 + " s   blend " + b + "   head layer " + h
  Text 16, 66, "1 Survey  2 Walk  3 Run (from fox-run.glb)  T blend  Space look once  H head layer"
End Function
