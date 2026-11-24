// The keys that undo and redo on the canvas, as a person reads them on their own keyboard
// (the engine's Keyboard binds all of them on every platform).
export function undoRedoKeys(platform = '') {
  const mac = /mac|iphone|ipad|ipod/i.test(String(platform))
  return mac
    ? { undo: '⌘Z', redo: '⇧⌘Z', undoAria: 'Meta+Z', redoAria: 'Meta+Shift+Z' }
    : { undo: 'Ctrl+Z', redo: 'Ctrl+Y', undoAria: 'Control+Z', redoAria: 'Control+Y Control+Shift+Z' }
}

/**
 * The canvas's Undo as words say it ("Undo (⌘Z)", "Undo (Ctrl+Z)"): the Undo control at the canvas's corner,
 * and its key where there is a keyboard to name (`touch`: a phone or tablet with no fine pointer says "Undo").
 */
export function undoWords(platform = '', touch = false) {
  return touch ? 'Undo' : `Undo (${undoRedoKeys(platform).undo})`
}

/** undoWords for the page this runs on. */
export function undoWordsHere() {
  if (typeof navigator === 'undefined') return 'Undo'
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches
  return undoWords(navigator.platform || navigator.userAgent, touch)
}
