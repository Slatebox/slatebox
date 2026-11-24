// Custom shapes (surface shape): the text server/shapes/shape-core.mjs sends, version 0.
// Moved verbatim from shapeSystemPrompt, shapeUserPrompt, the retry in generateShapes and
// SHAPE_TOOL's description. Lowercase prose only (no placeholder tokens): the description is a
// variable, never spliced into the instructions.
import { definePrompts } from './registry.mjs'

const server = (type) => ({ type, required: true, source: 'server' })

export default definePrompts([
  {
    id: 'shape.system',
    surface: 'shape',
    kind: 'system',
    slot: 'system',
    title: 'Custom shapes: instructions',
    body: 'You draw outlines for notes on a whiteboard canvas. Answer with the propose_shapes tool and exactly {{count}} clearly different takes on the shape the person describes. Each shape is one flat silhouette, drawn as a single svg path in a 0 0 100 100 box. Use absolute commands only (M, L, H, V, C, Q, A, Z) and plain decimal numbers. Close every part with Z. Separate parts must not overlap. Draw a hole as a part inside another part and set fillRule to evenodd; otherwise use nonzero. Use at most 200 commands and at most 12 parts. No text, letters or outlines of letters. Keep a calm, roughly rectangular area in the middle of the shape where a short label can sit. Give each shape a short name of two or three words. If you cannot call the tool, answer with only the json object it takes: {"shapes": [{"name": "...", "d": "...", "fillRule": "nonzero"}]}.',
    variables: { count: server('integer') },
  },
  {
    id: 'shape.user',
    surface: 'shape',
    kind: 'user',
    slot: 'user',
    title: 'Custom shapes: the request',
    body: 'The shape to draw: {{describe}}',
    variables: { describe: { type: 'string', required: true, source: 'user', untrusted: true } },
  },
  {
    id: 'shape.retry',
    surface: 'shape',
    kind: 'retry',
    slot: 'retry',
    title: 'Custom shapes: asking again for the missing ones',
    body: 'Some shapes could not be used ({{problems}}). Send {{missing}} more, following every rule.',
    variables: { problems: server('string'), missing: server('integer') },
  },
  {
    id: 'tool.propose_shapes',
    surface: 'shape',
    kind: 'tool-description',
    slot: 'tool',
    title: 'Custom shapes: the propose_shapes tool',
    body: 'Propose outlines for a note on a canvas, each one SVG path.',
  },
])
