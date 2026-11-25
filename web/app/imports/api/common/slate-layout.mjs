// The presenter's layout of a slate as the server stores it, for a presentation made without a
// browser (presentations.create, the create_presentation tool) and for a style worn by the slate
// (presentationBake): the same tree the engine's extractPresentationLayout gives the Present button
// ({ presentationWidth, presentationHeight, nodes: [{ nodeId, description, metrics: { rotation, bbox },
// childrenNodes }] }). A workshop's lanes and cards are its notes too; its captions, columns and
// handles are the board's own drawing and are not stops. Category frames are not stops either, nor
// the notes a worn style added. Boxes are relative to the notes' top left (`origin`). Pure: it reads
// the slate and returns a new object.
import { slatePreview } from './slate-preview.mjs'
import { layoutOfNodes } from './slate-layout-core.mjs'

/** The layout and where its 0, 0 is on the canvas ({ layout, origin }), a workshop's lanes and cards drawn as notes. */
export const slateLayout = (slate) => layoutOfNodes(slatePreview(slate || {}).nodes || [])

export const storedSlateLayout = (slate) => slateLayout(slate).layout
