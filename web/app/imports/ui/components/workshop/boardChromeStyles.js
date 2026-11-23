import { boardChromeStyles } from 'slateboxjs/workshops/model'

// The styles every board on a canvas shares, added to the page once (board polish):
// - the engine's: a board in focus brings the rest of the canvas down to 32% while the canvas carries
//   `focusing`, and a draft's notes are see-through;
// - the app's: the board chrome's type is the app's (Manrope), and the zoom control keeps clear of a
//   cookie notice not yet answered.
// The chrome's colours are the engine's defaults (the brand's green ink and amber), which suit the slate's
// own background; whether a viewer's dark mode darkens the canvas is the dark-mode work's to decide.
const css = boardChromeStyles + `
.slatebox-zoom-slider { --slatebox-zoom-offset: var(--sb-cookie-room, 0px); }
[data-board-chrome], [data-board-layer] { --slatebox-board-font: Manrope, system-ui, sans-serif; }
[data-board-layer="focus-done-box"]:focus-visible { outline: 2px solid #1f4a3a; outline-offset: 2px; }
`

export function ensureBoardChromeStyles() {
  if (typeof document === 'undefined' || document.getElementById('sb-board-chrome')) return
  const style = document.createElement('style')
  style.id = 'sb-board-chrome'
  style.textContent = css
  document.head.appendChild(style)
}
