; Birds - Adam Gore's Blitz3D sample (samples/AGore/BirdDemo), ported.
;
; Two MD2 birds and the camera follow paths made in Lightwave: keyframed
; splines (tension, continuity and bias, as Kochanek and Bartels made them)
; that move and turn an entity. The original keeps them in .bbm files; here
; their keys are the Data lines at the end of this program. Each key is its
; step, x y z, pitch yaw roll, scale x y z, linear, tension, continuity,
; bias. The canyon is Canyon.x converted to glTF (tools/x2gltf.mjs).
;
; The original steps the paths 30 times a second and draws between the
; steps; here the step is a number that grows by 30 every second, so the
; paths are worked out at every update.
;
; The files come with the Blitz3D samples (zlib licence).

Graphics3D 800, 600

Const PATHS = 3                 ; 0 camera, 1 and 2 the birds
Const KEYS = 20                 ; the most keys a path has
Const CHANNELS = 9              ; position, turn and scale: x y z each
Const STEPS_PER_SECOND# = 30

Global camera, sky, bird1, bird2
Global stepNow#
Global nsteps

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
CameraRange camera, 1, 3000

AmbientLight 90, 90, 90
sun = CreateLight()
LightColor sun, 200, 200, 100
RotateEntity sun, 60, -90, 0

canyon = LoadMesh("assets/blitz3d/bird/canyon.glb")
sky = MakeSkyBox("assets/blitz3d/bird/Textures/sky")

bird1 = LoadMD2("assets/blitz3d/bird/Bird.md2")
skin = LoadTexture("assets/blitz3d/bird/Textures/Bird.bmp")
EntityTexture bird1, skin
bird2 = CopyEntity(bird1)

; 2.5 frames each of the original's 30 steps a second: 1.25 of ours.
AnimateMD2 bird1, ANIM_LOOP, 1.25, 0, 31
AnimateMD2 bird2, ANIM_LOOP, 1.25, 0, 31

Follow 0
stepNow = 1

; The sky is five pictures on the inside of a box that goes where the camera
; goes, so it never gets nearer.
Function MakeSkyBox(file$)
  box = CreatePivot()
  AddSkyFace box, file + "_FR.bmp", -1, 1, -1,  1, 1, -1,  1, -1, -1,  -1, -1, -1,  0, 0, 1, 0, 1, 1, 0, 1
  AddSkyFace box, file + "_LF.bmp", 1, 1, -1,  1, 1, 1,  1, -1, 1,  1, -1, -1,  0, 0, 1, 0, 1, 1, 0, 1
  AddSkyFace box, file + "_BK.bmp", 1, 1, 1,  -1, 1, 1,  -1, -1, 1,  1, -1, 1,  0, 0, 1, 0, 1, 1, 0, 1
  AddSkyFace box, file + "_RT.bmp", -1, 1, 1,  -1, 1, -1,  -1, -1, -1,  -1, -1, 1,  0, 0, 1, 0, 1, 1, 0, 1
  AddSkyFace box, file + "_UP.bmp", -1, 1, 1,  1, 1, 1,  1, 1, -1,  -1, 1, -1,  0, 1, 0, 0, 1, 0, 1, 1
  ScaleEntity box, 1700, 1700, 1700
  Return box
End Function

Function AddSkyFace(box, file$, x0#, y0#, z0#, x1#, y1#, z1#, x2#, y2#, z2#, x3#, y3#, z3#, u0#, v0#, u1#, v1#, u2#, v2#, u3#, v3#)
  face = CreateMesh(box)
  s = CreateSurface(face)
  AddVertex s, x0, y0, z0, u0, v0
  AddVertex s, x1, y1, z1, u1, v1
  AddVertex s, x2, y2, z2, u2, v2
  AddVertex s, x3, y3, z3, u3, v3
  AddTriangle s, 0, 1, 2
  AddTriangle s, 0, 2, 3
  FlipMesh face
  EntityTexture face, LoadTexture(file, TEX_COLOR + TEX_CLAMPU + TEX_CLAMPV)
  EntityFX face, FX_FULLBRIGHT
End Function

; Every path at a step.
Function Follow(at#)
  Apply 0, at, camera
  Apply 1, at, bird1
  Apply 2, at, bird2
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

Function Update()
  stepNow = stepNow + STEPS_PER_SECOND * DeltaTime()
  If stepNow > nsteps Then stepNow = stepNow - nsteps
  Follow stepNow
  PositionEntity sky, EntityX(camera, True), EntityY(camera, True), EntityZ(camera, True)
End Function

Function Draw()
  Color 255, 255, 255
  FontSize 18
  Text 16, 14, "Birds - Adam Gore's Blitz3D sample"
  FontSize 14
  Text 16, 40, "Spline data imported from Lightwave   step " + Int(stepNow) + " of " + nsteps
End Function

; Cam: 12 keys: frame, x y z, pitch yaw roll, scale x y z, linear, tension, continuity, bias
Data 12
Data 0, 644.072, 0, 197.785, 0, 180, 0, 1, 1, 1, 0, 0, 0, 0
Data 30, 644.072, 0, -0.215451, 0, 180, 0, 1, 1, 1, 0, 0, 0, 0
Data 67, 583.957, -13.2769, -325.508, 6.99118, 161.894, 2.34681, 1, 1, 1, 0, 0, 0, 0
Data 113, 417.375, -58.8888, -562.76, 2.77291, 149.149, -78.4541, 1, 1, 1, 0, 0, 0, 0
Data 170, -87.9633, -45.21, -629.166, 1.39252, 90.1819, 8.86372, 1, 1, 1, 0, 0, 0, 0
Data 225, -625.618, -70.29, -571.854, 4.49998, 36.1001, 50, 1, 1, 1, 0, 0, 0, 0
Data 281, -599.109, -45.21, 40.1402, 11.4834, 10.6097, 0.138594, 1, 1, 1, 0, 0, 0, 0
Data 338, -769.359, -29.366, 635.14, -3.23909, -55.2414, -5.21836, 1, 1, 1, 0, 0, 0, 0
Data 395, -170.892, -45.21, 655.333, 2.18281, -91.0005, 6.8817, 1, 1, 1, 0, 0, 0, 0
Data 450, 500.165, -6.6, 631.131, 2.59998, -177.1, -1.5, 1, 1, 1, 0, 0, 0, 0
Data 480, 626.241, -4.94957, 497.102, 2.00924, -177.896, -1.13666, 1, 1, 1, 0, 0, 0, 0
Data 525, 644.071, 0, 197.785, 0, -180, 0, 1, 1, 1, 0, 0, 0, 0
; Bird1: 17 keys: frame, x y z, pitch yaw roll, scale x y z, linear, tension, continuity, bias
Data 17
Data 0, 644.072, -26.4, 197.785, 0, 180, 0, 1, 1, 1, 0, 0, 0, 0
Data 67, 587.169, -6.34694, -358.156, 6.99, 161.89, -21.95, 1, 1, 1, 0, 0, 0, 0
Data 113, 398.419, -58.8888, -622.165, 8.17291, 107.949, -78.4541, 1, 1, 1, 0, 0, 0, 0
Data 142, 155.586, -68.5395, -652.304, -0.410908, 86.3052, -34.7343, 1, 1, 1, 0, 0, 0, 0
Data 170, -114.301, -52.47, -635.107, -0.207478, 87.8818, 27.7637, 1, 1, 1, 0, 0, 0, 0
Data 183, -247.522, -16.5971, -666.336, -15.0302, 103.897, 24.5776, 1, 1, 1, 0, 0, 0, 0
Data 193, -353.421, 2.04996, -667.489, 4.42792, 72.395, 11.3806, 1, 1, 1, 0, 0, 0, 0
Data 225, -700.255, -54.45, -436.007, 7.09998, 9.8001, -56.3, 1, 1, 1, 0, 0, 0, 0
Data 254, -652.209, -4.24768, -172.992, 5.14504, -11.1657, -40.7413, 1, 1, 1, 0, 0, 0, 0
Data 281, -581.891, -69.63, 88.0191, 2.48344, 4.30973, 25.9386, 1, 1, 1, 0, 0, 0, 0
Data 304, -673.933, -45.2472, 351.064, -8.56151, 22.8598, -3.49729, 1, 1, 1, 0, 0, 0, 0
Data 338, -750.156, 1.98396, 670.559, -0.439092, -47.3414, -96.7183, 1, 1, 1, 0, 0, 0, 0
Data 361, -538.051, -8.1492, 692.269, 4.80766, -94.6671, -39.1392, 1, 1, 1, 0, 0, 0, 0
Data 395, -120.212, -32.67, 646.857, -3.41719, -93.1005, 6.8817, 1, 1, 1, 0, 0, 0, 0
Data 450, 492.552, -20.46, 570.925, -1.40002, -102.8, -49, 1, 1, 1, 0, 0, 0, 0
Data 480, 635.271, -4.94957, 467.053, 1.80924, -172.496, -34.2367, 1, 1, 1, 0, 0, 0, 0
Data 525, 644.072, -26.4, 197.785, 0, -180, 0, 1, 1, 1, 0, 0, 0, 0
; Bird2: 18 keys: frame, x y z, pitch yaw roll, scale x y z, linear, tension, continuity, bias
Data 18
Data 0, 644.072, 39.6, 197.785, 0, 180, 0, 1, 1, 1, 0, 0, 0, 0
Data 67, 550.324, -23.8369, -351.897, 4.49119, 161.794, -47.8532, 1, 1, 1, 0, 0, 0, 0
Data 113, 385.085, -36.7788, -604.59, 8.17291, 107.949, -78.4541, 1, 1, 1, 0, 0, 0, 0
Data 142, 124.429, -68.5395, -630.32, -1.91091, 93.6052, 6.26574, 1, 1, 1, 0, 0, 0, 0
Data 170, -157.178, -43.89, -642.503, 0.092515, 93.1819, 27.7637, 1, 1, 1, 0, 0, 0, 0
Data 183, -269.144, -53.2271, -650.317, 10.5698, 91.6972, 30.6776, 1, 1, 1, 0, 0, 0, 0
Data 193, -407.086, -53.72, -663.014, 4.32792, 75.295, 45.4806, 1, 1, 1, 0, 0, 0, 0
Data 225, -652.251, -75.9, -523.12, -11.6, 16.7001, -38.8, 1, 1, 1, 0, 0, 0, 0
Data 254, -624.976, -54.4077, -210.414, 4.74504, -7.86568, 15.4587, 1, 1, 1, 0, 0, 0, 0
Data 281, -588.317, -81.18, 86.4795, 2.28344, 6.90973, 25.9386, 1, 1, 1, 0, 0, 0, 0
Data 290, -634.629, -71.4966, 205.182, -3.94413, 28.9996, -9.95455, 1, 1, 1, 0, 0, 0, 0
Data 304, -709.767, -45.2472, 353.567, -8.56151, 22.8598, -75.4973, 1, 1, 1, 0, 0, 0, 0
Data 338, -756.658, 1.98396, 680.506, 6.36091, -44.6414, -96.7183, 1, 1, 1, 0, 0, 0, 0
Data 361, -541.411, -25.9692, 705.817, 4.60766, -92.3671, -39.1392, 1, 1, 1, 0, 0, 0, 0
Data 395, -121.169, -50.49, 667.667, -3.41719, -93.1005, 1.2817, 1, 1, 1, 0, 0, 0, 0
Data 450, 518.155, 9.9, 580.814, -1.20002, -104.3, -49, 1, 1, 1, 0, 0, 0, 0
Data 480, 620.264, 18.1504, 412.466, 4.10924, -153.396, -2.83666, 1, 1, 1, 0, 0, 0, 0
Data 525, 644.072, 39.6, 197.785, 0, -180, 0, 1, 1, 1, 0, 0, 0, 0
