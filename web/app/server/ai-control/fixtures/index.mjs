// Built-in samples for test runs and the eval gate (spec 3.6, 6.5), one file per surface: each
// builds the request its call site sends, with every prompt's text from render(id) (the version
// under test for that prompt, the live one for the rest), and says whether an answer is one the
// surface can use (its own check). Answers are shown, never applied.
import shape from './shape.mjs'
import workshop from './workshop.mjs'
import workshopDraft from './workshop-draft.mjs'
import canvas from './canvas.mjs'
import agent from './agent.mjs'
import presentation from './presentation.mjs'
import library from './library.mjs'
import connectors from './connectors.mjs'

export const FIXTURES = Object.freeze(Object.fromEntries([shape, workshop, workshopDraft, canvas, agent, presentation, library, connectors].map((f) => [f.surface, f])))
export const fixtureFor = (surface) => FIXTURES[surface] || null
