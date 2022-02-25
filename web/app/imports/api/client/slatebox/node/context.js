import utils from '../helpers/Utils'

export default class Context {
  constructor(slate, node) {
    this.slate = slate
    this.node = node
    this.contextMenu = null
    this.priorAllowDrag = true
  }

  ctx(e) {
    this.priorAllowDrag = this.node.options.allowDrag
    this.node.options.allowDrag = false
    this.remove()
    this.buildContext(e)
    setTimeout(() => {
      this.node.options.allowDrag = this.priorAllowDrag
    }, 2)
    return utils.stopEvent(e)
  }

  create() {
    if (
      this.node.text &&
      this.node.text.node &&
      this.node.options.allowContext &&
      !this.node.slate.isAlt &&
      !this.node.slate.isShift
    ) {
      this.node.text.node.oncontextmenu = this.ctx
      this.node.vect.node.oncontextmenu = this.ctx
    }
  }

  buildContext(e) {
    this.contextMenu = document.createElement('div')
    this.contextMenu.setAttribute('id', `contextMenu_${this.node.options.id}`)
    this.contextMenu.setAttribute('class', 'sb_cm')
    document.body.appendChild(this.contextMenu)
    this.setContext(e)
  }

  menuItems() {
    const tmp =
      "<div style='padding:5px;' class='sbthis.contextMenuItem' rel='{func}'>{text}</div>"
    let inside = tmp
      .replace(/{func}/g, 'tofront')
      .replace(/{text}/g, 'to front')
    inside += tmp.replace(/{func}/g, 'toback').replace(/{text}/g, 'to back')
    if (this.priorAllowDrag) {
      inside += tmp.replace(/{func}/g, 'lock').replace(/{text}/g, 'lock')
    } else {
      inside += tmp.replace(/{func}/g, 'unlock').replace(/{text}/g, 'unlock')
    }
    inside += tmp.replace(/{func}/g, 'close').replace(/{text}/g, 'close')
    return inside
  }

  setContext(e) {
    const self = this
    this.contextMenu.innerHTML = this.menuItems()
    const all = utils.select('div.contextMenuItem')
    // eslint-disable-next-line no-plusplus
    for (let s = all.length; s++; ) {
      const elem = all[s]
      elem.onclick = function (e) {
        const act = this.getAttribute('rel')
        let _reorder = false
        const pkg = { type: '', data: { id: self.node.options.id } }
        switch (act) {
          case 'tofront':
            self.node.toFront()
            _reorder = true
            pkg.type = 'onNodeToFront'
            break
          case 'toback':
            self.node.toBack()
            _reorder = true
            pkg.type = 'onNodeToBack'
            break
          case 'lock':
            self.node.options.isLocked = true // self is not a part of the self.node.disable function on purpose
            self.node.disable()
            pkg.type = 'onNodeLocked'
            break
          case 'unlock':
            self.node.options.isLocked = false // self is not a part of the self.node.enable function on purpose
            self.node.enable()
            pkg.type = 'onNodeUnlocked'
            break
          case 'close':
            break
          default: {
            break
          }
        }
        if (_reorder) {
          let zIndex = 0
          for (
            let node = self.node.slate.paper.bottom;
            node != null;
            node = node.next
          ) {
            if (node.type === 'ellipse' || node.type === 'rect') {
              zIndex += 1
              const id = node.data('id')

              // not all rects have an id (the menu box is a rect, but it has no options.id because it is not a node
              // so you cannot always show self...
              if (id) {
                const reorderedNode = self.node.slate.nodes.allNodes.find(
                  (n) => n.options.id === id
                )
                reorderedNode.sortorder = zIndex
              }
            }
          }
          self.node.slate.nodes.allNodes.sort((a, b) =>
            a.sortorder < b.sortorder ? -1 : 1
          )
        }
        if (pkg.type !== '') self.broadcast(pkg)
        this.remove()
      }
    }

    const mp = utils.mousePos(e)

    const { x } = mp // this.node.options.xPos - this.node.slate.options.viewPort.left + this.node.options.width / 3;
    const { y } = mp // this.node.options.yPos - this.node.slate.options.viewPort.top;
    this.contextMenu.style.left = `${x}px`
    this.contextMenu.style.top = `${y}px`
  }

  broadcast(pkg) {
    // broadcast
    if (this.node.slate.collab) this.node.slate.collab.send(pkg)
    if (this.node.slate.birdsEye) this.node.slate.birdsEye.nodeChanged(pkg)
  }

  remove() {
    if (this.node.slate) this.node.slate.removeContextMenus()
    this.contextMenu = null
  }

  isVisible() {
    return this.contextMenu !== null
  }
}
