// Compile errors carry the source position so tools (the CLI, the future web
// playground) can point at the exact spot. The message is written for a
// beginner: say what is wrong in plain words, never dump compiler internals.

export class CompileError extends Error
{
  constructor(message, pos)
  {
    super(message);
    this.name = 'CompileError';
    this.file = pos ? pos.file : '';
    this.line = pos ? pos.line : 0;
    this.column = pos ? pos.col : 0;
  }

  // "game.pb:3:7: error: ..." is the format editors know how to link.
  format()
  {
    return `${this.file}:${this.line}:${this.column}: error: ${this.message}`;
  }
}
