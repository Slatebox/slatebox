import Utils from '../helpers/Utils'

export default class Shapes {
  constructor(slate, node) {
    this.slate = slate
    this.node = node
  }

  async set(pkg = { sendCollab: false }) {
    this.slate.unglow()
    let path = ''
    switch (pkg.shape) {
      case 'ellipse': {
        path = Utils.lowLevelTransformPath(
          `M${this.node.options.xPos + 75},${
            this.node.options.yPos + 50
          } m -75,0 a75,50 0 1,0 150,0 a 75,50 0 1,0 -150,0Z`
        )
        this.node.options.isEllipse = true
        break
      }
      case 'rect': {
        if (pkg.rx > 0) {
          path = Utils.lowLevelTransformPath(
            `M${this.node.options.xPos},${this.node.options.yPos} h130 a10,10 0 0 1 10,10 v80 a10,10 0 0 1 -10,10 h-130 a10,10 0 0 1 -10,-10 v-80 a10,10 0 0 1 10,-10 z`
          )
        } else {
          path = Utils.lowLevelTransformPath(
            `M${this.node.options.xPos},${this.node.options.yPos} h150 v100 h-150 v-100 z`
          )
        }
        this.node.options.isEllipse = false
        break
      }
      default: {
        path = Utils.lowLevelTransformPath(
          pkg.shape,
          `T${this.node.options.xPos},${this.node.options.yPos}`
        ) // _optimizedContext.path;
        this.node.options.isEllipse = false
        break
      }
    }

    this.node.options.vectorPath = path
    this.node.options.origVectWidth = pkg.width
    this.node.options.origVectHeight = pkg.height

    this.node.options.width = pkg.width
    this.node.options.height = pkg.height

    this.node.vect.attr({ path })
    this.node.editor.setTextOffset()
    this.node.text.attr(
      this.node.textCoords({
        x: this.node.options.xPos,
        y: this.node.options.yPos,
      })
    )

    // apply image fill rotation
    if (this.node.vect.pattern) {
      this.node.images.imageSizeCorrection()
      this.node.rotate.applyImageRotation()
    }

    this.node.text.toFront()
    this.node.link.toFront()
    this.node.relationships.refreshOwnRelationships()

    if (pkg.keepResizerOpen) {
      if (this.node.menu) this.node.menu.hide()
      if (this.node.rotate) this.node.rotate.hide()
    }

    this.node.vect.data({ id: this.node.options.id })
    this.node.context.create()

    if (pkg.sendCollab) {
      const upkg = {
        type: 'onNodeShapeChanged',
        data: {
          id: this.node.options.id,
          shape: pkg.shape,
          width: pkg.width,
          height: pkg.height,
          sendCollab: false,
          rx: pkg.rx,
        },
      }

      if (this.slate.collab) this.slate.collab.send(upkg)
      if (this.slate.birdsEye) this.slate.birdsEye.nodeChanged(upkg)
    }
  }
}
