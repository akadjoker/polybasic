; String commands.
s$ = "Hello, World"
Print Len(s)
Print Left(s, 5) + "|" + Right(s, 5) + "|" + Left(s, 0) + "|" + Left(s, 99)
Print Mid(s, 8) + "|" + Mid(s, 8, 3) + "|" + Mid(s, 50) + "|"
Print Instr(s, "o") + " " + Instr(s, "o", 6) + " " + Instr(s, "xyz") + " " + Instr(s, "")
Print Replace(s, "l", "L") + " " + Replace("aaa", "a", "bb") + " " + Replace(s, "", "x")
Print Upper(s) + " " + Lower(s)
Print "[" + Trim("   padded   ") + "]"
Print "[" + LSet("ab", 5) + "][" + RSet("ab", 5) + "][" + LSet("abcdef", 3) + "][" + RSet("abcdef", 3) + "]"
Print Chr(80) + Chr(66) + " " + Asc("A") + " " + Asc("") + " " + Asc(Chr(233))
Print Hex(255) + " " + Hex(-1) + " " + Bin(5)
Print String("-=", 5) + " " + String("x", 0) + "|"
Print Len(12345) + " " + Mid(12345, 2, 2)
Print Str(42) + Str(1.5)
; Building a string in a loop
out$ = ""
For i = 1 To 5 : out = out + i : Next
Print out
; Comparison is by character code
Print ("apple" < "banana") + " " + ("Zebra" < "apple") + " " + ("abc" = "abc")
