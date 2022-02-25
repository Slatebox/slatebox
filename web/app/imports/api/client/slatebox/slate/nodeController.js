import uniq from 'lodash.uniq'
import invoke from 'lodash.invoke'
import getTransformedPath from '../helpers/getTransformedPath'
import getDepCoords from '../helpers/getDepCoords'

import Utils from '../helpers/Utils'
import Editor from '../node/Editor'
import Relationships from '../node/Relationships'
import Rotate from '../node/Rotate'
import Menu from '../node/Menu'
import Connectors from '../node/Connectors'

import Resize from '../node/Resize'
import Images from '../node/Images'
import Shapes from '../node/Shapes'
import CustomShapes from '../node/CustomShapes'
import ColorPicker from '../node/ColorPicker'
import Context from '../node/Context'
import LineOptions from '../node/LineOptions'
import GridLines from '../node/GridLines'

export default class NodeController {
  constructor(slate) {
    this.slate = slate
    this.ensureBe = null
    this.allNodes = []
  }

  refreshBe() {
    const self = this
    window.clearTimeout(self.ensureBe)
    self.ensureBe = window.setTimeout(() => {
      if (self.slate.birdsEye) self.slate.birdsEye.refresh(false)
    }, 10)
  }

  getParentChild(obj) {
    let parent
    let child
    this.allNodes.forEach((node) => {
      if (node.options.id === obj.parent) {
        parent = node
      } else if (node.options.id === obj.child) {
        child = node
      }
    })

    return { p: parent, c: child }
  }

  copyNodePositions(source, useMainCanvas = false) {
    const self = this
    source.forEach((src) => {
      // if (src.options.id !== self.tempNodeId) {
      let cn = self.allNodes.find((n) => n.options.id === src.options.id)
      if (!cn) {
        self.add(src)
        cn = self.allNodes.find((n) => n.options.id === src.options.id)
      }
      cn.setPosition({ x: src.options.xPos, y: src.options.yPos })

      const opts = {}
      if (useMainCanvas) {
        const tempPath = self.slate.paper.path(cn.vect.attr('path')) // Meteor.currentSlate.paper
        opts.boundingClientRect = tempPath[0].getBoundingClientRect()
        tempPath.remove()
      }
      cn.rotate.applyImageRotation(opts)
      // }
    })
    invoke(
      self.allNodes.map((n) => n.relationships),
      'refresh'
    )
  }

  addRange(_nodes) {
    const self = this
    _nodes.forEach((node) => {
      self.add(node)
    })
    return self
  }

  removeRange(_nodes) {
    const self = this
    _nodes.forEach((node) => {
      self.allNodes = self.remove(self.allNodes, node)
    })
    return self
  }

  add(node, useMainCanvas) {
    const unode = node
    unode.slate = this.slate // parent
    this.allNodes.push(unode)
    this.addToCanvas(unode, useMainCanvas)
  }

  remove(node) {
    const unode = node
    this.allNodes = this.remove(this.allNodes, unode)
    unode.slate = null
    this.removeFromCanvas(unode)
  }

  nodeMovePackage(opts = {}) {
    // if exporting a move package with moves applied (e.g., you're
    // planning on manipulating the slate programmatically and this is
    // not an export bound for collaboration (at first)) -- then we need
    // to apply the final results to a copy of the slate because they are need
    // for the calculations below, and those calcs are mutable, so they
    // cannot be applied to the current slate.

    let use = this.slate
    let divCopy = null
    if (opts && opts.moves) {
      divCopy = document.createElement('div')
      const did = `copy_${Utils.guid()}`
      divCopy.setAttribute('id', did)
      divCopy.setAttribute('style', `width:1px;height:1px;display:none;`)
      document.body.appendChild(divCopy)
      use = this.slate.copy({ container: did, moves: opts.moves })
    }

    const nds = opts?.nodes || use.nodes.allNodes
    const ret = {
      dur: opts ? opts.dur : 300,
      easing: opts ? opts.easing : '>',
      textPositions: (() =>
        nds.map((node) => ({
          id: node.options.id,
          textPosition: {
            x: node.text.attrs.x,
            y: node.text.attrs.y,
            transform: node.getTransformString(),
          },
        })))(),
      nodeOptions: nds.map((node) => node.options),
      associations: (() => {
        const assoc = []
        if (opts.relationships && opts.nodes) {
          opts.relationships.forEach((a) => {
            assoc.push({
              parentId: a.parent.options.id,
              childId: a.child.options.id,
              linePath: a.line.attr('path').toString(),
              id: a.line.id,
            })
          })
        } else {
          use.nodes.allNodes.forEach((node) => {
            node.relationships.associations.forEach((a) => {
              assoc.push({
                parentId: a.parent.options.id,
                childId: a.child.options.id,
                linePath: a.line.attr('path').toString(),
                id: a.line.id,
              })
            })
          })
        }
        return uniq(assoc, (a) => a.id)
      })(),
    }

    if (divCopy) {
      document.removeChild(divCopy)
    }

    return ret
  }

  moveNodes(pkg, options = {}) {
    this.closeAllLineOptions()
    this.closeAllMenus()
    // _node.hideOwnMenus();
    const allAssoc = []
    this.allNodes.forEach((node) => {
      node.relationships.associations.forEach((a) => {
        allAssoc.push(a)
      })
    })
    const uniqAssoc = uniq(allAssoc, (a) => a.id)

    const p = pkg.data || pkg
    const d = p.dur || 300 // Meteor.collabAnimationDuration ||
    const e = p.easing || '>'

    const { associations, nodeOptions, textPositions } = p

    let cntr = 0
    function potentiallyFinalize() {
      cntr += 1
      if (cntr === nodeOptions.length && options.cb) {
        options.cb()
        // eslint-disable-next-line no-param-reassign
        delete options.cb
      }
    }

    nodeOptions.forEach((opts) => {
      const nodeObject = this.allNodes.find(
        (node) => node.options.id === opts.id
      )
      if (nodeObject) {
        Object.assign(nodeObject.options, opts)

        const dps = getDepCoords(
          { x: opts.xPos, y: opts.yPos },
          nodeObject.options
        )
        const { lx, ty } = dps

        const currentTextPosition = textPositions.find(
          (tp) => tp.id === opts.id
        )
        if (options.animate) {
          nodeObject.text.animate(currentTextPosition.textPosition, d, e)
          nodeObject.link.animate({ x: lx, y: ty }, d, e)
        } else {
          nodeObject.text.attr(currentTextPosition.textPosition)
          nodeObject.link.attr({ x: lx, y: ty })
        }

        if (options.animate) {
          if (nodeObject) {
            nodeObject.vect.animate(
              {
                path: opts.vectorPath,
                transform: nodeObject.getTransformString(),
              },
              d,
              e,
              () => {
                nodeObject.vect.attr({ path: opts.vectorPath })
                nodeObject.images.imageSizeCorrection()
                potentiallyFinalize()
              }
            )
          }
        } else {
          if (nodeObject) {
            nodeObject.vect.attr({ path: opts.vectorPath })
          }
          let rotationOptions = {}
          if (options.useMainCanvas) {
            const tempPath = this.slate.paper.path(nodeObject.vect.attr('path')) // Meteor.currentSlate.paper.
            rotationOptions = {
              boundingClientRect: tempPath[0].getBoundingClientRect(),
            }
            tempPath.remove()
          }
          nodeObject.rotate.applyImageRotation(rotationOptions)
          nodeObject.images.imageSizeCorrection()
          potentiallyFinalize()
        }
      }
    })

    associations.forEach((assoc) => {
      const a = uniqAssoc.find(
        (ax) =>
          ax.parent.options.id === assoc.parentId &&
          ax.child.options.id === assoc.childId
      )
      if (options.animate) {
        if (a) {
          a.line.animate({ path: assoc.linePath }, d, e, () => {
            a.line.attr({ path: assoc.linePath })
            potentiallyFinalize()
          })
        }
      } else {
        if (a) {
          a.line.attr({ path: assoc.linePath })
        }
        potentiallyFinalize()
      }
    })
    if (this.slate.birdsEye) this.slate.birdsEye.refresh(true)
  }

  static getRelevantAssociationsWith(nodes) {
    const relationshipsToTranslate = []
    const relationshipsToRefresh = []
    nodes.forEach((node) => {
      const otherSelectedNodes = nodes.filter(
        (n) => n.options.id !== node.options.id
      )
      node.relationships.associations.forEach((assoc) => {
        if (
          otherSelectedNodes
            .map((n) => n.relationships.associations)
            .some((associations) => associations.find((a) => a.id === assoc.id))
        ) {
          if (!relationshipsToTranslate.some((r) => r.id === assoc.id)) {
            relationshipsToTranslate.push(assoc) // connections which move with both nodes
          }
        } else if (!relationshipsToRefresh.some((r) => r.id === assoc.id)) {
          relationshipsToRefresh.push(assoc) // connections which move on one end only
        }
      })
    })

    return {
      relationshipsToRefresh,
      relationshipsToTranslate,
    }
  }

  static translateRelationships(relations, { dx, dy }) {
    relations.forEach((r) => {
      r.line.transform(`T${dx}, ${dy}`)
    })
  }

  static saveRelationships(relations, { dx, dy }) {
    relations.forEach((r) => {
      const newLinePath = Utils.lowLeveltransformPath(
        r.line.attr('path').toString(),
        `T${dx},${dy}`
      ).toString()
      r.line.attr({ path: newLinePath })
      r.line.transform('')
    })
  }

  removeRelationship(rm) {
    const pc = this.getParentChild(rm)
    const parent = pc.p
    const child = pc.c
    if (parent && child) {
      // parent.relationships.removeChild(child);
      // child.relationships.removeParent(parent);
      parent.relationships.removeAssociation(child)
      child.relationships.removeAssociation(parent)
    }
  }

  refreshAllRelationships() {
    this.allNodes.forEach((node) => {
      node.relationships.refreshOwnRelationships()
    })
  }

  addRelationship(add) {
    const pc = this.getParentChild(add)
    const parent = pc.p
    const child = pc.c
    if (parent && child) {
      switch (add.type) {
        case 'association':
          parent.relationships.addAssociation(child, add.options)
          break
        default: {
          break
        }
      }
    }
  }

  closeAllLineOptions(exception) {
    this.allNodes.forEach((node) => {
      node.relationships.associations.forEach((association) => {
        if (association.id !== exception) {
          if (node.lineOptions) node.lineOptions.hide(association.id)
        }
      })
    })
  }

  closeAllMenus({ exception, nodes } = {}) {
    const nn = nodes || this.allNodes
    nn.forEach((node) => {
      if (node.options.id !== exception) {
        if (node.menu) node.menu.hide()
        if (node.lineOptions) node.lineOptions.hideAll()
        if (node.resize) node.resize.hide()
        if (node.rotate) node.rotate.hide()
      }
    })
  }

  closeAllConnectors() {
    this.allNodes.forEach((node) => {
      if (node.connectors) node.connectors.remove()
      if (node.resize) node.resize.hide()
      if (node.rotate) node.rotate.hide()
    })
  }

  one(id) {
    let cn = null
    this.allNodes.forEach((node) => {
      if (node.options.id === id) {
        cn = node
      }
    })
    return cn
  }

  removeFromCanvas(node) {
    ;['vect', 'text', 'link'].forEach((tt) => {
      node[tt].remove()
    })
    this.refreshBe()
  }

  addToCanvas(snode, useMainCanvas) {
    const node = snode
    node.slate = this.slate

    let vect = null
    let link = null
    const vectOpt = {
      fill: node.options.backgroundColor || '#fff',
      'fill-opacity': node.options.opacity != null ? node.options.opacity : 1,
    }
    Object.assign(vectOpt, node.applyBorder())
    const x = node.options.xPos
    const y = node.options.yPos
    const paperToUse = this.slate.paper
    const percent = 1

    const { width, height } = node.options

    // tree:
    // node.options.vectorPath = "M72.223,47.223c0-5.945-3.777-11.039-9.028-13.021c2.192-2.455,3.472-5.651,3.472-9.201c0-7.67-6.218-13.889-13.889-13.889c-1.094,0-2.104,0.106-3.125,0.344C48.49,4.961,42.942-0.002,36.111,0c-6.83,0.001-12.379,4.964-13.542,11.46c-1.021-0.239-2.032-0.345-3.125-0.345c-7.671,0-13.889,6.218-13.889,13.889c0,3.551,1.28,6.746,3.472,9.202C3.777,36.187,0,41.278,0,47.223c0,7.671,5.556,13.892,13.889,13.892h2.777l11.111,19.444v13.887c0,2.777,2.778,5.555,5.556,5.555h5.556c2.776,0,5.555-2.777,5.555-5.555v-13.89l11.112-19.441l3.992-0.083C66.666,61.113,72.223,54.474,72.223,47.223L72.223,47.223z M27.778,61.113h16.667l-5.555,11.11h-5.556L27.778,61.113z";

    // house:
    // node.options.vectorPath = "M232.272,88.949L79.937,223.837v192.749c0,4.979,4.023,8.971,9.001,8.971h95.205v-84.51c0-4.979,3.994-9,8.971-9h78.229  c4.978,0,8.97,4.021,8.97,9v84.51h95.235c4.979,0,8.972-3.992,8.972-8.971V223.779L232.272,88.949z";

    // rounded rect:
    //
    // node.options.vectorPath = "M1,1 h130 a10,10 0 0 1 10,10 v80 a10,10 0 0 1 -10,10 h-130 a10,10 0 0 1 -10,-10 v-80 a10,10 0 0 1 10,-10 z";
    // node.options.vectorPath = "M" + x + "," + y + " h130 a10,10 0 0 1 10,10 v80 a10,10 0 0 1 -10,10 h-130 a10,10 0 0 1 -10,-10 v-80 a10,10 0 0 1 10,-10 z";
    // console.log("path is ", node.options.vectorPath);
    // node.options.vectorPath = "M20,4H4C2.9,4,2,4.9,2,6v12c0,1.1,0.9,2,2,2h16c1.1,0,2-0.9,2-2V6C22,4.9,21.1,4,20,4z"
    // M276.328,277.105h-85.096V224.74  h85.096V277.105z M79.937,42.699h54.771l-0.479,32.438l-54.293,49.048V42.699z M231.388,24.746L15.334,216.053l22.758,25.676l194.18-171.952l194.136,171.952l22.715-25.676L233.113,24.746 l-0.884-0.76L231.388,24.746z

    // const _path = paperToUse.roundedRectanglePath(pathAttrs);
    // console.log("path is ", _path);
    // node.options.vectorPath = "M" + x + "," + y + " h130 a10,10 0 0 1 10,10 v80 a10,10 0 0 1 -10,10 h-130 a10,10 0 0 1 -10,-10 v-80 a10,10 0 0 1 10,-10 z";

    // console.log("paths are ", _path, node.options.vectorPath);

    // adjust historical vectorPaths to pure paths...
    // const _tp = "T" + (x * percent) + "," + (y * percent) + ",s" + (width/150 * percent) + "," + (height/100 * percent);
    const transforms = [
      `T${x * percent}, ${y * percent}`,
      `s${(width / 150) * percent}, ${(height / 100) * percent}, ${x}, ${y}`,
    ]
    node.options.isEllipse =
      node.options.isEllipse || node.options.vectorPath === 'ellipse'
    switch (node.options.vectorPath) {
      case 'ellipse':
        node.options.vectorPath = getTransformedPath(
          'M150,50 a75,50 0 1,1 0,-1 z',
          transforms
        )
        break
      case 'rectangle':
        node.options.vectorPath = getTransformedPath(
          'M1,1 h150 v100 h-150 v-100 z',
          transforms
        )
        break
      case 'roundedrectangle':
        node.options.vectorPath = getTransformedPath(
          'M1,1 h130 a10,10 0 0 1 10,10 v80 a10,10 0 0 1 -10,10 h-130 a10,10 0 0 1 -10,-10 v-80 a10,10 0 0 1 10,-10 z',
          transforms
        )
        break
      default: {
        break
      }
    }

    if (node.options.vectorPath === 'M2,12 L22,12') {
      vectOpt['stroke-dasharray'] = '2px'
    }

    vect = paperToUse.path(node.options.vectorPath).attr(vectOpt)
    vect.node.style.cursor = 'pointer'

    // need to set in case toback or tofront is called and the load order changes in the context plugin
    vect.node.setAttribute('rel', node.options.id)
    vect.data({ id: node.options.id })
    node.vect = vect
    // node.vect.ox = x;
    // node.vect.oy = y;

    // get the text coords before the transform is applied
    // var tc = node.textCoords();
    node.vect.transform(node.getTransformString())

    // update xPos, yPos in case it is different than actual
    const bbox = vect.getBBox()
    node.options.xPos = bbox.x
    node.options.yPos = bbox.y

    const lc = node.linkCoords()

    // apply the text coords prior to transform
    // text = paperToUse.text(tc.x, tc.y, (node.options.text || '')).attr({ "font-size": node.options.fontSize + "pt", fill: node.options.foregroundColor || "#000" });
    link = paperToUse
      .linkArrow()
      .transform(
        ['t', lc.x, ',', lc.y, 's', '.8', ',', '.8', 'r', '180'].join()
      )

    // create and set editor
    node.editor = new Editor(this.slate, node)
    node.editor.set() // creates and sets the text
    node.text.transform(node.getTransformString())
    // setTimeout(() => {
    //   node.editor.setTextOffset();
    // }, 100);

    // Utils.transformPath(node, `T${self._dx},${self._dy}`);
    // node.vect.currentDx = 0;
    // node.vect.currentDy = 0;
    // node.editor.setTextOffset();

    // set links
    node.link = link

    // eslint-disable-next-line new-cap
    node.both = new node.slate.paper.set()
    node.both.push(node.vect)
    node.both.push(node.text)

    // relationships
    node.relationships = new Relationships(this.slate, node)
    // node.relationships.wireHoverEvents();
    node.relationships.wireDragEvents()
    if (node.links) node.links.wireEvents()

    // rotate
    node.rotate = new Rotate(this.slate, node)

    // connectors
    node.connectors = new Connectors(this.slate, node)

    // menu
    node.menu = new Menu(this.slate, node)

    // resizer
    node.resize = new Resize(this.slate, node)

    // images
    node.images = new Images(this.slate, node)

    // context
    node.context = new Context(this.slate, node)

    // lineOptions
    node.lineOptions = new LineOptions(this.slate, node)

    // shapes
    node.shapes = new Shapes(this.slate, node)

    // customShapes
    node.customShapes = new CustomShapes(this.slate, node)

    // colorPicker
    node.colorPicker = new ColorPicker(this.slate, node)

    // gridLines
    node.gridLines = new GridLines(this.slate, node)

    if (node.options.image && !node.options.imageOrigHeight) {
      node.options.imageOrigHeight = node.options.height
    }

    if (node.options.image && !node.options.imageOrigWidth) {
      node.options.imageOrigWidth = node.options.width
    }

    if (node.options.image && node.options.image !== '') {
      node.images.set(
        node.options.image,
        node.options.imageOrigWidth,
        node.options.imageOrigHeight,
        useMainCanvas
      )
      // node.vect.attr({ "fill": "url(" + node.options.image + ")", "stroke-width": node.options.borderWidth, "stroke": "#000" });
    }

    if (!node.options.link || !node.options.link.show) {
      node.link.hide()
    }

    // apply any node filters to vect and/or text
    node.applyFilters()

    // this code will run only for not updated nodes in slates created pre Slatebox 2.0
    // if (node.options.isEllipse) {
    //   node.shapes.set({ shape: "rect", rx: 5 });
    //   node.shapes.set({ shape: "ellipse", rx: 16 });
    // }
    // delete node.options.isEllipse;

    this.refreshBe()

    // console.log("added to canvas", vect);

    return vect
  }
}
