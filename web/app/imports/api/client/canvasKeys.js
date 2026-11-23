/**
 * Keys after a control beside the canvas has been used.
 *
 * The canvas acts on Delete, Backspace, the arrows and Escape only while the keyboard is on it
 * or nowhere on the page, so a key pressed in a dialog or a field can never delete a note. A
 * person who selects a note, picks a colour in the note pane and presses Delete still means the
 * note. So when a press of the mouse or a finger leaves the keyboard on a control that has no
 * use for those keys (a button, a tab, a toggle, a slider, anything in the note pane that is not a
 * field), it is handed back: the control is blurred and the keyboard is nowhere again.
 *
 * What keeps the keyboard: a field a person types in, anything in a dialog, a menu or list
 * while it is open, the conversation, the slate settings, and any other part of the page that works with the keys
 * itself. A control reached with the keyboard (Tab, the arrows, Enter, Space) keeps it too, so
 * nothing changes for a person who does not use a pointer.
 */
const typing = [
  'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="color"])' +
    ':not([type="file"]):not([type="submit"]):not([type="reset"]):not([type="image"])',
  'textarea', 'select', '[contenteditable]:not([contenteditable="false"])', '[role="textbox"]', '[role="searchbox"]',
].join(', ')
const dialogs = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]'
// The side panels beside the canvas (Ask Slatebox, the slate settings) work with the keys themselves.
const surfaces = dialogs + ', aside[aria-label="Ask Slatebox"], [aria-label="Conversation with Slatebox"], [role="complementary"][aria-label="Slate settings"]'
// A menu, a list of choices or a picker that is on screen now, and the control that opened it.
const openMenus = '.MuiPopover-root:not(.MuiModal-hidden), .MuiAutocomplete-popper, [aria-haspopup][aria-expanded="true"], [role="combobox"][aria-expanded="true"]'
// Controls that are worked with a press and have no use for the keys once pressed.
const pressedControls = [
  'button', 'summary', '[role="button"]', '[role="tab"]', '[role="switch"]', '[role="checkbox"]', '[role="radio"]',
  '[role="menuitem"]', '[role="option"]', '[role="combobox"]:not(input)',
  'input[type="button"]', 'input[type="checkbox"]', 'input[type="radio"]', 'input[type="range"]', 'input[type="color"]',
  'input[type="file"]', 'input[type="submit"]', 'input[type="reset"]', 'input[type="image"]',
].join(', ')
// The panes and the toolbar that style what is selected on the canvas. Nothing in them but a field keeps the keyboard.
const tools = '.MuiDrawer-root, .sb-board-toolbar'
// Elsewhere, parts of a page that are worked with the arrows, Home and End themselves.
const worksWithKeys = '[role="slider"], [role="spinbutton"], [role="listbox"], [role="tree"], [role="grid"], [role="menu"], [role="menubar"], [role="application"]'
// Keys that move the keyboard on purpose or work the control it is on.
const steering = new Set(['Tab', 'Enter', ' ', 'Spacebar', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'])

/** Whether the keyboard should stay on `element` once a press has left it there. */
export function keepsKeyboard(element, canvas) {
  if (!element || element === document.body || element === document.documentElement) return true
  if (element.matches(typing) || element.closest(surfaces)) return true
  // The canvas's own notes and buttons already give it the keys. A slider of its own (the zoom
  // control) is an input, which the canvas leaves alone, so that one is handed back.
  if (canvas?.contains(element)) return !element.matches('input')
  if (element.matches(pressedControls) || element.closest(tools)) return false
  // A press on something that cannot take the keyboard leaves it on whatever holds that thing,
  // which can only be reached that way. Anything else a person can reach is taken to have a use
  // for the keys: a slate's own slider keeps them.
  return !(element.getAttribute('tabindex') === '-1' && !element.matches(worksWithKeys))
}

/**
 * Watch the page a canvas is on. `canvas` returns the canvas's element (or null while there is
 * none). Returns the function that stops watching.
 */
export function watchCanvasKeys(canvas) {
  // The last thing a person did on purpose was a press, not a key that moves the keyboard.
  let byPointer = false
  let pressed = false
  // A press opened a menu or a dialog, which has the keyboard until it closes. However it closes
  // (a choice, Escape, its own button), the keyboard then comes back to the control that opened it.
  let lent = false
  let timer = 0
  let looks = 0
  const look = () => {
    const area = canvas()
    if (!byPointer || pressed || !area) return
    // A menu still on screen is still in use. Look again when it has had time to close.
    if (document.querySelector(openMenus)) {
      lent = true
      if (looks++ < 10) timer = setTimeout(look, 120)
      return
    }
    const active = document.activeElement
    lent = Boolean(active?.closest?.(dialogs))
    if (!keepsKeyboard(active, area)) active.blur()
  }
  const soon = () => {
    clearTimeout(timer)
    looks = 0
    timer = setTimeout(look, 0)
  }
  const down = () => { byPointer = true; pressed = true }
  const up = () => { pressed = false; if (byPointer) soon() }
  const key = event => { if (steering.has(event.key)) { byPointer = false; lent = false; clearTimeout(timer) } }
  // Focus that moves by itself is looked at only when a menu or dialog is giving the keyboard
  // back. Focus the page or a person's own tools put somewhere else is left where it was put.
  const focused = () => { if (byPointer && lent) soon() }
  const pressedNow = () => { if (byPointer) soon() }
  document.addEventListener('pointerdown', down, true)
  document.addEventListener('pointerup', up, true)
  document.addEventListener('pointercancel', up, true)
  document.addEventListener('click', pressedNow, true)
  document.addEventListener('keydown', key, true)
  document.addEventListener('focusin', focused, true)
  return () => {
    clearTimeout(timer)
    document.removeEventListener('pointerdown', down, true)
    document.removeEventListener('pointerup', up, true)
    document.removeEventListener('pointercancel', up, true)
    document.removeEventListener('click', pressedNow, true)
    document.removeEventListener('keydown', key, true)
    document.removeEventListener('focusin', focused, true)
  }
}
