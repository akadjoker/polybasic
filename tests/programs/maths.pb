; Maths commands. Angles are in degrees.
Print Sin(30) + " " + Cos(60) + " " + Tan(45)
Print Sin(90) + " " + Cos(180) + " " + Sin(0)
Print ASin(0.5) + " " + ACos(0.5) + " " + ATan(1)
Print ATan2(1, 1) + " " + ATan2(1, -1) + " " + ATan2(-1, 0)
Print Sqr(16) + " " + Sqr(2)
Print Floor(2.7) + " " + Floor(-2.7) + " " + Ceil(2.2) + " " + Ceil(-2.2)
Print Exp(0) + " " + Exp(1) + " " + Log(Exp(2)) + " " + Log10(1000)
Print Int(2.5) + " " + Int(3.5) + " " + Int(-2.5) + " " + Int(2.49)
Print Pi
Print 2 * Pi

; Random numbers repeat for the same seed
SeedRnd 42
For i = 1 To 6 : Write Rand(1, 6) + " " : Next : Print
SeedRnd 42
For i = 1 To 6 : Write Rand(1, 6) + " " : Next : Print
SeedRnd 7
Print Rnd(1) < 1
Print RndSeed()
ok = 1
For i = 1 To 1000
  r = Rand(-3, 3)
  If r < -3 Or r > 3 Then ok = 0
  f# = Rnd(5, 10)
  If f < 5 Or f > 10 Then ok = 0
  d = Rand(6)
  If d < 1 Or d > 6 Then ok = 0
Next
Print "ranges ok: " + ok
