; AlignToVector turns one of an entity's axes towards a direction.
Global e, p, child

; Rate 1: the Z axis ends up along the vector.
e = CreatePivot()
AlignToVector e, 1, 0, 0, 3
fwd = CreatePivot(e)
PositionEntity fwd, 0, 0, 1
Print "Z towards +X: " + EntityX(fwd, True) + " " + EntityY(fwd, True) + " " + EntityZ(fwd, True)

; Y up along a slope, as a car on a hill: the Y axis tilts, the rest follows.
AlignToVector e, 0, 1, 1, 2
up = CreatePivot(e)
PositionEntity up, 0, 1, 0
Print "Y towards (0, 1, 1): " + EntityX(up, True) + " " + EntityY(up, True) + " " + EntityZ(up, True)

; Rate 0.5: half the angle each time.
p = CreatePivot()
AlignToVector p, 0, 1, 0, 3, 0.5
Print "half way from +Z to +Y, pitch " + EntityPitch(p)
AlignToVector p, 0, 1, 0, 3, 0.5
Print "and half again, pitch " + EntityPitch(p)

; Straight away: a half turn about X (for the Z axis).
AlignToVector p, 0, 0, -1, 3
AlignToVector p, 0, 0, 1, 3
Print "from pointing away: yaw " + EntityYaw(p) + ", pitch " + EntityPitch(p)

; A child is turned in the world, whatever its parent's turn.
TurnEntity e, 0, 40, 0
child = CreatePivot(e)
AlignToVector child, 0, 0, -1, 3
tip = CreatePivot(child)
PositionEntity tip, 0, 0, 1
Print "child's Z towards -Z: " + EntityX(tip, True) + " " + EntityZ(tip, True)
Print "a zero vector changes nothing, a bad axis is an error:"
AlignToVector p, 0, 0, 0, 3
AlignToVector p, 1, 0, 0, 4
