function getEngine(slate) {
  return slate?.v2 || slate
}

function getOrientation(slate, engine) {
  const orientation = slate?.getOrientation?.() || engine?.getOrientation?.()
  if (!orientation) {
    throw new Error('The Slatebox runtime did not provide export orientation')
  }
  return orientation
}

function normalizeExport(result, slate, engine) {
  if (typeof result === 'string') {
    return { svg: result, orient: getOrientation(slate, engine) }
  }
  if (result?.svg && result?.orient) return result
  throw new Error('The Slatebox runtime did not return presentation SVG data')
}

/** Bound optional provider work so local presentation rendering stays usable. */
export function withPresentationTimeout(
  promise,
  timeoutMs = 15000,
  message = 'AI presentation planning timed out'
) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs)
  })

  return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
    clearTimeout(timeoutId)
  })
}

/** Return only an unowned top-level export background, never a node's rect. */
export function findPresentationBackground(svgElement) {
  return (
    Array.from(svgElement?.children || []).find((element) => {
      const tagName = element?.tagName?.toLowerCase?.()
      return (
        (tagName === 'rect' || tagName === 'image') &&
        !element.getAttribute?.('rel')
      )
    }) || null
  )
}

/**
 * Find every SVG element that belongs to a presentation viewpoint node.
 *
 * Legacy Slatebox exports stamped `rel` on the group, text, and relationship
 * paths. slateboxjs 3 instead identifies the node's root group with
 * `data-node-id`, leaving its descendant paths and text untagged. Presentation
 * playback dims paths, text, and groups independently, so restoring only the
 * v3 root group still leaves its visible children at 10% opacity.
 */
/**
 * The notes a viewpoint's note brings with it. A workshop lane is drawn as its heading note
 * (`lane-<id>`) over its column, with its caption and picture: framing the lane keeps all of
 * them lit.
 */
export function presentationNodeParts(nodeId) {
  const id = String(nodeId)
  if (!id.startsWith('lane-')) return [id]
  const lane = id.slice('lane-'.length)
  return [id, 'column-' + lane, 'caption-' + lane, 'image-' + lane]
}

export function findPresentationViewpointElements(svgElement, nodeId) {
  if (nodeId == null) return []

  const id = String(nodeId)
  const parts = new Set(presentationNodeParts(id))
  const matches = new Set()
  const candidates = Array.from(
    svgElement?.querySelectorAll?.('g, path, text, marker') || []
  )

  const addWithDescendants = (element) => {
    matches.add(element)
    Array.from(
      element?.querySelectorAll?.('g, path, text, marker') || []
    ).forEach((descendant) => matches.add(descendant))
  }

  const addReferencedMarkers = (element) => {
    const markerIds = ['marker-start', 'marker-end']
      .map((attribute) => element.getAttribute?.(attribute) || '')
      .map((value) => value.match(/url\(["']?#([^"')]+)["']?\)/)?.[1])
      .filter(Boolean)

    if (!markerIds.length) return
    const elementsWithIds = Array.from(
      svgElement?.querySelectorAll?.('[id]') || []
    )
    markerIds.forEach((markerId) => {
      const marker = elementsWithIds.find(
        (elementWithId) => elementWithId.getAttribute?.('id') === markerId
      )
      if (marker) addWithDescendants(marker)
    })
  }

  candidates.forEach((element) => {
    const rel = element.getAttribute?.('rel') || ''
    const isLegacyNodeElement = rel === id || rel === `text-${id}`
    const isLegacyRelationship =
      rel.startsWith('association-') &&
      (rel.includes(`${id}-`) || rel.includes(`-${id}`))
    const isV3Relationship =
      element.getAttribute?.('data-source-node-id') === id ||
      element.getAttribute?.('data-target-node-id') === id

    if (isLegacyNodeElement || isLegacyRelationship || isV3Relationship) {
      addWithDescendants(element)
      if (isLegacyRelationship || isV3Relationship) {
        addReferencedMarkers(element)
      }
    }

    if (parts.has(element.getAttribute?.('data-node-id'))) {
      addWithDescendants(element)
    }
  })

  return Array.from(matches)
}

/**
 * Return one opacity owner per visible presentation primitive.
 *
 * V3 node descendants inherit opacity from their data-node-id group, while
 * connectors and marker paths live in shared structural containers. Dimming
 * every group and every descendant compounds 10% opacity into near-invisible
 * content and also hides the shared connector layer during camera moves.
 */
export function findPresentationDimmableElements(svgElement) {
  const candidates = Array.from(
    svgElement?.querySelectorAll?.('g, path, text') || []
  )

  return candidates.filter((element) => {
    const nodeId = element.getAttribute?.('data-node-id')
    if (nodeId) return true

    // Descendants of a v3 node inherit the root group's opacity.
    if (element.closest?.('[data-node-id]')) return false

    // Older v3 exports have no endpoint ownership. Keep those shared lines and
    // their markers fully visible instead of dimming them with no way to
    // restore the active relationship. New exports carry endpoint metadata and
    // can be highlighted selectively below.
    if (element.closest?.('marker')) return false
    if (element.getAttribute?.('data-source-node-id')) return true
    if (element.getAttribute?.('data-target-node-id')) return true
    if (element.getAttribute?.('connectortype')) return false

    // V1 exports identify node, text, and relationship primitives with rel.
    return Boolean(element.getAttribute?.('rel'))
  })
}

/**
 * Keep a directly connected previous viewpoint in the camera frame.
 *
 * Presentation data is a node tree: every parent -> child pair represents a
 * visible connector. Framing only the focused node can zoom past that line and
 * make the spatial transition look disconnected. We include only candidates
 * from the immediately preceding viewpoint, and only when they share a direct
 * edge, so dense mind maps do not unexpectedly zoom out to an entire branch.
 * Only a step from one note to one note does this: a segment (a group of notes)
 * is framed by its own notes, whatever came before it (an overview, another
 * segment).
 */
export function resolvePresentationFrameNodeIds(
  presentationData,
  focusNodeIds,
  previousNodeIds
) {
  const focus = new Set((focusNodeIds || []).map(String))
  const previous = new Set((previousNodeIds || []).map(String))
  const framed = new Set(focus)
  if (focus.size !== 1 || previous.size !== 1) return Array.from(framed)

  const visit = (nodes, parentId = null) => {
    ;(nodes || []).forEach((node) => {
      const nodeId = node?.nodeId == null ? null : String(node.nodeId)
      if (!nodeId) return

      if (
        parentId &&
        ((focus.has(nodeId) && previous.has(parentId)) ||
          (focus.has(parentId) && previous.has(nodeId)))
      ) {
        framed.add(parentId)
        framed.add(nodeId)
      }

      visit(node.childrenNodes, nodeId)
    })
  }

  visit(presentationData?.nodes)
  return Array.from(framed)
}

function parseViewBox(value) {
  const values = String(value || '')
    .trim()
    .split(/[\s,]+/)
    .map(Number)
  if (values.length !== 4 || values.some((entry) => !Number.isFinite(entry))) {
    return null
  }
  const [x, y, width, height] = values
  if (width <= 0 || height <= 0) return null
  return { x, y, width, height }
}

/**
 * Frame a v3 fit-to-content export using its real coordinate origin.
 *
 * slateboxjs 3 exports absolute canvas coordinates (often around 10,000) and
 * stamps a padded viewBox around them. The legacy presentation code replaced
 * that viewBox with `0 0 width height`, leaving every node outside the visible
 * viewport. Center-cropping the exported viewBox to the runtime orientation
 * preserves the real origin while retaining the presentation's smaller pad.
 */
export function resolvePresentationViewport(viewBox, orient = {}) {
  const exported = parseViewBox(viewBox)
  const width = Number(orient.width)
  const height = Number(orient.height)
  const hasOrientation =
    Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0

  if (!exported) {
    return {
      x: 0,
      y: 0,
      width: hasOrientation ? width : 1,
      height: hasOrientation ? height : 1,
    }
  }

  if (!hasOrientation) return exported

  return {
    x: exported.x + (exported.width - width) / 2,
    y: exported.y + (exported.height - height) / 2,
    width,
    height,
  }
}

/**
 * Export through either the legacy facade or the slateboxjs 3 engine.
 *
 * The v1 callback returns `{ svg, orient }`; the v3 engine returns the SVG
 * string synchronously and exposes orientation separately.
 */
export function exportPresentationSvg(slate, options) {
  const engine = getEngine(slate)

  if (typeof slate?.svg === 'function') {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (result) => {
        if (settled) return
        settled = true
        try {
          resolve(normalizeExport(result, slate, engine))
        } catch (error) {
          reject(error)
        }
      }

      try {
        const returned = slate.svg(options, finish)
        if (typeof returned === 'string' || returned?.svg) finish(returned)
        else if (returned?.then) returned.then(finish, reject)
      } catch (error) {
        reject(error)
      }
    })
  }

  if (typeof engine?.svg !== 'function') {
    throw new Error('The Slatebox runtime does not support SVG export')
  }

  return Promise.resolve(normalizeExport(engine.svg(options), slate, engine))
}

/** Resolve the v1 presentation method or its slateboxjs 3 module location. */
export function extractPresentationLayout(slate, options) {
  if (typeof slate?.extractPresentationLayout === 'function') {
    return slate.extractPresentationLayout(options)
  }

  const engine = getEngine(slate)
  const extract = engine?.presentation?.extractPresentationLayout
  if (typeof extract !== 'function') {
    throw new Error(
      'The Slatebox runtime does not support presentation layout extraction'
    )
  }
  return extract.call(engine.presentation, options)
}
