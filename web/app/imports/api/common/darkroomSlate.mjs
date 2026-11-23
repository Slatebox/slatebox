import { initialFocusDarkroom, normalizeFocusDarkroom, describeFocusDarkroom } from 'slateboxjs/workshops/model'

export const darkroomSlate = {
  kind: 'focus-darkroom',
  title: 'Focus Darkroom',
  initial: initialFocusDarkroom,
  normalize: normalizeFocusDarkroom,
  describe: describeFocusDarkroom,
  labels: [],
}
