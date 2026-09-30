; Types, objects and For Each.
Type Vec
  Field x#, y#
  Field name$
  Field tag
End Type

Type Node
  Field v.Vec
  Field slots[3]
End Type

For i = 1 To 5
  v.Vec = New Vec
  v\x = i
  v\y = i * 10
  v\name = "v" + i
Next
For v.Vec = Each Vec
  Write v\name + "(" + v\x + "," + v\y + ") "
Next
Print

f.Vec = First Vec : l.Vec = Last Vec
Print "first=" + f\name + " last=" + l\name
v = After First Vec
Print "after first = " + v\name
v = Before v
Print "before that = " + v\name
Print "before first is Null: " + (Before First Vec = Null)
Print "after last is Null: " + (After Last Vec = Null)

; Deleting inside For Each is safe, the loop carries on
For v.Vec = Each Vec
  If v\x = 2 Or v\x = 4 Then Delete v
Next
For v.Vec = Each Vec : Write v\name + " " : Next : Print

; A deleted object compares equal to Null
a.Vec = First Vec
b.Vec = a
Delete a
Print "a=Null " + (a = Null) + ", b=Null " + (b = Null) + ", a<>Null " + (a <> Null)
If b = Null Then Print "b is Null too"
If Not b Then Print "Not b is true"
Delete a
Print "deleting twice is fine"

; Insert moves an object in its list
v1.Vec = First Vec
v2.Vec = Last Vec
Insert v2 Before v1
For v.Vec = Each Vec : Write v\name + " " : Next : Print
Insert v2 After Last Vec
For v.Vec = Each Vec : Write v\name + " " : Next : Print

; Objects inside objects, and [ ] arrays in fields
n.Node = New Node
n\v = New Vec
n\v\name = "inner"
n\slots[0] = 5
n\slots[3] = 7
Print n\v\name + " " + n\slots[0] + " " + n\slots[3] + " " + n\slots[1]
If n\v <> Null Then Print "field object is set"

; New objects start at zero
w.Vec = New Vec
Print "fresh: " + w\x + " [" + w\name + "] " + w\tag
w = Null
Print "w=Null " + (w = Null)

; Count, then delete all
c = 0
For v.Vec = Each Vec : c = c + 1 : Next
Print "count=" + c
Delete Each Vec
c = 0
For v.Vec = Each Vec : c = c + 1 : Next
Print "after Delete Each: " + c + " " + (First Vec = Null)

; Functions take and return objects
Function MakeVec.Vec(x#, y#)
  Local p.Vec = New Vec
  p\x = x : p\y = y
  Return p
End Function
Function Length#(p.Vec)
  Return Sqr(p\x * p\x + p\y * p\y)
End Function
Print Length(MakeVec(3, 4))
q.Vec = MakeVec(6, 8)
Print Length(q) + " " + (q = Last Vec) + " " + (q = First Vec)

; For Each with a new variable name takes the Type from the loop
For item = Each Vec
  Write item\x + " "
Next
Print

; Deleting the current object and the next one inside For Each
Delete Each Vec
For i = 1 To 6
  v = New Vec
  v\x = i
Next
For v.Vec = Each Vec
  Write v\x + " "
  If v\x = 2
    following.Vec = After v
    Delete v
    Delete following
  EndIf
Next
Print
