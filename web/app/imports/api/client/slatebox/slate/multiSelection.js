import utils from '../helpers/utils.js';
import uniq from 'lodash.uniq';
import refreshRelationships from '../helpers/refreshRelationships.js'
import { Slatebox } from '../index.js';
import cloneDeep from 'lodash.clonedeep';

export default class multiSelection {

  constructor(slate) {
    const self = this;
    self.slate = slate;
    self.selRect = null; //used during selection
    self.ox = null;
    self.oy = null;
    self._init = null;
    self.marker = null; //stays after selection
    self.selectedNodes = [];
    self.relationshipsToTranslate = [];
    self.relationshipsToRefresh = [];
    self.origPos = null;
    self.resizer = null;
    self.minSize = 100;
    self._icons = [];
    self.iconBg = null;
    self.moveX = 0;
    self.moveY = 0;
    self.attrs = {
      create:  { fill: "#fff", stroke: "#000" },
      mouseOut: { fill: "#fff", stroke: "#000"  },
      mouseOver: { fill: "#ccc", cursor: "pointer" }
    }
  }
  
  init() {
    const self = this;
    if (self.slate.options.isbirdsEye) return;

    function finalize(e) {
      // self.showConnections(self.relationshipsToTranslate.concat(self.relationshipsToRefresh));
      self.slate.options.allowDrag = true;
      self.slate.birdsEye && self.slate.birdsEye.refresh(true);
      self.selectedNodes.forEach((node) => {
        utils.transformPath(node, `T${self.moveX},${self.moveY}`);
        node.vect.currentDx = 0;
        node.vect.currentDy = 0;
      });

      refreshRelationships({ relationships: self.relationshipsToRefresh, nodes: self.selectedNodes, moveX: self.moveX, moveY: self.moveY });
      self.slate.nodes.saveRelationships(self.relationshipsToTranslate, { dx: self.moveX, dy: self.moveY });
      self.showConnections(self.relationshipsToTranslate.concat(self.relationshipsToRefresh));
      self.broadcastMove();

      self.showIcons();

      self.origPos = self.marker.getBBox();
      self.marker.toBack();
      self.slate?.grid.toBack();
      self.slate?.canvas.bgToBack();
    }

    var c = self.slate.options.container;
    if (c && self.slate.options.enabled && self.slate.options.showMultiSelect) {
      self._init = document.createElement("div");
      self._init.setAttribute("class", "slateMultiSelect");
      self._init.style.position = "absolute";
      self._init.style.height = "30px";
      self._init.style.left = '10px';
      self._init.style.color = "#081272";
      self._init.style.fontSize = "11pt";
      self._init.style.fontFamily = "trebuchet ms";
      self._init.style.top = "5px";
      self._init.style.display = "block";
      self._init.style.padding = "5px";
      self._init.style.margin = "5px;";
      self._init.style.backgroundColor = "#fff";
      self._init.style.cursor = "pointer";
      self._init.style["user-select"] = "none";
      self._init.innerHTML = "[multi-select]";
      self._init.style.zIndex = "0";
      c.appendChild(self._init);

      self.markerEvents = {
        init: function (x, y) {
          self.hideIcons();
          self.hideConnections(self.relationshipsToTranslate.concat(self.relationshipsToRefresh));
          self.moveX = 0;
          self.moveY = 0;
          self.slate.options.allowDrag = false;
          self.marker.ox = self.marker.attr("x");
          self.marker.oy = self.marker.attr("y");
          self.selectedNodes.forEach(function (node) {
            const bb = node.vect.getBBox();
            node.vect.ox = bb.x;
            node.vect.oy = bb.y;
          });
        }
        , move: function (dx, dy) {
          try {
            const _zr = self.slate.options.viewPort.zoom.r;
            dx = dx + ((dx / _zr) - dx);
            dy = dy + ((dy / _zr) - dy);
            self.moveX = dx;
            self.moveY = dy;

            var att = { x: self.marker.ox + dx, y: self.marker.oy + dy };
            self.marker.attr(att);

            self.selectedNodes.forEach(function (node) {
              node.vect.currentDx = dx;
              node.vect.currentDy = dy;
              node.translateWith({ dx, dy });
            });

            var _nx = self.origPos.x + self.origPos.width + dx - 5
              , _ny = self.origPos.y + self.origPos.height + dy - 5;
            self.resizer.transform(["t", _nx, ",", _ny, " r95 s1.5,1.5"].join(""));
          } catch (err) {
            finalize(e);
          }
        }
        , up: function (e) {
          finalize(e);
        }
      };

      self.resizeEvents = {
        init: function () {
          self.hideIcons();
          self.hideConnections(self.relationshipsToTranslate.concat(self.relationshipsToRefresh));
          self.moveX = 0;
          self.moveY = 0;
          self.slate.options.allowDrag = false;
          self.selectedNodes.forEach(function (node) {
            const bb = node.vect.getBBox();
            node.vect.ox = bb.x;
            node.vect.oy = bb.y;
          });
          self.marker.toBack();
          self.slate?.grid.toBack();
          self.slate?.canvas.bgToBack();
        }
        , move: function (dx, dy) {
          var _zr = self.slate.options.viewPort.zoom.r;
          dx = dx + ((dx / _zr) - dx);
          dy = dy + ((dy / _zr) - dy);

          self.moveX = dx;
          self.moveY = dy;

          var _width = self.origPos.width + (dx * 2);
          var _height = self.origPos.height + (dy * 2);

          var _nx = self.origPos.x + self.origPos.width + dx - 5;
          var _ny = self.origPos.y + self.origPos.height + dy - 5;
          var rw = true, rh = true;
          if (_width < self.minSize) { _width = self.minSize; rw = false; }
          if (_height < self.minSize) { _height = self.minSize; rh = false; }

          self.resizer.transform(["t", _nx, ",", _ny, " r95 s1.5,1.5"].join(""));

          var att = { width: _width, height: _height };
          rw && Object.assign(att, { x: self.origPos.x - dx });
          rh && Object.assign(att, { y: self.origPos.y - dy });

          self.marker.attr(att);
        }
        , up: function (e) {
          
          self.showConnections(self.relationshipsToTranslate.concat(self.relationshipsToRefresh));

          self.selectedNodes.forEach(function (node) {
            const transWidth = node.options.width + self.moveX;
            const transHeight = node.options.height + self.moveY;
            node.resize.set(transWidth, transHeight, { isMoving: true, getRotationPoint: node.options.rotate.rotationAngle });
            node.images.imageSizeCorrection();
          });

          refreshRelationships({ relationships: self.relationshipsToRefresh.concat(self.relationshipsToTranslate), nodes: self.selectedNodes, dx: 0, dy: 0 });
          self.broadcastMove();

          self.origPos = self.marker.getBBox();
          var _nx = self.origPos.x + self.origPos.width;
          var _ny = self.origPos.y + self.origPos.height;
          self.resizer.transform(["t", _nx - 5, ",", _ny - 5].join(""));
          self.refreshMarker();
          self.showIcons();
          self.marker.toBack();
          self.slate?.grid.toBack();
          self.slate?.canvas.bgToBack();
          self.slate.enable();
        }
      };

      utils.addEvent(self._init, "click", function (e) {
        switch (self._init.innerHTML) {
          case "[multi-select]":
            self.start();
            break;
          case "selecting [click to stop]...":
            self.end(false);
            self.endSelection();
            break;
        }
      });
    }
  }

  hide() {
    const self = this;
    if (self._init) self._init.style.display = "none";
  };

  show() {
    const self = this;
    if (self._init) self._init.style.display = "block";
  }

  start() {
    const self = this;
    self.slate.disable(); // options.allowDrag = false;
    self._init.innerHTML = "selecting [click to stop]...";
    document.head.insertAdjacentHTML("beforeend", `<style id='svg-no-select-text'>.slatebox-text { -webkit-user-select: none; -moz-user-select: none; -ms-user-select: none; user-select: none; }</style>`);
    //document.head.insertAdjacentHTML("beforeend", `<style id='svg-no-select-text'>svg text { pointer-events: none; }</style>`);
    self.slate.onSelectionStart = function (e) {
      self.end();
      var p = self.xy(e);
      self.selRect = self.slate.paper.rect(p.x, p.y, 10, 10).attr({ "stroke-dasharray": "-" });
      utils.addEvent(self.slate.canvas.get(), "mousemove", self._move.bind(self), null);
      utils.addEvent(self.slate.canvas.get(), "mouseup", self._mouseUp.bind(self), null, true);
      utils.addEvent(self.slate.canvas.get(), "mouseleave", self._select.bind(self), null, true);
      window.addEventListener('beforeunload', self._enableOnRefresh);
      self.ox = p.x;
      self.oy = p.y;
    };
  };

  _enableOnRefresh() {
    const self = this;
    self.relationshipsToTranslate = [];
    self.relationshipsToRefresh = [];
    self.selectedNodes = [];
    self.slate.enable();
    self.broadcastMove(); //broadcast an "empty" move to save the enabled state of the slate
  };

  showIcons() {
    const self = this;
    if (self.marker !== null) {

      const groupIds = uniq(self.selectedNodes.map(n => n.options.groupId));
      const isGrouped = groupIds.length === 1 && groupIds[0] !== null;
      const markerBB = self.marker.getBBox();
      let multiX = markerBB.x + markerBB.width + 45;

      // TODO: decide if you want to use a settings button here
      let showSettings = false;
      let height = 200;
      let heightSpacer = height/4;

      self.iconBg && self.iconBg.remove();
      self.iconBg = self.slate.paper.rect(multiX - 10, markerBB.y + heightSpacer - 10, 50, (heightSpacer * 3), 5).attr({ ...self.attrs.create, opacity: 0.3 }).toBack();

      const del = self.slate.paper.trash().attr({ fill: "#fff", stroke: "#f00" }).transform(["t", multiX, ",", markerBB.y + (heightSpacer * 3), "s", ",", "1.25", "1.25"].join());
      del.mouseover(function (e) {
        del.attr(self.attrs.mouseOver);
        utils.stopEvent(e);
      });
      del.mouseout(function (e) {
        del.attr({ fill: "#fff", stroke: "#f00" })
        utils.stopEvent(e);
      });
      del.mousedown(function (e) {
        utils.stopEvent(e);
        self.del();
      });

      const copy = self.slate.paper.copy().attr(self.attrs.create).transform(["t", multiX, ",", markerBB.y + (heightSpacer * 2), "s", ",", "1.25", "1.25"].join());
      copy.mouseover(function (e) {
        copy.attr(self.attrs.mouseOver);
        utils.stopEvent(e);
      });
      copy.mouseout(function (e) {
        copy.attr(self.attrs.mouseOut)
        utils.stopEvent(e);
      });
      copy.mousedown(function (e) {
        utils.stopEvent(e);
        const snap = self.slate.snapshot();
        const nGroupId = self.selectedNodes[0].options.groupId ? utils.guid().replace(/-/gi, "").substring(0, 8).toUpperCase() : null;
        let orient = self.slate.getOrientation(self.selectedNodes);
        let pad = 75;
        let relationalMap = {};
        self.selectedNodes.forEach(node => {
          let c = cloneDeep(node.options);
          c.xPos += orient.width + pad;
          c.groupId = nGroupId;
          c.id = utils.guid().replace(/-/gi, "").substring(0, 12);
          relationalMap[node.options.id] = c.id;
          c.vectorPath = utils._transformPath(c.vectorPath, `T${orient.width + pad},0`);
          let nn = new Slatebox.node(c);
          self.slate.nodes.add(nn);
        });

        //next add relationships
        let an = self.slate.nodes.allNodes;
        self.selectedNodes.forEach(node => {
          const nn = an.find(n => n.options.id === relationalMap[node.options.id]);
          // with nn as "parent", add all its children
          node.relationships.associations.filter(a => a.parent.options.id === node.options.id).forEach(a => {
            const assocPkg = cloneDeep(a);
            delete assocPkg.line; //ensure new line is created 
            assocPkg.id = utils.guid().replace(/-/gi, "").substring(0, 12);
            assocPkg.activeNode = relationalMap[assocPkg.activeNode];
            let childNode = an.find(n => { return n.options.id === relationalMap[a.child.options.id] });
            if (!childNode) {
              childNode = an.find(n => { return n.options.id === a.child.options.id });
            }
            nn.relationships.addAssociation(childNode, assocPkg);
          });
        });

        //send collaboration info
        const pkg = { type: 'onNodeAdded', data: self.slate.exportDifference(snap) };
        self.slate.collab.send(pkg);
      });
      
      self._icons.push(copy);


      if (!isGrouped) {
        const group = self.slate.paper.plus().attr(self.attrs.create).transform(["t", multiX, ",", markerBB.y + heightSpacer, "s", ",", "1.25", "1.25"].join());

        group.mouseover(function (e) {
          group.attr(self.attrs.mouseOver)
          utils.stopEvent(e);
        });
        group.mouseout(function (e) {
          group.attr(self.attrs.mouseOut)
          utils.stopEvent(e)
        });
        group.mousedown(function (e) {
          const groupId = utils.guid().replace(/-/gi, "").substring(0, 8).toUpperCase();
          self.selectedNodes.forEach(n => {
            n.options.groupId = groupId;
          });
          utils.stopEvent(e);
          self.endSelection();
          self.end();
          self.showGroup(groupId);
        });
        self._icons.push(group);
      } else {
        const ungroup = self.slate.paper.minus().attr(self.attrs.create).transform(["t", multiX, ",", markerBB.y + heightSpacer, "s", ",", "1.25", "1.25"].join());

        ungroup.mouseover(function (e) {
          ungroup.attr(self.attrs.mouseOver)
          utils.stopEvent(e)
        });
        ungroup.mouseout(function (e) {
          ungroup.attr(self.attrs.mouseOut)
          utils.stopEvent(e)
        });
        ungroup.mousedown(function (e) {
          self.selectedNodes.forEach(n => {
            n.options.groupId = null;
          });
          utils.stopEvent(e);
          self.hideIcons();
          self.showIcons();
          // self.selectedNodes[0].menu.show();
          // self.endSelection();
          // self.end();
        });
        self._icons.push(ungroup);

        if (showSettings) {
          const settings = self.slate.paper.setting().attr(self.attrs.create).transform(["t", multiX, ",", markerBB.y + (heightSpacer * 4), "s", ",", "1.25", "1.25"].join());
          settings.mouseover(function (e) {
            settings.attr(self.attrs.mouseOver)
            utils.stopEvent(e)
          });
          settings.mouseout(function (e) {
            settings.attr(self.attrs.mouseOut)
            utils.stopEvent(e)
          });
          settings.mousedown(function (e) {
            utils.stopEvent(e);
            self.selectedNodes[0].menu.show();
          });
          self._icons.push(settings);
        }
      }
      self._icons.push(del);

    }
  };

  hideIcons() {
    const self = this;
    self.iconBg.remove();
    self._icons.forEach(i => i.remove());
  }

  isSelecting() {
    const self = this;
    return (self.marker !== null);
  }

  del() {
    const self = this;
    self.slate.events.onConfirmRequested(`Confirm Deletion`, `Are you sure you want to remove these ${self.selectedNodes.length} node(s)?`, (blnConfirm) => {
      if (blnConfirm) {
        self.selectedNodes.forEach(function (node) {
          node.del();
          self.slate.unglow();
          var delPkg = { type: 'onNodeDeleted', data: { id: node.options.id } };
          self.slate.collab && self.slate.collab.send(delPkg);
          self.slate.birdsEye && self.slate.birdsEye.nodeDeleted(delPkg);
        });
        self.end();
      }
    });  
  }

  end(hasMarker = true) {
    const self = this;
    if (self.marker !== null || !hasMarker) {
      self.marker && self.marker.remove();
      self.marker && self.resizer.remove();
      self.marker = null;
      self.slate.enable();
      // self.slate.keyboard && self.slate.keyboard.end();
      self.hideIcons();
      window.removeEventListener("beforeunload", self._enableOnRefresh);
    }
    if (self._init) self._init.innerHTML = "[multi-select]";
  }

  endSelection() {
    const self = this;
    self.selRect && self.selRect.remove();
    self.showIcons();
    self.slate.options.allowDrag = true;
    self.slate.onSelectionStart = null;
    // let noSelect = document.getElementById('svg-no-select-text');
    // noSelect && noSelect.parentNode.remove(noSelect);
    // console.log("mouseup removed");
    utils.removeEvent(self.slate.canvas.get(), "mousemove", self._move.bind(self));
    // utils.removeEvent(self.slate.canvas.get(), "mouseup", self._select);
    // utils.removeEvent(self.slate.canvas.get(), "mouseleave", self._select);
  };

  xy(e) {
    const self = this;
    var mp = utils.mousePos(e);
    var off = utils.positionedOffset(self.slate.options.container);
    var _x = mp.x + self.slate.options.viewPort.left - off.left;
    var _y = mp.y + self.slate.options.viewPort.top - off.top;
    var z = self.slate.options.viewPort.zoom.r;
    return { x: _x / z, y: _y / z };
  };

  _move(e) {
    const self = this;
    const p = self.xy(e);
    var height = p.y - self.oy;
    var width = p.x - self.ox;

    if (height > 0) {
      self.selRect.attr({ height: height });
    } else {
      self.selRect.attr({ y: p.y, height: (self.oy - p.y) });
    }
    if (width > 0) {
      self.selRect.attr({ width: width });
    } else {
      self.selRect.attr({ x: p.x, width: (self.ox - p.x) });
    }
  }

  showGroup(groupId) {
    const self = this;
    self.selectedNodes = self.slate.nodes.allNodes.filter(n => n.options.groupId === groupId);
    if (self.prepSelectedNodes()) {
      self.refreshMarker();
      self.showIcons();
    }
  }

  refreshMarker() {
    const self = this;
    const _imageFolder = "/packages/slatebox/lib/client/images/";
    self.marker && self.marker.remove();
    self.resizer && self.resizer.remove();
    self.iconBg && self.iconBg.remove();
    const z = self.slate.options.viewPort.zoom.r;
    const orient = self.slate.getOrientation(self.selectedNodes);
    let w = orient.width / z;
    let h = orient.height / z;
    if (w < self.minSize) w = self.minSize;
    if (h < self.minSize) h = self.minSize;

    self.marker = self.slate.paper.rect(orient.left / z, orient.top / z, w, h).attr({ "stroke-dasharray": "-", "fill": "#f8f8f8", opacity: 0.3 });
    self.marker.toBack();
    self.slate?.grid.toBack();
      self.slate?.canvas.bgToBack();
    self.origPos = self.marker.getBBox();

    //self.resizer
    const _nx = self.origPos.x + self.origPos.width;
    const _ny = self.origPos.y + self.origPos.height;
    self.resizer = self.slate.paper.resize().transform(["t", _nx - 5, ",", _ny - 5, "r95 s1.5,1.5"].join()).attr({ fill: "#fff", stroke: "#000" });
    self.resizer.toFront();
    self.resizer.mouseover((e) => {
      self.resizer.attr(self.attrs.mouseOver);
      utils.stopEvent(e);
    }); //self._resizeHover.bind(self));
    self.resizer.mouseout((e) => {
      self.resizer.attr(self.attrs.mouseOut);
      utils.stopEvent(e);
    }); //self._resizeHover.bind(self));
    // self.resizer.unmouseover(self._resizeHover.bind(self));
    self.marker.drag(self.markerEvents.move, self.markerEvents.init, self.markerEvents.up);
    self.resizer.drag(self.resizeEvents.move, self.resizeEvents.init, self.resizeEvents.up);
  };

  prepSelectedNodes() {
    const self = this;
    //select relevant connections
    if (self.selectedNodes.length > 1) {
      const _associations = self.slate.nodes.getRelevantAssociationsWith(self.selectedNodes);
      self.relationshipsToTranslate = _associations.relationshipsToTranslate;
      self.relationshipsToRefresh = _associations.relationshipsToRefresh;
  
      self.refreshMarker();
      self.endSelection();

      //unmark all and remove connectors
      self.slate.nodes.closeAllMenus({ nodes: self.selectedNodes });

      //activate keyboard shortcuts for self group...
      // self.slate.keyboard && self.slate.keyboard.start();

    } else if (self.selectedNodes.length === 1) {
      self.selectedNodes[0].menu.show();
      self.slate.enable();
      self.endSelection();
      self.end();
      return false;
    } else {
      self.slate.enable();
      self.endSelection();
      self.end();
      return true;
    }
  }

  _mouseUp(e) {
    const self = this;
    console.log("mouse up");
    if (self._init) {
      self._init.innerHTML = "[multi-select]";
    }
    this._select(e);
  }

  _select(e) {
    const self = this;
    var sr = self.selRect.getBBox();

    if (sr) {
      const withinBox = self.slate.nodes.allNodes.filter(function (n) {
        let inRange = ((n.options.xPos + n.options.width > sr.x && n.options.xPos < sr.x + sr.width) && (n.options.yPos + n.options.height > sr.y && n.options.yPos < sr.y + sr.height))
        return inRange && !n.options.isLocked;
      });

      // add any groupIds
      const groupIds = uniq(withinBox.map(n => n.options.groupId)).filter(g => !!g);
      const alreadySelectedIds = withinBox.map(n => n.options.id);
      self.selectedNodes = self.slate.nodes.allNodes.filter(n => alreadySelectedIds.includes(n.options.id) || groupIds.includes(n.options.groupId));
      self.prepSelectedNodes();
    }
  };

  hideConnections(connections) {
    connections.forEach((c) => {
      c.line.hide();
    });
  }

  showConnections(connections) {
    connections.forEach((c) => {
      c.line.show();
    });
  }

  _resize() {
    const self = this;
    var mbb = self.marker.getBBox();

    var xStatic = mbb.x + mbb.width / 2;
    var yStatic = mbb.y + mbb.height / 2;
    var yScale = mbb.height / self.origPos.height;
    var xScale = mbb.width / self.origPos.width;

    self.selectedNodes.forEach(function (node) {
      var nx = xStatic + (xScale * (node.options.xPos - xStatic));
      var ny = yStatic + (yScale * (node.options.yPos - yStatic));

      node.setPosition({ x: nx, y: ny });

      var nw = xScale * node.options.width; // ((mbb.width * node.options.width) / origPos.width);
      var nh = yScale * node.options.height; // ((mbb.height * node.options.height) / origPos.height);
      node.resize.set(nw, nh);
    });
  };

  broadcastMove() {
    const self = this;
    const pkg = {
      type: "onNodesMove"
      , data: self.slate.nodes.nodeMovePackage({ nodes: self.selectedNodes, relationships: self.relationshipsToTranslate.concat(self.relationshipsToRefresh) })
    };

    self.slate.collab && self.slate.collab.send(pkg);
    self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
  };

}