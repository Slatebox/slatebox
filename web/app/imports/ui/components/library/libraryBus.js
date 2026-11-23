// How the + menu and the strip ask the conversation for the library (eager, a few lines): an event
// the canvas page hears, which opens Ask Slatebox on the library or sends an add message. Everything
// the library shows (its pictures, names and rows) is in lazy chunks.
export const LIBRARY_EVENT = 'slatebox:library'
export function requestLibrary(detail) {
  window.dispatchEvent(new CustomEvent(LIBRARY_EVENT, { detail }))
}
// Loaded when the strip shows, while the browser is idle: the library is ready when Browse is tapped.
export const loadLibrary = () => import('./LibraryView')
export function prefetchLibrary() {
  const go = () => { loadLibrary().catch(() => { /* Loaded again on Browse. */ }) }
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(go, { timeout: 4000 })
  else setTimeout(go, 1500)
}
// The + menu's "Boards and starters" rows (desktop dock and phone sheet): a chunk of their own.
export const loadBoardsRows = () => import('./BoardsRows')
