import uniq from 'lodash.uniq'
import merge from 'deepmerge'
import Utils from '../helpers/Utils'
import getTransformedPath from '../helpers/getTransformedPath'
import Canvas from '../slate/Canvas'
import Collab from '../slate/Collab'
import NodeController from '../slate/NodeController'
import MultiSelection from '../slate/MultiSelection'
import BirdsEye from '../slate/BirdsEye'
import Inertia from '../slate/Inertia'
import Controller from '../slate/Controller'
import ZoomSlider from '../slate/ZoomSlider'
import UndoRedo from '../slate/UndoRedo'
import Grid from '../slate/Grid'
import Comments from '../slate/Comments'
import Keyboard from '../slate/Keyboard'
import Filters from '../slate/Filters'

import Base from './Base'
import Node from './Node'

export default class Slate extends Base {
  constructor(_options, events, collaboration) {
    super(_options)
    this.options = {
      id: _options.id || Utils.guid(),
      container: '',
      instance: '',
      name: '',
      description: '',
      basedOnThemeId: '',
      syncWithTheme: false,
      containerStyle: {
        width: 'auto',
        height: 'auto',
        backgroundColor: 'transparent',
        backgroundImage: '',
        backgroundSize: '',
        backgroundEffect: '',
        backgroundColorAsGradient: false, // linear|radial
        backgroundGradientType: null,
        backgroundGradientColors: [],
        backgroundGradientStrategy: null, // shades|palette
      },
      viewPort: {
        useInertiaScrolling: true,
        showGrid: false,
        snapToObjects: true,
        gridSize: 50,
        originalWidth: 50000,
        width: 50000,
        height: 50000,
        left: 5000,
        top: 5000,
        zoom: { w: 50000, h: 50000, r: 1 },
      },
      enabled: true,
      allowDrag: true,
      showbirdsEye: true,
      sizeOfbirdsEye: 200,
      showMultiSelect: true,
      showZoom: true,
      showUndoRedo: true,
      showStatus: true,
      showLocks: true,
      mindMapMode: true,
      isPublic: true,
      isFeatured: false,
      isCommunity: false,
      autoEnableDefaultFilters: true,
    }

    this.options = merge(this.options, _options)
    this.events = events || {
      onNodeDragged: null,
      onCanvasClicked: null,
      onImagesRequested: null,
      onRequestSave: null,
      isReadOnly: null,
    }

    this.collaboration = collaboration || {
      allow: true,
      localizedOnly: false,
      userIdOverride: null,
      onCollaboration: null,
    }

    // console.log("SLATE - share details are", this.options.shareId, this.options.userId, this.options.orgId);

    // ensure container is always an object
    if (!Utils.isElement(this.options.container)) {
      this.options.container = Utils.el(this.options.container)
    }

    this.constants = {
      statusPanelAtRest: 33,
      statusPanelExpanded: 200,
    }

    this.glows = []
    this.tips = []
    this.tempNodeId = Utils.guid()
    this.allLines = []
  }

  init() {
    const self = this
    // instantiate all the dependencies for the slate -- order here is importantish
    // (birdsEye, undoRedo, zoomSlider are used in canvas, and inertia uses canvas)
    self.nodes = new NodeController(self)
    self.collab = new Collab(self)
    self.birdsEye = new BirdsEye(self)
    self.zoomSlider = new ZoomSlider(self)
    if (!self.isReadOnly() && !self.isCommentOnly()) {
      self.undoRedo = new UndoRedo(self)
      self.multiSelection = new MultiSelection(self)
    }
    self.controller = new Controller(self)
    self.filters = new Filters(self)
    self.canvas = new Canvas(self)
    self.canvas.init()
    if (self.multiSelection) {
      self.multiSelection.initSelection()
    }
    self.inertia = new Inertia(self)
    self.grid = new Grid(self)
    self.comments = new Comments(self)
    self.keyboard = new Keyboard(self)
    // ["canvas", "collab", "multiSelection"].forEach(c => {
    //   self[c] = (Function(`return new  ${c}(slate)`))();
    // });

    self.autoLoadFilters()

    if (self.options.onInitCompleted) {
      self.options.onInitCompleted.apply(self)
    }

    return self
  }

  url(opt) {
    return this.options.ajax.rootUrl + this.options.ajax.urlFlavor + opt
  }

  glow(obj) {
    this.glows.push(obj.glow())
  }

  unglow() {
    // console.log("removing glows ", this.glows);
    this.glows.forEach((glow) => {
      glow.remove()
    })
    this.glows = []
  }

  addtip(tip) {
    if (tip) this.tips.push(tip)
  }

  untooltip() {
    this.tips.forEach((tip) => {
      if (tip) tip.remove()
    })
  }

  toggleFilters(blnHide, nodeId, esc) {
    // hide filters during dragging
    if (this.nodes.allNodes.length > 20) {
      this.nodes.allNodes.forEach((n) => {
        if (!nodeId || n.options.id === nodeId) {
          n.toggleFilters(blnHide)
        }
      })
      this.allLines
        .filter((l) => l.lineEffect)
        .forEach((c) => {
          if (blnHide) {
            c.line.attr('filter', '')
          } else {
            c.line.attr('filter', `url(#${c.lineEffect})`)
          }
        })
      if (blnHide) {
        this.canvas.hideBg()
      }
      if (esc) {
        setTimeout(() => {
          this.toggleFilters(!blnHide)
          this.canvas.hideBg(1)
        }, 500)
      }
    }
  }

  removeContextMenus() {
    const cm = Utils.select('div.sb_cm')
    cm.forEach((elem) => {
      document.body.removeChild(elem)
    })
  }

  remove() {
    this.nodes.allNodes.forEach((node) => {
      node.del()
    })
    this.paper.remove()
    // delete self;
  }

  zoom(x, y, w, h, fit) {
    this.nodes.closeAllLineOptions()
    this.paper.setViewBox(x, y, w, h, fit)
  }

  png(ropts, cb) {
    const self = this
    self.svg(
      { useDataImageUrls: true, backgroundOnly: ropts?.backgroundOnly },
      (opts) => {
        if (self.events.onCreateImage) {
          self.events.onCreateImage(
            { svg: opts.svg, orient: opts.orient, type: 'png' },
            (err, base64) => {
              if (err) {
                console.error('Unable to create png server side', svg, err)
              } else if (ropts?.base64) {
                cb(base64)
              } else {
                const img = new Image()
                img.src = base64
                img.onload = function () {
                  const canvas = document.createElement('canvas')
                  canvas.width = img.naturalWidth
                  canvas.height = img.naturalHeight
                  const ctx = canvas.getContext('2d')
                  ctx.imageSmoothingEnabled = false
                  ctx.drawImage(img, 0, 0)
                  const link = document.createElement('a')
                  link.setAttribute(
                    'download',
                    `${(self.options.name || 'slate')
                      .replace(/[^a-z0-9]/gi, '_')
                      .toLowerCase()}_${self.options.id}.png`
                  )
                  canvas.toBlob((blob) => {
                    link.href = URL.createObjectURL(blob)
                    const event = new MouseEvent('click')
                    link.dispatchEvent(event)
                    if (cb) {
                      cb()
                    }
                  })
                }
              }
            }
          )
        } else {
          const canvas = document.createElement('canvas')
          canvas.width = opts.orient.width
          canvas.height = opts.orient.height
          const blb = new Blob([opts.svg], {
            type: 'image/svg+xml;charset=utf8',
          })
          const url = URL.createObjectURL(blb)
          if (ropts?.base64) {
            console.log('sending back url', url)
            cb(`url('${url}')`)
          } else {
            const ctx = canvas.getContext('2d')
            const img = document.createElement('img')

            // img.setAttribute("src", "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(opts.svg))));
            // let svg = `
            // <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">
            //    <circle cx="25" cy="25" r="20"/>
            // </svg>`;
            img.src = url
            // console.log("img src is ", opts.svg);
            img.onload = function () {
              ctx.drawImage(img, 0, 0)
              const imgsrc = canvas.toDataURL('image/png')
              const a = document.createElement('a')
              a.download = `${(self.options.name || 'slate')
                .replace(/[^a-z0-9]/gi, '_')
                .toLowerCase()}_${self.options.id}.png`
              a.href = imgsrc
              a.click()
              URL.revokeObjectURL(img.src)
              cb && cb()
            }
            img.onerror = function () {
              console.log('error loading image ', arguments)
            }
          }
        }
      }
    )
  }

  copy(opts) {
    const self = this
    if (!self.copySlate) {
      self.copySlate = new slate({
        container: opts.container,
        containerStyle: this.options.containerStyle,
        defaultLineColor: this.options.defaultLineColor,
        viewPort: this.options.viewPort,
        name: this.options.name,
        description: this.options.description,
        showbirdsEye: false,
        showMultiSelect: false,
        showUndoRedo: false,
        showZoom: false,
      }).init()
    }
    // _copy.init();

    // known bug: the animation of text in controller methods is not aligning
    // correctly
    const json = JSON.parse(this.exportJSON())
    json.nodes.forEach((node) => {
      const cnode = node
      const mpkg = opts.moves
        ? opts.moves.find((m) => m.id === node.options.id || m.id === '*')
        : null
      if (mpkg) {
        cnode.options.xPos += mpkg.x
        cnode.options.yPos += mpkg.y
        const transforms = [`t${mpkg.x}, ${mpkg.y}`]
        cnode.options.vectorPath = getTransformedPath(
          node.options.vectorPath,
          transforms
        )
      }
    })

    // _jsonSlate, blnPreserve, blnSkipZoom, useMainCanvas = false
    self.copySlate.loadJSON(JSON.stringify(json))
    self.copySlate.nodes.refreshAllRelationships()

    return self.copySlate
  }

  svg(opts, cb) {
    const self = this

    const nodesToOrient = opts.nodes
      ? self.nodes.allNodes.filter((n) => opts.nodes.indexOf(n.options.id) > -1)
      : null
    const orient = self.getOrientation(nodesToOrient, true)
    const rr = 1 // this.options.viewPort.zoom.r || 1;
    const resizedSlate = JSON.parse(self.exportJSON())
    if (opts.backgroundOnly) {
      resizedSlate.nodes = []
    }
    resizedSlate.nodes.forEach((n) => {
      const nc = n
      const ty = n.options.yPos * rr
      const tx = n.options.xPos * rr
      const { width, height } = n.options
      nc.options.yPos = ty - orient.top
      nc.options.xPos = tx - orient.left
      nc.options.width = width * rr
      nc.options.height = height * rr
      if (nc.options.rotate && nc.options.rotate.point) {
        nc.options.rotate.point.x = nc.options.rotate.point.x * rr - orient.left
        nc.options.rotate.point.y = nc.options.rotate.point.y * rr - orient.top //  = { x: nc.options.xPos + nc.options.width/2, y: nc.options.yPos + nc.options.height/2 };
      }
      const updatedPath = Utils._transformPath(
        nc.options.vectorPath,
        [
          'T',
          (orient.left / rr) * -1,
          ',',
          (orient.top / rr) * -1,
          's',
          ',',
          _r,
          ',',
          _r,
        ].join('')
      )
      nc.options.vectorPath = updatedPath
    })

    const div = document.createElement('div')
    div.setAttribute('id', 'tempSvgSlate')
    div.style.width = `${orient.width}px`
    div.style.height = `${orient.height}px`
    div.style.visibility = 'hidden'

    document.body.appendChild(div)

    const exportOptions = merge(resizedSlate.options, {
      container: 'tempSvgSlate',
      containerStyle: {
        backgroundColor: resizedSlate.options.containerStyle.backgroundColor,
        backgroundColorAsGradient:
          resizedSlate.options.containerStyle.backgroundColorAsGradient, // linear|radial
        backgroundGradientType:
          resizedSlate.options.containerStyle.backgroundGradientType,
        backgroundGradientColors:
          resizedSlate.options.containerStyle.backgroundGradientColors,
        backgroundGradientStrategy:
          resizedSlate.options.containerStyle.backgroundGradientStrategy, // shades|palette
      },
      defaultLineColor: resizedSlate.options.defaultLineColor,
      viewPort: {
        allowDrag: false,
        originalWidth: orient.width,
        width: orient.width,
        height: orient.height,
        left: 0,
        top: 0,
        zoom: { w: orient.width * 1.5, h: orient.height * 1.5 },
        showGrid: false,
      },
      name: resizedSlate.options.name,
      description: resizedSlate.options.description,
      showbirdsEye: false,
      showMultiSelect: false,
      showUndoRedo: false,
      showZoom: false,
      showLocks: false,
      isEmbedding: true,
    })

    // we don't yet load the nodes by default even though they're passed in on the options below...
    const exportCanvas = new Slate(exportOptions).init()

    // ...that's done in the loadJSON...which seems weird
    exportCanvas.loadJSON(
      JSON.stringify({ options: exportOptions, nodes: resizedSlate.nodes }),
      false,
      true
    )
    // events don't serialize, so add them explicitly
    exportCanvas.events = self.events
    exportCanvas.nodes.refreshAllRelationships()

    // add the bgColor (this is done on html styling in slatebox proper view)
    let bg = null
    if (resizedSlate.options.containerStyle.backgroundImage) {
      const img = document.createElement('img')
      img.setAttribute(
        'src',
        resizedSlate.options.containerStyle.backgroundImage
      )
      img.style.visibility = 'hidden'
      document.body.appendChild(img)
      let bw = img.naturalWidth
      let bh = img.naturalHeight
      if (self.options.containerStyle.backgroundSize === 'cover') {
        const ratio = self.canvas.internal.parentElement.offsetWidth / bw
        bw *= ratio
        bh *= ratio
      } else {
        // TODO: handle repeat by calcing how many paper.images should be added to an array of [bg] and then simulate the repeat effect
        // need to see if orient.width > bw and if so, add another horizontally, and if orient.height > bh, then add another by the multiple vertically as well
      }
      img.remove()
      const iw = Math.max(bw, orient.width)
      const ih = Math.max(bh, orient.height)
      console.log(
        'setting iw ',
        resizedSlate.options.containerStyle.backgroundSize,
        bw,
        iw,
        orient.width
      )
      bg = exportCanvas.paper.image(
        resizedSlate.options.containerStyle.backgroundImage,
        0,
        0,
        iw,
        ih
      )
    } else {
      bg = exportCanvas.paper.rect(0, 0, orient.width, orient.height).attr({
        fill: resizedSlate.options.containerStyle.backgroundColor,
        stroke: 'none',
      })
    }
    bg.toBack()

    // the timeout is critical to ensure that the SVG canvas settles
    // and the url-fill images appear.
    setTimeout(async () => {
      exportCanvas.canvas.rawSVG((svg) => {
        cb({ svg, orient })
        div.remove()
      })
    }, 100)
  }

  // this.setSize = function (w, h) {
  //     this.paper.setSize(w, h);
  // };

  autoLoadFilters() {
    const self = this
    // if auto filter is on, then these filters become immediately availalbe in their default form
    if (
      self.options.autoEnableDefaultFilters &&
      self.filters?.availableFilters
    ) {
      Object.keys(self.filters.availableFilters).forEach((type) => {
        self.filters.add(
          {
            id: type,
            filters: self.filters.availableFilters[type].filters,
          },
          true
        )
        if (self.filters.availableFilters[type].deps) {
          self.filters.addDeps(self.filters.availableFilters[type].deps)
        }
      })
    }
  }

  loadJSON(_jsonSlate, blnPreserve, blnSkipZoom, useMainCanvas = false) {
    const self = this

    if (blnPreserve === undefined) {
      if (self.paper) self.paper.clear()
      if (self.nodes) self.nodes.allNodes = []
    }

    const loadedSlate = JSON.parse(_jsonSlate)
    Object.assign(self.options, loadedSlate.options)

    // loadedSlate.options.allowDrag = true;

    self.autoLoadFilters()

    // bgcolor set
    self.canvas?.refreshBackground()

    // grid
    if (self.options.viewPort.showGrid) {
      self.grid?.show()
    } else {
      self.grid?.destroy()
    }

    // zoom
    if (!blnSkipZoom) {
      const val = Math.max(
        self.options.viewPort.zoom.w,
        self.options.viewPort.zoom.h
      )
      self.zoomSlider?.set(val)
      // self.zoom(0, 0, _v, _v, false);
      // self.canvas.resize(_v);
    }

    // sort nodes by their last painted order to honor toBack/toFront
    loadedSlate.nodes.sort((n1, n2) => {
      const i1 = loadedSlate.options.nodeOrder?.findIndex(
        (n) => n === n1.options.id
      )
      const i2 = loadedSlate.options.nodeOrder?.findIndex(
        (n) => n === n2.options.id
      )
      return i1 - i2
    })

    const deferredRelationships = []

    loadedSlate.nodes.forEach((n) => {
      const nc = n
      nc.options.allowDrag = true
      nc.options.allowMenu = true
      const boundTo = new Node(n.options)
      self.nodes.add(boundTo, useMainCanvas)
      deferredRelationships.push({ bt: boundTo, json: n })
    })

    deferredRelationships.forEach((relationship) => {
      const bounded = relationship
      bounded.bt.addRelationships(bounded.json)
    })

    if (self.options.showLocks) {
      self.displayLocks()
    }

    // refreshes all relationships
    self.nodes.allNodes.forEach((_node) => {
      _node.relationships.updateAssociationsWith({
        activeNode: _node.options.id,
        currentDx: 0,
        currentDy: 0,
      })
    })
    self.nodes.refreshAllRelationships()

    // finally invoke toFront in order
    self.nodes.allNodes.forEach((n) => n.toFront())

    // always add style tag to the <defs> for font embedding
    self.paper.def({
      tag: 'style',
      type: 'text/css',
      id: `embeddedSBStyles_${self.options.id}`,
    })

    self.paper.def({
      tag: 'path',
      id: `raphael-marker-classic`,
      'stroke-linecap': 'round',
      d: 'M5,0 0,2.5 5,5 3.5,3 3.5,2z',
    })

    // always add the arrow path def
    // <path ="round" d="" id="" style="-webkit-tap-highlight-color: #FFEB3B;"></path>

    // reset disable if previously was disabled
    // if (!_enabled) {
    //    self.disable();
    // }

    // refresh birdsEye
    // self.options.showbirdsEye && self.birdsEye.refresh();

    self.loadAllFonts()
    if (!blnSkipZoom) {
      self.controller.centerOnNodes({ dur: 0 })
    }

    // if (self.isCommentOnly() && self.options.showbirdsEye) {
    //   self.comments.engage();
    // }
  }

  loadAllFonts() {
    // load all fonts
    const fonts = uniq(
      this.nodes.allNodes.map((n) => n.options.fontFamily)
    ).join('|')
    if (document.getElementById('googleFonts')) {
      document
        .getElementById('googleFonts')
        .setAttribute(
          'href',
          `https://fonts.googleapis.com/css?family=${fonts}`
        )
    } else {
      const sc = document.createElement('link')
      sc.setAttribute('src', 'https://fonts.googleapis.com/css?family=${fonts}')
      sc.setAttribute('id', 'googleFonts')
      sc.setAttribute('rel', 'stylesheet')
      sc.setAttribute('type', 'text/css')
      document.head.appendChild(sc)
    }
  }

  displayLocks() {
    this.nodes.allNodes.forEach((node) => {
      node.initLock()
    })
  }

  hideLocks() {
    this.nodes.allNodes.forEach((node) => {
      node.hideLock()
    })
  }

  isReadOnly() {
    return (
      !this.events.isReadOnly ||
      (this.events.isReadOnly && this.events.isReadOnly())
    )
  }

  isCommentOnly() {
    return (
      !this.events.isCommentOnly ||
      (this.events.isCommentOnly && this.events.isCommentOnly())
    )
  }

  canRemoveComments() {
    return (
      !this.events.canRemoveComments ||
      (this.events.canRemoveComments && this.events.canRemoveComments())
    )
  }

  // the granularity is at the level of the node...
  exportDifference(compare, lineWidthOverride) {
    const difOpts = { ...this.options }
    delete difOpts.container
    // delete difOpts.events;

    // birdsEye specific -- if this is not here, then locks
    // show up on the birdsEye
    difOpts.showLocks = compare.options.showLocks

    const jsonSlate = {
      options: JSON.parse(JSON.stringify(difOpts)),
      nodes: [],
    }
    const tnid = this.tempNodeId
    this.nodes.allNodes.forEach((node) => {
      let exists = false
      const pn = node
      if (pn.options.id !== tnid) {
        compare.nodes.allNodes.forEach((nodeInner) => {
          if (nodeInner.options.id === pn.options.id) {
            exists = true
          }
        })
        if (!exists) {
          jsonSlate.nodes.push(pn.serialize(lineWidthOverride))
        }
      }
    })

    return JSON.stringify(jsonSlate)
  }

  exportJSON() {
    const cont = this.options.container
    const pcont = this.collaboration.panelContainer || null
    const callbacks = this.collaboration.callbacks || null
    const opts = this.options
    delete opts.container

    const jsonSlate = { options: JSON.parse(JSON.stringify(opts)), nodes: [] }
    this.options.container = cont
    this.collaboration.panelContainer = pcont
    this.collaboration.callbacks = callbacks

    delete jsonSlate.options.ajax
    delete jsonSlate.options.container

    const tnid = this.tempNodeId
    this.nodes.allNodes.forEach((node) => {
      if (node.options.id !== tnid) {
        jsonSlate.nodes.push(node.serialize())
      }
    })

    jsonSlate.shareId = this.shareId

    return JSON.stringify(jsonSlate)
  }

  snapshot() {
    const snap = JSON.parse(this.exportJSON())
    snap.nodes.allNodes = snap.nodes
    return snap
  }

  getOrientation(nodesToOrient, _alwaysOne) {
    let orient = 'landscape'
    const sWidth = this.options.viewPort.width
    const sHeight = this.options.viewPort.height
    const bb = {}
    bb.left = 99999
    bb.right = 0
    bb.top = 99999
    bb.bottom = 0

    const an = nodesToOrient || this.nodes.allNodes
    if (an.length > 0) {
      for (let px = 0; px < an.length; px += 1) {
        // var sb = allNodes[px].b.split(' ');
        const sbw = 10
        // if (!isNaN(sb[0].replace('px', ''))) sbw = parseInt(sb[0].replace('px', ''));
        const vbb = an[px].vect.getBBox()

        // var x = vbb.x + ((vbb.x / this.options.viewPort.zoom.r) - vbb.x);
        const rz = _alwaysOne ? 1 : this.options.viewPort.zoom.r || 1
        const x = vbb.x * rz
        const y = vbb.y * rz
        const w = vbb.width * rz
        const h = vbb.height * rz

        /*
        var x = _bb.x;
        var y = _bb.y;
        var w = _bb.width;
        var h = _bb.height;
        */

        bb.left = Math.abs(Math.min(bb.left, x - sbw))
        bb.right = Math.abs(Math.max(bb.right, x + w + sbw))
        bb.top = Math.abs(Math.min(bb.top, y - sbw))
        bb.bottom = Math.abs(Math.max(bb.bottom, y + h + sbw))
      }

      const cwidth = bb.right - bb.left
      const cheight = bb.bottom - bb.top

      if (cheight > cwidth) {
        orient = 'portrait'
      }
    }
    return {
      orientation: orient,
      height: sHeight,
      width: sWidth,
      left: bb.left,
      top: bb.top,
    }
  }

  resize(size, dur, pad) {
    let p = pad || 0
    if (p < 6) p = 6
    let nsize = size
    nsize -= p * 2 || 0
    const orx = this.getOrientation()
    const wp = (orx.width / nsize) * this.options.viewPort.width
    const hp = (orx.height / nsize) * this.options.viewPort.height
    const sp = Math.max(wp, hp)

    const rr =
      Math.max(this.options.viewPort.width, this.options.viewPort.height) / sp
    const l = orx.left * rr - p
    const t = orx.top * rr - p

    this.zoom(0, 0, sp, sp, true)
    this.options.viewPort.zoom = {
      w: sp,
      h: sp,
      l: parseInt(l * -1, 10),
      t: parseInt(t * -1, 10),
      r: this.options.viewPort.originalWidth / sp,
    }
    this.canvas.move({ x: l, y: t, dur, isAbsolute: true })
  }

  // stopEditing() {
  //   this.nodes.allNodes.forEach(function (node) {
  //     node.links && node.links.end();
  //     node.customShapes && node.customShapes.end();
  //   });
  // };

  disable(exemptSlate, exemptNodes) {
    if (!exemptNodes) {
      this.nodes.allNodes.forEach((node) => {
        node.disable()
      })
    }

    if (!exemptSlate) {
      this.options.enabled = false
      this.options.allowDrag = false
    }
  }

  enable(exemptSlate, exemptNodes) {
    if (!exemptNodes) {
      this.nodes.allNodes.forEach((node) => {
        if (!node.options.isLocked) node.enable()
      })
    }
    if (!exemptSlate) {
      this.options.enabled = true
      this.options.allowDrag = true
    }
  }

  reorderNodes() {
    // these ids will come out in the order that they are painted on the screen - toFront and toBack adjusts this, so we need
    // to always keep this hand so that when the slate is reloaded, it can order the nodes by these ids (which are going to be dif
    // from the saved JSON order of arrays)
    const ids = Array.from(
      this.canvas.internal.querySelector('svg').querySelectorAll('path')
    )
      .map((a) => a.getAttribute('rel'))
      .filter((r) => !!r)
    // console.log("order of nodes", ids);
    this.options.nodeOrder = ids
  }

  findChildren(nodeIds, allChildren = []) {
    const self = this
    // get his node's children - then recursively call findChildren on that node
    const nodes = self.nodes.allNodes.filter((n) =>
      nodeIds.includes(n.options.id)
    )
    // console.log("got nodes", nodes.length);
    let children = allChildren
    children = children.concat(nodes.map((n) => n.options.id))
    nodes.forEach((n) => {
      n.relationships.associations
        .filter((a) => a.parent.options.id === n.options.id)
        .forEach((a) => children.push(a.child.options.id))
    })
    // let children = nodes.map(n => n.relationships.associations).flat().filter(a => a.parentId === n.options.id).map(a => a.childId).flat();
    // console.log("got children", children, children);
    if (children.length) {
      return self.findChildren(children, children)
    }
    return children
  }

  applyTheme(theme, syncWithTheme, revertTheme) {
    const self = this
    if (!revertTheme) {
      self.options.basedOnThemeId = theme._id
      self.options.syncWithTheme = syncWithTheme
    } else {
      self.options.basedOnThemeId = null
      self.options.syncWithTheme = null
    }
    const nodeStyle = {}
    const currentNodesByColor = {}
    const totChildren = []

    // first apply slate

    if (theme.containerStyle.backgroundImage) {
      self.collab.invoke({
        type: 'onSlateBackgroundImageChanged',
        data: {
          bg: {
            size: theme.containerStyle.backgroundSize,
            url: theme.containerStyle.backgroundImage,
          },
        },
      })
    } else if (theme.containerStyle.backgroundEffect) {
      self.collab.invoke({
        type: 'onSlateBackgroundEffectChanged',
        data: { effect: theme.containerStyle.backgroundEffect },
      })
    } else {
      self.collab.invoke({
        type: 'onSlateBackgroundColorChanged',
        data: {
          color: theme.containerStyle.backgroundColor,
          asGradient: theme.containerStyle.backgroundColorAsGradient,
          gradientType: theme.containerStyle.backgroundGradientType,
          gradientColors: theme.containerStyle.backgroundGradientColors,
          gradientStrategy: theme.containerStyle.backgroundGradientStrategy,
        },
      })
    }
    self.collab.invoke({
      type: 'onLineColorChanged',
      data: { color: theme.defaultLineColor },
    })

    function applyStyle(id) {
      const allKeys = Object.keys(theme.styles)
      const lastStyle = theme.styles[allKeys[allKeys.length - 1]]
      const base = theme.styles[nodeStyle[id]] || lastStyle

      // borders
      self.collab.invoke({
        type: 'onNodeBorderPropertiesChanged',
        data: { id: id, prop: 'borderWidth', val: base.borderWidth },
      })
      self.collab.invoke({
        type: 'onNodeBorderPropertiesChanged',
        data: { id: id, prop: 'borderColor', val: base.borderColor },
      })
      self.collab.invoke({
        type: 'onNodeBorderPropertiesChanged',
        data: { id: id, prop: 'borderOpacity', val: base.borderOpacity },
      })
      self.collab.invoke({
        type: 'onNodeBorderPropertiesChanged',
        data: { id: id, prop: 'borderStyle', val: base.borderStyle },
      })

      // shape
      if (base.vectorPath && syncWithTheme) {
        // const node = self.nodes.one(id);
        // const sendPath = Utils._transformPath(base.vectorPath, `T${node.options.xPos},${node.options.xPos}`);
        self.collab.invoke({
          type: 'onNodeShapeChanged',
          data: { id: id, shape: base.vectorPath },
        })
      }

      // text
      self.collab.invoke({
        type: 'onNodeTextChanged',
        data: {
          id: id,
          fontSize: base.fontSize,
          fontFamily: base.fontFamily,
          fontColor: base.foregroundColor,
          textOpacity: base.textOpacity,
        },
      })

      // effects
      self.collab.invoke({
        type: 'onNodeEffectChanged',
        data: { id: id, filter: { apply: 'text', id: base.filters.text } },
      })

      // background color
      self.collab.invoke({
        type: 'onNodeColorChanged',
        data: { id: id, opacity: base.opacity, color: base.backgroundColor },
      })

      // effects
      self.collab.invoke({
        type: 'onNodeEffectChanged',
        data: { id: id, filter: { apply: 'vect', id: base.filters.vect } },
      })

      // lines
      const node = self.nodes.one(id)

      // console.log("node is ", id, node);
      node.relationships.associations.forEach((a, ind) => {
        self.collab.invoke({
          type: 'onLineColorChanged',
          data: { id: id, color: base.lineColor },
        })
        self.collab.invoke({
          type: 'onLinePropertiesChanged',
          data: {
            id: id,
            prop: 'lineOpacity',
            val: base.lineOpacity,
            associationId: a.id,
            index: ind,
          },
        })
        self.collab.invoke({
          type: 'onLinePropertiesChanged',
          data: {
            id: id,
            prop: 'lineEffect',
            val: base.lineEffect,
            associationId: a.id,
            index: ind,
          },
        })
        self.collab.invoke({
          type: 'onLinePropertiesChanged',
          data: {
            id: id,
            prop: 'lineWidth',
            val: base.lineWidth,
            associationId: a.id,
            index: ind,
          },
        })
      })
    }

    self.nodes.allNodes.forEach((node) => {
      if (self.options.mindMapMode || syncWithTheme) {
        const children = self.findChildren([node.options.id])
        totChildren.push(children)
      } else {
        if (!currentNodesByColor[node.options.backgroundColor]) {
          currentNodesByColor[node.options.backgroundColor] = []
        }
        currentNodesByColor[node.options.backgroundColor].push(node.options.id)
      }
    })

    if (self.options.mindMapMode || syncWithTheme) {
      totChildren.sort((a, b) => a.length - b.length)
      totChildren.forEach((t) => {
        t.forEach((n, ind) => {
          nodeStyle[n] = ind === 0 ? `parent` : `child_${ind}`
        })
      })
    } else {
      const colorsByUsage = Object.keys(currentNodesByColor).sort(
        (a, b) => currentNodesByColor[b].length - currentNodesByColor[a].length
      )
      let styleIndex = -1
      colorsByUsage.forEach((c, index) => {
        if (Object.keys(theme.styles).length < index) {
          styleIndex = -1
        }
        styleIndex++
        currentNodesByColor[c].forEach((id, index) => {
          nodeStyle[id] = styleIndex === 0 ? `parent` : `child_${styleIndex}`
        })
      })
    }

    Object.keys(nodeStyle).forEach((id) => {
      applyStyle(id)
    })
  }
}
