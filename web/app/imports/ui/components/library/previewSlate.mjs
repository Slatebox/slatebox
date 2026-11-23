// A library version's content as a slate document SnapSlate draws: a slate or presentation is its
// snapshot; a component is an empty slate holding its one board at the top left (as library.fork
// makes it). Pure. The id is made up for the preview's container, never a real slate's.
const BACKGROUND = '#ffffff'

export function previewSlateOf(content, { key = 'item', title = '' } = {}) {
  if (!content) return null
  const shareId = 'library_' + String(key).replace(/[^A-Za-z0-9_]/g, '').slice(0, 40)
  if (content.kind === 'component') {
    const workshop = structuredClone(content.workshop)
    return {
      shareId,
      options: { name: title || workshop?.title || 'Board', description: '', containerStyle: { backgroundColor: BACKGROUND }, workshopOrigin: { x: 40, y: 40 } },
      nodes: [],
      nativeCanvasDrawing: true,
      creative: { model: { kind: 'workshop', workshop }, revision: 0 },
    }
  }
  const slate = structuredClone(content.slate || {})
  const options = slate.options || {}
  return {
    ...slate,
    shareId,
    options: { ...options, name: options.name || title, containerStyle: { backgroundColor: BACKGROUND, ...(options.containerStyle || {}) } },
    nodes: Array.isArray(slate.nodes) ? slate.nodes : [],
  }
}
