// The export golden cases: a stored slate (fixtures/mermaid/slates) and the options it is
// written with; fixtures/mermaid/export/<name>.mmd holds the expected Mermaid.
export const EXPORT_CASES = [
  { name: 'basic', slate: 'basic.json', options: {} },
  { name: 'basic-styles', slate: 'basic.json', options: { styles: true } },
  { name: 'frames', slate: 'frames.json', options: {} },
  { name: 'mindmap', slate: 'mindmap.json', options: {} },
  { name: 'mindmap-as-flowchart', slate: 'mindmap.json', options: { format: 'flowchart' } },
  { name: 'frames-as-mindmap', slate: 'frames.json', options: { format: 'mindmap' } },
  { name: 'workshop', slate: 'workshop.json', options: {} },
  { name: 'workshop-gantt', slate: 'workshop.json', options: { format: 'gantt', start: '2026-12-01' } },
]
