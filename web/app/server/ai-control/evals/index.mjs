// The eval set of each surface (spec 6.5): cases a prompt must pass before it is published.
import shape from './shape.mjs'
import workshop from './workshop.mjs'
import workshopDraft from './workshop-draft.mjs'
import canvas from './canvas.mjs'
import agent from './agent.mjs'
import presentation from './presentation.mjs'
import library from './library.mjs'
import connectors from './connectors.mjs'
import interview from './interview.mjs'
import personal from './personal.mjs'
import voice from './voice.mjs'

export const EVALS = Object.freeze({ shape, workshop, 'workshop.draft': workshopDraft, canvas, 'agent.slatebox': agent, presentation, library, connectors, interview, 'personal.suggest': personal, ...voice })
export const evalsFor = (surface) => EVALS[surface] || []
