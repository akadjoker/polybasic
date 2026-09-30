; Variables, sigils, Global / Local / Const and implicit conversions.
Const LIVES = 3, TITLE$ = "Space Rocks", GRAVITY# = 9.81
Const DOUBLE_LIVES = LIVES * 2
Global score, player$ = "Ana", speed# = 1.5

Print TITLE + " lives=" + LIVES + " double=" + DOUBLE_LIVES + " g=" + GRAVITY
Print player + " " + score + " " + speed

; Untyped names are Int; the sigil is only needed the first time.
count = 7
ratio# = 0.25
label$ = "items"
Print count + " " + ratio + " " + label
Print Count + " " + RATIO# + " " + Label$

; Float to Int rounds to the nearest, halves to even.
i = 2.5 : Print i
i = 3.5 : Print i
i = -2.5 : Print i
i = 2.7 : Print i
i = "42 apples" : Print i
i = "nothing" : Print i
f# = 7 : Print f
f# = "3.75x" : Print f
s$ = 12 : Print s
s$ = 0.5 : Print s
s$ = 1.0 / 3 : Print s
s$ = 10.0 : Print s

; Int() Float() Str() convert explicitly.
Print Int(9.5) + Int(10.5) + Int("5")
Print Float(1) / 4
Print Str(3) + Str(2.0)

Local here = 99
Print here

; Large and tiny floats
Print 123456789.0
Print 12345678.0
Print 0.0001
Print 0.00001
Print 1.0 / 0
Print -1.0 / 0
