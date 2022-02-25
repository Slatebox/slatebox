import refreshRelationships from "../helpers/refreshRelationships";
import getHorizontalCurve from "../helpers/getHorizontalCurve";
import utils from '../helpers/utils.js';
import sbIcons from '../helpers/sbIcons.js';
import node from '../core/node.js';
import kdTree from 'static-kdtree';

export default class relationships {

  constructor(slate, node) {
    const self = this;
    self.slate = slate;
    self.node = node;
    self.PATH_COMPLEXITY_LIMIT = 100000;
    self.associations = [];
    self._isLastAlt = false;
    self._isLastShift = false;
    self.selectedNodes = [];
    self.relationshipsToTranslate = [];
    self.relationshipsToRefresh = [];
    self._dx = 0;
    self._dy = 0;
    self.collabSent = null;
    self.ft = null;
    self.kdTree = null;
    self.gracefulClear = null;

    self.dragEvents = {
      move: function (dx, dy) {
        self.enactMove(dx, dy);
      },
      up: async function () {
        self.finishDrag(true);
      },
      dragger: function (x, y, e) {
        if (!self.slate.canvas.isDragging) {
          self.node.toggleImage({ active: true });
          //self.slate.canvas._bg?.hide();
          if (self.node.events?.onClick) {
            self.node.events.onClick.apply(self, [function () {
              self._initDrag(self, e);
            }]);
          } else {
            self._initDrag(self, e);
          }
        }
      }
    }
    
    // self.hoverEvents = {
    //   over: function (e) {
    //     // if (!self.slate.canvas.isDragging) {
    //     //   showMenu(e);
    //     // }
    //   },
    //   out: function (e) {
    //     if (self.slate?.options && !self.slate.canvas.isDragging) {
    //       self.slate.options.allowDrag = true;
    //       self.slate.unglow();
    //       // self.slate.keyboard?.end();
    //     }
    //     utils.stopEvent(e);
    //   },
    //   down: function (e) {
    //     self.slate.toggleFilters(true);
    //     console.log('down show menu');
    //     //self.showMenu(e);
    //     //utils.stopEvent(e);
    //   }
    // }

    // self.hoverObjects = [];
    // self.hoverObjects.push({ o: self.node.vect, over: self.hoverEvents.over, out: self.hoverEvents.out, down: self.hoverEvents.down }); //, move: _move
    // self.hoverObjects.push({ o: self.node.text, over: self.hoverEvents.over, out: self.hoverEvents.out, down: self.hoverEvents.down });
  }
  
  showMenu(e) {
    const self = this;
    // self.slate.keyboard && self.slate.keyboard.start(self.node);
    self.slate.nodes.closeAllMenus({ exception: self.node.options.id });
    self.slate.enable();
    //if (!self.slate.isBeingResized) {
      if (self.node?.menu?.show && self.node.options.allowMenu && !self.node.menu.isOpen()) {
        if (self.node?.options.groupId) {
          self.slate.multiSelection.showGroup(self.node?.options.groupId);
        }
        self.node.menu.show();
      }
    //}
    utils.stopEvent(e);
  }

  finishDrag(blnBroadcast) {
    const self = this;
    self.selectedNodes.forEach(node => {
      //the transformPath here converts the transient transforms that happened during the movement
      //to become permanent on the "attr" properties.
      utils.transformPath(node, `T${self._dx},${self._dy}`);
      node.vect.currentDx = 0;
      node.vect.currentDy = 0;
      node.editor.setTextOffset();
    });

    // await Promise.all(self.selectedNodes.map(async node => {
    //   await utils.transformPath(node, `T${self._dx},${self._dy}`);
    //   node.vect.currentDx = 0;
    //   node.vect.currentDy = 0;
    // }));

    refreshRelationships({ relationships: self.relationshipsToRefresh, nodes: self.selectedNodes, dx: 0, dy: 0 });
    self.slate.nodes.saveRelationships(self.relationshipsToTranslate, { dx: self._dx, dy: self._dy });

    if (blnBroadcast) {
      self.send({ nodes: self.selectedNodes, relationships: self.relationshipsToRefresh.concat(self.relationshipsToTranslate) });
      self.selectedNodes.forEach((n) => {
        n.relationships.showAll(true);
      });

      if (self.foreignPoints?.length > 0) {
        self.kdTree.dispose();
        delete self.foreignPoints;
        clearTimeout(self.gracefulClear);
        self.gracefulClear = setTimeout(() => {
          self.node.gridLines.clear();
        }, 200);
        
      }
    }

    //console.log("here we go", self.selectedNodes);
    //self.slate.canvas._bg?.show();
    self.slate.toggleFilters(false);
    self.showMenu();
  }

  enactMove(dx, dy, blnFinish) {
    const self = this;

    dx = Math.ceil(dx);
    dy = Math.ceil(dy);

    //adjust the dx and dy if snapping to grid
    // if (slate.options.viewPort.showGrid && slate.options.viewPort.snapToGrid) {
    //   let gridSize = slate.options.viewPort.gridSize || 10;
    //   dx = Math.round(dx / gridSize) * gridSize;
    //   dy = Math.round(dy / gridSize) * gridSize;
    // }

    let z = self.slate.options.viewPort.zoom.r;
    dx = dx + ((dx / z) - dx);
    dy = dy + ((dy / z) - dy);

    self.selectedNodes.forEach(function (node, i) {
      node.vect.currentDx = dx;
      node.vect.currentDy = dy;
      node.translateWith({ dx, dy });

      //console.log("yPos ", i, node.options.yPos);

      //only snap and show guidelines for primary moving node, none of its children
      if (i === 0 && node.options.id !== self.slate.tempNodeId) {
        //const nbb = node.vect.getBBox();
        const nearest = self.kdTree.knn([node.options.xPos, node.options.yPos], 2); //, 1);

        nearest.forEach(n => {
          ({ dx, dy } = self.node.gridLines.draw(self.foreignPoints[n].id, dx, dy, self.foreignPoints[n].bbox));
        });
      }
    });
    
    self.slate.nodes.translateRelationships(self.relationshipsToTranslate, { dx, dy });
    refreshRelationships({ relationships: self.relationshipsToRefresh, nodes: self.selectedNodes, dx, dy });

    self._dx = dx;
    self._dy = dy;

    if (blnFinish) {
      self.finishDrag(false);
    }
  }

  _broadcast(pkg) {
    this.slate.collab?.send(pkg);
  }

  _hitTest(mp) {
    const self = this;
    var overNode = null;
    var off = utils.positionedOffset(self.slate.options.container);
    self.slate.nodes.allNodes.forEach(function (node) {
      if (node.options.id !== self.slate.tempNodeId && node.options.id !== self.node.options.id && node.options.allowContext && node.options.allowResize) {
        var _bb = node.vect.getBBox();

        var _zr = self.slate.options.viewPort.zoom.r;
        var xp = (self.slate.options.viewPort.left + mp.x - off.left);
        var yp = (self.slate.options.viewPort.top + mp.y - off.top);

        var c = {
          x: xp + ((xp / _zr) - xp)
          , y: yp + ((yp / _zr) - yp)
        }

        if (c.x > _bb.x && c.x < _bb.x + _bb.width && c.y > _bb.y && c.y < _bb.y + _bb.height) {
          overNode = node;
          return;
        }
      }
    });
    return overNode;
  }

  _remove(associations, type, obj) {
    var _na = [];
    const self = this;
    associations.forEach(function (association) {
      if (association[type].options.id === obj.options.id) {
        self.removeRelationship(association);
      } else {
        _na.push(association);
      }
    });
    return _na;
  }

  _initDrag(vect, e) {
    const self = this;
    self.selectedNodes = [];
    self.relationshipsToRefresh = [];
    self.relationshipsToTranslate = [];
    self.collabSent = false;
    self._dx = 0;
    self._dy = 0;
    self.slate.multiSelection && self.slate.multiSelection.end();
    if (self.slate.options.linking) {
      self.slate.options.linking.onNode.apply(vect, [self]);
    } else {
      if (self.node.options.allowDrag && !self.node.options.disableDrag) {
        self.selectedNodes = self.getSelectedNodes();
        const _associations = self.slate.nodes.getRelevantAssociationsWith(self.selectedNodes);
        self.relationshipsToTranslate = _associations.relationshipsToTranslate;
        self.relationshipsToRefresh = _associations.relationshipsToRefresh;
        self.selectedNodes.forEach((n) => {
          n.setStartDrag();
          n.vect.ox = n.options.xPos;
          n.vect.oy = n.options.yPos;
        });
        const selectedIds = self.selectedNodes.map(n => n.options.id);
        self.foreignPoints = self.slate.nodes.allNodes.filter(n => selectedIds.indexOf(n.options.id) === -1).map((n) => { return { id: n.options.id, bbox: n.vect.getBBox(), point: [n.options.xPos, n.options.yPos] } });
        self.kdTree = kdTree(self.foreignPoints.map(fp => fp.point));
        self.conditionallyHideAll();
      } else {
        utils.stopEvent(e);
      }
    }
  }

  async initiateTempNode(e, _parent, _assocPkg) {
    const self = this;
    var mp = utils.mousePos(e);
    var _slate = _parent.slate;

    var off = utils.positionedOffset(_slate.options.container);

    var _zr = self.slate.options.viewPort.zoom.r;
    var xp = (_slate.options.viewPort.left + mp.x - off.left);
    var yp = (_slate.options.viewPort.top + mp.y - off.top);

    const _xPos = xp + ((xp / _zr) - xp);
    const _yPos = yp + ((yp / _zr) - yp);

    //const _transforms = [`T${_xPos - 15}, ${_yPos - 15}`];
    const _path = utils._transformPath(sbIcons.icons.handle, `T${_xPos - 15}, ${_yPos - 15}`);
    //_path = _optimizedContext.path;

    var _tempNode = new node({
      id: self.slate.tempNodeId
      , xPos: _xPos
      , yPos: _yPos
      , lineColor: "#990000"
      , backgroundColor: "#ffffff"
      , vectorPath: _path
      , width: 30
      , height: 30
    });

    //var _pkg = { showParentArrow: self.node.options.showParentArrow, showChildArrow: self.node.options.showChildArrow }
    _slate.nodes.add(_tempNode, true);
    var _tempRelationship = _parent.relationships.addAssociation(_tempNode, _assocPkg, true); // _tempNode.relationships.addParent(_parent, {}, true);

    _tempRelationship.hoveredOver = null;
    _tempRelationship.lastHoveredOver = null;

    //initiates the drag
    _tempNode.vect.start(e); //, off.x, off.y);
    _slate.options.allowDrag = false;

    _tempNode.vect.mousemove(function (e) {
      //is there a current hit?
      if (_tempRelationship.hoveredOver === null) { //(e.clientX + e.clientY) % 2 === 0 &&
        _tempRelationship.hoveredOver = self._hitTest(utils.mousePos(e));
        if (_tempRelationship.hoveredOver !== null) {
          //yes, currently over a node -- scale it
          _tempRelationship.hoveredOver.vect.animate({ "stroke-width": 5 }, 500, function () {
            _tempRelationship.hoveredOver.vect.animate({ "stroke-width": self.node.options.borderWidth }, 500, function () {
              _tempRelationship.hoveredOver = null;
            });
          });

          //_tempRelationship.hoveredOver.vect.animate({ scale: '1.25, 1.25' }, 200);
          //remember self node
          //_tempRelationship.lastHoveredOver = _tempRelationship.hoveredOver;
        } else {
          //no current hit...is there a previous hit to reset?
          //if (_tempRelationship.lastHoveredOver !== null) {
          //    _tempRelationship.lastHoveredOver.vect.attr({ fill: self.node.options.backgroundColor });
          //_tempRelationship.lastHoveredOver.vect.animate({ scale: '1,1' }, 200);
          //    _tempRelationship.lastHoveredOver = null;
          //}
        }
      }
    });

    _tempNode.vect.mouseup(function (e) {
      _parent.relationships.removeAssociation(_tempNode);
      //_tempNode.relationships.removeParent(_parent);
      _tempNode.slate.nodes.remove(_tempNode);

      var overNode = self._hitTest(utils.mousePos(e));
      if (overNode !== null) {
        //overNode.vect.transform("s1,1,");

        //check if overNode has any parents
        const _relevantAssociations = overNode.relationships.associations.filter(function (association) {
          return overNode.options.id === association.child.options.id;
        });
        overNode.options.parents = _relevantAssociations.map(function (a) {
          return a.parent.options.id;
        });
        //check if the two nodes are already associated -- multiple associations between two nodes are currently not supported
        var relevantAssociation = _parent.relationships.associations.find(function (association) {
          return (association.child.options.id === overNode.options.id && association.parent.options.id === _parent.options.id) || (association.parent.options.id === overNode.options.id && association.child.options.id === _parent.options.id)
        });
        if (!relevantAssociation) {
          _parent.relationships.addAssociation(overNode, _assocPkg);
          var _pkgx = { type: "addRelationship", data: { type: 'association', parent: _parent.options.id, child: overNode.options.id } }
          self.slate.birdsEye && self.slate.birdsEye.relationshipsChanged(_pkgx);
          self._broadcast(_pkgx);
        }
      }

      if (self.slate.options.enabled)
        _parent.slate.options.allowDrag = true;
    });
  }

  _visibility(action) {
    if (this.node.options.id !== this.slate.tempNodeId) {
      for (var i = this.associations.length; i--;) {
        this.associations[i].line[action]();
      }
    }
  }

  removeAll() {
    const self = this;
    self.associations.forEach(function (association) {
      association.child.relationships.removeAssociation(self.node); //.parent);
      association.parent.relationships.removeAssociation(self.node);
      self.removeRelationship(association);
    });
    self.associations = [];
  }

  removeAssociation(_node) {
    this.associations = this._remove(this.associations, 'child', _node);
    this.associations = this._remove(this.associations, 'parent', _node);
    return this;
  }

  setKeys({ isShift, isAlt }) {
    this._isLastShift = isShift;
    this._isLastAlt = isAlt;
  }

  addAssociation(_node, assocPkg) {
    assocPkg = assocPkg || {}

    //make sure this doesn't already exist
    var _connection = this.associations.find(function (a) {
      return a.child.options.id === _node.options.id;
    });

    if (!_connection) {
      const _copts = {
        id: utils.guid()
        , parent: this.node
        , child: _node
        , lineColor: assocPkg.lineColor || this.node.options.lineColor
        , lineWidth: assocPkg.lineWidth || this.node.options.lineWidth
        , lineOpacity: assocPkg.lineOpacity || this.node.options.lineOpacity
        , lineEffect: assocPkg.lineEffect || this.node.options.lineEffect
        , blnStraight: assocPkg.isStraightLine || false
        , showParentArrow: assocPkg.showParentArrow || this.node.options.parentArrowForChildren.includes(_node.options.id)
        , showChildArrow: assocPkg.showChildArrow || !this.node.options.noChildArrowForChildren.includes(_node.options.id)
      }

      _connection = this.createNewRelationship(_copts);
      _connection.line.toBack();

      this.associations.push(_connection);
      _node.relationships.associations.push(_connection);

      this.wireLineEvents(_connection);
    }
    
    _node.slate.allLines.push(_connection); // helper for managing raw line attrs

    return _connection;
  }

  createNewRelationship(opts) {
    const paper = this.slate.paper;

    const association = {
      parent: null
      , child: null
      , lineColor: "#fff"
      , lineOpacity: 1
      , lineEffect: ""
      , lineWidth: 20
      , blnStraight: false
      , showParentArrow: false
      , showChildArrow: true
    }
    Object.assign(association, opts);

    let _attr = { stroke: association.lineColor, class: "association", fill: "none", "stroke-width": association.lineWidth, "fill-opacity": association.lineOpacity, filter: association.lineEffect ? `url(#${association.lineEffect})` : "", opacity: association.lineOpacity }

    //these two generic points will be adjusted after the line is created
    const origPoint = { x: 1, y: 1 }
    const endPoint = { x: 200, y: 200 }
    if (!association.line) {
      Object.assign(association, {
        line: paper.path(getHorizontalCurve(origPoint, endPoint)).attr(_attr)
      });
    }
    if (association.child && association.parent) {
      refreshRelationships({ relationships: [association], nodes: [association.parent] });
    }

    return association;
  }

  removeRelationship(association) {
    const self = this;
    self.node.slate?.allLines.splice(self.slate?.allLines.findIndex(l => l.id === association.id));
    association.line.remove();
  }

  wireLineEvents(c) {
    const self = this;
    if (self.node.options.allowMenu) {
      c.line.node.style.cursor = "pointer";
      c.line.mousedown(function (e) {
        utils.stopEvent(e);
        self.node.lineOptions.show(e, c);
      });
      self.slate?.grid.toBack();
      self.slate?.canvas.bgToBack();
    }
  }

  getSelectedNodes() {
    const self = this;
    self.selectedNodes = [];
    if (self.node.options.isLocked === false) {
      self.selectedNodes.push(self.node);
      this.syncAssociations(self.node, function (c, a) {
        if (!self.selectedNodes.some(function (n) { return n.options.id === c.options.id }) && c.options.isLocked === false) {
          self.selectedNodes.push(c);
        }
      });
    }
    return self.selectedNodes;
  }

  syncAssociations(node, cb) {
    const self = this;
    if (!self.slate.isCtrl || (self.slate.isCtrl && self.slate.isShift)) {
      node.relationships.associations.forEach(function (a) {
        if (a.child.options.id !== self.node.options.id && a.child.options.id !== node.options.id) {
          cb && cb(a.child, a);
          if (self.slate.isCtrl && self.slate.isShift) {
            self.syncAssociations(a.child, cb);
          }
        }
      });
    }
  }

  updateAssociationsWith(opts) {
    const conditionalSet = {}
    if (opts.conditional) {
      opts.conditional.forEach((setContext, i) => {
        conditionalSet[i] = setContext;
      });
      delete opts.conditional;
    }
    this.associations.forEach(function (a) {
      Object.assign(a, opts);
      Object.keys(conditionalSet).forEach((sc) => {
        const setContext = conditionalSet[sc];
        if (setContext.condition(a, setContext.data)) {
          a[setContext.key] = setContext.getValue(a, setContext.data);
        }
      });
    });
  }

  updateSingleAssociationWith(key, opts) {
    const association = this.associations.find(a, key);
    association && Object.assign(association, opts);
  }

  send(opts) {
    if (this.node.context && !this.node.context.isVisible() && this.node.options.allowDrag && !this.node.options.disableDrag) {
      const pkg = {
        type: "onNodesMove"
      }

      if (opts.nodes && opts.relationships) {
        pkg.data = this.slate.nodes.nodeMovePackage({ nodes: opts.nodes, relationships: opts.relationships });
      } else {
        pkg.data = this.slate.nodes.nodeMovePackage();
      }
      this.slate.collab && this.slate.collab.send(pkg);
      this.slate.birdsEye && this.slate.birdsEye.nodeChanged(pkg);
      self.collabSent = true;
    }
  }

  conditionallyHideAll(_exceedsOverride) {
    const self = this;
    if (self.node.options.id !== self.slate.tempNodeId) {
      const _exceeds = self.node.options.vectorPath.length > self.PATH_COMPLEXITY_LIMIT;
      if (_exceeds) {
        self.hideAll(true);
      }
      self.associations.forEach(function (a) {
        const _cexceed = _exceeds || a.child.options.vectorPath.length > self.PATH_COMPLEXITY_LIMIT;
        const _pexceed = _exceeds || a.parent.options.vectorPath.length > self.PATH_COMPLEXITY_LIMIT;
        a.child.relationships.hideAll(_cexceed);
        // a.parent.relationships.hideAll(_pexceed);
      });
    }
  }

  hideAll(_blnOverride) {
    if ((this.slate.isAlt && this.slate.isShift) || _blnOverride) this._visibility("hide");
  }

  hideOwn() {
    this.associations.forEach((association) => {
      association.line.hide();
    });
  }

  showOwn() {
    this.associations.forEach((association) => {
      association.line.show();
    });
  }

  showAll(_blnOverride) {
    if ((this._isLastAlt && this._isLastShift) || _blnOverride) this._visibility("show");
  }

  refreshOwnRelationships() {
    refreshRelationships({ relationships: this.associations, nodes: [this.node] });
  }

  // wireHoverEvents() {
  //   if (!this.slate.isReadOnly()) {
  //     if (this.node.options.id !== this.slate.tempNodeId) {
  //       this.hoverObjects.forEach(function (vElem) {
  //         if (!vElem.o.events || !vElem.o.events.map(e => e.name).some(e => "mouseover")) {
  //           vElem.over && vElem.o.mouseover(vElem.over);
  //           vElem.out && vElem.o.mouseout(vElem.out);
  //           vElem.down && vElem.o.mousedown(vElem.down);
  //         }
  //       });
  //     }
  //   }
  // }

  // unwireHoverEvents() {
  //   this.hoverObjects.forEach(function (vElem) {
  //     vElem.o.events && vElem.over && vElem.o.unmouseover(vElem.over); //_.indexOf(_.pluck(vElem.o.events, 'name'), "mouseover") > -1
  //     vElem.o.events && vElem.out && vElem.o.unmouseout(vElem.out);
  //     vElem.o.events && vElem.down && vElem.o.unmousedown(vElem.down);
  //   });
  // }

  wireDragEvents() {
    const self = this;
    if (!self.slate.isReadOnly() && (!self.slate.isCommentOnly() || self.slate.isCommentOnly() && self.node.options.isComment)) {
      self.node.vect.drag(self.dragEvents.move, self.dragEvents.dragger, self.dragEvents.up);
      self.node.text.mousedown(function (e) {
        self.node.vect.start(e);
      });
      function showText() {
        self.slate.events?.onTextPaneRequested?.apply(this, [self.node, (opts) => {
        }]);
      }
      self.node.vect.dblclick((e) => {
        showText();
      });
      self.node.text.dblclick((e) => {
        showText();
      });
    }

    // self.node.both.mousedown(function() {
    //   self.ft = self.slate.paper.freeTransform(self.node.both, {
    //       scale: ['bboxCorners']
    //     , rotate: 'axisY'
    //     , drag: true
    //     , draw: 'bbox'
    //   },
    //   function(ft, events) {
    //     console.log("ft event ", ft, events);
    //   });
    // });

  }

}