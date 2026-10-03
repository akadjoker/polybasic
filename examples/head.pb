; The Head - Adam Gore's Blitz3D sample (zlib licence), ported.
;
; A head turns and looks about on paths made in Lightwave: keyframed
; splines (tension, continuity and bias, as Kochanek and Bartels made them)
; that move and turn it, and another that is where the eyes look. The
; original keeps them in .bbm files; here their keys are the Data lines at
; the end of this program. Each key is its step, x y z, pitch yaw roll, scale
; x y z, linear, tension, continuity, bias. Late in the film (step 574) the
; head is given a sphere map, a picture of a room it reflects, and goes back
; to its face when the film starts again.
;
; The original steps 24 times a second and draws between the steps; here a
; step is a number that grows by 24 every second, and what happens at a step
; (the background turning, the head's skin) happens as the number passes it.
;
; Head.x and Eye.x were converted to glTF with tools/x2gltf.mjs; the files
; come with the Blitz3D samples.

Graphics3D 800, 600

Const PATHS = 2                 ; 0 the head, 1 where the eyes look
Const KEYS = 100                ; the most keys a path has
Const CHANNELS = 9              ; position, turn and scale: x y z each
Const STEPS_PER_SECOND# = 24

Global head, rightEye, leftEye, focus, background
Global faceTex, reflectionTex
Global clock#, stepNow, nsteps

; key(path, k, 0) is a key's step, 1 to 9 its values, 10 whether it is a
; straight line to it, 11 to 13 its tension, continuity and bias.
Dim key#(PATHS - 1, KEYS - 1, 13)
Dim keys(PATHS - 1)
Dim v#(CHANNELS - 1)               ; a path's values at a step

For p = 0 To PATHS - 1
  Read keys(p)
  For k = 0 To keys(p) - 1
    For c = 0 To 13
      Read key(p, k, c)
    Next
  Next
Next
nsteps = key(0, keys(0) - 1, 0)

camera = CreateCamera()
CameraRange camera, 0.05, 150
PositionEntity camera, 0, 0, -1

head = LoadMesh("assets/blitz3d/head/head.glb")
rightEye = LoadMesh("assets/blitz3d/head/eye.glb", head)
eyeTex = LoadTexture("assets/blitz3d/head/eye.jpg", TEX_COLOR)
EntityTexture rightEye, eyeTex
EntityShininess rightEye, 1
leftEye = CopyEntity(rightEye, head)
focus = CreatePivot()

; The room behind: a square a hundred and thirty wide, turning slowly, drawn
; before everything else (a higher EntityOrder is drawn earlier) and without
; looking at depth.
background = CreateMesh()
s = CreateSurface(background)
AddVertex s, 1, 1, 1, 0, 0 : AddVertex s, -1, 1, 1, 1, 0
AddVertex s, -1, -1, 1, 1, 1 : AddVertex s, 1, -1, 1, 0, 1
AddTriangle s, 0, 1, 2 : AddTriangle s, 0, 2, 3
ScaleMesh background, 130, 130, 100
EntityFX background, FX_FULLBRIGHT
FlipMesh background
EntityOrder background, 10

PositionEntity rightEye, -0.058, 0.256, -0.146
PositionEntity leftEye, 0.058, 0.256, -0.146

faceTex = LoadTexture("assets/blitz3d/head/face.jpg", TEX_COLOR)
reflectionTex = LoadTexture("assets/blitz3d/head/reflection.jpg", TEX_SPHEREMAP)
EntityTexture head, faceTex
EntityTexture background, LoadTexture("assets/blitz3d/head/bkgd.jpg", TEX_COLOR)

AmbientLight 5, 5, 5
light1 = CreateLight()
LightColor light1, 255, 255, 255
RotateEntity light1, 0, 60, 0
light2 = CreateLight()
LightColor light2, 200, 0, 0
RotateEntity light2, -5, -95, 0

stepNow = 1
Apply 0, stepNow, head
Apply 1, stepNow, focus

; --- The film --------------------------------------------------------------------

Function Update()
  ; The steps that have gone by since the last Update: each does what the
  ; sample does at every step.
  gone = Int(Floor(clock))
  clock = clock + STEPS_PER_SECOND * DeltaTime()
  For passed = gone + 1 To Int(Floor(clock))
    stepNow = stepNow + 1
    If stepNow > nsteps Then stepNow = 1
    TurnEntity background, 0, 0, 1
    If stepNow = 574 Then EntityTexture head, reflectionTex
    If stepNow = 1 Then EntityTexture head, faceTex
  Next
  ; Between the steps the paths are worked out at the fraction.
  at# = stepNow + (clock - Floor(clock))
  Apply 0, at, head
  Apply 1, at, focus
  PointEntity rightEye, focus
  PointEntity leftEye, focus
End Function

; Puts an entity where a path is at a step: Hermite splines between the two
; keys the step falls between, their slopes from the keys around them
; (tension, continuity and bias), or a straight line to a key marked linear.
Function Apply(p, at#, e)
  If keys(p) = 1
    Place e, key(p, 0, 1), key(p, 0, 2), key(p, 0, 3), key(p, 0, 4), key(p, 0, 5), key(p, 0, 6), key(p, 0, 7), key(p, 0, 8), key(p, 0, 9)
    Return
  EndIf
  If at < key(p, 0, 0) Then Return

  ; The first key at or after the step, and the one before it.
  k1 = 1
  While k1 < keys(p) And at > key(p, k1, 0)
    k1 = k1 + 1
  Wend
  If k1 >= keys(p) Then Return
  k0 = k1 - 1
  length# = key(p, k1, 0) - key(p, k0, 0)
  t# = (at - key(p, k0, 0)) / length
  finalStep = key(p, keys(p) - 1, 0)
  hasPrev = (key(p, k0, 0) <> 0 And k1 >= 2)
  hasNext = (key(p, k1, 0) <> finalStep And k1 + 1 < keys(p))

  If key(p, k1, 10) = 0
    t2# = t * t
    t3# = t * t2
    z# = 3 * t2 - t3 - t3
    h0# = 1 - z
    h1# = z
    h2# = t3 - t2 - t2 + t
    h3# = t3 - t2
    dd0a# = (1 - key(p, k0, 11)) * (1 + key(p, k0, 12)) * (1 + key(p, k0, 13))
    dd0b# = (1 - key(p, k0, 11)) * (1 - key(p, k0, 12)) * (1 - key(p, k0, 13))
    ds1a# = (1 - key(p, k1, 11)) * (1 - key(p, k1, 12)) * (1 + key(p, k1, 13))
    ds1b# = (1 - key(p, k1, 11)) * (1 + key(p, k1, 12)) * (1 - key(p, k1, 13))
    If hasPrev Then adj0# = length / (key(p, k1, 0) - key(p, k0 - 1, 0))
    If hasNext Then adj1# = length / (key(p, k1 + 1, 0) - key(p, k0, 0))
  EndIf

  For i = 0 To CHANNELS - 1
    c0# = key(p, k0, 1 + i)
    c1# = key(p, k1, 1 + i)
    d10# = c1 - c0
    If key(p, k1, 10) = 0
      If hasPrev
        dd0# = adj0 * (dd0a * (c0 - key(p, k0 - 1, 1 + i)) + dd0b * d10)
      Else
        dd0 = 0.5 * (dd0a + dd0b) * d10
      EndIf
      If hasNext
        ds1# = adj1 * (ds1a * d10 + ds1b * (key(p, k1 + 1, 1 + i) - c1))
      Else
        ds1 = 0.5 * (ds1a + ds1b) * d10
      EndIf
      v(i) = h0 * c0 + h1 * c1 + h2 * dd0 + h3 * ds1
    Else
      v(i) = c0 + t * d10
    EndIf
  Next
  Place e, v(0), v(1), v(2), v(3), v(4), v(5), v(6), v(7), v(8)
End Function

Function Place(e, x#, y#, z#, pitch#, yaw#, roll#, sx#, sy#, sz#)
  PositionEntity e, x, y, z
  RotateEntity e, pitch, yaw, roll
  ScaleEntity e, sx, sy, sz
End Function

Function Draw()
  Color 255, 255, 255
  FontSize 14
  Text 10, 10, "The Head Demo, by Adam Gore"
End Function

; Head: 50 keys: frame, x y z, pitch yaw roll, scale x y z, linear, tension, continuity, bias
Data 50
Data 0, 0, -1.5, 0, -90, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 150, 0, -0.18, -0.45, -25.7, 0, 0, 1, 1, 1, 0, 1, 0, 0
Data 170, 0, -0.18, -0.45, -27.4, 0, 0, 1, 1, 1, 1, 0, 0, 0
Data 180, 0, -0.18, -0.337, -21.3782, 36.4728, 0, 1, 1, 1, 0, -1, 0, 0
Data 200, 0, -0.18, -0.337, -21.3782, 36.4728, 0, 1, 1, 1, 0, 0, 0, 0
Data 240, 0, -0.18, -0.337, -21.3782, 36.4728, 0, 1, 1, 1, 0, 0, 0, 0
Data 250, 0, -0.18, -0.337, -25.6782, -33.3272, 0, 1, 1, 1, 0, 0, 0, 0
Data 271, 0, -0.18, -0.337, -21.5782, -26.8272, 0, 1, 1, 1, 0, 0, 0, 0
Data 310, 0, -0.18, -0.337, -25.6782, -33.3272, 0, 1, 1, 1, 0, 0, 0, 0
Data 350, 0, -0.18, -0.337, 4.12175, 16.8728, 0, 1, 1, 1, 0, 1, 0, 0
Data 361, 0, -0.18, -0.337, 3.02175, 17.2728, 1.8, 1, 1, 1, 0, 0, 0, 0
Data 375, 0, -0.18, -0.337, 4.12175, 16.8728, 0, 1, 1, 1, 1, 0, 0, 0
Data 385, 0, -0.18, -0.337, 4.12175, 16.8728, 8.4, 1, 1, 1, 0, 0, 0, 0
Data 395, 0, -0.18, -0.337, 4.12175, 16.8728, -8, 1, 1, 1, 0, 0, 0, 0
Data 405, 0, -0.18, -0.337, 4.12175, 16.8728, 12.8, 1, 1, 1, 0, 0, 0, 0
Data 415, 0, -0.18, -0.337, 4.12175, 16.8728, -3.5, 1, 1, 1, 0, 0, 0, 0
Data 425, 0, -0.18, -0.337, -24.8783, -6.9272, 1.9, 1, 1, 1, 0, 0, 0, 0
Data 435, -0.008, -0.153, -0.6, -24.8783, -7.4272, 1.9, 1, 1, 1, 0, 0, 0, 0
Data 465, -0.008, -0.153, -0.55, -26.1783, -7.5272, 1.9, 1, 1, 1, 1, 0, 0, 0
Data 475, 0.0185, -0.153, -0.6, -24.7783, 13.7728, 1.9, 1, 1, 1, 0, 0, 0, 0
Data 505, 0.0185, -0.153, -0.6, -23.7783, 13.3728, 0.900002, 1, 1, 1, 1, 0, 0, 0
Data 530, 0, -0.18, -0.45, -16.5783, -12.6272, 0, 1, 1, 1, 0, 0, 0, 0
Data 550, 0, -0.18, -0.45, 1.89088, -17.0549, -0.195134, 1, 1, 1, 0, 1, 0, 0
Data 560, 0, -0.18, -0.45, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0
Data 570, 0, -0.18, -0.45, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0
Data 572, 0, -0.18, -0.45, 0, 90, 0, 1, 1, 1, 0, 0, 0, 0
Data 574, 0, -0.18, -0.45, 0, 180, 0, 1, 1, 1, 0, 0, 0, 0
Data 576, 0, -0.18, -0.45, 0, 270, 0, 1, 1, 1, 0, 0, 0, 0
Data 578, 0, -0.18, -0.45, 0, 360, 0, 1, 1, 1, 0, 0, 0, 0
Data 620, 0, -0.18, -0.45, -16.4, 355.3, 9.89999, 1, 1, 1, 0, 0, 0, 0
Data 650, 0, -0.18, -0.45, -25.7036, 377.056, -12.4185, 1, 1, 1, 0, 0, 0, 0
Data 675, 0, -0.18, -0.45, -8.4204, 355.355, -2.65794, 1, 1, 1, 0, 0, 0, 0
Data 685, 0, -0.18, -0.45, 10.9852, 233.906, -3.71967, 1, 1, 1, 0, 0, 0, 0
Data 710, 0, -0.18, -0.45, 12.2852, 230.706, -3.71967, 1, 1, 1, 1, 0, 0, 0
Data 725, 0, -0.18, -0.45, -3.01482, 355.406, 0, 1, 1, 1, 0, 0, 0, 0
Data 740, 0, -0.18, -0.45, 0.685183, 445.506, 0, 1, 1, 1, 0, 0, 0, 0
Data 750, 0, -0.18, -0.45, 0.685183, 445.506, 0, 1, 1, 1, 0, 0, 0, 0
Data 780, 1.00258, -0.18, -0.45, -15.3148, 507.206, 0, 1, 1, 1, 0, 0, 0, 0
Data 800, 1.047, -0.18, 0.4115, -21.1148, 556.907, 0, 1, 1, 1, 0, 0, 0, 0
Data 820, 0.1655, -0.18, 1.1265, -16.9148, 631.007, 0, 1, 1, 1, 0, 0, 0, 0
Data 840, -1.1115, -0.18, 0.667501, -15.3148, 691.307, 0, 1, 1, 1, 0, 0, 0, 0
Data 860, -0.7535, -0.18, -0.174499, -17.9148, 779.406, 0, 1, 1, 1, 0, 0, 0, 0
Data 880, 0, -0.18, -0.45, 0, 720, 0, 1, 1, 1, 0, 0, 0, 0
Data 890, 0, -0.18, -0.45, 0, 720, 0, 1, 1, 1, 0, 0, 0, 0
Data 910, 0, -0.18, -0.45, 1.42884, 720, 0, 0.890169, 0.832117, 1.8, 0, 0, 0, 0
Data 935, 0, -0.18, -0.45, 2.89952, 720, 0, 0.714604, 0.896981, -1, 0, 0, 0, 0
Data 960, 0, -0.18, -0.45, 0, 720, 0, 1, 1, 1, 0, 0, 0, 0
Data 965, 0, -0.18, -0.45, -17.8, 720, 0, 1, 1, 1, 0, 0, 0, 0
Data 970, 0, -0.18, -0.45, 0, 720, 0, 1, 1, 1, 0, 0, 0, 0
Data 1000, 0, -1.5, 0, -90, 720, 0, 1, 1, 1, 0, -1, 0, 0
; EyeFocus: 43 keys: frame, x y z, pitch yaw roll, scale x y z, linear, tension, continuity, bias
Data 43
Data 0, 0, -3.5, -0.5, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 150, 0, -0.470629, -2.5297, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 167, 0, -0.522981, -2.52171, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0
Data 171, 0.958085, -0.716145, -2.48438, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 200, 1.51219, -0.738686, -1.96232, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 237, 1.52886, -0.719809, -2.03154, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 240, 0.321325, -0.829845, -2.92304, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 260, -1.52513, -0.836848, -1.98861, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 278, -1.00675, -1.44899, -2.07649, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 305, -1.25387, -1.57446, -1.85209, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 308, -0.609554, -1.01392, -2.71949, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 350, 0.354631, -0.0334752, -2.77583, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 380, 0.358189, -0.0632377, -2.77691, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 383, 0.456466, 0.564408, -2.14185, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 417, 0.477513, 0.42323, -2.18419, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 420, 0.0741423, -0.311634, -2.33229, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 430, -0.017926, -0.436128, -2.50972, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 469, 0.306361, -0.39294, -2.57877, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 475, -0.137182, -0.357213, -2.81308, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 509, -0.0556873, -0.205175, -2.78174, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0
Data 525, -0.131777, -0.265644, -2.56918, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0
Data 550, -0.28009, -0.210101, -2.79211, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 567, 0.421664, -0.291219, -2.77164, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 570, 1.6325, -0.101249, -2.894, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 578, -0.198501, -0.101249, -2.828, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 595, 0.168654, -0.397583, -2.82165, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 598, -0.22373, -0.674645, -2.80221, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 623, -0.645492, -1.07459, -2.59725, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 626, 0.757452, -0.990998, -2.81049, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 664, 1.46444, -1.18952, -2.35778, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 667, -0.249983, -0.376726, -2.88461, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 675, -1.53541, -0.242485, -2.65174, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 717, -2.47551, 0.298615, 0.47294, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 720, -0.952826, -0.110404, -2.87295, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 737, 3.7573, -0.154886, -1.62369, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 870, 1.93996, -0.792957, -3.487, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 873, 0.973901, -0.570356, -4.14927, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 880, -0.00000239797, -0.312249, -4.42026, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 906, 0.0459905, 0.058743, -18.9254, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 961, 0.0260615, -0.61869, -7.8196, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0
Data 965, 0.0236648, -1.11771, -7.30184, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 969, 0.0209974, -0.646219, -6.94435, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
Data 1000, 0.000000079876, -5.47026, 0.132249, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0
