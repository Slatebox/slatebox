// Fixtures shared by the presentation tests.

// The owner's 19-note "What is Slatebox" mind map, at its positions on /present/3df500c17b.
export function whatIsSlatebox() {
  const BR = [
    ['b1', 'Free and open source', ['MIT licensed', 'Run it on your own server']],
    ['b2', 'Smart components', ['Boards that follow your rules', 'Drag to plan, budget and decide']],
    ['b3', 'Presentations', ['AI builds the story from your slate', 'Share with a link']],
    ['b4', 'Work together', ['Live editing and comments', 'Calls right on the slate']],
    ['b5', 'Agents', ['MCP server for Claude and ChatGPT', 'API and exec scripts']],
    ['b6', 'Diagrams', ['Mermaid in and out', 'Mind maps and flowcharts']],
  ]
  const BY = [758, 854, 950, 1046, 1142, 1238]
  const LY = [459, 555, 651, 747, 848, 950, 1046, 1142, 1243, 1346, 1442, 1537]
  const box = (cx, cy, w, h) => ({ rotation: 0, bbox: { x: cx - w / 2, y: cy - h / 2, width: w, height: h } })
  return {
    nodes: [{
      nodeId: 'n0', description: 'Slatebox', metrics: box(706, 998, 114, 114),
      childrenNodes: BR.map(([id, text, kids], i) => ({
        nodeId: id, description: text, metrics: box(926, BY[i], 180, 56),
        childrenNodes: kids.map((k, j) => ({ nodeId: `l${i * 2 + j + 1}`, description: k, metrics: box(1219, LY[i * 2 + j], 230, 56), childrenNodes: [] })),
      })),
    }],
  }
}
