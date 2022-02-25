import invoke from 'lodash.invoke'

export default class Menu {
  constructor(slate, node) {
    this.slate = slate
    this.node = node
    this.m = null
    this.isOpen = false
  }

  isOpen() {
    return this.isOpen
  }

  show() {
    const self = this
    const r = self.slate.paper
    if (self.m) {
      invoke(self.m, 'remove')
      self.m = null
    }
    const bb = self.node.vect.getBBox()
    const { x, y } = bb
    self.m = r.set()
    self.isOpen = true

    // right, bottom, and settings connectors
    self.node.connectors.show(x, y, self.m, () => {
      if (self.slate.events?.onMenuRequested) {
        self.slate.events?.onMenuRequested(self.node, () => {})
      }
    })
  }

  hide(exceptionElemId) {
    if (this.m) {
      this.m.forEach((m) => {
        if (m.id !== exceptionElemId) {
          m.remove()
        }
      })
      this.m.items = exceptionElemId
        ? null
        : this.m.items.filter((item) => item.id !== exceptionElemId)
      this.node?.connectors?.iconBar?.remove()
    }

    this.node.rotate.hide()
    this.isOpen = false
  }
}
