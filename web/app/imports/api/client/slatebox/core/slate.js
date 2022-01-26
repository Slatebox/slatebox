import uniq from 'lodash.uniq';
import merge from 'deepmerge';
import utils from '../helpers/utils.js';
import getTransformedPath from '../helpers/getTransformedPath';
import canvas from '../slate/canvas.js';
import collab from '../slate/collab.js';
import nodeController from '../slate/nodeController.js';
import multiSelection from '../slate/multiSelection.js';
import birdsEye from '../slate/birdsEye.js';
import inertia from '../slate/inertia.js';
import controller from '../slate/controller.js';
import zoomSlider from '../slate/zoomSlider.js';
import undoRedo from '../slate/undoRedo.js';
import grid from '../slate/grid.js';
import comments from '../slate/comments.js';
import keyboard from '../slate/keyboard.js';
import filters from '../slate/filters.js';

import base from './base.js';
import node from './node.js';

export default class slate extends base {

  constructor(_options, events, collaboration) {
    super(_options);
    this.options = {
      id: _options.id || utils.guid(),
      container: '',
      instance: '',
      name: '',
      description: '',
      basedOnThemeId: '',
      syncWithTheme: false,
      containerStyle: {
        width: "auto",
        height: "auto",
        backgroundColor: "transparent",
        backgroundImage: "",
        backgroundSize: "",
        backgroundEffect: "",
        backgroundColorAsGradient: false, //linear|radial
        backgroundGradientType: null,
        backgroundGradientColors: [],
        backgroundGradientStrategy: null //shades|palette   
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
        zoom: { w: 50000, h: 50000, r: 1 }
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
      autoEnableDefaultFilters: true
    }
  
    this.options = merge(this.options, _options);
    this.events = events ||  {
      onNodeDragged: null,
      onCanvasClicked: null,
      onImagesRequested: null,
      onRequestSave: null,
      isReadOnly: null
    }

    this.collaboration = collaboration || {
      allow: true,
      localizedOnly: false,
      userIdOverride: null,
      onCollaboration: null
    }

    //console.log("SLATE - share details are", this.options.shareId, this.options.userId, this.options.orgId);
    
    //ensure container is always an object
    if (!utils.isElement(this.options.container)) {
      this.options.container = utils.el(this.options.container);
    }
  
    this.constants = {
      statusPanelAtRest: 33,
      statusPanelExpanded: 200
    }

    this.glows = [];
    this.tips = [];
    this.tempNodeId = utils.guid();
    this.allLines = [];

  }

  init() {
    const self = this;
    //instantiate all the dependencies for the slate -- order here is importantish 
    //(birdsEye, undoRedo, zoomSlider are used in canvas, and inertia uses canvas)
    self.nodes = new nodeController(self);
    self.collab = new collab(self);
    self.birdsEye = new birdsEye(self);
    self.zoomSlider = new zoomSlider(self);
    if (!self.isReadOnly() && !self.isCommentOnly()) {
      self.undoRedo = new undoRedo(self);
      self.multiSelection = new multiSelection(self);
    }
    self.controller = new controller(self);
    self.filters = new filters(self);
    self.canvas = new canvas(self);
    self.canvas.init();
    if (self.multiSelection) {
      self.multiSelection.init();
    }
    self.inertia = new inertia(self);
    self.grid = new grid(self);
    self.comments = new comments(self);
    self.keyboard = new keyboard(self);
    // ["canvas", "collab", "multiSelection"].forEach(c => {
    //   self[c] = (Function(`return new  ${c}(slate)`))();
    // });

    self.autoLoadFilters();

    if (self.options.onInitCompleted) {
      self.options.onInitCompleted.apply(self);
    }

    return self;
  }
  
  url(opt) {
    return this.options.ajax.rootUrl + this.options.ajax.urlFlavor + opt
  }
  
  glow(obj) {
    this.glows.push(obj.glow());
  }
  
  unglow() {
    //console.log("removing glows ", this.glows);
    this.glows.forEach(function (glow) {
      glow.remove();
    });
    this.glows = [];
  }

  addtip(tip) {
    if (tip) this.tips.push(tip);
  }

  untooltip() {
    this.tips.forEach(function (tip) {
      tip && tip.remove();
    });
  }

  toggleFilters(blnHide, nodeId, esc) {
    //hide filters during dragging
    if (this.nodes.allNodes.length > 20) {
      this.nodes.allNodes.forEach(n =>{
        if (!nodeId || n.options.id === nodeId) {
          n.toggleFilters(blnHide);
        }
      });
      this.allLines.filter(l => l.lineEffect).forEach(c => {
        if (blnHide) {
          c.line.attr("filter", "");
        } else {
          c.line.attr("filter", `url(#${c.lineEffect})`);
        }
      });
      if (blnHide) {
        this.canvas.hideBg();
      }
      if (esc) {
        setTimeout(() => {
          this.toggleFilters(!blnHide);
          this.canvas.hideBg(1);
        }, 500);
      }
    }
  }

  removeContextMenus() {
    var _cm = utils.select("div.sb_cm");
    _cm.forEach(function (elem) {
      document.body.removeChild(elem);
    });
  }
  
  remove() {
    this.nodes.allNodes.forEach((node) => {
      node.del();
    });
    this.paper.remove();
    //delete self;
  }
  
  zoom(x, y, w, h, fit) {

    const self = this;
    //const parentDimen = utils.getDimensions(self.options.container);

    // if (!self.origin) {
    //   offsets = { x: self.canvas.windowSize.width/2, y: self.canvas.windowSize.height/2 };
    //   self.origin = `${(self.options.viewPort.left * self.options.viewPort.zoom.r)}px ${(self.options.viewPort.top * self.options.viewPort.zoom.r)}px`;
    // }
    //if (!offsets) {
    //offsets = { x: self.canvas.windowSize.width/2, y: self.canvas.windowSize.height/2 };
    //}
    //window.requestAnimationFrame(() => {
      //* self.options.viewPort.zoom.r
      //const torigin = `${(self.options.viewPort.left) + offsets.x}px ${(self.options.viewPort.top) + offsets.y}px`;
      //console.log("zooming origin", self.origin);
      // self.canvas.internal.style["transform-origin"] = `5000px 5000px`; // `${5000 + parentDimen.width/2}px ${5000 + parentDimen.height/2}px`; // self.origin; // torigin;
      // self.canvas.internal.style.transform = `scale(${self.options.viewPort.zoom.r})`; // = style;
    //});
    this.nodes.closeAllLineOptions();
    //console.log("setting viewbox ", x, y, w, h, fit, self.options.viewPort.zoom);
    this.paper.setViewBox(x, y, w, h, fit);
    // window.clearTimeout(self.zoff);
    // self.zoff = window.setTimeout(() => {
    //   self.origin = null;
    // }, 1000);
  }

  // this.svgDefs = function() {
  //   return ["<defs", this.canvas.rawSVG().split("<defs")[1].split("</defs>")[0], "</defs>"].join("");
  // };

  png(ropts, cb) {
    const self = this;
    console.log("getting png ", ropts);
    self.svg({ useDataImageUrls: true, backgroundOnly: ropts?.backgroundOnly }, (opts) => {
      if (self.events.onCreateImage) {
        self.events.onCreateImage({ svg: opts.svg, orient: opts.orient, type: "png" }, (err, base64) => {
          if (err) {
            console.error("Unable to create png server side", svg, err);
          } else {
            console.log("got base64", base64);
            if (ropts?.base64) {
              cb(base64);
            } else {
              const img = new Image();
              img.src = base64;
              img.onload = function() {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(img, 0, 0);
                let link = document.createElement('a');
                link.setAttribute('download',  `${(self.options.name || "slate").replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${self.options.id}.png`);
                canvas.toBlob(function(blob) {
                  link.href = URL.createObjectURL(blob);
                  let event = new MouseEvent('click');
                  link.dispatchEvent(event);
                  cb && cb();
                });
              }
            }
          }
        })
      } else {
        const canvas = document.createElement("canvas");
        canvas.width = opts.orient.width;
        canvas.height = opts.orient.height;
        const blb = new Blob([opts.svg], {
          type: 'image/svg+xml;charset=utf8'
        });
        const url = URL.createObjectURL(blb);
        if (ropts?.base64) {
          console.log("sending back url", url);
          cb(`url('${url}')`);
        } else {
          const ctx = canvas.getContext("2d");
          const img = document.createElement("img");
          
          //img.setAttribute("src", "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(opts.svg))));
          // let svg = `
          // <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50">
          //    <circle cx="25" cy="25" r="20"/>
          // </svg>`;
          img.src = url;
          //console.log("img src is ", opts.svg);
          img.onload = function () {
            ctx.drawImage(img, 0, 0);
            const imgsrc = canvas.toDataURL("image/png");
            const a = document.createElement("a");
            a.download = `${(self.options.name || "slate").replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${self.options.id}.png`;
            a.href = imgsrc;
            a.click();
            URL.revokeObjectURL(img.src);
            cb && cb();
          }
          img.onerror = function() {
            console.log("error loading image ", arguments);
          }
        }
      }
    });

  }

  copy(opts) {

    const self = this;
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
        showZoom: false
      }).init();
    }
    //_copy.init();

    //known bug: the animation of text in controller methods is not aligning
    //correctly
    const _json = JSON.parse(this.exportJSON());
    _json.nodes.forEach((node) => {
      const _mpkg = opts.moves ? opts.moves.find((m) => { return m.id === node.options.id || m.id === "*"; }) : null;
      if (_mpkg) {
        node.options.xPos += _mpkg.x;
        node.options.yPos += _mpkg.y;
        const _transforms = [`t${_mpkg.x}, ${_mpkg.y}`];
        node.options.vectorPath = getTransformedPath(node.options.vectorPath, _transforms);
      }
    });

    // _jsonSlate, blnPreserve, blnSkipZoom, useMainCanvas = false
    self.copySlate.loadJSON(JSON.stringify(_json));
    self.copySlate.nodes.refreshAllRelationships();

    return self.copySlate;
  }

  svg(opts, cb) {
    const self = this;

    const _nodesToOrient = opts.nodes ? self.nodes.allNodes.filter((n) => { return opts.nodes.indexOf(n.options.id) > -1; }) : null;
    const _orient = self.getOrientation(_nodesToOrient, true);
    const _r = 1; //this.options.viewPort.zoom.r || 1;
    const _resizedSlate = JSON.parse(self.exportJSON());
    if (opts.backgroundOnly) {
      _resizedSlate.nodes = [];
    }
    _resizedSlate.nodes.forEach((n) => {
      const _ty = (n.options.yPos * _r);
      const _tx = (n.options.xPos * _r);
      const _width = n.options.width;
      const _height = n.options.height;
      n.options.yPos = _ty - _orient.top;
      n.options.xPos = _tx - _orient.left;
      n.options.width = _width * _r;
      n.options.height = _height * _r;
      if (n.options.rotate && n.options.rotate.point) {
        n.options.rotate.point.x = (n.options.rotate.point.x * _r) - _orient.left;
        n.options.rotate.point.y = (n.options.rotate.point.y * _r) - _orient.top; //  = { x: n.options.xPos + n.options.width/2, y: n.options.yPos + n.options.height/2 };
      }
      const _updatedPath = utils._transformPath(n.options.vectorPath, ["T", ((_orient.left) / _r) * -1, ",", ((_orient.top) / _r) * -1, "s", ",", _r, ",", _r].join(""));
      n.options.vectorPath = _updatedPath;
    });
    
    const _div = document.createElement("div");
    _div.setAttribute("id", "tempSvgSlate");
    _div.style.width = `${_orient.width}px`;
    _div.style.height = `${_orient.height}px`;
    _div.style.visibility = "hidden";

    document.body.appendChild(_div);

    //const _size = Math.max(_orient.width, _orient.height);

    //arrows are not showing up because this is missing from the new svg --
    //it exists in the Meteor.currentSlate.
    //<path stroke-linecap="round" d="M5,0 0,2.5 5,5 3.5,3 3.5,2z" id="raphael-marker-classic" style="-webkit-tap-highlight-color: #FFEB3B;"></path>
    //Meteor.Slatebox.exportCanvas.nodes.refreshAllRelationships();

    //because raphael only adds the <path (above) when it doesn't already
    //exist and because I modified the raphael.js source on 5964 to accomodate
    //the hiding of these so that they get created on SVG export
    //now the exported SVG should include the previously missing <path element
    
    // ["block", "classic", "oval", "diamond", "open", "none", "wide", "narrow", "long", "short"].forEach((tt) => {
    //   const d = document.getElementById("raphael-marker-" + tt);
    //   if (d) {
    //     d.style.visibility='hidden';
    //   }
    // });

    const exportOptions = merge(_resizedSlate.options, {
      container: "tempSvgSlate",
      containerStyle: { 
        backgroundColor: _resizedSlate.options.containerStyle.backgroundColor,
        backgroundColorAsGradient: _resizedSlate.options.containerStyle.backgroundColorAsGradient, //linear|radial
        backgroundGradientType: _resizedSlate.options.containerStyle.backgroundGradientType,
        backgroundGradientColors: _resizedSlate.options.containerStyle.backgroundGradientColors,
        backgroundGradientStrategy: _resizedSlate.options.containerStyle.backgroundGradientStrategy //shades|palette   
      },
      defaultLineColor: _resizedSlate.options.defaultLineColor,
      viewPort: {
        allowDrag: false,
        originalWidth: _orient.width,
        width: _orient.width,
        height: _orient.height,
        left: 0,
        top: 0,
        zoom: { w: _orient.width * 1.5, h: _orient.height * 1.5 },
        showGrid: false
      },
      name: _resizedSlate.options.name,
      description: _resizedSlate.options.description,
      showbirdsEye: false,
      showMultiSelect: false,
      showUndoRedo: false,
      showZoom: false,
      showLocks: false,
      isEmbedding: true
    });

    //we don't yet load the nodes by default even though they're passed in on the options below...
    const _exportCanvas = new slate(exportOptions).init();
    
    //...that's done in the loadJSON...which seems weird
    _exportCanvas.loadJSON(JSON.stringify({ options: exportOptions, nodes: _resizedSlate.nodes }), false, true);
    //events don't serialize, so add them explicitly
    _exportCanvas.events = self.events;
    _exportCanvas.nodes.refreshAllRelationships();
    
    //add the bgColor (this is done on html styling in slatebox proper view)
    let bg = null;
    if (_resizedSlate.options.containerStyle.backgroundImage) {
      const img = document.createElement("img");
      img.setAttribute("src", _resizedSlate.options.containerStyle.backgroundImage);
      img.style.visibility = "hidden";
      document.body.appendChild(img);
      let bw = img.naturalWidth;
      let bh = img.naturalHeight;
      if (self.options.containerStyle.backgroundSize === "cover") {
        const ratio = self.canvas.internal.parentElement.offsetWidth/bw;
        bw = bw * ratio;
        bh = bh * ratio;
      } else { 
        //TODO: handle repeat by calcing how many paper.images should be added to an array of [bg] and then simulate the repeat effect
        //need to see if _orient.width > bw and if so, add another horizontally, and if _orient.height > bh, then add another by the multiple vertically as well
      }
      img.remove();
      let iw = Math.max(bw, _orient.width);
      let ih = Math.max(bh, _orient.height);
      console.log("setting iw ", _resizedSlate.options.containerStyle.backgroundSize, bw, iw, _orient.width);
      bg = _exportCanvas.paper.image(_resizedSlate.options.containerStyle.backgroundImage, 0, 0, iw, ih);
      
    } else {
      bg = _exportCanvas.paper.rect(0, 0, _orient.width, _orient.height).attr({ fill: _resizedSlate.options.containerStyle.backgroundColor, stroke: "none" })
    }
    bg.toBack();

    //the timeout is critical to ensure that the SVG canvas settles
    //and the url-fill images appear.
    setTimeout(async function () {
      _exportCanvas.canvas.rawSVG((svg) => {
        cb({ svg: svg, orient: _orient });
        _div.remove();
        //show these, which were missing due to the above logic re the 
        //arrows on the exported slate.
        // ["block", "classic", "oval", "diamond", "open", "none", "wide", "narrow", "long", "short"].forEach((tt) => {
        //   const d = document.getElementById("raphael-marker-" + tt);
        //   if (d) {
        //     d.style.visibility='visible';
        //   }
        // });
      });
    }, 100);
  }

  // this.setSize = function (w, h) {
  //     this.paper.setSize(w, h);
  // };

  autoLoadFilters() {
    const self = this;
    //if auto filter is on, then these filters become immediately availalbe in their default form
    if (self.options.autoEnableDefaultFilters && self.filters?.availableFilters) {
      Object.keys(self.filters.availableFilters).forEach(type => {
        self.filters.add({
          id: type,
          filters: self.filters.availableFilters[type].filters
        }, true);
        if (self.filters.availableFilters[type].deps) {
          self.filters.addDeps(self.filters.availableFilters[type].deps);
        }
      });
    }
  }

  loadJSON(_jsonSlate, blnPreserve, blnSkipZoom, useMainCanvas = false) {
    const self = this;

    if (blnPreserve === undefined) {
      self.paper && self.paper.clear();
      if (self.nodes) self.nodes.allNodes = [];
    }

    var loadedSlate = JSON.parse(_jsonSlate);
    Object.assign(self.options, loadedSlate.options);
    
    // loadedSlate.options.allowDrag = true;

    self.autoLoadFilters();

    //bgcolor set
    self.canvas?.refreshBackground();

    //grid
    if (self.options.viewPort.showGrid) {
      self.grid?.show();
    } else {
      self.grid?.destroy();
    }

    //zoom
    if (!blnSkipZoom) {
      const val = Math.max(self.options.viewPort.zoom.w, self.options.viewPort.zoom.h);
      self.zoomSlider?.set(val);
      //self.zoom(0, 0, _v, _v, false);
      //self.canvas.resize(_v);
    }

    //sort nodes by their last painted order to honor toBack/toFront
    loadedSlate.nodes.sort((n1, n2) => {
      let i1 = loadedSlate.options.nodeOrder?.findIndex(n => n === n1.options.id);
      let i2 = loadedSlate.options.nodeOrder?.findIndex(n => n === n2.options.id);
      return i1 - i2;
    });

    var deferredRelationships = [];
    // if (!loadedSlate.options.showBirdsEye) {
    //   console.log("** non birdseye - loaded nodes length ",  loadedSlate.nodes.length, _jsonSlate);
    // }
    loadedSlate.nodes.forEach(function (n) {
      n.options.allowDrag = true; //must default
      n.options.allowMenu = true;
      //console.log("allowDrag is set to true");
      var _boundTo = new node(n.options);

      //track down edge case: if node.options.allowDrag = false then node.options.isLocked must always be set to true
      // console.log("looking at node ", node.options.allowDrag, node.options.isLocked);
      // if (!node.options.allowDrag && !node.options.isLocked) {
      //   console.log("setting lock");
      //   node.options.isLocked = true;
      // }

      self.nodes.add(_boundTo, useMainCanvas);
      deferredRelationships.push({ bt: _boundTo, json: n });
    });

    deferredRelationships.forEach(function (relationship) {
      var _bounded = relationship;
      _bounded.bt.addRelationships(_bounded.json);
    });

    if (self.options.showLocks) {
      self.displayLocks();
    }

    //refreshes all relationships
    self.nodes.allNodes.forEach((_node) => {
      _node.relationships.updateAssociationsWith({ activeNode: _node.options.id, currentDx: 0, currentDy: 0 });
    });
    self.nodes.refreshAllRelationships();

    //finally invoke toFront in order
    self.nodes.allNodes.forEach(
      n => n.toFront()
    );

    //always add style tag to the <defs> for font embedding
    self.paper.def({
      tag: "style",
      type: "text/css",
      id: `embeddedSBStyles_${self.options.id}`
    });

    self.paper.def({
      tag: "path",
      id: `raphael-marker-classic`,
      "stroke-linecap": "round",
      d: "M5,0 0,2.5 5,5 3.5,3 3.5,2z"
    });

    //always add the arrow path def
    //<path ="round" d="" id="" style="-webkit-tap-highlight-color: #FFEB3B;"></path>

    //reset disable if previously was disabled
    //if (!_enabled) {
    //    self.disable();
    //}

    //refresh birdsEye
    //self.options.showbirdsEye && self.birdsEye.refresh();

    self.loadAllFonts();
    if (!blnSkipZoom) {
      self.controller.centerOnNodes({ dur: 0 });
    }

    // if (self.isCommentOnly() && self.options.showbirdsEye) {
    //   self.comments.engage();
    // }
    
  }

  loadAllFonts() {
    //load all fonts
    const fonts = uniq(this.nodes.allNodes.map((n) => { return n.options.fontFamily })).join("|");
    if (document.getElementById("googleFonts")) {
      document.getElementById('googleFonts').setAttribute("href", `https://fonts.googleapis.com/css?family=${fonts}`);
    } else {
      const sc = document.createElement("link");
      sc.setAttribute("src", "https://fonts.googleapis.com/css?family=${fonts}");
      sc.setAttribute("id", "googleFonts"); 
      sc.setAttribute("rel", "stylesheet"); 
      sc.setAttribute("type", "text/css"); 
      document.head.appendChild(sc);
    }
  }

  displayLocks() {
    this.nodes.allNodes.forEach(function (node) {
      node.initLock();
    });
  }

  hideLocks() {
    this.nodes.allNodes.forEach(function (node) {
      node.hideLock();
    });
  }

  isReadOnly() {
    return (!this.events.isReadOnly || (this.events.isReadOnly && this.events.isReadOnly()));
  }

  isCommentOnly() {
    return (!this.events.isCommentOnly || (this.events.isCommentOnly && this.events.isCommentOnly()));
  }

  canRemoveComments() {
    return (!this.events.canRemoveComments || (this.events.canRemoveComments && this.events.canRemoveComments()));
  }

  //the granularity is at the level of the node...
  exportDifference(compare, lineWidthOverride) {
    var _difOpts = Object.assign({}, this.options);
    // var _pc = _difOpts.collaboration.panelContainer;
    // var _cc = _difOpts.collaboration.callbacks;
    // delete _difOpts.collaboration.panelContainer;
    // delete _difOpts.collaboration.callbacks;
    delete _difOpts.container;
    // delete _difOpts.events;

    //birdsEye specific -- if this is not here, then locks
    //show up on the birdsEye
    _difOpts.showLocks = compare.options.showLocks;

    var jsonSlate = { options: JSON.parse(JSON.stringify(_difOpts)), nodes: [] };
    let tnid = this.tempNodeId;
    this.nodes.allNodes.forEach(function (node) {
      var _exists = false;
      var pn = node;
      if (pn.options.id !== tnid) {
        compare.nodes.allNodes.forEach(function (nodeInner) {
          if (nodeInner.options.id === pn.options.id) {
            _exists = true;
            return;
          }
        });
        if (!_exists) {
          jsonSlate.nodes.push(pn.serialize(lineWidthOverride));
        }
      }
    });

    // _difOpts.collaboration.panelContainer = _pc;
    // _difOpts.collaboration.callbacks = _cc;

    return JSON.stringify(jsonSlate);
  }

  exportJSON() {
    const _cont = this.options.container;
    const _pcont = this.collaboration.panelContainer || null;
    const _callbacks = this.collaboration.callbacks || null;
    const _opts = this.options;
    delete _opts.container;

    const jsonSlate = { options: JSON.parse(JSON.stringify(_opts)), nodes: [] };
    this.options.container = _cont;
    this.collaboration.panelContainer = _pcont;
    this.collaboration.callbacks = _callbacks;

    delete jsonSlate.options.ajax;
    delete jsonSlate.options.container;

    let tnid = this.tempNodeId;
    this.nodes.allNodes.forEach(function (node) {
      if (node.options.id !== tnid) {
        jsonSlate.nodes.push(node.serialize());
      }
    });

    jsonSlate.shareId = this.shareId;

    return JSON.stringify(jsonSlate);
  }

  snapshot() {
    var _snap = JSON.parse(this.exportJSON());
    _snap.nodes.allNodes = _snap.nodes;
    return _snap;
  }

  getOrientation(_nodesToOrient, _alwaysOne) {

    var orient = 'landscape',
      sWidth = this.options.viewPort.width,
      sHeight = this.options.viewPort.height;
    var bb = new Array();
    bb['left'] = 99999;
    bb['right'] = 0;
    bb['top'] = 99999;
    bb['bottom'] = 0;

    var an = _nodesToOrient || this.nodes.allNodes;
    if (an.length > 0) {
      for (var _px = 0; _px < an.length; _px++) {
        //var sb = allNodes[_px].b.split(' ');
        var sbw = 10;
        //if (!isNaN(sb[0].replace('px', ''))) sbw = parseInt(sb[0].replace('px', ''));
        var _bb = an[_px].vect.getBBox();

        //var x = _bb.x + ((_bb.x / this.options.viewPort.zoom.r) - _bb.x);
        var _r = _alwaysOne ? 1 : this.options.viewPort.zoom.r || 1;
        var x = _bb.x * _r;
        var y = _bb.y * _r;
        var w = _bb.width * _r;
        var h = _bb.height * _r;

        /*
        var x = _bb.x;
        var y = _bb.y;
        var w = _bb.width;
        var h = _bb.height;
        */

        bb['left'] = Math.abs(Math.min(bb['left'], x - sbw));
        bb['right'] = Math.abs(Math.max(bb['right'], x + w + sbw));
        bb['top'] = Math.abs(Math.min(bb['top'], y - sbw));
        bb['bottom'] = Math.abs(Math.max(bb['bottom'], y + h + sbw));
      }

      var sWidth = bb['right'] - bb['left'];
      var sHeight = bb['bottom'] - bb['top'];

      if (sHeight > sWidth) {
        orient = 'portrait';
      }
    }
    return { orientation: orient, height: sHeight, width: sWidth, left: bb['left'], top: bb['top'] };
  }

  resize(_size, dur, pad) {
    var _p = (pad || 0);
    if (_p < 6) _p = 6;
    _size = _size - ((_p * 2) || 0);
    var orx = this.getOrientation();
    var wp = (orx.width / _size) * this.options.viewPort.width;
    var hp = (orx.height / _size) * this.options.viewPort.height;
    var sp = Math.max(wp, hp);

    var _r = Math.max(this.options.viewPort.width, this.options.viewPort.height) / sp;
    var l = orx.left * _r - _p;
    var t = orx.top * _r - _p;

    zoom(0, 0, sp, sp, true);
    this.options.viewPort.zoom = { w: sp, h: sp, l: parseInt(l * -1), t: parseInt(t * -1), r: this.options.viewPort.originalWidth / sp };
    this.canvas.move({ x: l, y: t, dur: dur, isAbsolute: true });
  }

  // stopEditing() {
  //   this.nodes.allNodes.forEach(function (node) {
  //     node.links && node.links.end();
  //     node.customShapes && node.customShapes.end();
  //   });
  // };

  disable(exemptSlate, exemptNodes) {
    if (!exemptNodes) {
      this.nodes.allNodes.forEach(function (node) {
        node.disable();
      });
    }

    if (!exemptSlate) {
      this.options.enabled = false;
      this.options.allowDrag = false;
    }
  }

  enable(exemptSlate, exemptNodes) {
    if (!exemptNodes) {
      this.nodes.allNodes.forEach(function (node) {
        !node.options.isLocked && node.enable();
      });
    }
    if (!exemptSlate) {
      this.options.enabled = true;
      this.options.allowDrag = true;
    }
  }

  reorderNodes() {
    //these ids will come out in the order that they are painted on the screen - toFront and toBack adjusts this, so we need
    //to always keep this hand so that when the slate is reloaded, it can order the nodes by these ids (which are going to be dif
    //from the saved JSON order of arrays)
    let ids = Array.from(this.canvas.internal.querySelector("svg").querySelectorAll("path")).map(a => a.getAttribute("rel")).filter(r => !!r);
    //console.log("order of nodes", ids);
    this.options.nodeOrder = ids;
  }

  findChildren(nodeIds, allChildren = []) {
    const self = this;
    // get his node's children - then recursively call findChildren on that node
    let nodes = self.nodes.allNodes.filter(n => nodeIds.includes(n.options.id));
    // console.log("got nodes", nodes.length);
    allChildren = allChildren.concat(nodes.map(n => n.options.id));
    let children = [];
    nodes.forEach(n => {
      n.relationships.associations.filter(a => a.parent.options.id === n.options.id).forEach(a => children.push(a.child.options.id));
    });
    // let children = nodes.map(n => n.relationships.associations).flat().filter(a => a.parentId === n.options.id).map(a => a.childId).flat();
    //console.log("got children", children, allChildren);
    if (children.length) {
      return self.findChildren(children, allChildren);
    } else {
      return allChildren;
    }
  }

  applyTheme(theme, syncWithTheme, revertTheme) {
    const self = this;
    if (!revertTheme) {
      self.options.basedOnThemeId = theme._id;
      self.options.syncWithTheme = syncWithTheme;
    } else {
      self.options.basedOnThemeId = null; 
      self.options.syncWithTheme  = null;
    }
    const nodeStyle = {};
    const currentNodesByColor = {};
    let totChildren = [];

    //first apply slate
    
    if (theme.containerStyle.backgroundImage) {
      self.collab.invoke({ type: "onSlateBackgroundImageChanged", data: { bg: { size: theme.containerStyle.backgroundSize, url: theme.containerStyle.backgroundImage } } });
    } else if (theme.containerStyle.backgroundEffect) {
      self.collab.invoke({ type: "onSlateBackgroundEffectChanged", data: { effect: theme.containerStyle.backgroundEffect } });
    } else {
      self.collab.invoke({ type: "onSlateBackgroundColorChanged", data: { 
        color: theme.containerStyle.backgroundColor,
        asGradient: theme.containerStyle.backgroundColorAsGradient,
        gradientType: theme.containerStyle.backgroundGradientType,
        gradientColors: theme.containerStyle.backgroundGradientColors,
        gradientStrategy: theme.containerStyle.backgroundGradientStrategy
      } });
    }
    self.collab.invoke({ type: "onLineColorChanged", data: { color: theme.defaultLineColor } });

    function applyStyle(id) {
      let allKeys = Object.keys(theme.styles);
      let lastStyle = theme.styles[allKeys[allKeys.length-1]];
      const base = theme.styles[nodeStyle[id]] || lastStyle;

      // borders
      self.collab.invoke({ type: "onNodeBorderPropertiesChanged", data: { id: id, prop: "borderWidth", val: base.borderWidth } });
      self.collab.invoke({ type: "onNodeBorderPropertiesChanged", data: { id: id, prop: "borderColor", val: base.borderColor } });
      self.collab.invoke({ type: "onNodeBorderPropertiesChanged", data: { id: id, prop: "borderOpacity", val: base.borderOpacity } });
      self.collab.invoke({ type: "onNodeBorderPropertiesChanged", data: { id: id, prop: "borderStyle", val: base.borderStyle } });

      // shape
      if (base.vectorPath && syncWithTheme) {
        // const node = self.nodes.one(id);
        // const sendPath = utils._transformPath(base.vectorPath, `T${node.options.xPos},${node.options.xPos}`);
        // console.log("v s ", base.vectorpath, sendPath);
        self.collab.invoke({ type: "onNodeShapeChanged", data: { id: id, shape: base.vectorPath } });
      }

      // text
      self.collab.invoke({ type: "onNodeTextChanged", data: { id: id, fontSize: base.fontSize, fontFamily: base.fontFamily, fontColor: base.foregroundColor, textOpacity: base.textOpacity } });

      //effects
      self.collab.invoke({ type: "onNodeEffectChanged", data: { id: id, filter: { apply: "text", id: base.filters.text } } });

      // background color
      self.collab.invoke({ type: "onNodeColorChanged", data: { id: id, opacity: base.opacity, color: base.backgroundColor } });

      //effects
      self.collab.invoke({ type: "onNodeEffectChanged", data: { id: id, filter: { apply: "vect", id: base.filters.vect } } });

      // lines
      const node = self.nodes.one(id);
      
      // console.log("node is ", id, node);
      node.relationships.associations.forEach((a, ind) => {
        self.collab.invoke({ type: "onLineColorChanged", data: { id: id, color: base.lineColor } });
        self.collab.invoke({ type: "onLinePropertiesChanged", data: { id: id, prop: "lineOpacity", val: base.lineOpacity, associationId: a.id, index: ind } });
        self.collab.invoke({ type: "onLinePropertiesChanged", data: { id: id, prop: "lineEffect", val: base.lineEffect, associationId: a.id, index: ind } });
        self.collab.invoke({ type: "onLinePropertiesChanged", data: { id: id, prop: "lineWidth", val: base.lineWidth, associationId: a.id, index: ind } });
      });
    }
    
    self.nodes.allNodes.forEach((node) => {
      if (self.options.mindMapMode || syncWithTheme) {
        const children = self.findChildren([node.options.id]);
        totChildren.push(children);
      } else {
        if (!currentNodesByColor[node.options.backgroundColor]) {
          currentNodesByColor[node.options.backgroundColor] = [];
        }
        currentNodesByColor[node.options.backgroundColor].push(node.options.id);
      }
    });
    
    if (self.options.mindMapMode || syncWithTheme) {
      totChildren.sort((a,b) => a.length - b.length);
      totChildren.forEach(t => {
        t.forEach((n, ind) => {
          nodeStyle[n] = ind === 0 ? `parent` : `child_${ind}`;
        });
      });
    } else {
      const colorsByUsage = Object.keys(currentNodesByColor).sort((a,b) => {
        return currentNodesByColor[b].length - currentNodesByColor[a].length
      });
      let styleIndex = -1;
      colorsByUsage.forEach((c, index) => {
        if (Object.keys(theme.styles).length < index) {
          styleIndex = -1;
        }
        styleIndex++;
        currentNodesByColor[c].forEach((id, index) => {
          nodeStyle[id] = styleIndex === 0 ? `parent` : `child_${styleIndex}`;
        });
      });
    }

    Object.keys(nodeStyle).forEach((id) => {
      applyStyle(id);
    });
    
  }
  
}