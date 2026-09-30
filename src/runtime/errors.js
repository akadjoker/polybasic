// Errors raised while a PolyBasic program runs.

// A mistake in the running program (index out of bounds, Null object, ...).
// The runner adds the .pb file and line by looking at the stack.
export class PolyRuntimeError extends Error
{
  constructor(message)
  {
    super(message);
    this.name = 'PolyRuntimeError';
  }
}

// Thrown by `End` to unwind out of whatever the program was doing. It is a
// normal way to stop, not an error.
export class EndSignal
{
  constructor()
  {
    this.name = 'EndSignal';
  }
}

export function runtimeError(message)
{
  return new PolyRuntimeError(message);
}
