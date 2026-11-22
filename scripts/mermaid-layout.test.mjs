// How an imported Mermaid diagram is laid out on the slate (imports/api/common/mermaid/layout.mjs
// and plan.mjs), checked on the geometry the plans draw (mermaid-geometry.mjs):
//   - no line passes through a note that is not one of its ends, nor across a frame's title;
//   - no label covers a note or a frame's title;
//   - a note outside a frame never overlaps it, and frames keep apart unless one holds the other;
//   - what the source writes first comes first in the diagram's direction;
//   - notes take Slatebox's own new-note look (the app's first note), not the engine's fallback.
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import { parseMermaid } from '../web/app/imports/api/common/mermaid/parse.mjs'
import { diagramPlans, NOTE_STYLE, FRAME_STYLE } from '../web/app/imports/api/common/mermaid/plan.mjs'
import { drawingFromPlans, problems } from './mermaid-geometry.mjs'

const draw = (text, options) => {
  const drawn = diagramPlans(parseMermaid(text), options)
  return { drawn, ...drawingFromPlans(drawn.plans) }
}
const clean = (name, text) => {
  const drawing = draw(text)
  const found = problems(drawing)
  assert.deepEqual(found, [], `${name}:\n  ${found.join('\n  ')}`)
  return drawing
}

// The examples on slatebox.com/product/mermaid/, as written there.
export const SITE_EXAMPLES = {
  flowchart: `flowchart TD
  idea(["Idea"]) --> plan["Write the plan"]
  plan --> review{"Ready?"}
  review -->|"yes"| ship(["Ship it"])
  review -.->|"not yet"| plan`,
  frames: `---
title: "Team map"
---
flowchart TD
  subgraph teamA["Team A [platform]"]
    a1["API"]
    subgraph inner["Inner squad"]
      a2["Gateway"]
    end
  end
  b1["Billing"]
  a1 --> a2
  a2 -->|"calls"| b1
  b1 -->|"reports to"| inner`,
  mindmap: `mindmap
  root((Launch))
    Marketing
      Blog post
      Social
    Engineering
      Release train
      Hotfix plan
    Sales
      Demo script`,
  gantt: `gantt
  title Release plan
  dateFormat YYYY-MM-DD
  section Design
  Research   :r1, 2026-01-05, 5d
  Wireframes :w1, after r1, 3d
  section Build
  API        :api, after w1, 10d
  Front end  :fe, after w1, 8d
  section Launch
  Release    :milestone, rel, after api fe, 0d`,
}

// Shapes that tempt a layered layout into lines through notes and labels on notes.
const HARD = {
  'a line that skips a layer': `flowchart TD
  a --> b --> c --> d
  a --> d
  a -->|"shortcut"| c`,
  'a wide fan-out with labels': `flowchart TD
  hub --> |"one"| n1
  hub --> |"two"| n2
  hub --> |"three"| n3
  hub --> |"four"| n4
  hub --> |"five"| n5
  hub --> |"six"| n6`,
  'long labels left to right': `flowchart LR
  start -->|"a rather long label on this line"| middle
  middle -->|"and another long one here"| finish
  start -->|"straight to the end, skipping the middle"| finish`,
  'lines back up the page': `flowchart TD
  a --> b --> c --> d
  d -->|"again"| a
  c -->|"retry"| b`,
  'lines between nested frames': `flowchart TB
  subgraph outer["Outer frame with a long title"]
    x1["First"]
    subgraph mid["Middle"]
      x2["Second"]
      subgraph deep["Deep"]
        x3["Third"]
      end
    end
  end
  y1["Outside one"]
  y2["Outside two"]
  x1 --> x3
  x3 -->|"out"| y1
  y1 --> y2
  y2 -->|"back in"| x2
  y2 --> mid`,
  'frames side by side, left to right': `flowchart LR
  subgraph one["One"]
    a1 --> a2
  end
  subgraph two["Two"]
    b1 --> b2
  end
  subgraph three["Three"]
    c1
  end
  a2 -->|"hand over"| b1
  a1 --> c1
  b2 --> c1`,
  'bottom to top': `flowchart BT
  a --> b & c
  b --> d
  c --> d
  a -->|"skip"| d`,
  'right to left': `flowchart RL
  a -->|"one"| b -->|"two"| c
  a -->|"over"| c`,
  'request and response between the same two notes': `flowchart LR
  client["Client"] -->|"request"| server["Server"]
  server -->|"response"| client
  server -->|"query"| db[("Database")]
  db -->|"rows"| server`,
  'a crossing in the middle': `flowchart TD
  a --> c & d
  b --> c & d
  c --> e
  d --> e
  a --> e`,
}

for (const [name, text] of Object.entries(SITE_EXAMPLES)) {
  test(`the site's ${name} example: no line through a note, no label on a note, no frame overlapped`, () => {
    clean(name, text)
  })
}
for (const [name, text] of Object.entries(HARD)) {
  test(`${name}: no line through a note, no label on a note, no frame overlapped`, () => {
    clean(name, text)
  })
}

const dir = new URL('./fixtures/mermaid/read/', import.meta.url)
for (const name of (await readdir(dir)).filter((file) => file.endsWith('.mmd')).sort()) {
  test(`fixture ${name}: no line through a note, no label on a note, no frame overlapped`, async () => {
    clean(name, await readFile(new URL(name, dir), 'utf8'))
  })
}

test('what the source writes first comes first: a frame written before a note sits before it', () => {
  const { boxes } = clean('frames', SITE_EXAMPLES.frames)
  const team = boxes.get('teamA')
  const billing = boxes.get('b1')
  assert.ok(billing.y >= team.y + team.height, `Billing (y ${billing.y}) should sit below Team A (bottom ${team.y + team.height}), outside it`)
  // And the other way round when the source says so.
  const flipped = SITE_EXAMPLES.frames.replace('  b1["Billing"]\n', '').replace('flowchart TD\n', 'flowchart TD\n  b1["Billing"]\n')
  const again = clean('frames, Billing first', flipped).boxes
  assert.ok(again.get('b1').y + again.get('b1').height <= again.get('teamA').y, 'Billing written first should sit above Team A')
})

test('notes take the app\'s new-note look; frames keep theirs; a Mermaid style still wins', () => {
  const { boxes } = clean('styles', `flowchart LR
  subgraph f["Frame"]
    a["Plain"]
  end
  b["Styled"]
  a --> b
  style b fill:#ffcc00,stroke:#333333,color:#111111`)
  assert.equal(boxes.get('a').style.backgroundColor, NOTE_STYLE.backgroundColor)
  assert.notEqual(NOTE_STYLE.backgroundColor, '#7aa2c8', 'the engine fallback is not the new-note look')
  assert.equal(boxes.get('b').style.backgroundColor, '#ffcc00')
  assert.equal(boxes.get('f').style.backgroundColor, FRAME_STYLE.backgroundColor)
  // Drawn into a slate that has notes, the import takes after the slate's last note, as a new note does.
  const into = draw('flowchart LR\n  a --> b', { noteStyle: { backgroundColor: '#e2f0d9', borderColor: '#38761d' } })
  assert.equal(into.boxes.get('a').style.backgroundColor, '#e2f0d9')
  assert.equal(into.boxes.get('a').style.borderColor, '#38761d')
})

test('frame titles sit top left, so lines into a frame pass beside them', () => {
  assert.equal(FRAME_STYLE.textXAlign, 'left')
  assert.equal(FRAME_STYLE.textYAlign, 'top')
})

test('600 random flowcharts in every direction, sparse and dense, with and without labels: all clear', () => {
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const failed = []
  for (let k = 0; k < 600; k += 1) {
    const dense = k % 2 === 1
    const n = 3 + Math.floor(random() * (dense ? 14 : 10))
    const m = n - 1 + Math.floor(random() * (dense ? n : 3))
    const lines = []
    for (let j = 0; j < m; j += 1) {
      const a = Math.floor(random() * n)
      const b = Math.floor(random() * n)
      if (a !== b) lines.push(`  n${a} -->${random() < 0.3 ? `|"label ${j}"|` : ''} n${b}`)
    }
    const text = `flowchart ${['TD', 'LR', 'BT', 'RL'][Math.floor(random() * 4)]}\n${lines.join('\n')}`
    if (!lines.length) continue
    const found = problems(draw(text))
    if (found.length) failed.push(`${text}\n  ${found.join('\n  ')}`)
  }
  assert.deepEqual(failed, [], failed.slice(0, 3).join('\n\n'))
})
