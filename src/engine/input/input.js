// Keyboard and mouse state, sampled once per Update step.
//
// Platform code (the DOM glue, or a test) reports raw events: key and
// button presses, pointer moves, wheel turns. `sample()` runs at the start
// of every Update step and turns what happened since the previous step
// into that step's view, so KeyHit is true in exactly one Update per press
// even when a frame runs several Updates, or none.

// Key codes. The numbers are PolyBasic's own (they happen to match the
// classic ASCII-style codes, which keeps them easy to remember), and the
// named constants are what programs should use.
export const KEYS = {
  KEY_BACKSPACE: 8, KEY_TAB: 9, KEY_ENTER: 13, KEY_SHIFT: 16, KEY_CONTROL: 17,
  KEY_ALT: 18, KEY_ESCAPE: 27, KEY_SPACE: 32,
  KEY_LEFT: 37, KEY_UP: 38, KEY_RIGHT: 39, KEY_DOWN: 40
};
for (let i = 0; i < 10; i++) KEYS['KEY_' + i] = 48 + i;
for (let i = 0; i < 26; i++) KEYS['KEY_' + String.fromCharCode(65 + i)] = 65 + i;
for (let i = 1; i <= 12; i++) KEYS['KEY_F' + i] = 111 + i;

// DOM KeyboardEvent.code -> our key code.
export const DOM_KEY_CODES = {
  Backspace: 8, Tab: 9, Enter: 13, NumpadEnter: 13, ShiftLeft: 16, ShiftRight: 16,
  ControlLeft: 17, ControlRight: 17, AltLeft: 18, AltRight: 18, Escape: 27, Space: 32,
  ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40
};
for (let i = 0; i < 10; i++) DOM_KEY_CODES['Digit' + i] = 48 + i;
for (let i = 0; i < 26; i++) DOM_KEY_CODES['Key' + String.fromCharCode(65 + i)] = 65 + i;
for (let i = 1; i <= 12; i++) DOM_KEY_CODES['F' + i] = 111 + i;

export class Input
{
  constructor()
  {
    this.down = new Set();         // keys held right now (raw)
    this.pressed = new Map();      // presses since the last sample
    this.released = new Map();
    this.buttons = new Set();
    this.buttonPresses = new Map();
    this.mouseX = 0;
    this.mouseY = 0;
    this.moveX = 0;                // movement since the last sample
    this.moveY = 0;
    this.wheel = 0;
    this.pointerLockWanted = false;
    // The view of the current Update step.
    this.step = {
      down: new Set(), hits: new Map(), ups: new Map(),
      buttons: new Set(), buttonHits: new Map(),
      x: 0, y: 0, speedX: 0, speedY: 0, wheel: 0
    };
  }

  // ------------------------------------------------------ raw events

  keyDown(code)
  {
    if (this.down.has(code)) return;   // auto-repeat is not a new press
    this.down.add(code);
    this.pressed.set(code, (this.pressed.get(code) || 0) + 1);
  }

  keyUp(code)
  {
    if (!this.down.has(code)) return;
    this.down.delete(code);
    this.released.set(code, (this.released.get(code) || 0) + 1);
  }

  pointerMove(x, y, dx = x - this.mouseX, dy = y - this.mouseY)
  {
    this.moveX += dx;
    this.moveY += dy;
    this.mouseX = x;
    this.mouseY = y;
  }

  buttonDown(button)
  {
    if (this.buttons.has(button)) return;
    this.buttons.add(button);
    this.buttonPresses.set(button, (this.buttonPresses.get(button) || 0) + 1);
  }

  buttonUp(button)
  {
    this.buttons.delete(button);
  }

  wheelTurn(steps)
  {
    this.wheel += steps;
  }

  // Forget held keys, e.g. when the page loses focus and key-up events
  // would never arrive.
  releaseAll()
  {
    for (const k of [...this.down]) this.keyUp(k);
    this.buttons.clear();
  }

  // ------------------------------------------------------- sampling

  sample()
  {
    const s = this.step;
    // A key pressed and released between two steps still counts as down
    // for that step, so very short taps are not lost.
    s.down = new Set([...this.down, ...this.pressed.keys()]);
    s.hits = this.pressed;
    s.ups = this.released;
    s.buttons = new Set([...this.buttons, ...this.buttonPresses.keys()]);
    s.buttonHits = this.buttonPresses;
    s.x = this.mouseX;
    s.y = this.mouseY;
    s.speedX = this.moveX;
    s.speedY = this.moveY;
    s.wheel = this.wheel;
    this.pressed = new Map();
    this.released = new Map();
    this.buttonPresses = new Map();
    this.moveX = 0;
    this.moveY = 0;
    this.wheel = 0;
  }
}
