// The keys that undo and redo on the canvas, as a person reads them on their own keyboard
// (the engine's Keyboard binds all of them on every platform).
export function undoRedoKeys(platform = '') {
  const mac = /mac|iphone|ipad|ipod/i.test(String(platform))
  return mac
    ? { undo: '⌘Z', redo: '⇧⌘Z', undoAria: 'Meta+Z', redoAria: 'Meta+Shift+Z' }
    : { undo: 'Ctrl+Z', redo: 'Ctrl+Y', undoAria: 'Control+Z', redoAria: 'Control+Y Control+Shift+Z' }
}
