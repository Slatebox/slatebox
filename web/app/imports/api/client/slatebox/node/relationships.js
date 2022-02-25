/* eslint-disable no-plusplus */
/* eslint-disable no-param-reassign */
/* eslint-disable no-underscore-dangle */
import kdTree from 'static-kdtree'
import refreshRelationships from '../helpers/refreshRelationships'
import getHorizontalCurve from '../helpers/getHorizontalCurve'
import Utils from '../helpers/Utils'
import sbIcons from '../helpers/sbIcons'
import Node from '../core/Node'

export default class Relationships {
  constructor(slate, node) {
    const self = this
    self.slate = slate
    self.node = node
    self.PATH_COMPLEXITY_LIMIT = 100000
    self.associations = []
    self._isLastAlt = false
    self._isLastShift = false
    self.selectedNodes = []
    self.relationshipsToTranslate = []
    self.relationshipsToRefresh = []
    self._dx = 0
    self._dy = 0
    self.collabSent = null
    self.ft = null
    self.kdTree = null
    self.gracefulClear = null

    self.dragEvents = {
      move(dx, dy) {
        self.enactMove(dx, dy)
      },
      async up() {
        self.finishDrag(true)
      },
      dragger(x, y, e) {
        if (!self.slate.canvas.isDragging) {
          self.node.toggleImage({ active: true })
          // self.slate.canvas._bg?.hide();
          if (self.node.events?.onClick) {
            self.node.events.onClick.apply(self, [
              () => {
                self._initDrag(self, e)
              },
            ])
          } else {
            self._initDrag(self, e)
          }
        }
      },
    }
  }

  showMenu(e) {
    const self = this
    self.slate.nodes.closeAllMenus({ exception: self.node.options.id })
    self.slate.enable()
    if (
      self.node?.menu?.show &&
      self.node.options.allowMenu &&
      !self.node.menu.isOpen()
    ) {
      if (self.node?.options.groupId) {
        self.slate.multiSelection.showGroup(self.node?.options.groupId)
      }
      self.node.menu.show()
    }
    Utils.stopEvent(e)
  }

  finishDrag(blnBroadcast) {
    const self = this
    self.selectedNodes.forEach((node) => {
      // the transformPath here converts the transient transforms that happened during the movement
      // to become permanent on the "attr" properties.
      Utils.transformPath(node, `T${self._dx},${self._dy}`)
      node.vect.currentDx = 0
      node.vect.currentDy = 0
      node.editor.setTextOffset()
    })

    refreshRelationships({
      relationships: self.relationshipsToRefresh,
      nodes: self.selectedNodes,
      dx: 0,
      dy: 0,
    })
    self.slate.nodes.saveRelationships(self.relationshipsToTranslate, {
      dx: self._dx,
      dy: self._dy,
    })

    if (blnBroadcast) {
      self.send({
        nodes: self.selectedNodes,
        relationships: self.relationshipsToRefresh.concat(
          self.relationshipsToTranslate
        ),
      })
      self.selectedNodes.forEach((n) => {
        n.relationships.showAll(true)
      })

      if (self.foreignPoints?.length > 0) {
        self.kdTree.dispose()
        delete self.foreignPoints
        clearTimeout(self.gracefulClear)
        self.gracefulClear = setTimeout(() => {
          self.node.gridLines.clear()
        }, 200)
      }
    }

    // console.log("here we go", self.selectedNodes);
    // self.slate.canvas._bg?.show();
    self.slate.toggleFilters(false)
    self.showMenu()
  }

  enactMove(dx, dy, blnFinish) {
    const self = this

    dx = Math.ceil(dx)
    dy = Math.ceil(dy)

    const z = self.slate.options.viewPort.zoom.r
    dx += dx / z - dx
    dy += dy / z - dy

    self.selectedNodes.forEach((node, i) => {
      node.vect.currentDx = dx
      node.vect.currentDy = dy
      node.translateWith({ dx, dy })

      // only snap and show guidelines for primary moving node, none of its children
      if (i === 0 && node.options.id !== self.slate.tempNodeId) {
        // const nbb = node.vect.getBBox();
        const nearest = self.kdTree.knn(
          [node.options.xPos, node.options.yPos],
          2
        )

        nearest.forEach((n) => {
          ;({ dx, dy } = self.node.gridLines.draw(
            self.foreignPoints[n].id,
            dx,
            dy,
            self.foreignPoints[n].bbox
          ))
        })
      }
    })

    self.slate.nodes.translateRelationships(self.relationshipsToTranslate, {
      dx,
      dy,
    })
    refreshRelationships({
      relationships: self.relationshipsToRefresh,
      nodes: self.selectedNodes,
      dx,
      dy,
    })

    self._dx = dx
    self._dy = dy

    if (blnFinish) {
      self.finishDrag(false)
    }
  }

  _broadcast(pkg) {
    this.slate.collab?.send(pkg)
  }

  _hitTest(mp) {
    const self = this
    let overNode = null
    const off = Utils.positionedOffset(self.slate.options.container)
    self.slate.nodes.allNodes.forEach((node) => {
      if (
        node.options.id !== self.slate.tempNodeId &&
        node.options.id !== self.node.options.id &&
        node.options.allowContext &&
        node.options.allowResize
      ) {
        const _bb = node.vect.getBBox()

        const _zr = self.slate.options.viewPort.zoom.r
        const xp = self.slate.options.viewPort.left + mp.x - off.left
        const yp = self.slate.options.viewPort.top + mp.y - off.top

        const c = {
          x: xp + (xp / _zr - xp),
          y: yp + (yp / _zr - yp),
        }

        if (
          c.x > _bb.x &&
          c.x < _bb.x + _bb.width &&
          c.y > _bb.y &&
          c.y < _bb.y + _bb.height
        ) {
          overNode = node
        }
      }
    })
    return overNode
  }

  _remove(associations, type, obj) {
    const _na = []
    const self = this
    associations.forEach((association) => {
      if (association[type].options.id === obj.options.id) {
        self.removeRelationship(association)
      } else {
        _na.push(association)
      }
    })
    return _na
  }

  _initDrag(vect, e) {
    const self = this
    self.selectedNodes = []
    self.relationshipsToRefresh = []
    self.relationshipsToTranslate = []
    self.collabSent = false
    self._dx = 0
    self._dy = 0
    if (self.slate.multiSelection) self.slate.multiSelection.end()
    if (self.slate.options.linking) {
      self.slate.options.linking.onNode.apply(vect, [self])
    } else if (self.node.options.allowDrag && !self.node.options.disableDrag) {
      self.selectedNodes = self.getSelectedNodes()
      const _associations = self.slate.nodes.getRelevantAssociationsWith(
        self.selectedNodes
      )
      self.relationshipsToTranslate = _associations.relationshipsToTranslate
      self.relationshipsToRefresh = _associations.relationshipsToRefresh
      self.selectedNodes.forEach((n) => {
        n.setStartDrag()
        n.vect.ox = n.options.xPos
        n.vect.oy = n.options.yPos
      })
      const selectedIds = self.selectedNodes.map((n) => n.options.id)
      self.foreignPoints = self.slate.nodes.allNodes
        .filter((n) => selectedIds.indexOf(n.options.id) === -1)
        .map((n) => ({
          id: n.options.id,
          bbox: n.vect.getBBox(),
          point: [n.options.xPos, n.options.yPos],
        }))
      self.kdTree = kdTree(self.foreignPoints.map((fp) => fp.point))
      self.conditionallyHideAll()
    } else {
      Utils.stopEvent(e)
    }
  }

  async initiateTempNode(e, _parent, _assocPkg) {
    const self = this
    const mp = Utils.mousePos(e)
    const _slate = _parent.slate

    const off = Utils.positionedOffset(_slate.options.container)

    const _zr = self.slate.options.viewPort.zoom.r
    const xp = _slate.options.viewPort.left + mp.x - off.left
    const yp = _slate.options.viewPort.top + mp.y - off.top

    const _xPos = xp + (xp / _zr - xp)
    const _yPos = yp + (yp / _zr - yp)

    // const _transforms = [`T${_xPos - 15}, ${_yPos - 15}`];
    const _path = Utils.lowLevelTransformPath(
      sbIcons.icons.handle,
      `T${_xPos - 15}, ${_yPos - 15}`
    )
    // _path = _optimizedContext.path;

    const _tempNode = new Node({
      id: self.slate.tempNodeId,
      xPos: _xPos,
      yPos: _yPos,
      lineColor: '#990000',
      backgroundColor: '#ffffff',
      vectorPath: _path,
      width: 30,
      height: 30,
    })

    // var _pkg = { showParentArrow: self.node.options.showParentArrow, showChildArrow: self.node.options.showChildArrow }
    _slate.nodes.add(_tempNode, true)
    const _tempRelationship = _parent.relationships.addAssociation(
      _tempNode,
      _assocPkg,
      true
    ) // _tempNode.relationships.addParent(_parent, {}, true);

    _tempRelationship.hoveredOver = null
    _tempRelationship.lastHoveredOver = null

    // initiates the drag
    _tempNode.vect.start(e) // , off.x, off.y);
    _slate.options.allowDrag = false

    _tempNode.vect.mousemove((e) => {
      // is there a current hit?
      if (_tempRelationship.hoveredOver === null) {
        // (e.clientX + e.clientY) % 2 === 0 &&
        _tempRelationship.hoveredOver = self._hitTest(Utils.mousePos(e))
        if (_tempRelationship.hoveredOver !== null) {
          // yes, currently over a node -- scale it
          _tempRelationship.hoveredOver.vect.animate(
            { 'stroke-width': 5 },
            500,
            () => {
              _tempRelationship.hoveredOver.vect.animate(
                { 'stroke-width': self.node.options.borderWidth },
                500,
                () => {
                  _tempRelationship.hoveredOver = null
                }
              )
            }
          )
        }
      }
    })

    _tempNode.vect.mouseup((e) => {
      _parent.relationships.removeAssociation(_tempNode)
      _tempNode.slate.nodes.remove(_tempNode)

      const overNode = self._hitTest(Utils.mousePos(e))
      if (overNode !== null) {
        // check if overNode has any parents
        const _relevantAssociations =
          overNode.relationships.associations.filter(
            (association) =>
              overNode.options.id === association.child.options.id
          )
        overNode.options.parents = _relevantAssociations.map(
          (a) => a.parent.options.id
        )
        // check if the two nodes are already associated -- multiple associations between two nodes are currently not supported
        const relevantAssociation = _parent.relationships.associations.find(
          (association) =>
            (association.child.options.id === overNode.options.id &&
              association.parent.options.id === _parent.options.id) ||
            (association.parent.options.id === overNode.options.id &&
              association.child.options.id === _parent.options.id)
        )
        if (!relevantAssociation) {
          _parent.relationships.addAssociation(overNode, _assocPkg)
          const _pkgx = {
            type: 'addRelationship',
            data: {
              type: 'association',
              parent: _parent.options.id,
              child: overNode.options.id,
            },
          }
          if (self.slate.birdsEye)
            self.slate.birdsEye.relationshipsChanged(_pkgx)
          self._broadcast(_pkgx)
        }
      }

      if (self.slate.options.enabled) _parent.slate.options.allowDrag = true
    })
  }

  _visibility(action) {
    if (this.node.options.id !== this.slate.tempNodeId) {
      for (let i = this.associations.length; i--; ) {
        this.associations[i].line[action]()
      }
    }
  }

  removeAll() {
    const self = this
    self.associations.forEach((association) => {
      association.child.relationships.removeAssociation(self.node) // .parent);
      association.parent.relationships.removeAssociation(self.node)
      self.removeRelationship(association)
    })
    self.associations = []
  }

  removeAssociation(_node) {
    this.associations = this._remove(this.associations, 'child', _node)
    this.associations = this._remove(this.associations, 'parent', _node)
    return this
  }

  setKeys({ isShift, isAlt }) {
    this._isLastShift = isShift
    this._isLastAlt = isAlt
  }

  addAssociation(_node, assocPkg) {
    assocPkg = assocPkg || {}

    // make sure this doesn't already exist
    let _connection = this.associations.find(
      (a) => a.child.options.id === _node.options.id
    )

    if (!_connection) {
      const _copts = {
        id: Utils.guid(),
        parent: this.node,
        child: _node,
        lineColor: assocPkg.lineColor || this.node.options.lineColor,
        lineWidth: assocPkg.lineWidth || this.node.options.lineWidth,
        lineOpacity: assocPkg.lineOpacity || this.node.options.lineOpacity,
        lineEffect: assocPkg.lineEffect || this.node.options.lineEffect,
        blnStraight: assocPkg.isStraightLine || false,
        showParentArrow:
          assocPkg.showParentArrow ||
          this.node.options.parentArrowForChildren.includes(_node.options.id),
        showChildArrow:
          assocPkg.showChildArrow ||
          !this.node.options.noChildArrowForChildren.includes(_node.options.id),
      }

      _connection = this.createNewRelationship(_copts)
      _connection.line.toBack()

      this.associations.push(_connection)
      _node.relationships.associations.push(_connection)

      this.wireLineEvents(_connection)
    }

    _node.slate.allLines.push(_connection) // helper for managing raw line attrs

    return _connection
  }

  createNewRelationship(opts) {
    const { paper } = this.slate

    const association = {
      parent: null,
      child: null,
      lineColor: '#fff',
      lineOpacity: 1,
      lineEffect: '',
      lineWidth: 20,
      blnStraight: false,
      showParentArrow: false,
      showChildArrow: true,
    }
    Object.assign(association, opts)

    const _attr = {
      stroke: association.lineColor,
      class: 'association',
      fill: 'none',
      'stroke-width': association.lineWidth,
      'fill-opacity': association.lineOpacity,
      filter: association.lineEffect ? `url(#${association.lineEffect})` : '',
      opacity: association.lineOpacity,
    }

    // these two generic points will be adjusted after the line is created
    const origPoint = { x: 1, y: 1 }
    const endPoint = { x: 200, y: 200 }
    if (!association.line) {
      Object.assign(association, {
        line: paper.path(getHorizontalCurve(origPoint, endPoint)).attr(_attr),
      })
    }
    if (association.child && association.parent) {
      refreshRelationships({
        relationships: [association],
        nodes: [association.parent],
      })
    }

    return association
  }

  removeRelationship(association) {
    const self = this
    self.node.slate?.allLines.splice(
      self.slate?.allLines.findIndex((l) => l.id === association.id)
    )
    association.line.remove()
  }

  wireLineEvents(c) {
    const self = this
    if (self.node.options.allowMenu) {
      c.line.node.style.cursor = 'pointer'
      c.line.mousedown((e) => {
        Utils.stopEvent(e)
        self.node.lineOptions.show(e, c)
      })
      self.slate?.grid.toBack()
      self.slate?.canvas.bgToBack()
    }
  }

  getSelectedNodes() {
    const self = this
    self.selectedNodes = []
    if (self.node.options.isLocked === false) {
      self.selectedNodes.push(self.node)
      this.syncAssociations(self.node, (c, a) => {
        if (
          !self.selectedNodes.some((n) => n.options.id === c.options.id) &&
          c.options.isLocked === false
        ) {
          self.selectedNodes.push(c)
        }
      })
    }
    return self.selectedNodes
  }

  syncAssociations(node, cb) {
    const self = this
    if (!self.slate.isCtrl || (self.slate.isCtrl && self.slate.isShift)) {
      node.relationships.associations.forEach((a) => {
        if (
          a.child.options.id !== self.node.options.id &&
          a.child.options.id !== node.options.id
        ) {
          cb && cb(a.child, a)
          if (self.slate.isCtrl && self.slate.isShift) {
            self.syncAssociations(a.child, cb)
          }
        }
      })
    }
  }

  updateAssociationsWith(opts) {
    const conditionalSet = {}
    if (opts.conditional) {
      opts.conditional.forEach((setContext, i) => {
        conditionalSet[i] = setContext
      })
      delete opts.conditional
    }
    this.associations.forEach((a) => {
      Object.assign(a, opts)
      Object.keys(conditionalSet).forEach((sc) => {
        const setContext = conditionalSet[sc]
        if (setContext.condition(a, setContext.data)) {
          a[setContext.key] = setContext.getValue(a, setContext.data)
        }
      })
    })
  }

  updateSingleAssociationWith(key, opts) {
    const association = this.associations.find(a, key)
    if (association) Object.assign(association, opts)
  }

  send(opts) {
    const self = this
    if (
      self.node.context &&
      !self.node.context.isVisible() &&
      self.node.options.allowDrag &&
      !self.node.options.disableDrag
    ) {
      const pkg = {
        type: 'onNodesMove',
      }

      if (opts.nodes && opts.relationships) {
        pkg.data = self.slate.nodes.nodeMovePackage({
          nodes: opts.nodes,
          relationships: opts.relationships,
        })
      } else {
        pkg.data = self.slate.nodes.nodeMovePackage()
      }
      if (self.slate.collab) self.slate.collab.send(pkg)
      if (self.slate.birdsEye) self.slate.birdsEye.nodeChanged(pkg)
      self.collabSent = true
    }
  }

  conditionallyHideAll() {
    const self = this
    if (self.node.options.id !== self.slate.tempNodeId) {
      const exceeds =
        self.node.options.vectorPath.length > self.PATH_COMPLEXITY_LIMIT
      if (exceeds) {
        self.hideAll(true)
      }
      self.associations.forEach((a) => {
        const cexceed =
          exceeds ||
          a.child.options.vectorPath.length > self.PATH_COMPLEXITY_LIMIT
        a.child.relationships.hideAll(cexceed)
        // a.parent.relationships.hideAll(_pexceed);
      })
    }
  }

  hideAll(_blnOverride) {
    if ((this.slate.isAlt && this.slate.isShift) || _blnOverride)
      this._visibility('hide')
  }

  hideOwn() {
    this.associations.forEach((association) => {
      association.line.hide()
    })
  }

  showOwn() {
    this.associations.forEach((association) => {
      association.line.show()
    })
  }

  showAll(_blnOverride) {
    if ((this._isLastAlt && this._isLastShift) || _blnOverride)
      this._visibility('show')
  }

  refreshOwnRelationships() {
    refreshRelationships({
      relationships: this.associations,
      nodes: [this.node],
    })
  }

  wireDragEvents() {
    const self = this
    if (
      !self.slate.isReadOnly() &&
      (!self.slate.isCommentOnly() ||
        (self.slate.isCommentOnly() && self.node.options.isComment))
    ) {
      self.node.vect.drag(
        self.dragEvents.move,
        self.dragEvents.dragger,
        self.dragEvents.up
      )
      self.node.text.mousedown((e) => {
        self.node.vect.start(e)
      })
      self.node.vect.dblclick(() => {
        self.slate.events?.onTextPaneRequested?.apply(this, [self.node])
      })
      self.node.text.dblclick(() => {
        self.slate.events?.onTextPaneRequested?.apply(this, [self.node])
      })
    }
  }
}
