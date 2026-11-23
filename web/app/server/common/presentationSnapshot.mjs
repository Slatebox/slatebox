// Only delete a filename generated for this presentation in the configured asset origin.
export function ownedSnapshotKey(imageUrl, assetBase, id, generation) {
  if (!imageUrl || !assetBase || typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) return null
  const base = assetBase.replace(/\/+$/, '') + '/'
  if (!imageUrl.startsWith(base)) return null
  const key = imageUrl.slice(base.length)
  if (!/^(?:\d{4}\/\d{2}\/\d{2}\/)?present_[A-Za-z0-9_-]+\.png$/.test(key)) return null
  const filename = key.split('/').pop()
  const expected = generation ? 'present_' + id + '_' + generation + '.png' : 'present_' + id + '.png'
  return filename === expected ? key : null
}

export async function finishSnapshot(render, attach, discard) {
  const image = await render()
  // Publication may have been withdrawn or replaced while the image was being rendered.
  if (!await attach(image)) await discard(image.url)
}
