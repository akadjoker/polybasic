; Functions: typed returns, defaults, recursion, globals.
Function Add(a, b)
  Return a + b
End Function

Function Fact(n)
  If n <= 1 Then Return 1
  Return n * Fact(n - 1)
End Function

Function Greet$(name$, punct$ = "!")
  Return "Hello " + name + punct
End Function

Function Half#(x#)
  Return x / 2
End Function

Function NoReturn(x)
  Print "noreturn " + x * 2
End Function

Function EmptyString$()
  Return
End Function

Function Clamp#(v#, lo# = 0, hi# = 1)
  If v < lo Then Return lo
  If v > hi Then Return hi
  Return v
End Function

Global counter = 0
Function Bump()
  counter = counter + 1
  Return counter
End Function

Function Shadow()
  Local counter = 99
  Return counter
End Function

Print Add(2, 3)
Print Fact(10)
Print Greet("World")
Print Greet("Bob", "?")
Print Half(5)
NoReturn 21
NoReturn(22)
Print NoReturn(1)
Print "[" + EmptyString() + "]"
Print Clamp(1.5) + " " + Clamp(-3) + " " + Clamp(5, 0, 10)
Bump : Bump : Bump()
Print "counter=" + counter
Print Shadow() + " " + counter
Print Add(Add(1, 2), Add(3, 4))
z = Add(10, Fact(3))
Print z
Function Show(a, b)
  Print a + " " + b
End Function
Show (1 + 2) * 3, 4
Show(5, 6)

; Functions can be used before they are declared
Print Later(4)
Function Later(n)
  Return n * 100
End Function

; Mutual recursion
Function IsEven(n)
  If n = 0 Then Return True
  Return IsOdd(n - 1)
End Function
Function IsOdd(n)
  If n = 0 Then Return False
  Return IsEven(n - 1)
End Function
Print IsEven(10) + " " + IsOdd(7) + " " + IsEven(3)

; Return from inside nested loops
Function Find(v)
  For i = 1 To 10
    For j = 1 To 10
      If i * j = v Then Return i * 100 + j
    Next
  Next
  Return -1
End Function
Print Find(42)
Print Find(101)
