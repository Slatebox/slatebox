import uniq from 'lodash.uniq'
import utils from '../helpers/Utils'
import sbIcons from '../helpers/sbIcons'
import { Raphael } from '../deps/raphael/raphael.svg'
import { shapes } from '../deps/raphael/raphael.fn.shapes'
import { extensions } from '../deps/raphael/raphael.el.extensions'
import embedGoogleFonts from '../helpers/embedGoogleFonts'

export default class Canvas {
  constructor(slate) {
    const self = this
    self.slate = slate
    let c = slate.options.container
    if (typeof c === 'string') c = utils.el(c)
    if (c === undefined || c === null) {
      throw new Error('You must provide a container to initiate the canvas!')
    }

    // modifies global Raphael for all other imports
    shapes(Raphael)
    extensions(Raphael)

    self.isDragging = false
    self.slate.paper = null
    self.internal = null
    self.status = null
    self.imageFolder = null
    self.dken = null
    self.eve = {
      init: ['onmousedown', 'ontouchstart'],
      drag: ['onmousemove', 'ontouchmove'],
      up: ['onmouseup', 'ontouchend', 'onmouseout'],
      gest: ['ongesturestart', 'ongesturechange', 'ongestureend'],
    }
  }

  init() {
    const self = this
    const imageFolder = self.slate.options.imageFolder || '/images/'
    const c = self.slate.options.container
    const { slate } = self

    self.Canvas = {
      objInitPos: {},
      objInitialMousePos: { x: 0, y: 0 },
      initDrag(e) {
        if (slate.isCtrl) {
          if (slate.multiSelection) slate.multiSelection.start()
        }
        if (slate.options.allowDrag) {
          self.isDragging = true

          if (slate.multiSelection) slate.multiSelection.end()
          if (slate.nodes) slate.nodes.closeAllMenus()

          const m = utils.mousePos(e)
          self.Canvas.objInitPos = utils.positionedOffset(self.internal)
          const offsets = utils.positionedOffset(slate.options.container)
          self.Canvas.objInitialMousePos = {
            x: m.x + offsets.left,
            y: m.y + offsets.top,
          }
          const xy = self.cp(e)

          if (self.status)
            self.status.innerHTML = `${Math.abs(xy.x)}, ${Math.abs(xy.y)}`

          if (slate.options.showStatus) {
            if (self.status) self.status.style.display = 'block'
            if (slate.multiSelection) slate.multiSelection.hide()
          }

          self.internal.style.cursor = `url(${imageFolder}closedhand.cur), default`

          if (m.allTouches) {
            slate.options.lastTouches = m.allTouches
          }

          if (slate.removeContextMenus) slate.removeContextMenus()

          slate.draggingZoom = self.slate.options.viewPort.zoom

          // hide filters during dragging
          slate.toggleFilters(true)

          utils.stopEvent(e)
        } else if (slate.onSelectionStart) {
          slate.onSelectionStart.apply(self, [e])
        } else {
          utils.stopEvent(e)
        }
      },
      setCursor() {
        if (self.isDragging)
          self.internal.style.cursor = `url(${imageFolder}closedhand.cur), default`
        else
          self.internal.style.cursor = `url(${imageFolder}openhand.cur), default`
      },
      onDrag(e) {
        requestAnimationFrame(() => {
          // broadcast custom collab
          const mp = utils.mousePos(e)
          // const offsets = utils.positionedOffset(slate.options.container);
          if (slate.collab)
            slate.collab.send({ type: 'onMouseMoved', data: mp })

          if (self.isDragging && slate.options.allowDrag) {
            // slate.birdsEye && slate.birdsEye.refresh(true);
            const xy = self.cp(e)
            if (xy.allTouches && xy.allTouches.length > 1) {
              slate.options.lastTouches = xy.allTouches
            }

            // if (xy.x > slate.options.viewPort.width - 1000 || xy.y > slate.options.viewPort.height - 1000) {
            //   utils.stopEvent(e);
            // } else {
            if (self.status)
              self.status.innerHTML = `${Math.abs(xy.x)}, ${Math.abs(xy.y)}`
            self.internal.style.left = `${xy.x}px`
            self.internal.style.top = `${xy.y}px`
            // }
          }
        })
      },
      endDrag(e) {
        if (self.isDragging && slate.options.allowDrag) {
          self.isDragging = false
          // const m = utils.mousePos(e);

          self.internal.style.cursor = `url(${imageFolder}openhand.cur), default`
          if (self.status) self.status.style.display = 'none'
          if (slate.multiSelection) slate.multiSelection.show()

          const xy = self.cp(e)
          slate.draggingZoom = null
          self.endDrag(xy)

          // show filters after dragging
          slate.toggleFilters(false)
        }
      },
    }

    // wipe it clean
    if (!slate.options.preserve) c.innerHTML = ''

    if (self.slate.paper) {
      self.slate.paper.clear()
    }

    if (self.internal) {
      c.removeChild(self.internal)
    }

    // internal
    self.internal = document.createElement('div')
    self.internal.setAttribute(
      'class',
      `slateboxInternal_${self.slate.options.id}`
    )
    // console.log("setting slate canvas", `slateboxInternal_${self.slate.options.id}`);
    const ws = slate.options.viewPort.width
    const hs = slate.options.viewPort.height
    const ls = slate.options.viewPort.left
    const ts = slate.options.viewPort.top
    self.internal.style.width = `${ws + 100000}px`
    self.internal.style.height = `${hs + 100000}px`
    self.internal.style.left = `${ls * -1}px`
    self.internal.style.top = `${ts * -1}px`
    self.internal.style.position = 'absolute'
    self.internal.style['-webkit-transform'] = `translateZ(0)`
    self.internal.style.transform = `translateZ(0)` // `translate3d(0,0,0)`; //helps with GPU based rendering
    c.appendChild(self.internal)

    self.internal.addEventListener('mousedown', () => {
      if (
        self.slate &&
        self.slate.events &&
        self.slate.events.onCanvasClicked
      ) {
        self.slate.events.onCanvasClicked()
      }
    })

    // status
    if (self.slate.options.showStatus) {
      self.status = document.createElement('div')
      self.status.style.position = 'absolute'
      self.status.style.height = '20px'
      self.status.style.left = '5px'
      self.status.style.color = '#000'
      self.status.style.fontSize = '10pt'
      self.status.style.fontFamily = 'trebuchet ms'
      self.status.style.top = '0px'
      self.status.style.display = 'none'
      self.status.style.padding = '5px'
      self.status.style.filter = 'alpha(opacity=80)'
      self.status.style.opacity = '.80'
      self.status.style.backgroundColor = '#ffff99'
      self.status.style.fontWeight = 'bold'
      c.appendChild(self.status)
    }

    // style container
    c.style.position = 'relative'
    c.style.overflow = 'hidden'

    // style internal
    self.internal.style.borderTop = `${slate.borderTop}px`
    self.internal.style.cursor = `url(${imageFolder}openhand.cur), default`

    // self.internal.style.overflow = 'scroll';
    // self.internal.style["-webkit-overflow-scrolling"] = "touch";
    // self.internal.style["touch-action"] = "auto";

    self.slate.paper = Raphael(self.internal, ws, hs)

    self.refreshBackground()

    if (slate.options.allowDrag) {
      self.wire()
    }

    slate.options.viewPort.originalHeight = hs
    slate.options.viewPort.originalWidth = ws

    // set up initial zoom params
    self.resize(ws)

    // show zoom slider
    if (slate.options.showZoom) {
      // slate.zoomSlider.show();
      if (slate.zoomSlider) slate.zoomSlider.show(slate.options.viewPort.width)
      // slate.zoomSlider.show();
      // slate.zoomSlider.setValue();
    }

    // show undo redo
    if (slate.options.showUndoRedo) {
      if (slate.undoRedo) slate.undoRedo.show()
    }

    // show birdsEye -- this is self referential on canvas in loadJSON inside slate.js, so this must be deferred until canvas constructor is done.
    if (slate.options.showbirdsEye) {
      if (slate.birdsEye.enabled()) {
        slate.birdsEye.reload(slate.exportJSON())
      } else {
        slate.birdsEye.show({
          size: slate.options.sizeOfbirdsEye || 200,
        })
      }
    }

    // set up the shareable/branding if need be
    if (
      !slate.options.isbirdsEye &&
      (slate.options.isSharing || slate.options.isEmbedding)
    ) {
      const btnSize = 25
      const scaleSize = btnSize - 3
      const iframe = document.getElementById('snap_slate')

      const parent = document.createElement('div')
      parent.className = 'sb_parent_shareable'

      const styles = utils.buildStyle({
        height: iframe ? `${scaleSize + 8}px` : `${scaleSize}px`,
      })
      parent.setAttribute('style', styles)

      if (slate.options.isEmbedding && !slate.options.nobrand) {
        const brand = document.createElement('a')
        brand.className = 'sbbrand'
        brand.setAttribute('href', 'https://slatebox.com')
        brand.innerHTML = 'built with slatebox'
        parent.appendChild(brand)
      }

      if (!slate.options.isbirdsEye && slate.options.isSharing) {
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${btnSize}" height="${btnSize}"><path fill="#333" stroke="#000" d="{path}" stroke-dasharray="none" stroke-width="1" opacity="1" fill-opacity="1"></path></svg>`
        // stick sharing buttons (one-click png export and one-click copy embed)
        ;['download', 'embed'].forEach((e) => {
          const btn = document.createElement('div')
          btn.className = 'sb_share'
          btn.setAttribute('data-action', e)
          const bstyles = utils.buildStyle({
            width: `${btnSize}px`,
            height: `${btnSize}px`,
          })
          btn.setAttribute('style', bstyles)
          const nnew = utils.centerAndScalePathToFitContainer({
            containerSize: btnSize,
            scaleSize,
            path: sbIcons.icons[e],
          })
          btn.innerHTML = svg.replace(/{path}/gi, nnew.path)
          parent.appendChild(btn)

          utils.addEvent(btn, 'click', () => {
            const act = this.getAttribute('data-action')
            switch (act) {
              case 'embed': {
                const et = document.createElement('textarea')
                document.body.appendChild(et)
                let val = ''

                if (iframe) {
                  val = `<iframe id='sb_embed_${slate.options.id}' src='${window.location.href}' width='${iframe.clientWidth}' height='${iframe.clientHeight}' frameborder='0' scrolling='no'></iframe>`
                } else {
                  const ele = slate.options.container.parentElement
                  const raw = ele.innerHTML
                  const split = raw.split('<div class="slateboxInternal"')
                  const orig = `${split[0]}<script>${
                    split[1].split('<script>')[1]
                  }`
                  val = `<div id="sb_embed_${slate.options.id}">${orig}</div>`
                }

                et.value = val
                et.select()
                document.execCommand('copy')
                document.body.removeChild(et)

                const note = document.createElement('div')
                note.innerHTML = 'Copied!'
                note.setAttribute(
                  'style',
                  utils.buildStyle({
                    'font-size': '11pt',
                    'text-align': 'center',
                    padding: '4px',
                    'margin-right': '-1px',
                    width: '125px',
                    height: '22px',
                    position: 'absolute',
                    right: 0,
                    bottom: 0,
                    'background-color': '#333',
                    color: '#fff',
                  })
                )
                parent.appendChild(note)

                window.setTimeout(() => {
                  parent.removeChild(note)
                }, 1500)

                break
              }
              case 'download':
              default: {
                slate.png() // if self is missing images, make sure you're not accidently clicking birdsEye
                break
              }
            }
          })
        })
      }

      if (slate.options.isEmbedding && parent.innerHTML !== '') {
        c.appendChild(parent)
      }
    }

    self.windowSize = utils.windowSize()
    self.containerOffset = utils.positionedOffset(self.slate.options.container)
    utils.addEvent(window, 'resize', () => {
      self.windowSize = utils.windowSize()
      self.containerOffset = utils.positionedOffset(
        self.slate.options.container
      )
      if (self.dken !== null) {
        self.dken.style.width = `${self.ws.width}px`
        self.dken.style.height = `${self.ws.height}px`
      }
    })

    setTimeout(() => {
      self.slate.birdsEye?.setBe()
      self.slate.birdsEye?.refresh()
    }, 500)
    self.completeInit = true
  } // init

  cp(e) {
    const m = utils.mousePos(e)

    let difX =
      this.Canvas.objInitPos.left + (m.x - this.Canvas.objInitialMousePos.x)
    let difY =
      this.Canvas.objInitPos.top + (m.y - this.Canvas.objInitialMousePos.y)

    const { width, height } = this.slate.options.containerStyle
    const vpWidth = this.slate.options.viewPort.width
    const vpHeight = this.slate.options.viewPort.height

    if (difX > 0) difX = 0
    else if (Math.abs(difX) + width > vpWidth) difX = width - vpWidth
    if (difY > 0) difY = 0
    else if (Math.abs(difY) + height > vpHeight) difY = height - vpHeight

    return { x: difX, y: difY }
  }

  endDrag(coords) {
    this.slate.options.viewPort.left = Math.abs(coords.x) // Math.abs((difX * this.slate.options.viewPort.zoom) / this.slate.options.viewPort.width);
    this.slate.options.viewPort.top = Math.abs(coords.y) // Math.abs((difY * this.slate.options.viewPort.zoom) / this.slate.options.viewPort.height);

    this.internal.style.left = `${coords.x}px`
    this.internal.style.top = `${coords.y}px`

    const curPos = utils.positionedOffset(this.internal)
    const moved = {
      x: this.Canvas.objInitPos.left - curPos.left,
      y: this.Canvas.objInitPos.top - curPos.top,
    }

    if (this.slate.birdsEye) this.slate.birdsEye.refresh(true)

    if (this.slate.collaboration.allow) {
      this.broadcast(moved)
    }
  }

  broadcast(moved) {
    if (this.slate.collab) {
      this.slate.collab.send({
        type: 'onCanvasMove',
        data: {
          left: this.slate.options.viewPort.left,
          top: this.slate.options.viewPort.top,
          relative: moved,
          orient: this.slate.getOrientation(),
        },
      })
    }
  }

  zoom(_opts) {
    const self = this
    const opts = {
      dur: 500,
      callbacks: { after: null, during: null },
      easing: 'easeFromTo',
      zoomPercent: 100,
    }

    Object.assign(opts, _opts)

    self.slate.nodes.closeAllConnectors()

    const startZoom = self.slate.options.viewPort.zoom.w
    const targetZoom =
      self.slate.options.viewPort.originalWidth *
      (100 / parseInt(opts.zoomPercent, 10))
    const zoomDif = Math.abs(targetZoom - startZoom)

    opts.dur = !opts.dur && opts.dur !== 0 ? 500 : opts.dur

    emile(self.internal, 'padding:1px', {
      duration: opts.dur,
      before() {
        self.slate.options.allowDrag = false
      },
      after() {
        self.slate.options.allowDrag = true
        self.slate.zoomSlider.set(targetZoom)
        if (self.slate.birdsEye) self.slate.birdsEye.refresh(true)
        if (opts.callbacks.after)
          opts.callbacks.after.apply(self.slate, [targetZoom])
      },
      during(pc) {
        const val =
          targetZoom > startZoom
            ? startZoom + zoomDif * pc
            : startZoom - zoomDif * pc
        self.slate.zoom(0, 0, val, val, false)
        self.slate.canvas.resize(val)
        if (self.slate.birdsEye) self.slate.birdsEye.refresh(true)
        if (opts.callbacks && opts.callbacks.during) opts.callbacks.during(pc)
      },
      easing: utils.easing[opts.easing],
    })
  }

  move(_opts) {
    const self = this
    const opts = {
      x: 0,
      y: 0,
      dur: 500,
      callbacks: { after: null, during: null },
      isAbsolute: true,
      easing: 'easeFromTo',
    }

    Object.assign(opts, _opts)

    let { x, y } = opts
    if (opts.isAbsolute === false) {
      x = self.slate.options.viewPort.left + x
      y = self.slate.options.viewPort.top + y
    }

    self.slate.nodes.closeAllConnectors()
    if (opts.dur > 0) {
      emile(self.internal, `left:${x * -1}px;top:${y * -1}px`, {
        duration: opts.dur,
        before() {
          self.slate.options.allowDrag = false
        },
        after() {
          self.slate.options.allowDrag = true
          self.slate.options.viewPort.left = Math.abs(
            parseInt(self.internal.style.left.replace('px', ''), 10)
          )
          self.slate.options.viewPort.top = Math.abs(
            parseInt(self.internal.style.top.replace('px', ''), 10)
          )
          if (self.slate.birdsEye) self.slate.birdsEye.refresh(true)
          if (opts.callbacks.after) opts.callbacks.after.apply(self.slate)
        },
        during(pc) {
          if (self.slate.birdsEye) self.slate.birdsEye.refresh(true)
          if (opts.callbacks && opts.callbacks.during) opts.callbacks.during(pc)
        },
        easing: utils.easing[opts.easing],
      })
    } else {
      window.requestAnimationFrame(() => {
        self.internal.style.left = `${x * -1}px`
        self.internal.style.top = `${y * -1}px`
        console.trace()
        console.log(
          'set style',
          x,
          y,
          self.internal.style.left,
          self.internal.style.top
        )
        self.slate.options.viewPort.left = Math.abs(x)
        self.slate.options.viewPort.top = Math.abs(y)
        if (opts.callbacks.after) opts.callbacks.after.apply(self.slate)
      })
    }
  }

  resize(val) {
    const uval = parseInt(val, 10)
    const R = this.slate.options.viewPort.width / uval
    const dimen = utils.getDimensions(this.slate.options.container)

    let top = this.slate.options.viewPort.top * -1 * R
    let left = this.slate.options.viewPort.left * -1 * R

    const centerY = ((dimen.height / 2) * R - dimen.height / 2) * -1
    const centerX = ((dimen.width / 2) * R - dimen.width / 2) * -1

    top += centerY
    left += centerX

    const threshold = this.slate.options.viewPort.originalWidth - 1000

    if (-top > threshold || -left > threshold) {
      // already at boundary
      return false
    }
    this.internal.style.top = `${top}px`
    this.internal.style.left = `${left}px`
    this.slate.options.viewPort.zoom = {
      w: val,
      h: val,
      l: parseFloat(left * -1),
      t: parseFloat(top * -1),
      r: this.slate.options.viewPort.originalWidth / val,
    }
    return true
  }

  clear() {
    this.slate.options.container.innerHTML = ''
    return this.slate
  }

  wire() {
    const self = this
    self.eve.init.forEach((ee) => {
      self.internal[ee] = self.Canvas.initDrag
    })
    self.eve.drag.forEach((ee) => {
      self.internal[ee] = self.Canvas.onDrag
    })
    self.eve.up.forEach((ee) => {
      self.internal[ee] = self.Canvas.endDrag
    })
  }

  unwire() {
    const self = this
    self.eve.init.forEach((ee) => {
      self.internal[ee] = null
    })
    self.eve.drag.forEach((ee) => {
      self.internal[ee] = null
    })
    self.eve.up.forEach((ee) => {
      self.internal[ee] = null
    })
  }

  rawSVG(cb) {
    const self = this

    function finalize(svg) {
      if (self.slate.events.onOptimizeSVG) {
        self.slate.events.onOptimizeSVG(svg, (err, optimized) => {
          if (err) {
            console.error('Unable to optimize slate svg export', err)
          } else {
            cb(optimized)
          }
        })
      } else {
        cb(svg)
      }
    }

    function extractImages(svg) {
      let usvg = svg
      const images = uniq(
        self.slate.nodes.allNodes.map((n) => n.options.image).filter((f) => !!f)
      )
      if (images.length > 0) {
        images.forEach((i, ind) => {
          if (self.slate.events.onBase64ImageRequested) {
            // server side gen
            let imageType = 'png'
            if (i.indexOf('jpg')) {
              imageType = 'jpeg'
            } else if (i.indexOf('gif')) {
              imageType = 'gif'
            }
            self.slate.events.onBase64ImageRequested(
              i,
              imageType,
              (err, res) => {
                if (err) {
                  console.error('Unable to retrieve base64 from image', err)
                } else {
                  const ix = i.replace(/&/gi, '&amp;')
                  while (usvg.indexOf(ix) > -1) {
                    usvg = usvg.replace(ix, res)
                  }
                }
                if (ind + 1 === images.length) {
                  finalize(usvg)
                }
              }
            )
          } else {
            // client side only -- good luck with CORS - this method should be avoided
            utils
              .toDataUrl(i)
              .then((dataUrl) => {
                usvg = usvg.replace(new RegExp(i, 'gi'), dataUrl)
              })
              .catch((err) => {
                console.error('Unable to get image', err)
              })
              .finally(() => {
                if (ind + 1 === images.length) {
                  finalize(usvg)
                }
              })
          }
        })
      } else {
        finalize(usvg)
      }
    }

    // always embed fonts and fix links -- a style node is always added in the init
    embedGoogleFonts({
      fonts: uniq(self.slate.nodes.allNodes.map((n) => n.options.fontFamily)),
      text: uniq(
        self.slate.nodes.allNodes.flatMap((n) =>
          n.options.text.replace(/ /gi, '').split('')
        )
      )
        .join('')
        .trim(),
      styleNode: self.internal.querySelector('svg > defs > style'),
    }).then(() => {
      // need to swap out xlink:href with href for the blob to work w/ the pixelate (or other) filter
      let svg = self.internal.innerHTML.replace(/xlink:href/gi, 'href')
      const slateBg = self.slate.options.containerStyle.backgroundImage
      if (slateBg) {
        // server side gen
        let bgImageType = 'png'
        if (slateBg.indexOf('jpg')) {
          bgImageType = 'jpeg'
        } else if (slateBg.indexOf('gif')) {
          bgImageType = 'gif'
        }
        self.slate.events.onBase64ImageRequested(
          slateBg,
          bgImageType,
          (err, res) => {
            if (err) {
              console.error('Unable to retrieve base64 from image', err)
            } else {
              svg = svg.replace(slateBg, res)
            }
            extractImages(svg)
          }
        )
      } else {
        extractImages(svg)
      }
    })
  }

  darken(percent) {
    if (this.dken === null) {
      this.dken = document.createElement('div')
      const ws = utils.windowSize()
      this.dken.style.backgroundColor = '#ccc'
      this.dken.style.position = 'absolute'
      this.dken.style.left = '0px'
      this.dken.style.top = '0px'
      this.dken.style.width = `${ws.width}px`
      this.dken.style.height = `${ws.height}px`
      this.dken.style.zIndex = 999
      this.dken.style.filter = `alpha(opacity=${percent})`
      this.dken.style.opacity = percent / 100
      document.body.appendChild(this.dken)
    }
    return this.dken
  }

  lighten() {
    if (this.dken) document.body.removeChild(this.dken)
    this.dken = null
  }

  bgToBack() {
    this.bg?.toBack()
  }

  hideBg(t) {
    const self = this
    const e = self.slate.options.containerStyle.backgroundEffect
    self.bg?.remove()
    delete self.bg
    if (e) {
      if (!self.slate.options.isbirdsEye) {
        clearTimeout(self.showBgTimeout)
        self.showBgTimeout = setTimeout(() => {
          const attrs = { filter: `url(#${e})` }
          if (self.slate.filters.availableFilters[e]?.fill) {
            attrs.fill = `url(#${self.slate.filters.availableFilters[e]?.fill})`
          }
          self.bg = self.slate.paper
            .rect(
              0,
              0,
              self.slate.options.viewPort.width,
              self.slate.options.viewPort.height
            )
            .attr(attrs)
            .toBack()
        }, t || 2500)
      }
    }
    self.refreshBackground()
  }

  refreshBackground() {
    const self = this

    self.internal.style.backgroundColor = ''
    self.internal.parentElement.style.backgroundImage = ''
    self.internal.parentElement.style.backgroundSize = ''
    self.internal.parentElement.style.background = ''
    self.internal.style.backgroundSize = ''
    self.internal.style.backgroundPosition = ''

    if (self.slate.options.containerStyle.backgroundEffect) {
      self.slate.options.containerStyle.backgroundColor =
        self.slate.filters.availableFilters[
          self.slate.options.containerStyle.backgroundEffect
        ].backgroundColor
    }

    if (self.slate.options.containerStyle.backgroundImage) {
      self.slate.options.containerStyle.prevBackgroundColor =
        self.slate.options.containerStyle.backgroundColor
      self.slate.options.containerStyle.backgroundColor = 'transparent'
      self.internal.parentElement.style.backgroundImage = `url('${self.slate.options.containerStyle.backgroundImage}')`
      if (self.slate.options.containerStyle.backgroundSize) {
        self.internal.parentElement.style.backgroundSize =
          self.slate.options.containerStyle.backgroundSize
      }
    }

    // show only on first load
    if (!self.initBg && self.slate.options.containerStyle.backgroundEffect) {
      self.initBg = true
      self.hideBg(1)
    }

    // let e = self.slate.options.containerStyle.backgroundEffect;
    // self.internal.style.filter = "";
    // self.bg?.remove();
    // if (e && !self.slate.options.isbirdsEye && !self.bgIsCleared) {
    //   self.bg = self.slate.paper.rect(0, 0, self.slate.options.viewPort.width, self.slate.options.viewPort.height)
    //       .attr({ filter: `url(#${e})`, fill: `url(#${self.slate.filters.availableFilters[e]?.fill})` }).toBack();
    //   if (self.slate.filters.availableFilters[e]?.backgroundColor) {
    //     self.slate.options.containerStyle.backgroundColor = self.slate.filters.availableFilters[e].backgroundColor;
    //   }
    // }
    switch (self.slate.options.containerStyle.backgroundColor) {
      case 'transparent': {
        if (!self.slate.options.isbirdsEye) {
          if (self.slate.options.isEmbedding) {
            self.internal.style.backgroundColor = ''
          } else if (!self.slate.options.containerStyle.backgroundImage) {
            self.internal.style.backgroundImage =
              'linear-gradient(45deg,rgba(13,26,43,0.1) 25%,transparent 25%,transparent 75%,rgba(13,26,43,0.1) 75%),linear-gradient(45deg,rgba(13,26,43,0.1) 25%,transparent 25%,transparent 75%,rgba(13,26,43,0.1) 75%)'
            self.internal.style.backgroundSize = '12px 12px'
            self.internal.style.backgroundPosition = '0 0,6px 6px'
          }
        }
        break
      }
      default: {
        if (self.slate.options.containerStyle.backgroundColorAsGradient) {
          self.internal.style.backgroundColor = ''
          const bgStyle = `${
            self.slate.options.containerStyle.backgroundGradientType
          }-gradient(${self.slate.options.containerStyle.backgroundGradientColors.join(
            ','
          )})`
          self.internal.parentElement.style.background = bgStyle
        } else {
          self.internal.style.backgroundColor =
            self.slate.options.containerStyle.backgroundColor || '#fff'
        }
        break
      }
    }
    self.slate.grid?.setGrid()
  }

  get() {
    return this.internal
  }

  draggable() {
    return this.internal
  }
}
