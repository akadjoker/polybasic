; A channel number no PlaySound gave.
ch = PlaySound(CreateSfx(SFX_HIT))
Print "ours: " + ChannelPlaying(ch)
Print ChannelPlaying(ch + 5)
