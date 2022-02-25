import indexOf from 'lodash.indexof';
import invoke from 'lodash.invoke';
import refreshRelationships from "../helpers/refreshRelationships.js";
import utils from '../helpers/utils.js';
import { Raphael } from '../deps/raphael/raphael.svg.js';

export default class lineOptions {

  constructor(slate, node) {
    this.slate = slate;
    this.node = node;
    this._m = {};
  }

  _broadcast(pkg) {
    pkg.data.id = this.node.options.id;
    this.slate.collab && this.slate.collab.send(pkg);
  };

  set(pkg) {
    const a = this.node.relationships.associations[pkg.index];
    if (pkg.updateChild) {
      a.child.options[pkg.prop] = pkg.val;
    } else {
      this.node.options[pkg.prop] = pkg.val;
    }
    if (pkg.val === "toggle") {
      a[pkg.prop] = a[pkg.prop] ? ![pkg.prop] : true;
    } else {
      a[pkg.prop] = pkg.val;
    }
    refreshRelationships({ relationships: [a], nodes: [this.node] });
  };

  show(e, c) {
    const self = this;

    self.hideAll();
    self.slate.nodes.closeAllLineOptions(c.id);
    var a = self.node.relationships.associations.find(function (a) { return a.id === c.id; });
    //if (!self._m[c.id]) {

    const _r = self.slate.paper;
    const mp = utils.mousePos(e);
    const off = utils.positionedOffset(self.slate.options.container);
    const z = self.slate.options.viewPort.zoom.r;
    const opacity = "1.0";
    let x = (mp.x + self.slate.options.viewPort.left - off.left - 90) / z;
    let y = (mp.y + self.slate.options.viewPort.top - off.top - 30) / z;

    const bb = a.line.getBBox();
    x = bb.cx;
    y = bb.cy;

    self._m[c.id] = _r.set();

    let transformToolbar = function(xx, yy) { return ["t", x + xx, ",", y + yy].join(); };
    let toolbarAttr = { fill: "#fff", "fill-opacity": opacity, stroke: "#333", "stroke-width": 1, "cursor": "pointer" };
    const toolbar = [];

    const reassign = self.node.options.showRelationshipReassign ? _r.handle().attr(toolbarAttr).transform(transformToolbar(15, 0)) : null;
    const props = self.node.options.showRelationshipProperties ? _r.setting().attr(toolbarAttr).transform(transformToolbar(-15, 0)) : null;
    const del = self.node.options.showRelationshipDelete ? _r.trash().transform(transformToolbar(-45, 0)).attr({ fill: "#fff", stroke: "#f00" }) : null;

    reassign && toolbar.push(reassign);
    toolbar && toolbar.push(props);
    del && toolbar.push(del);

    let toolbarGlows = [];
    toolbar.forEach(function (toolbarElem) {
      toolbarElem.mouseover(function (e) {
        toolbarGlows.push(this.glow());
        utils.stopEvent(e);
      });
      toolbarElem.mouseout(function (e) {
        toolbarGlows.forEach(t => {
          t.remove();
        });
        utils.stopEvent(e);
      });
    });

    props && props.mousedown(function (e) {
      utils.stopEvent(e);
      toolbarGlows.forEach(t => {
        t.remove();
      });
      const a = self.node.relationships.associations.find(function (a) { return a.id === c.id; });
      if (self.slate.events?.onLineMenuRequested) {
        self.hideAll();
        self.slate.events?.onLineMenuRequested(self.node, a, (opts) => {
          //finished
        });
      }
    });

    function removeRelationship(e) {
      toolbarGlows.forEach(t => {
        t.remove();
      });
      utils.stopEvent(e);
      if (self.slate.options.enabled) {
        var a = self.node.relationships.associations.find(function (a) { return a.id === c.id; });
        var pkg = { type: "removeRelationship", data: { parent: c.parent.options.id, child: c.child.options.id } };
        self.slate.nodes.removeRelationship(pkg.data);
        self.slate.birdsEye && self.slate.birdsEye.relationshipsChanged(pkg);
        self._broadcast(pkg);
        self.hide(c.id);
        return a;
      }
    }
    //reassign relationship
    reassign && reassign.mousedown(function (e) {
      const a = removeRelationship();
      self.node.relationships.initiateTempNode(e, c.parent, { showChildArrow: a.showChildArrow, showParentArrow: a.showParentArrow });

    });

    //remove relationship
    del && del.mousedown(function (e) {
      removeRelationship();
    });

    toolbar.forEach(function (toolbarElem) {
      self._m[c.id].push(toolbarElem);
    });
    return self;
  }

  hide(id) {
    if (this._m[id]) { invoke(this._m[id], 'remove'); this._m[id] = null; }
  }

  hideAll() {
    const self = this;
    //self.slate.unglow();
    self.node.relationships.associations.map(r => r.id).forEach(function (id) {
      self.hide(id);
    });
  }
}