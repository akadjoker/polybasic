; A quick tour of the PolyBasic language. Everything prints to the console.

; Variables: the sigil says the type (% Int, # Float, $ String).
lives = 3
speed# = 2.5
name$ = "Ada"
Print name + " has " + lives + " lives and moves at " + speed

; Loops
For i = 1 To 5
  Write i + " "
Next
Print

; Functions with a return type and a default value
Function Greet$(who$, mark$ = "!")
  Return "Hello, " + who + mark
End Function
Print Greet("PolyBasic")

; Arrays
Dim squares(5)
For i = 0 To 5 : squares(i) = i * i : Next
Print "5 squared is " + squares(5)

; Types: objects kept in a list, visited with For Each
Type Fruit
  Field name$
  Field price#
End Type

Data "apple", 0.5, "pear", 0.75, "melon", 2.25
For i = 1 To 3
  f.Fruit = New Fruit
  Read f\name, f\price
Next

total# = 0
For f.Fruit = Each Fruit
  total = total + f\price
  Select f\name
    Case "melon": Print f\name + " is big"
    Default: Print f\name + " costs " + f\price
  End Select
Next
Print "All together: " + total

; Integers are 32-bit, Float division needs a Float
Print "7 / 2 = " + 7 / 2 + " but 7.0 / 2 = " + 7.0 / 2
