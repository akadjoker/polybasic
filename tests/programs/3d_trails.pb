; Ribbon trails on the headless engine.
Global hilt, tip, t
hilt = CreatePivot()
tip = CreatePivot(hilt)
PositionEntity tip, 0, 2, 0
t = CreateTrail(hilt, tip)
TrailLife t, 0.25
TrailStep t, 0.05
TrailSmooth t, 6
TrailColor t, 80, 200, 255
TrailFadeColor t, 0, 0, 255, 0
mid = CreatePivot(hilt)
PositionEntity mid, 0, 1, 0
TrailPoint t, mid
Function Update()
  TurnEntity hilt, 0, 0, 6
  If FrameCount() = 30
    Print "emitting"
    TrailEmit t, False
  EndIf
  If FrameCount() = 60
    ClearTrail t
    Print "cleared"
    CountSurfaces t
  EndIf
End Function
