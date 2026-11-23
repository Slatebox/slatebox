export const maxNativeNotesFragmentLength = 12000

function invalid() {
  throw new Error('This slate link contains invalid notes.')
}

export function readNativeNotesFragment(source, fragment) {
  if (!fragment) return source
  if (typeof fragment !== 'string' || fragment.length > maxNativeNotesFragmentLength || !fragment.startsWith('#')) invalid()
  const entries = [...new URLSearchParams(fragment.slice(1))]
  if (entries.length !== 1 || entries[0][0] !== 'notes') invalid()
  const notes = JSON.parse(entries[0][1])
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  if (!isObject(notes)) invalid()
  const template = structuredClone(source)
  for (const [id, change] of Object.entries(notes)) {
    const note = template.nodes.find(node => node.options.id === id)
    if (!note || !isObject(change)) invalid()
    for (const [key, value] of Object.entries(change)) {
      if (key === 'text') {
        if (typeof value !== 'string' || value.length > 240 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)) invalid()
        note.options.text = value
      } else if (key === 'x' || key === 'y') {
        if (!Number.isInteger(value) || Math.abs(value) > 4096) invalid()
        note.options[key === 'x' ? 'xPos' : 'yPos'] = value
      } else invalid()
    }
  }
  return template
}
