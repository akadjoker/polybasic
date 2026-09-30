; Update and Draw may have parameters when they all have defaults.
Global n
Function Update(stepSize = 2)
  n = n + stepSize
  If n >= 10 Then End
End Function
Function Draw(label$ = "n=")
  Print label + n
End Function
