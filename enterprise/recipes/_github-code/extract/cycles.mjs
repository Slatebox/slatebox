// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Import cycles (strongly connected components, Tarjan's algorithm, iterative) and hotspots (the
// modules most depended on, and those depending on most).

/** Components of more than one node, each sorted, sorted by first member. */
export function findCycles(nodes, edges) {
  const out = new Map(nodes.map((n) => [n, []]))
  for (const e of edges) if (out.has(e.from) && out.has(e.to) && e.from !== e.to) out.get(e.from).push(e.to)
  let index = 0
  const indexOf = new Map()
  const low = new Map()
  const onStack = new Set()
  const stack = []
  const components = []
  for (const start of nodes) {
    if (indexOf.has(start)) continue
    const work = [[start, 0]]
    indexOf.set(start, index)
    low.set(start, index)
    index += 1
    stack.push(start)
    onStack.add(start)
    while (work.length) {
      const frame = work[work.length - 1]
      const [v, i] = frame
      const next = out.get(v)
      if (i < next.length) {
        frame[1] += 1
        const w = next[i]
        if (!indexOf.has(w)) {
          indexOf.set(w, index)
          low.set(w, index)
          index += 1
          stack.push(w)
          onStack.add(w)
          work.push([w, 0])
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), indexOf.get(w)))
        continue
      }
      work.pop()
      if (work.length) {
        const parent = work[work.length - 1][0]
        low.set(parent, Math.min(low.get(parent), low.get(v)))
      }
      if (low.get(v) === indexOf.get(v)) {
        const component = []
        let w
        do {
          w = stack.pop()
          onStack.delete(w)
          component.push(w)
        } while (w !== v)
        if (component.length > 1) components.push(component.sort())
      }
    }
  }
  return components.sort((a, b) => (a[0] < b[0] ? -1 : 1))
}

/** The top modules by fan-in and fan-out (each at least 3 edges). */
export function hotspots(nodes, edges, top = 3) {
  const fanIn = new Map(nodes.map((n) => [n, 0]))
  const fanOut = new Map(nodes.map((n) => [n, 0]))
  for (const e of edges) {
    if (fanIn.has(e.to)) fanIn.set(e.to, fanIn.get(e.to) + 1)
    if (fanOut.has(e.from)) fanOut.set(e.from, fanOut.get(e.from) + 1)
  }
  const rank = (m) => [...m].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, top).map(([key, count]) => ({ key, count }))
  return { fanIn: rank(fanIn), fanOut: rank(fanOut) }
}
