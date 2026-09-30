; Operators, precedence and 32-bit integer arithmetic.
Print 2 + 3 * 4
Print (2 + 3) * 4
Print 10 - 4 - 3
Print 2 ^ 3 ^ 2
Print -2 ^ 2
Print 7 / 2
Print -7 / 2
Print 7.0 / 2
Print 7 / 2.0
Print 7 Mod 3
Print -7 Mod 3
Print 7 Mod -3
Print 7.5 Mod 2
Print 10 / 4 * 4
Print 10.0 / 4 * 4

; Shifts sit between + and *:  1 + 2 Shl 3 = 1 + (2 Shl 3)
Print 1 + 2 Shl 3
Print 2 * 2 Shl 1
Print 1 Shl 31
Print -16 Shr 2
Print -16 Sar 2
Print $FF + %1010
Print $FFFFFFFF

; 32-bit wrap
big = 2147483647
Print big + 1
Print big * 2
Print -big - 2
Print 65536 * 65536
Print 100000 * 100000
small = -2147483648
Print small / -1
Print Abs(small)

; Comparisons give 1 or 0
Print (3 > 2) + (2 > 3) + (5 = 5) + (5 <> 5)
Print (3 > 2) * 10
Print ("abc" < "abd") + " " + ("b" > "a")
Print 1 < 1.5
Print "10" = 10

; And / Or / Xor are bitwise on Ints, Not is logical
Print (6 And 3) + " " + (6 Or 3) + " " + (6 Xor 3)
Print (Not 0) + " " + (Not 5) + " " + (Not -1)
Print ~5
x = 7
Print x > 5 And x < 10
Print Not x = 7
Print Not x > 10 And x > 5
Print x < 5 Or x > 6
Print (1 = 1) Xor (2 = 2)

; Strings join with +, numbers convert on the way
Print "a" + 1 + 2
Print 1 + 2 + "a"
Print "pi is about " + 3.14159
Print "half " + 1 / 2 + " " + 1.0 / 2
n = 5
Print "n=" + n + ", n*2=" + n * 2

; Unary minus and Abs / Sgn / Min / Max keep the type
Print -n + " " + - -n + " " + +n
Print Abs(-3) + " " + Abs(-3.5) + " " + Sgn(-9) + " " + Sgn(0.0) + " " + Sgn(4)
Print Min(3, 8) + " " + Max(3, 8) + " " + Min(2.5, 1) + " " + Max(-1, -1.5)

; Constant folding follows the same rules as run time
Const K = 2147483647 + 1
Print K
Const F# = 1 / 3
Print F
