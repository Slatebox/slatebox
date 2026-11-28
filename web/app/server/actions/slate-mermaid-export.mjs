import { defineAction } from './registry.mjs'
import { problem } from './errors.mjs'
import { loadSlate } from './slate-access.mjs'
import { audit } from '../audit/recorder.mjs'
import { shareIdInput } from './slate-schemas.mjs'
import { slateVisibility } from '../methods/slate-role.mjs'
import { MermaidError, MERMAID_FORMATS, slateToMermaid } from '../../imports/api/common/mermaid/index.mjs'

export const mermaidProblem = (error) =>
  error instanceof MermaidError ? problem(error.status, error.code, error.message, error.details ? { details: error.details } : {}) : error

/** Where a public slate's Mermaid is served as plain text (server/actions/mermaid-file.mjs). */
export const mermaidFileUrl = (origin, shareId) => new URL(`/slates/${shareId}.mmd`, origin).href

// Any slate the caller may read, as Mermaid text. Free on every slate: no renderer, no AI.
export default defineAction({
  id: 'slates.exportMermaid',
  title: 'To Mermaid',
  description:
    'Write a slate you can open as Mermaid text: notes and lines as a flowchart (direction from the layout; shapes, labels, arrow ends and dashed, thick or hidden lines kept; a note drawn behind notes it holds becomes a subgraph of them; a workshop\'s lanes become subgraphs of cards), a mind map as a mindmap, a launch plan as a Gantt chart (format gantt, start is its first day). Returns the text, the same as a Markdown code block, and for a public slate its plain-text address (/slates/<id>.mmd). A public slate reads without a token. What Mermaid cannot say is named in warnings: dashed lines are written as Mermaid\'s one broken style (dotted), a line with an arrow only at its start is written from its other end, and a line with an end on the open canvas is left out.',
  toolset: 'slates',
  kind: 'read',
  scope: 'slates:read',
  principals: ['agent', 'visitor'],
  mounts: { http: { method: 'GET', path: '/slates/{shareId}/mermaid', operationId: 'exportMermaid' } },
  input: {
    type: 'object',
    properties: {
      shareId: shareIdInput,
      format: {
        type: 'string',
        enum: MERMAID_FORMATS,
        default: 'auto',
        description: 'auto: a mind map that is one tree as mindmap, anything else as flowchart.',
      },
      styles: { type: 'boolean', default: false, description: 'Also write each note\'s colors (style lines).' },
      start: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'A Gantt chart\'s first day, YYYY-MM-DD (default today).' },
      canonical: {
        type: 'boolean',
        default: false,
        description: 'Write the canonical flowchart a repository keeps: notes, frames and lines sorted by id, note ids as names, a fixed direction, and a first-line header "%% slatebox:<shareId> rev:<n> hash:<h>" (the hash changes only when the diagram does, never when notes move). slates.importMermaid with sync reads it back.',
      },
      direction: { type: 'string', enum: ['LR', 'TD', 'RL', 'BT'], default: 'LR', description: 'With canonical: the direction written.' },
    },
    required: ['shareId'],
    additionalProperties: false,
  },
  output: {
    type: 'object',
    properties: {
      shareId: { type: 'string' },
      revision: { type: 'integer', minimum: 0 },
      name: { type: 'string' },
      format: { type: 'string', enum: ['flowchart', 'mindmap', 'gantt'] },
      formats: { type: 'array', items: { type: 'string' }, description: 'The formats this slate can be written as.' },
      mermaid: { type: 'string' },
      markdown: { type: 'string', description: 'The Mermaid in a ```mermaid code block.' },
      notes: { type: 'integer' },
      lines: { type: 'integer' },
      subgraphs: { type: 'integer' },
      warnings: { type: 'array', items: { type: 'string' } },
      canonical: { type: 'boolean' },
      hash: { type: 'string', description: 'With canonical: the hash of the diagram (the header\'s).' },
      body: { type: 'string', description: 'With canonical: the text after the header.' },
      publicUrl: { type: ['string', 'null'], description: 'The plain-text address of a public slate\'s Mermaid; null otherwise.' },
    },
    required: ['shareId', 'revision', 'format', 'mermaid', 'markdown'],
  },
  load: loadSlate(false),
  tool: { name: 'export_mermaid', title: 'Read a slate as Mermaid', description: 'Read a slate as Mermaid text, to put a diagram in docs or code: a mind map as mindmap, a project plan as a Gantt chart, anything else as a flowchart.' },
  handler(principal, input, { deps, resource: slate }) {
    let out
    try {
      out = input.canonical
        ? slateToMermaid(slate, { canonical: true, direction: input.direction, shareId: slate.shareId, revision: slate.revision ?? 0 })
        : slateToMermaid(slate, { format: input.format, styles: input.styles, start: input.start })
    } catch (error) {
      throw mermaidProblem(error)
    }
    // A slate taken out as Mermaid by a person or a token, once an hour each (a public slate's
    // visitors are not anyone's team activity). The log never holds the text.
    if (principal?.userId && (principal.kind === 'person' || principal.kind === 'agent')) {
      audit.record({ action: 'export.mermaid', target: { type: 'slate', id: slate.shareId, name: slate.options?.name }, slateId: slate.shareId, ...(slate.orgId && { orgId: slate.orgId }), details: { format: out.format } }, { coalesce: true })
    }
    return {
      shareId: slate.shareId,
      revision: slate.revision ?? 0,
      name: `${slate.options?.name ?? ''}`,
      ...out,
      publicUrl: slateVisibility(slate) === 'public' ? mermaidFileUrl(deps.appOrigin(), slate.shareId) : null,
    }
  },
})
