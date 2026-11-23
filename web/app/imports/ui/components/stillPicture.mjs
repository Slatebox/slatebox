// A slate's thumbnail is a still picture of the live canvas: the same renderer draws it, with every
// control the canvas has (a link's "Remove the link: …" button, a bar's "Left and Right move it a day…").
// Here none of them work, so none of them are said: the picture is one image named after the slate.

/** What the canvas puts on its parts for people using a screen reader or the keyboard. */
const SAID = /^(aria-.+|role|tabindex|title)$/

/** Take one part's control words, role and focus off it; an SVG <title> or <desc> goes (it is said, and shown on hover). */
function quiet(el) {
  if (el.localName === 'title' || el.localName === 'desc') { el.remove(); return }
  for (const name of [...el.getAttributeNames()]) if (SAID.test(name)) el.removeAttribute(name)
}

/** Take every control's words, role and focus off `root`'s parts (not off `root`). */
export function quietParts(root) {
  for (const el of [...root.querySelectorAll('*')]) quiet(el)
}

/**
 * Make `root` a still picture: its parts quiet, and kept quiet as boards draw into it later; named
 * `name` as one image when a name is given. Returns a function that stops watching.
 */
export function stillPicture(root, name) {
  if (!root) return () => {}
  // The picture itself: one image with its name, or (unnamed, inside a named one) as quiet as its parts.
  const own = () => {
    if (!name) { quiet(root); return }
    if (root.getAttribute('role') !== 'img') root.setAttribute('role', 'img')
    if (root.getAttribute('aria-label') !== name) root.setAttribute('aria-label', name)
  }
  own()
  quietParts(root)
  const Watcher = root.ownerDocument?.defaultView?.MutationObserver
  if (!Watcher) return () => {}
  const watcher = new Watcher((records) => {
    for (const record of records) {
      if (record.type === 'attributes') {
        if (record.target === root) own()
        else if (record.target.isConnected) quiet(record.target)
        continue
      }
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1 || !node.isConnected) continue
        quietParts(node)
        quiet(node)
      }
    }
  })
  watcher.observe(root, { subtree: true, childList: true, attributes: true })
  return () => watcher.disconnect()
}
