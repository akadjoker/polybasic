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

  on(window, 'keydown', (e) =>
  {
    const code = DOM_KEY_CODES[e.code];
    if (code === undefined) return;
    input.keyDown(code);
    // Arrows and space would scroll the page instead of playing the game.
    if (code === 32 || (code >= 37 && code <= 40)) e.preventDefault();
  });
  on(window, 'keyup', (e) =>
  {
    const code = DOM_KEY_CODES[e.code];
    if (code !== undefined) input.keyUp(code);
  });
  on(window, 'blur', () => input.releaseAll());

  element.style.touchAction = 'none';
  const move = (e) =>
  {
    if (e.pointerType === 'touch' && e.pointerId !== touchId) return;
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
    element.setPointerCapture(e.pointerId);
    const [x, y] = toLogical(e.clientX, e.clientY);
    // Jumping to the new spot is not movement: a finger landing somewhere
    // should not look like a fast swipe.
    input.pointerMove(x, y, 0, 0);
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
  };
  on(element, 'pointerup', up);
  on(element, 'pointercancel', up);
  on(element, 'contextmenu', (e) => e.preventDefault());
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
