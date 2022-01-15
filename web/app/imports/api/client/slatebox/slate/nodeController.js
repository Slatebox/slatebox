import getTransformedPath from "../helpers/getTransformedPath";
import getDepCoords from "../helpers/getDepCoords";
import uniq from 'lodash.uniq';

import utils from '../helpers/utils.js';
import editor from '../node/editor.js';
import relationships from "../node/relationships.js";
import rotate from "../node/rotate.js";
import menu from "../node/menu.js";
import connectors from '../node/connectors.js';

import invoke from 'lodash.invoke';
import resize from "../node/resize.js";
import images from "../node/images.js";
import shapes from "../node/shapes.js";
import customShapes from "../node/customShapes.js";
import colorPicker from "../node/colorPicker.js";
import context from '../node/context.js';
import lineOptions from '../node/lineOptions.js';
import gridLines from "../node/gridLines";

export default class nodeController {

  constructor(slate) {
    this.slate = slate;
    this.ensureBe = null;
    this.allNodes = [];
  }

  _refreshBe() {
    const self = this;
    window.clearTimeout(self.ensureBe);
    self.ensureBe = window.setTimeout(function () {
      self.slate.birdsEye && self.slate.birdsEye.refresh(false);
    }, 10);
  };

  _getParentChild(obj) {
    var _parent, _child;
    this.allNodes.forEach(function (node) {
      if (node.options.id === obj.parent) {
        _parent = node;
      } else if (node.options.id === obj.child) {
        _child = node;
      }
      if (_parent && _child) return;
    });

    return { p: _parent, c: _child };
  };

  _remove(a, obj) {
    return a.filter(function (a) { return a.options.id !== obj.options.id; });
  }

  copyNodePositions(source, useMainCanvas = false) {
    const self = this;
    source.forEach(function (src) {
      //if (src.options.id !== self.tempNodeId) {
      var cn = self.allNodes.find(function (n) { return n.options.id === src.options.id });
      if (!cn) {
        self.add(src);
        cn = self.allNodes.find(function (n) { return n.options.id === src.options.id });
      }
      cn.setPosition({ x: src.options.xPos, y: src.options.yPos });

      const opts = {};
      if (useMainCanvas) {
        const tempPath = self.slate.paper.path(cn.vect.attr("path")); //Meteor.currentSlate.paper
        opts.boundingClientRect = tempPath[0].getBoundingClientRect();
        tempPath.remove();
      }
      cn.rotate.applyImageRotation(opts);
      //}
    });
    invoke(self.allNodes.map(n => n.relationships), 'refresh');
  };

  addRange(_nodes) {
    const self = this;
    _nodes.forEach(function (node) {
      self.add(node);
    });
    return self;
  };

  removeRange(_nodes) {
    const self = this;
    _nodes.forEach(function (node) {
      this.allNodes = self._remove(self.allNodes, node);
    });
    return self;
  };

  add(_node, useMainCanvas) {
    _node.slate = this.slate; //parent
    this.allNodes.push(_node);
    this.addToCanvas(_node, useMainCanvas);
  };

  remove(_node) {
    this.allNodes = this._remove(this.allNodes, _node);
    _node.slate = null;
    this.removeFromCanvas(_node);
  };

  nodeMovePackage(opts = {}) {
    //if exporting a move package with moves applied (e.g., you're
    //planning on manipulating the slate programmatically and this is
    //not an export bound for collaboration (at first)) -- then we need
    //to apply the final results to a copy of the slate because they are need
    //for the calculations below, and those calcs are mutable, so they 
    //cannot be applied to the current slate.

    let _use = this.slate;
    let _divCopy = null;
    if (opts && opts.moves) {
      const _divCopy = document.createElement("div");
      const _did = "copy_" + utils.guid();
      _divCopy.setAttribute("id", _did);
      _divCopy.setAttribute("style", `width:1px;height:1px;display:none;`);
      document.body.appendChild(_divCopy);
      _use = this.slate.copy({ container: _did, moves: opts.moves });
    }

    let nds = opts?.nodes || _use.nodes.allNodes;
    const _ret = {
      dur: opts ? opts.dur : 300
      , easing: opts ? opts.easing : ">"
      , textPositions: (() => {
        return nds.map((node) => {
          return {
            id: node.options.id,
            textPosition: {
              x: node.text.attrs.x,
              y: node.text.attrs.y,
              transform: node.getTransformString()
            }
          }
        })
      })(),
      nodeOptions: nds.map((node) => {
        return node.options;
      }),
      associations: (() => {
        const assoc = [];
        if (opts.relationships && opts.nodes) {
          opts.relationships.forEach((a) => {
            assoc.push({
              parentId: a.parent.options.id,
              childId: a.child.options.id,
              linePath: a.line.attr("path").toString(),
              id: a.line.id
            })
          });
        } else {
          _use.nodes.allNodes.forEach((node) => {
            node.relationships.associations.forEach((a) => {
              assoc.push({
                parentId: a.parent.options.id,
                childId: a.child.options.id,
                linePath: a.line.attr("path").toString(),
                id: a.line.id
              })
            });
          });
        }
        return uniq(assoc, (a) => {
          return a.id;
        })
      })()
    };

    if (_divCopy) {
      document.removeChild(_divCopy);
    }

    return _ret;
  };

  moveNodes(pkg, options = {}) {
    this.closeAllLineOptions();
    this.closeAllMenus();
    // _node.hideOwnMenus();
    const allAssoc = [];
    this.allNodes.forEach((node) => {
      node.relationships.associations.forEach((a) => {
        allAssoc.push(a);
      });
    });
    const uniqAssoc = uniq(allAssoc, (a) => {
      return a.id;
    });

    var p = pkg.data || pkg
      , d = p.dur || 300 //Meteor.collabAnimationDuration || 
      , e = p.easing || ">";

    const { associations, nodeOptions, textPositions } = p;

    let _cntr = 0;
    function _potentiallyFinalize() {
      _cntr++;
      if (_cntr === nodeOptions.length && options.cb) {
        options.cb();
        delete options.cb;
      }
    };

    nodeOptions.forEach((opts) => {
      const _nodeObject = this.allNodes.find(function (node) {
        return node.options.id === opts.id;
      });
      if (_nodeObject) {
        Object.assign(_nodeObject.options, opts);

        const dps = getDepCoords({ x: opts.xPos, y: opts.yPos }
          , _nodeObject.options)
          , lx = dps.lx
          , tx = dps.tx
          , ty = dps.ty;

        const currentTextPosition = textPositions.find(tp => tp.id === opts.id);
        if (options.animate) {
          _nodeObject.text.animate(currentTextPosition.textPosition, d, e);
          _nodeObject.link.animate({ x: lx, y: ty }, d, e);
        } else {
          _nodeObject.text.attr(currentTextPosition.textPosition);
          _nodeObject.link.attr({ x: lx, y: ty });
        }

        if (options.animate) {
          _nodeObject && _nodeObject.vect.animate({ path: opts.vectorPath, transform: _nodeObject.getTransformString() }, d, e, function () {
            _nodeObject.vect.attr({ path: opts.vectorPath });
            _nodeObject.images.imageSizeCorrection(); _potentiallyFinalize();
          });
        } else {
          _nodeObject && _nodeObject.vect.attr({ path: opts.vectorPath });
          let rotationOptions = {};
          if (options.useMainCanvas) {
            const tempPath = this.slate.paper.path(_nodeObject.vect.attr("path")); //Meteor.currentSlate.paper.
            rotationOptions = {
              boundingClientRect: tempPath[0].getBoundingClientRect()
            };
            tempPath.remove();
          }
          _nodeObject.rotate.applyImageRotation(rotationOptions);
          _nodeObject.images.imageSizeCorrection(); _potentiallyFinalize();
        }
      }
    });

    associations.forEach((assoc) => {
      const a = uniqAssoc.find(function (a) {
        return a.parent.options.id === assoc.parentId && a.child.options.id === assoc.childId;
      });
      if (options.animate) {
        a && a.line.animate({ path: assoc.linePath }, d, e, function () {
          a.line.attr({ path: assoc.linePath });
          _potentiallyFinalize();
        });
      } else {
        a && a.line.attr({ path: assoc.linePath });
        _potentiallyFinalize();
      }
    });
    this.slate.birdsEye && this.slate.birdsEye.refresh(true);
  };

  getRelevantAssociationsWith(nodes) {
    const _relationshipsToTranslate = [];
    const _relationshipsToRefresh = [];
    nodes.forEach((node) => {
      const otherSelectedNodes = nodes.filter((n) => n.options.id !== node.options.id);
      node.relationships.associations.forEach((assoc) => {
        if (otherSelectedNodes.map((n) => n.relationships.associations).some((associations) => {
          return associations.find(a => a.id === assoc.id);
        })) {
          if (!_relationshipsToTranslate.some(r => r.id === assoc.id)) {
            _relationshipsToTranslate.push(assoc); //connections which move with both nodes
          }
        } else {
          if (!_relationshipsToRefresh.some(r => r.id === assoc.id)) {
            _relationshipsToRefresh.push(assoc); //connections which move on one end only
          }
        }
      })
    });

    return {
      relationshipsToRefresh: _relationshipsToRefresh,
      relationshipsToTranslate: _relationshipsToTranslate
    }
  };

  translateRelationships(relationships, { dx, dy }) {
    relationships.forEach((r) => {
      r.line.transform(`T${dx}, ${dy}`);
    });
  };

  saveRelationships(relationships, { dx, dy }) {
    relationships.forEach((r) => {
      const newLinePath = utils._transformPath(r.line.attr("path").toString(), `T${dx},${dy}`).toString();
      r.line.attr({ "path": newLinePath });
      r.line.transform("");
    });
  };

  removeRelationship(rm) {
    var pc = this._getParentChild(rm);
    var _parent = pc.p, _child = pc.c;
    if (_parent && _child) {
      // _parent.relationships.removeChild(_child);
      // _child.relationships.removeParent(_parent);
      _parent.relationships.removeAssociation(_child);
      _child.relationships.removeAssociation(_parent);
    }
  };

  refreshAllRelationships() {
    this.allNodes.forEach(function (node) {
      node.relationships.refreshOwnRelationships();
    });
  };

  addRelationship(add) {
    var pc = this._getParentChild(add);
    var _parent = pc.p, _child = pc.c;
    if (_parent && _child) {
      switch (add.type) {
        case "association":
          _parent.relationships.addAssociation(_child, add.options);
          break;
        // case "parent":
        //     _parent.relationships.addParent(_child);
        //     break;
      }
    }
  };

  closeAllLineOptions(exception) {
    this.allNodes.forEach(function (node) {
      node.relationships.associations.forEach(function (association) {
        if (association.id === exception) {
        } else {
          node.lineOptions && node.lineOptions.hide(association.id);
        }
      });
    });
  };

  closeAllMenus({ exception, nodes } = {}) {
    (nodes || this.allNodes).forEach(function (node) {
      if (node.options.id === exception) {
      } else {
        node.menu && node.menu.hide();
        node.lineOptions && node.lineOptions.hideAll();
        node.resize && node.resize.hide();
        node.rotate && node.rotate.hide();
      }
    });
  };

  closeAllConnectors() {
    this.allNodes.forEach(function (node) {
      node.connectors && node.connectors.remove();
      node.resize && node.resize.hide();
      node.rotate && node.rotate.hide();
    });
  };

  one(id) {
    var cn = null;
    this.allNodes.forEach(function (node) {
      if (node.options.id === id) {
        cn = node;
        return;
      }
    });
    return cn;
  };

  removeFromCanvas(_node) {
    ["vect", "text", "link"].forEach(function (tt) {
      _node[tt].remove();
    });
    this._refreshBe();
  };

  addToCanvas(_node, useMainCanvas) {
    const self = this;
    _node.slate = this.slate;

    var vect = null, link = null;
    var vectOpt = { fill: (_node.options.backgroundColor || "#fff"), "fill-opacity": _node.options.opacity != null ? _node.options.opacity : 1 };
    Object.assign(vectOpt, _node.applyBorder());
    var _x = _node.options.xPos;
    var _y = _node.options.yPos;
    var paperToUse = this.slate.paper;
    var percent = 1;

    var _width = _node.options.width;
    var _height = _node.options.height;

    //tree:
    //_node.options.vectorPath = "M72.223,47.223c0-5.945-3.777-11.039-9.028-13.021c2.192-2.455,3.472-5.651,3.472-9.201c0-7.67-6.218-13.889-13.889-13.889c-1.094,0-2.104,0.106-3.125,0.344C48.49,4.961,42.942-0.002,36.111,0c-6.83,0.001-12.379,4.964-13.542,11.46c-1.021-0.239-2.032-0.345-3.125-0.345c-7.671,0-13.889,6.218-13.889,13.889c0,3.551,1.28,6.746,3.472,9.202C3.777,36.187,0,41.278,0,47.223c0,7.671,5.556,13.892,13.889,13.892h2.777l11.111,19.444v13.887c0,2.777,2.778,5.555,5.556,5.555h5.556c2.776,0,5.555-2.777,5.555-5.555v-13.89l11.112-19.441l3.992-0.083C66.666,61.113,72.223,54.474,72.223,47.223L72.223,47.223z M27.778,61.113h16.667l-5.555,11.11h-5.556L27.778,61.113z";

    //house:
    //_node.options.vectorPath = "M232.272,88.949L79.937,223.837v192.749c0,4.979,4.023,8.971,9.001,8.971h95.205v-84.51c0-4.979,3.994-9,8.971-9h78.229  c4.978,0,8.97,4.021,8.97,9v84.51h95.235c4.979,0,8.972-3.992,8.972-8.971V223.779L232.272,88.949z";

    //rounded rect:
    //
    //_node.options.vectorPath = "M1,1 h130 a10,10 0 0 1 10,10 v80 a10,10 0 0 1 -10,10 h-130 a10,10 0 0 1 -10,-10 v-80 a10,10 0 0 1 10,-10 z";
    //_node.options.vectorPath = "M" + _x + "," + _y + " h130 a10,10 0 0 1 10,10 v80 a10,10 0 0 1 -10,10 h-130 a10,10 0 0 1 -10,-10 v-80 a10,10 0 0 1 10,-10 z";
    //console.log("path is ", _node.options.vectorPath);
    //_node.options.vectorPath = "M20,4H4C2.9,4,2,4.9,2,6v12c0,1.1,0.9,2,2,2h16c1.1,0,2-0.9,2-2V6C22,4.9,21.1,4,20,4z"
    // M276.328,277.105h-85.096V224.74  h85.096V277.105z M79.937,42.699h54.771l-0.479,32.438l-54.293,49.048V42.699z M231.388,24.746L15.334,216.053l22.758,25.676l194.18-171.952l194.136,171.952l22.715-25.676L233.113,24.746 l-0.884-0.76L231.388,24.746z

    //const _path = paperToUse.roundedRectanglePath(pathAttrs);
    //console.log("path is ", _path);
    //_node.options.vectorPath = "M" + _x + "," + _y + " h130 a10,10 0 0 1 10,10 v80 a10,10 0 0 1 -10,10 h-130 a10,10 0 0 1 -10,-10 v-80 a10,10 0 0 1 10,-10 z";

    //console.log("paths are ", _path, _node.options.vectorPath);

    //adjust historical vectorPaths to pure paths...
    // const _tp = "T" + (_x * percent) + "," + (_y * percent) + ",s" + (_width/150 * percent) + "," + (_height/100 * percent);
    const _transforms = [`T${_x * percent}, ${_y * percent}`, `s${_width / 150 * percent}, ${_height / 100 * percent}, ${_x}, ${_y}`];
    _node.options.isEllipse = _node.options.isEllipse || _node.options.vectorPath === "ellipse";
    switch (_node.options.vectorPath) {
      case "ellipse":
        _node.options.vectorPath = getTransformedPath("M150,50 a75,50 0 1,1 0,-1 z", _transforms);
        break;
      case "rectangle":
        _node.options.vectorPath = getTransformedPath("M1,1 h150 v100 h-150 v-100 z", _transforms);
        break;
      case "roundedrectangle":
        _node.options.vectorPath = getTransformedPath("M1,1 h130 a10,10 0 0 1 10,10 v80 a10,10 0 0 1 -10,10 h-130 a10,10 0 0 1 -10,-10 v-80 a10,10 0 0 1 10,-10 z", _transforms);
        break;
    }

    if (_node.options.vectorPath === "M2,12 L22,12") {
      vectOpt["stroke-dasharray"] = "2px";
    }

    vect = paperToUse.path(_node.options.vectorPath).attr(vectOpt);
    vect.node.style.cursor = "pointer";

    //need to set in case toback or tofront is called and the load order changes in the context plugin
    vect.node.setAttribute("rel", _node.options.id);
    vect.data({ id: _node.options.id });
    _node.vect = vect;
    // _node.vect.ox = _x;
    // _node.vect.oy = _y;

    //get the text coords before the transform is applied
    //var tc = _node.textCoords();
    _node.vect.transform(_node.getTransformString());

    //update xPos, yPos in case it is different than actual
    const bbox = vect.getBBox();
    _node.options.xPos = bbox.x;
    _node.options.yPos = bbox.y;

    var lc = _node.linkCoords();

    //apply the text coords prior to transform
    //text = paperToUse.text(tc.x, tc.y, (_node.options.text || '')).attr({ "font-size": _node.options.fontSize + "pt", fill: _node.options.foregroundColor || "#000" });
    link = paperToUse.linkArrow().transform(["t", lc.x, ",", lc.y, "s", ".8", ",", ".8", "r", "180"].join());

    //create and set editor
    _node.editor = new editor(this.slate, _node);
    _node.editor.set(); //creates and sets the text
    _node.text.transform(_node.getTransformString());
    // setTimeout(() => {
    //   _node.editor.setTextOffset();
    // }, 100);

    // utils.transformPath(_node, `T${self._dx},${self._dy}`);
    // node.vect.currentDx = 0;
    // node.vect.currentDy = 0;
    // node.editor.setTextOffset();
    

    //set links
    _node.link = link;

    _node.both = new _node.slate.paper.set();
    _node.both.push(_node.vect);
    _node.both.push(_node.text);

    //relationships
    _node.relationships = new relationships(this.slate, _node);
    // _node.relationships.wireHoverEvents();
    _node.relationships.wireDragEvents();
    _node.links && _node.links.wireEvents();

    //rotate
    _node.rotate = new rotate(this.slate, _node);

    //connectors
    _node.connectors = new connectors(this.slate, _node);

    //menu
    _node.menu = new menu(this.slate, _node);

    //resizer
    _node.resize = new resize(this.slate, _node);

    //images
    _node.images = new images(this.slate, _node);

    //context
    _node.context = new context(this.slate, _node);

    //lineOptions
    _node.lineOptions = new lineOptions(this.slate, _node);

    //shapes
    _node.shapes = new shapes(this.slate, _node);

    //customShapes
    _node.customShapes = new customShapes(this.slate, _node);

    //colorPicker
    _node.colorPicker = new colorPicker(this.slate, _node);

    //gridLines
    _node.gridLines = new gridLines(this.slate, _node);

    if (_node.options.image && !_node.options.imageOrigHeight) {
      _node.options.imageOrigHeight = _node.options.height;
    }

    if (_node.options.image && !_node.options.imageOrigWidth) {
      _node.options.imageOrigWidth = _node.options.width;
    }

    if (_node.options.image && _node.options.image !== "") {
      _node.images.set(_node.options.image, _node.options.imageOrigWidth, _node.options.imageOrigHeight, useMainCanvas);
      //_node.vect.attr({ "fill": "url(" + _node.options.image + ")", "stroke-width": _node.options.borderWidth, "stroke": "#000" });
    }

    if (!_node.options.link || !_node.options.link.show) {
      _node.link.hide();
    }

    //apply any node filters to vect and/or text
    _node.applyFilters();

    //this code will run only for not updated nodes in slates created pre Slatebox 2.0
    // if (_node.options.isEllipse) {
    //   _node.shapes.set({ shape: "rect", rx: 5 });
    //   _node.shapes.set({ shape: "ellipse", rx: 16 });
    // }
    // delete _node.options.isEllipse;

    this._refreshBe();

    //console.log("added to canvas", vect);

    return vect;
  }

}