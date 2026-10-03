// Connects browser events to an Input. The pointer is followed with
// pointer events, so a mouse, a pen and the first finger on a touch screen
// all act as "the mouse" (a finger is button 1).

import { DOM_KEY_CODES } from './input.js';

export function attachDomInput(input, element, toLogical)
{
  let touchId = null;
  const listeners = [];
  const on = (target, type, fn, options) =>
  {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  };
  const locked = () => document.pointerLockElement === element;

  // Keys typed into an editor or a text box on the same page are not
  // game input.
  const typing = (e) =>
  {
    const t = e.target;
    return t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
  };

  on(window, 'keydown', (e) =>
  {
    if (typing(e)) return;
    const code = DOM_KEY_CODES[e.code];
    if (code === undefined) return;
    input.keyDown(code);
    // Arrows and space would scroll the page instead of playing the game.
    if (code === 32 || (code >= 37 && code <= 40)) e.preventDefault();
  });
  on(window, 'keyup', (e) =>
  {
    // Releases always count, so a key held when focus moved is let go.
    const code = DOM_KEY_CODES[e.code];
    if (code !== undefined) input.keyUp(code);
  });
  on(window, 'blur', () => input.releaseAll());

  element.style.touchAction = 'none';
  // A second button pressed or released while another is held sends no
  // pointerdown or pointerup, only a pointermove whose `buttons` changed:
  // so the buttons held are read from `buttons` on every pointer event
  // (bit 1 left, 2 right, 4 middle).
  const syncButtons = (e) =>
  {
    for (const [bit, button] of [[1, 1], [2, 2], [4, 3]])
    {
      if (e.buttons & bit) input.buttonDown(button);
      else if (input.buttons.has(button)) input.buttonUp(button);
    }
  };
  const move = (e) =>
  {
    if (e.pointerType === 'touch' && e.pointerId !== touchId) return;
    syncButtons(e);
    const [x, y] = toLogical(e.clientX, e.clientY);
    if (locked()) input.pointerMove(input.mouseX, input.mouseY, e.movementX, e.movementY);
    else input.pointerMove(x, y);
  };
  on(element, 'pointermove', move);
  on(element, 'pointerdown', (e) =>
  {
    if (e.pointerType === 'touch')
    {
      if (touchId !== null) return;
      touchId = e.pointerId;
    }
    // Capturing keeps the drag going outside the canvas, but a browser can
    // refuse (the pointer is not active any more, as under a locked pointer
    // or a synthetic event); the press must count all the same.
    try
    {
      element.setPointerCapture(e.pointerId);
    }
    catch
    {
      // not captured: the press is still taken below
    }
    const [x, y] = toLogical(e.clientX, e.clientY);
    // Jumping to the new spot is not movement: a finger landing somewhere
    // should not look like a fast swipe.
    input.pointerMove(x, y, 0, 0);
    syncButtons(e);
    input.buttonDown(e.button === 2 ? 2 : e.button === 1 ? 3 : 1);
    if (input.pointerLockWanted && !locked() && element.requestPointerLock) element.requestPointerLock();
    e.preventDefault();
  });
  const up = (e) =>
  {
    if (e.pointerType === 'touch')
    {
      if (e.pointerId !== touchId) return;
      touchId = null;
    }
    input.buttonUp(e.button === 2 ? 2 : e.button === 1 ? 3 : 1);
    syncButtons(e);
  };
  on(element, 'pointerup', up);
  on(element, 'pointercancel', up);
  on(element, 'contextmenu', (e) => e.preventDefault());
  // Whether the game holds the pointer (the browser lets go on Esc).
  on(document, 'pointerlockchange', () =>
  {
    input.pointerLocked = locked();
  });

  on(element, 'wheel', (e) =>
  {
    input.wheelTurn(e.deltaY > 0 ? -1 : e.deltaY < 0 ? 1 : 0);
    e.preventDefault();
  }, { passive: false });

  return () =>
  {
    for (const off of listeners) off();
  };
}
