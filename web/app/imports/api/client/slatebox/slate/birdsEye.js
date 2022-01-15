import utils from "../helpers/utils";
import omit from 'lodash.omit';
import slate from '../core/slate.js';

export default class birdsEye {

  constructor(slate) {
    this.slate = slate;
    this.be = null;
    this.corner = null;
    this.handle = null;
    this.orx = null;
    this.sp = null;
    this.options = {
      size: 200
      , onHandleMove: null
    };
    this.parentDimen = null;
    this.lastX = null;
    this.lastY = null;
    this.wpadding = null;
    this.hpadding = null;
  }

  setBe() {
    if (this.be) this.be.style.left = (this.parentDimen.width - this.options.size) + "px";
    if (this.be) this.be.style.top = "-2px";
  };

  _hideText() {
    this.corner.nodes.allNodes.forEach((node) => {
      node.text.hide();
    });
  };

  _wireHandle() {
    const self = this;
    let start = {};
    var init = function () {
      self.handle.ox = this.attr("x");
      self.handle.oy = this.attr("y");
      start = utils.positionedOffset(self.slate.canvas.internal);
    };

    var move = function (x, y) {

      var _zr = self.corner.options.viewPort.originalWidth / self.sp;
      x = x + ((x / _zr) - x);
      y = y + ((y / _zr) - y);

      var _mx = self.handle.ox + x;
      var _my = self.handle.oy + y;

      self.handle.attr({ x: _mx, y: _my });

      var bb = self.handle.getBBox();
      var _cx = bb.x * self.slate.options.viewPort.zoom.r; // -self.parentDimen.width / 2;
      var _cy = bb.y * self.slate.options.viewPort.zoom.r; // -self.parentDimen.height / 2;

      self.options.onHandleMove?.apply(self, [_cx, _cy]);

      self.slate.canvas.move({ x: _cx, y: _cy, dur: 0, isAbsolute: true });

      self.lastX = bb.x;
      self.lastY = bb.y;
      //_lastOrx = this.orx;

      //self.handle.transform(["t", x, y].join());
    };

    var up = function (e) {
      self.refresh();
      const end = utils.positionedOffset(self.slate.canvas.internal);
      self.slate.canvas.broadcast({ x: start.left - end.left, y: start.top - end.top });
    };

    self.handle.drag(move, init, up);
  };

  show(_options) {
    const self = this;
    Object.assign(self.options, _options);

    var c = self.slate.options.container;
    self.parentDimen = utils.getDimensions(c);

    self.be = document.createElement('div');
    self.be.setAttribute("id", "slatebirdsEye_" + self.slate.options.id);
    self.be.setAttribute("class", "slatebirdsEye");
    self.be.style.position = "absolute";
    self.be.style.height = self.options.size + "px";
    self.be.style.width = self.options.size + "px";
    self.be.style.border = "2px inset #333";
    self.be.style.backgroundColor = "#fff";

    c.appendChild(self.be);
    self.setBe();

    //utils.instance.slate({
    //new Slatebox().slate({
    self.corner = new slate({
      container: "slatebirdsEye_" + self.slate.options.id
      , viewPort: { allowDrag: false }
      , collaboration: { allow: false }
      , showZoom: false
      , showUndoRedo: false
      , showMultiSelect: false
      , showbirdsEye: false //no infinite recursion!
      , showLocks: false
      , imageFolder: ''
      , isbirdsEye: true
    }, {
      onNodeDragged: function () {
        //console.log("birdsEye relationships changed ", pkg);
        self.slate.nodes.copyNodePositions(self.corner.nodes.allNodes);
      }
    }).init();

    self.refresh();

    utils.addEvent(window, "resize", function () {
      var c = self.slate.options.container;
      self.parentDimen = utils.getDimensions(c);
      self.setBe();
    });

    //if (!self.slate.options.showbirdsEye) self.disable();
  };

  enabled() {
    return this.corner !== null;
  };

  enable() {
    if (!this.corner) this.show();
    utils.el("slatebirdsEye_" + this.slate.options.id).style.display = "block";
  };

  disable() {
    utils.el("slatebirdsEye_" + this.slate.options.id).style.display = "none";
  };

  relationshipsChanged(pkg) {
    if (this.corner) {
      switch (pkg.type) {
        case "removeRelationship":
          this.corner.nodes.removeRelationship(pkg.data);
          //{ parent: c.parent.options.id, child: c.child.options.id };
          break;
        case "addRelationship":
          var __pkg = JSON.parse(JSON.stringify(pkg));
          Object.assign(__pkg.data, { options: { lineWidth: 1 } });
          //data: { id: this.slate.options.id, relationships: rels} };
          this.corner.nodes.addRelationship(__pkg.data);
          break;
      }
    }
  };

  nodeChanged(pkg) {
    if (this.corner) {
      if (pkg.type === "onNodesMove") {
        this.corner.nodes.moveNodes(pkg, { useMainCanvas: true });
      } else {
        var _node = this.corner.nodes.one(pkg.data.id);
        if (_node) {
          const useMainCanvas = true;
          switch (pkg.type) {
            case 'onNodeShapeChanged':
              _node.shapes.set(pkg.data);
              break;
            case "onNodeTextChanged":
              _node.editor.set(pkg.data.text, pkg.data.fontSize, pkg.data.fontFamily, pkg.data.fontColor, pkg.data.textXAlign, pkg.data.textYAlign);
              break;
            case "onNodeColorChanged":
              _node.colorPicker.set(pkg.data);
              break;
            case "onNodeImageChanged":
              _node.images.set(pkg.data.img, pkg.data.w, pkg.data.h, useMainCanvas);
              this.refresh();
              break;
            case "onNodeResized":
              Object.assign(_node.options, pkg.data);
              _node.vect.attr({ path: pkg.data.vectorPath });
              _node.vect.pattern && _node.images.imageSizeCorrection();
              this.refresh();
              break;
            case "onNodeRotated":
              pkg.data.associations.forEach((association) => {
                const currentAssociation = _node.relationships.associations.find((ass) => {
                  return ass.child.options.id === association.childId && ass.parent.options.id === association.parentId;
                });
                if (currentAssociation) {
                  currentAssociation.line.attr({ path: association.linePath });
                }
              });
              Object.assign(_node.options, omit(pkg.data, "associations"));
              const tempPath = this.slate.paper.path(_node.vect.attr("path")); // Meteor.currentSlate.paper.path
              const opts = {
                boundingClientRect: tempPath[0].getBoundingClientRect()
              };
              tempPath.remove();
              _node.rotate.applyImageRotation();
              this.refresh();
              break;
            case "onNodeToFront":
              _node.vect.toFront();
              break;
            case "onNodeToBack":
              _node.vect.toBack();
              break;
            case "onNodeLocked":
              _node.options.allowDrag = false;
            case "onNodeUnlocked":
              _node.options.allowDrag = true;
              break;
            case "changeLineColor":
              _node.lineOptions.set(pkg.data);
              break;
          }
        }
      }
    }
  };

  nodeDeleted(pkg) {
    if (this.corner) {
      var _node = this.corner.nodes.one(pkg.data.id);
      _node.del();
    }
  };

  nodeDetatched(pkg) {
    if (this.corner) {
      var _node = this.corner.nodes.one(pkg.data.id);
      _node.relationships.detatch();
    }
  };

  reload(json) {
    this.handle?.remove();
    this.corner.loadJSON(json);
    this.refresh(true);
  };

  refresh(blnNoAdditions) {
    if (this.corner) {

      var c = this.slate.options.container;
      this.parentDimen = utils.getDimensions(c);

      this.handle?.remove();

      if (blnNoAdditions === true) {
        this.corner.canvas.move({ x: this.slate.options.viewPort.left, y: this.slate.options.viewPort.top, dur: 0, isAbsolute: true });
        const useMainCanvas = true;
        this.corner.nodes.copyNodePositions(this.slate.nodes.allNodes, useMainCanvas); //repositionNodes();
      } else {
        var _export = this.slate.exportDifference(this.corner, 1); //line width override                    
        this.corner.loadJSON(_export, true, true, true, true);
      }

      this.orx = this.slate.getOrientation();

      if (this.slate.options.viewPort.left < this.orx.left)
        this.wpadding = ((this.slate.options.viewPort.left) - (this.orx.left));
      else
        this.wpadding = (this.slate.options.viewPort.left - this.orx.left) + (this.parentDimen.width - this.orx.width); // (this.slate.options.viewPort.left + this.parentDimen.width) - (this.orx.left + this.orxthis.width);

      this.hpadding = ((this.slate.options.viewPort.top) - (this.orx.top));

      var _pw = Math.max(Math.abs(this.wpadding), (this.orx.width < this.parentDimen.width ? (this.parentDimen.width - this.orx.width) : 0));
      var _ph = Math.max(Math.abs(this.hpadding), (this.orx.height < this.parentDimen.height ? (this.parentDimen.height - this.orx.height) : 0));

      var wp = ((this.orx.width + _pw) / this.options.size) * this.slate.options.viewPort.width;
      var hp = ((this.orx.height + _ph) / this.options.size) * this.slate.options.viewPort.height;

      this.sp = Math.max(wp, hp);

      var _r = Math.max(this.slate.options.viewPort.width, this.slate.options.viewPort.height) / this.sp;
      var l = (this.orx.left + (this.wpadding < 0 ? this.wpadding : 0)) * _r - 5;
      var t = (this.orx.top + (this.hpadding < 0 ? this.hpadding : 0)) * _r - 5;

      this.corner.zoom(0, 0, this.sp, this.sp, true);
      this.corner.options.viewPort.zoom.r = this.corner.options.viewPort.originalWidth / this.sp;
      //this.corner.zoom();
      this.corner.canvas.move({ x: l, y: t, dur: 0, isAbsolute: true });
      this.corner.disable();

      var _ix = this.slate.options.viewPort.left / this.slate.options.viewPort.zoom.r; // +this.wpadding; // this.orx.left; // -(this.orx.left - this.slate.options.viewPort.left); //+this.slate.options.viewPort.left; // this.orx.left + this.orx.width / 2;
      var _iy = this.slate.options.viewPort.top / this.slate.options.viewPort.zoom.r; // +this.hpadding; // this.orx.top; // -(this.orx.top - this.slate.options.viewPort.top); //+this.slate.options.viewPort.top; // this.orx.top + this.orx.height / 2;

      var _w = this.parentDimen.width / this.slate.options.viewPort.zoom.r, _h = this.parentDimen.height / this.slate.options.viewPort.zoom.r;
      this.handle = this.corner.paper.rect(_ix, _iy, _w, _h).attr({ stroke: '#000', "stroke-width": 2, fill: "#FFEB3A", "fill-opacity": ".5" });
      this._hideText();
      this._wireHandle();
    }
  };
}