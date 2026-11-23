import {moonGallery, normalizeMoonGallery} from 'slateboxjs/workshops/model'

export const moonGallerySlate = {
  kind: 'moon-gallery',
  title: 'Hang the night sky',
  initial(query) {
    const model = normalizeMoonGallery(moonGallery)
    const stage = query.get('wall')
    if (stage === 'moon' || stage === 'complete') model.hung.push('moon')
    if (stage === 'complete') model.hung.push('coast')
    return model
  },
  normalize: normalizeMoonGallery,
  labels: [],
  describe(model) {
    const names = model.panels.filter(panel => model.hung.includes(panel.id)).map(panel => panel.label)
    return names.length ? 'On the gallery wall: ' + names.join(', ') : 'The gallery wall is waiting for its first panel.'
  },
}
