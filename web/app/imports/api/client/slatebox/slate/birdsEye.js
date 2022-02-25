import omit from 'lodash.omit'
import utils from '../helpers/Utils'
import Slate from '../core/Slate'

export default class BirdsEye {
  constructor(slate) {
    this.slate = slate
    this.be = null
    this.corner = null
    this.handle = null
    this.orx = null
    this.sp = null
    this.options = {
      size: 200,
      onHandleMove: null,
    }
    this.parentDimen = null
    this.lastX = null
    this.lastY = null
    this.wpadding = null
    this.hpadding = null
  }

  setBe() {
    if (this.be)
      this.be.style.left = `${this.parentDimen.width - this.options.size}px`
    if (this.be) this.be.style.top = '-2px'
  }

  hideText() {
    this.corner.nodes.allNodes.forEach((node) => {
      node.text.hide()
    })
  }

  wireHandle() {
    const self = this
    let start = {}

    function init() {
      self.handle.ox = this.attr('x')
      self.handle.oy = this.attr('y')
      start = utils.positionedOffset(self.slate.canvas.internal)
    }

    function move(x, y) {
      const zr = self.corner.options.viewPort.originalWidth / self.sp
      const ux = x + (x / zr - x)
      const uy = y + (y / zr - y)
      const mx = self.handle.ox + ux
      const my = self.handle.oy + uy

      self.handle.attr({ x: mx, y: my })

      const bb = self.handle.getBBox()
      const cx = bb.x * self.slate.options.viewPort.zoom.r
      const cy = bb.y * self.slate.options.viewPort.zoom.r

      self.options.onHandleMove?.apply(self, [cx, cy])

      self.slate.canvas.move({ x: cx, y: cy, dur: 0, isAbsolute: true })

      self.lastX = bb.x
      self.lastY = bb.y
    }

    function up() {
      self.refresh()
      const end = utils.positionedOffset(self.slate.canvas.internal)
      self.slate.canvas.broadcast({
        x: start.left - end.left,
        y: start.top - end.top,
      })
    }

    self.handle.drag(move, init, up)
  }

  show(_options) {
    const self = this
    Object.assign(self.options, _options)

    const c = self.slate.options.container
    self.parentDimen = utils.getDimensions(c)

    self.be = document.createElement('div')
    self.be.setAttribute('id', `slatebirdsEye_${self.slate.options.id}`)
    self.be.setAttribute('class', 'slatebirdsEye')
    self.be.style.position = 'absolute'
    self.be.style.height = `${self.options.size}px`
    self.be.style.width = `${self.options.size}px`
    self.be.style.border = '2px inset #333'
    self.be.style.backgroundColor = '#fff'

    c.appendChild(self.be)
    self.setBe()

    self.corner = new Slate(
      {
        container: `slatebirdsEye_${self.slate.options.id}`,
        viewPort: { allowDrag: false },
        collaboration: { allow: false },
        showZoom: false,
        showUndoRedo: false,
        showMultiSelect: false,
        showbirdsEye: false, // no infinite recursion!
        showLocks: false,
        imageFolder: '',
        isbirdsEye: true,
      },
      {
        onNodeDragged: () => {
          self.slate.nodes.copyNodePositions(self.corner.nodes.allNodes)
        },
      }
    ).init()

    self.refresh()

    utils.addEvent(window, 'resize', () => {
      self.parentDimen = utils.getDimensions(c)
      self.setBe()
    })
  }

  enabled() {
    return this.corner !== null
  }

  enable() {
    if (!this.corner) this.show()
    utils.el(`slatebirdsEye_${this.slate.options.id}`).style.display = 'block'
  }

  disable() {
    utils.el(`slatebirdsEye_${this.slate.options.id}`).style.display = 'none'
  }

  relationshipsChanged(pkg) {
    if (this.corner) {
      switch (pkg.type) {
        case 'removeRelationship': {
          this.corner.nodes.removeRelationship(pkg.data)
          break
        }
        case 'addRelationship':
        default: {
          const rpkg = JSON.parse(JSON.stringify(pkg))
          Object.assign(rpkg.data, { options: { lineWidth: 1 } })
          this.corner.nodes.addRelationship(rpkg.data)
          break
        }
      }
    }
  }

  nodeChanged(pkg) {
    if (this.corner) {
      if (pkg.type === 'onNodesMove') {
        this.corner.nodes.moveNodes(pkg, { useMainCanvas: true })
      } else {
        const node = this.corner.nodes.one(pkg.data.id)
        if (node) {
          const useMainCanvas = true
          switch (pkg.type) {
            case 'onNodeShapeChanged': {
              node.shapes.set(pkg.data)
              break
            }
            case 'onNodeTextChanged': {
              node.editor.set(
                pkg.data.text,
                pkg.data.fontSize,
                pkg.data.fontFamily,
                pkg.data.fontColor,
                pkg.data.textXAlign,
                pkg.data.textYAlign
              )
              break
            }
            case 'onNodeColorChanged': {
              node.colorPicker.set(pkg.data)
              break
            }
            case 'onNodeImageChanged': {
              node.images.set(
                pkg.data.img,
                pkg.data.w,
                pkg.data.h,
                useMainCanvas
              )
              this.refresh()
              break
            }
            case 'onNodeResized': {
              Object.assign(node.options, pkg.data)
              node.vect.attr({ path: pkg.data.vectorPath })
              if (node.vect.pattern) node.images.imageSizeCorrection()
              this.refresh()
              break
            }
            case 'onNodeRotated': {
              pkg.data.associations.forEach((association) => {
                const currentAssociation = node.relationships.associations.find(
                  (ass) =>
                    ass.child.options.id === association.childId &&
                    ass.parent.options.id === association.parentId
                )
                if (currentAssociation) {
                  currentAssociation.line.attr({ path: association.linePath })
                }
              })
              Object.assign(node.options, omit(pkg.data, 'associations'))
              const tempPath = this.slate.paper.path(node.vect.attr('path')) // Meteor.currentSlate.paper.path
              tempPath.remove()
              node.rotate.applyImageRotation()
              this.refresh()
              break
            }
            case 'onNodeToFront': {
              node.vect.toFront()
              break
            }
            case 'onNodeToBack': {
              node.vect.toBack()
              break
            }
            case 'onNodeLocked': {
              node.options.allowDrag = false
              break
            }
            case 'onNodeUnlocked': {
              node.options.allowDrag = true
              break
            }
            case 'changeLineColor': {
              node.lineOptions.set(pkg.data)
              break
            }
            default:
              break
          }
        }
      }
    }
  }

  nodeDeleted(pkg) {
    if (this.corner) {
      const node = this.corner.nodes.one(pkg.data.id)
      node.del()
    }
  }

  nodeDetatched(pkg) {
    if (this.corner) {
      const node = this.corner.nodes.one(pkg.data.id)
      node.relationships.detatch()
    }
  }

  reload(json) {
    this.handle?.remove()
    this.corner.loadJSON(json)
    this.refresh(true)
  }

  refresh(blnNoAdditions) {
    if (this.corner) {
      const c = this.slate.options.container
      this.parentDimen = utils.getDimensions(c)

      this.handle?.remove()

      if (blnNoAdditions === true) {
        this.corner.canvas.move({
          x: this.slate.options.viewPort.left,
          y: this.slate.options.viewPort.top,
          dur: 0,
          isAbsolute: true,
        })
        const useMainCanvas = true
        this.corner.nodes.copyNodePositions(
          this.slate.nodes.allNodes,
          useMainCanvas
        )
      } else {
        const exp = this.slate.exportDifference(this.corner, 1) // line width override
        this.corner.loadJSON(exp, true, true, true, true)
      }

      this.orx = this.slate.getOrientation()

      if (this.slate.options.viewPort.left < this.orx.left)
        this.wpadding = this.slate.options.viewPort.left - this.orx.left
      else
        this.wpadding =
          this.slate.options.viewPort.left -
          this.orx.left +
          (this.parentDimen.width - this.orx.width) // (this.slate.options.viewPort.left + this.parentDimen.width) - (this.orx.left + this.orxthis.width);

      this.hpadding = this.slate.options.viewPort.top - this.orx.top

      const pw = Math.max(
        Math.abs(this.wpadding),
        this.orx.width < this.parentDimen.width
          ? this.parentDimen.width - this.orx.width
          : 0
      )
      const ph = Math.max(
        Math.abs(this.hpadding),
        this.orx.height < this.parentDimen.height
          ? this.parentDimen.height - this.orx.height
          : 0
      )

      const wp =
        ((this.orx.width + pw) / this.options.size) *
        this.slate.options.viewPort.width
      const hp =
        ((this.orx.height + ph) / this.options.size) *
        this.slate.options.viewPort.height

      this.sp = Math.max(wp, hp)

      const r =
        Math.max(
          this.slate.options.viewPort.width,
          this.slate.options.viewPort.height
        ) / this.sp
      const l =
        (this.orx.left + (this.wpadding < 0 ? this.wpadding : 0)) * r - 5
      const t = (this.orx.top + (this.hpadding < 0 ? this.hpadding : 0)) * r - 5

      this.corner.zoom(0, 0, this.sp, this.sp, true)
      this.corner.options.viewPort.zoom.r =
        this.corner.options.viewPort.originalWidth / this.sp
      this.corner.canvas.move({ x: l, y: t, dur: 0, isAbsolute: true })
      this.corner.disable()

      const ix =
        this.slate.options.viewPort.left / this.slate.options.viewPort.zoom.r // +this.wpadding; // this.orx.left; // -(this.orx.left - this.slate.options.viewPort.left); //+this.slate.options.viewPort.left; // this.orx.left + this.orx.width / 2;
      const iy =
        this.slate.options.viewPort.top / this.slate.options.viewPort.zoom.r // +this.hpadding; // this.orx.top; // -(this.orx.top - this.slate.options.viewPort.top); //+this.slate.options.viewPort.top; // this.orx.top + this.orx.height / 2;

      const w = this.parentDimen.width / this.slate.options.viewPort.zoom.r
      const h = this.parentDimen.height / this.slate.options.viewPort.zoom.r
      this.handle = this.corner.paper.rect(ix, iy, w, h).attr({
        stroke: '#000',
        'stroke-width': 2,
        fill: '#FFEB3A',
        'fill-opacity': '.5',
      })
      this.hideText()
      this.wireHandle()
    }
  }
}
