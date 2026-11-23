import { createLaneWorkshop, decodeWorkshopFragment, validateWorkshop } from 'slateboxjs/workshops/model'

export const maxWorkshopFragmentLength = 65536

function normalize(raw) {
  if (raw?.kind !== 'workshop' || raw.version !== 1) throw new Error('Invalid workshop document.')
  return { kind: 'workshop', version: 1, workshop: validateWorkshop(raw.workshop) }
}

export function readWorkshopFragment(fragment) {
  return { kind: 'workshop', version: 1, workshop: fragment === '' ? createLaneWorkshop() : decodeWorkshopFragment(fragment) }
}

export const portableWorkshopSlate = {
  kind: 'workshop',
  title: 'Interactive workshop',
  labels: [],
  initial: readWorkshopFragment,
  normalize,
  name: model => model.workshop.title,
  describe: ({ workshop }) => workshop.title + ' · ' + workshop.lanes.length + ' lanes · ' + workshop.cards.length + ' cards',
}
