// Schemas shared by the slate actions. They are registry components: the OpenAPI document
// publishes them under #/components/schemas and the tool contract inlines them.
import { CONNECTOR_KEYS, NODE_KEYS, slateOperationPlanSchema } from 'slateboxjs/operations'
// The plans' edits and rule keys join the engine's table as the rules load: load them before reading it.
import 'slateboxjs/workshops/rules'
import { describeWorkshopEdits, WORKSHOP_BOARD_KINDS } from 'slateboxjs/workshops/model'
import { catalog } from 'slateboxjs/catalog'

const text = { type: 'string' }
const object = { type: 'object' }
const number = { type: 'number' }
const nullableText = { type: ['string', 'null'] }
const revision = { type: 'integer', minimum: 0 }
const stringList = { type: 'array', items: text }
const record = (properties, required = Object.keys(properties)) => ({
  type: 'object',
  properties,
  required,
})
const sceneOrder = {
  type: 'array',
  minItems: 2,
  maxItems: 5,
  uniqueItems: true,
  items: { type: 'string', minLength: 1 },
  description:
    'All lane or station IDs exactly once, in presentation order. Board positions and routes stay intact.',
}
const mapText = (maxLength) => ({
  type: 'string',
  minLength: 1,
  maxLength,
  pattern: '^[^<>\\x00-\\x1f]+$',
})
const mapEdit = (kind, fields) => ({
  ...onBoard(record({ kind: { const: kind }, ...fields, outcome: mapText(160), expectedRevision: revision })),
  additionalProperties: false,
})
// Which board of the slate a workshop operation is for: optional on a slate of one board, required on a
// slate of several (400 board_required, with the boards). slates.get lists them (boards[].id).
export const boardIdInput = { type: 'string', pattern: '^[a-z0-9]{1,12}$', description: 'The board (slates.get boards[].id; main is the first). Required when the slate holds several boards.' }
const onBoard = (schema) => ({ ...schema, properties: { ...schema.properties, boardId: boardIdInput } })
const onePlan = (items) => record({
  message: { type: 'string', minLength: 1 },
  operations: { type: 'array', minItems: 1, maxItems: 1, items },
})

// One edit of workshop_edits: the engine's own table (describeWorkshopEdits), each with the
// boards that take it. A board's read lists the ones it takes (workshop.edits).
const workshopEdit = {
  oneOf: describeWorkshopEdits().map(({ schema, boards }) => ({
    ...schema,
    description: schema.description + ' Boards: ' + boards.join(', ') + '.',
  })),
}

export const shareIdInput = {
  type: 'string',
  minLength: 1,
  maxLength: 80,
  pattern: '^[A-Za-z0-9_-]+$',
  description: 'The slate ID from its address: /canvas/<shareId>.',
}
export const inviteRole = { type: 'string', enum: ['read', 'comment', 'edit'] }
export const inviteId = { type: 'string', pattern: '^[a-f0-9]{32}$' }
export const ref = (name) => ({ $ref: '#/components/schemas/' + name })

export const slateComponents = {
  // The published plan: a shape is a name or a custom shape {name, d, fillRule, ref} (the model
  // tool SLATE_OPERATION_TOOL lists names only).
  CanvasPlan: slateOperationPlanSchema(),
  WorkshopMovePlan: onePlan({
    ...onBoard(record({ kind: { const: 'move_workshop_card' }, cardId: text, laneId: text, expectedRevision: revision })),
    additionalProperties: false,
  }),
  WorkshopEditsPlan: {
    ...onePlan({
      ...onBoard(record({
        kind: { const: 'workshop_edits' },
        edits: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: workshopEdit,
          description:
            'Applied in order, all or none, by the rules a person meets on the canvas. Name a card or lane by its id ({id}) or by what people call it ("the Proposal stage"). workshop.edits lists the edits this board takes.',
        },
        expectedRevision: revision,
      })),
      additionalProperties: false,
    }),
    description:
      'Edit a workshop the way people do: add, move, rename and remove cards and lanes. Additions and changes save at once; an edit that removes a card, a lane, a dependency or an outcome waits for the person to agree. A refusal answers 409 edit_refused with the sentence a person sees (details.reason), details.editIndex and the board as it stands; nothing is saved.',
  },
  WorkshopUndoPlan: {
    ...onePlan({
      ...onBoard(record({
        kind: { const: 'undo_workshop_edit' },
        receiptId: { type: 'string', pattern: '^workshop-[0-9a-f]{64}$', description: 'The receiptId a saved workshop edit of yours answered with.' },
        expectedRevision: revision,
      })),
      additionalProperties: false,
    }),
    description:
      'Put the workshop back as it was before one of your saved edits, only while nothing has changed since (otherwise 409 slate_changed with the board as it stands).',
  },
  AddComponentPlan: {
    ...onePlan({
      ...record({
        kind: { const: 'add_component' },
        component: { type: 'string', enum: catalog.map((entry) => entry.id), description: 'The library entry to add (components.list ids).' },
        topic: { type: 'string', minLength: 1, maxLength: 100, description: 'What it is about: names the board ("Retro: Q3 launch").' },
        expectedRevision: { ...revision, description: 'The slate revision you read (slates.get).' },
      }, ['kind', 'component', 'expectedRevision']),
      additionalProperties: false,
    }),
    description:
      'Add a library component (components.list) to this slate, the way the chat\'s Add does: its board goes beside the slate\'s notes and boards, covering none, and open pages draw it at once. The answer names its boardId (main for a slate\'s first board). A slate holds up to 8 boards; past that, 409 component_opens_new_slate. Preview to see the board and where it goes; saving requires an Idempotency-Key.',
  },
  PresentationOrderPlan: onePlan({
    ...onBoard(record({ kind: { const: 'set_presentation_order' }, laneIds: sceneOrder, expectedRevision: revision })),
    additionalProperties: false,
  }),
  WorkshopLinePlan: onePlan({
    ...onBoard(record({
      kind: { enum: ['connect_workshop_card', 'disconnect_workshop_card'] },
      cardId: text,
      toId: { ...text, description: 'Another card of the workshop, or an ordinary note of the slate by its note ID. To disconnect, it can also be the id of one of the card\'s lines (workshop.lines[].id): the only way to name a line whose end is free on the canvas (toPoint).' },
      expectedRevision: revision,
    })),
    additionalProperties: false,
    description: 'Lane workshops: draw a line from a card to another card or to a note (connect), or take away every line between them, or one of the card\'s lines by its id (disconnect). The lines stay with the card wherever it moves, on or off the lanes.',
  }),
  MapAuthoringPlan: onePlan({
    oneOf: [
      mapEdit('add_map_branch', { fromStationId: text, label: mapText(80) }),
      mapEdit('update_map_outcome', { stationId: text }),
    ],
  }),
  Workshop: record({
    title: text,
    kind: { type: 'string', enum: [...WORKSHOP_BOARD_KINDS] },
    launch: { ...record({ day: { type: 'integer' }, finish: { type: 'integer' }, name: text }, ['day', 'finish']), description: 'Launch plans: launch day, and the day the last task ends (name: what the plan calls its line, such as go-live).' },
    clock: { ...record({ origin: text }), description: 'Launch and hiring plans with dates: the plan\'s first day (YYYY-MM-DD); every day is an offset from it.' },
    hiring: {
      ...record({ cash: { type: 'integer' }, burn: { type: 'integer' }, currency: text, weeks: { type: 'integer' }, runway: { type: 'number', description: 'Months of runway with these hires.' },
        bands: { type: 'array', items: record({ id: text, label: text, monthly: { type: 'integer' }, lane: text }) },
        funding: record({ day: { type: 'integer' }, amount: { type: 'integer' } }) }, ['cash', 'burn', 'currency', 'weeks', 'runway', 'bands']),
      description: 'Hiring plans: cash, monthly burn without new hires, role bands (cost per band, never per person), the funding round, and runway.',
    },
    forecast: { ...record({ target: { type: 'integer' }, currency: text, value: { type: 'integer' } }), description: 'Pipelines: the target, and the forecast (Σ amount × chance, plus won).' },
    budget: { ...record({ total: { type: 'integer' }, currency: text, step: { type: 'integer' } }), description: 'Budgets: the total the teams split, and the step money moves in.' },
    experience: { type: ['string', 'null'], description: 'The starter experience this board is, or null.' },
    fixed: {
      ...record({ lanes: nullableText, cards: nullableText }),
      description: 'What this board keeps as it came, in the sentence it answers a change with; null where it may change.',
    },
    revision,
    presentationOrder: sceneOrder,
    lanes: {
      type: 'array',
      items: record(
        {
          id: text,
          label: text,
          capacity: { type: 'integer' },
          caption: { ...text, description: 'The line under the lane on the canvas: "2 of 3", "4 / 8 points", "$300 · ...".' },
          held: { type: 'integer', description: 'Cards in the lane.' },
          load: { type: 'integer', description: 'Release plans: points planned in this release.' },
          budget: record({ amount: { type: 'number' }, description: text }),
          probability: { type: 'number', description: 'Pipelines: the chance a deal in this open stage is won, 0 to 1.' },
          role: { type: 'string', enum: ['won', 'lost'], description: 'Pipelines: the stage that holds won or lost deals.' },
          allocation: { type: 'integer', description: 'Budgets: what this team is given.' },
          committed: { type: 'integer', description: 'Budgets: what this team’s line items add up to.' },
          floor: { type: 'integer', description: 'Budgets: the least this team may be given.' },
          cap: { type: 'integer', description: 'Budgets: the most this team may be given.' },
          outcome: text,
          next: stringList,
          position: record({ column: { type: 'integer' }, row: { type: 'integer' } }),
          image: record({ src: text, alt: text }),
        },
        ['id', 'label', 'caption', 'held']
      ),
    },
    cards: {
      type: 'array',
      items: record(
        {
          id: text,
          label: text,
          laneId: text,
          allowedLaneIds: stringList,
          legalLaneIds: stringList,
          points: { type: 'integer', description: 'Release plans: the feature’s effort.' },
          dependsOn: { ...stringList, description: 'Release plans and launch plans: the cards it waits on.' },
          duration: { type: 'integer', description: 'Launch plans: the days the task takes.' },
          lag: { type: 'integer', description: 'Launch plans: the days it waits after what it waits on.' },
          start: { type: 'integer', description: 'Launch plans: the day it starts (derived).' },
          end: { type: 'integer', description: 'Launch plans: the day it ends (derived).' },
          slack: { type: 'integer', description: 'Launch plans: the days it can slip without moving the finish.' },
          critical: { type: 'boolean', description: 'Launch plans: on the critical path.' },
          from: { type: 'number', description: 'Dated plans: the calendar day it starts (an offset from clock.origin).' },
          to: { type: 'number', description: 'Dated plans: the calendar day after its last day; a hire\'s first day.' },
          band: { ...text, description: 'Hiring plans: the hire\'s role band.' },
          amount: { type: 'integer', description: 'Pipelines and budgets: the deal’s or line item’s amount.' },
        },
        ['id', 'label', 'laneId', 'legalLaneIds']
      ),
    },
    lines: {
      type: 'array',
      description: 'The lines joined to its cards: fromId and toId are card IDs, or note IDs of the slate. A line whose end is free on the canvas has toPoint (canvas coordinates) in place of toId.',
      items: record({ id: text, fromId: text, toId: text, toPoint: record({ x: number, y: number }), label: text }, ['id', 'fromId']),
    },
    outcomes: { type: 'array', items: record({ id: text, label: text, cardId: text, laneId: text, present: { type: 'boolean' }, text }) },
    scenes: {
      type: 'array',
      description: 'One per lane or step, in presentation order, as Present steps through them.',
      items: record({ laneId: text, label: text, caption: text, cardIds: stringList, outcomeIds: stringList, nodeIds: stringList }),
    },
    livePresentation: {
      type: ['object', 'null'],
      description: 'The presentation someone is leading now, or null: step is the viewpoint everyone is on (-1 is the whole slate).',
      properties: { sessionId: text, step: { type: 'integer' }, revision, expiresAt: { type: 'integer' } },
    },
    operations: { ...stringList, description: 'The operation kinds the operations route takes on this board.' },
    edits: { ...stringList, description: 'The edits workshop_edits takes on this board.' },
    can: {
      type: 'array',
      description: 'What this board takes, in plain words, each with a phrase that does it: what a person sees under "What else can this board do?" with the board in focus. Make the change itself with workshop_edits.',
      items: record({ words: text, say: text }, ['words', 'say']),
    },
  }, ['title', 'kind', 'experience', 'fixed', 'revision', 'presentationOrder', 'lanes', 'cards', 'outcomes', 'scenes', 'livePresentation']),
  SlateRead: record(
    {
      shareId: text,
      revision: {
        ...revision,
        description: "The slate's save count. Send it as expectedRevision with an edit; a workshop or map edit uses workshop.revision.",
      },
      name: text,
      description: text,
      url: { type: 'string', format: 'uri', description: 'The address you open the slate at.' },
      embed: {
        type: ['object', 'null'],
        description: 'The published picture of this board and its embed code, or null when none is published.',
        properties: { url: text, code: text },
      },
      access: record(
        {
          visibility: { type: 'string', enum: ['private', 'unlisted', 'public'] },
          yourRole: { type: 'string', enum: ['READ', 'COMMENT', 'EDIT'] },
          isOwner: { type: 'boolean' },
          canEdit: { type: 'boolean' },
          linkRole: { type: ['string', 'null'], description: 'The owner only: the role the share link gives, or null.' },
        },
        ['visibility', 'yourRole', 'isOwner', 'canEdit']
      ),
      brief: { type: ['string', 'null'], description: 'The brief the slate was created from.' },
      background: { type: ['object', 'null'], description: 'As update_slate takes it: {color, gradient?}.' },
      bounds: { type: ['object', 'null'], properties: { x: number, y: number, width: number, height: number } },
      nodeCount: { type: 'integer', minimum: 0, description: 'Notes the selection matches, on every page.' },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          description: 'Every key a write sets, read back as the engine loads it, unless fields chose some.',
          properties: {
            id: text,
            ...Object.fromEntries(Object.entries(NODE_KEYS).map(([key, spec]) => [key, { description: spec.description }])),
            image: { type: ['string', 'null'] },
            comments: record({ count: { type: 'integer' }, unresolved: { type: 'integer' } }),
          },
          required: ['id'],
        },
      },
      connections: {
        type: 'array',
        description: 'The connectors that start at a note on this page.',
        items: {
          type: 'object',
          properties: {
            id: text,
            from: text,
            to: { type: ['string', 'null'] },
            ...Object.fromEntries(Object.entries(CONNECTOR_KEYS).map(([key, spec]) => [key, { description: spec.description }])),
          },
          required: ['id', 'from', 'to'],
        },
      },
      nextCursor: { type: ['string', 'null'], description: 'Pass as cursor for the next page; null on the last.' },
      comments: record({ count: { type: 'integer' }, unresolved: { type: 'integer' } }),
      conversation: record({
        available: { type: 'boolean', description: 'Whether you may use this slate’s conversation.' },
        starters: {
          type: 'array',
          description: 'Up to three messages known to work here; select is the part to type over.',
          items: record({ label: text, text, select: { type: 'array', items: { type: 'integer' } } }, ['text']),
        },
      }),
      workshop: ref('Workshop'),
      boards: { type: 'array', items: object, description: 'Every board on the slate, first (main) first: {id, title, kind, origin, revision} and the same read as workshop. Name one by its id (boardId) in a workshop operation; a slate of several boards requires it.' },
      document: { type: 'object', description: 'include=full: the slate as the engine loads it {options, nodes, shareId}.' },
    },
    ['shareId', 'revision', 'name', 'description', 'url', 'embed', 'access', 'brief', 'background', 'bounds', 'nodeCount', 'nodes', 'connections', 'nextCursor', 'comments', 'conversation']
  ),
  DiagramSummary: record({
    name: text,
    description: text,
    nodeCount: { type: 'integer', minimum: 0 },
    nodes: { type: 'array', items: object },
    connections: { type: 'array', items: object },
  }),
  Invitation: record({
    shareId: text,
    inviteId,
    role: inviteRole,
    url: { type: 'string', format: 'uri' },
  }),
}

