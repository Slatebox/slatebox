// A workshop slate keeps its lanes and cards in creative.model. On the canvas the engine draws
// them as notes of its own and keeps them out of everything it exports, so every note in a
// slate's stored `nodes` is the slate's own note, whatever it is called.

export const hasWorkshop = board => board?.creative?.model?.kind === 'workshop'

// A workshop slate takes its name and description from the workshop's title, unless the
// workshop was added to a drawing that already had a name of its own.
export const workshopNamesSlate = board => hasWorkshop(board) && !board.nativeCanvasDrawing
