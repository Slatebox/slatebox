import utils from "../helpers/utils";
import { Raphael } from '../deps/raphael/raphael.svg.js'

export default class undoRedo {

  constructor(slate) {
    this.slate = slate;
    this.stateSlate = null;
    this.actions = []
    this.actionIndex = -1
    this.toolbar = [];
  }

  setVisibility() { //TODO: private method#
    toolbar[0].data({ disabled: false });
    toolbar[1].data({ disabled: false });

    if (!this.actions[this.actionIndex - 1]) {
      toolbar[0].attr({ "fill-opacity": "0.3" });
      toolbar[0].data({ disabled: true })
    } else {
      toolbar[0].attr({ "fill-opacity": "1.0" });
    }

    if (!this.actions[this.actionIndex + 1]) {
      toolbar[1].attr({ "fill-opacity": "0.3" });
      toolbar[1].data({ disabled: true })
    } else {
      toolbar[1].attr({ "fill-opacity": "1.0" });
    }
  };

  run() { //TODO: private method#
    var _state = this.actions[this.actionIndex];
    this.slate.loadJSON(_state);
    this.slate.birdsEye && this.slate.birdsEye.reload(_state);
    var _pkg = { type: "onSaveRequested" };
    this.slate.collaboration.onCollaboration && this.slate.collaboration.onCollaboration({ type: "custom", slate: this.slate, pkg: _pkg });
    //var _pkg = { type: "onJSONChanged", data: { json: _state } };
    //this.slate.collab && this.slate.collab.send(_pkg);
    //this.slate.collab.invoke(pkg);
    //console.log("running ", pkg);
    //pkg && this.slate.collab && this.slate.collab.send(pkg);
  };

  undo() {
    if (this.actions[this.actionIndex - 1]) {
      this.actionIndex--;
      this.setVisibility();
      this.run();
    } else {
      this.setVisibility();
    }
  };

  redo() {
    if (this.actions[this.actionIndex + 1]) {
      this.actionIndex++;
      this.setVisibility();
      this.run();
    } else {
      this.setVisibility();
    }
  };

  hide() {
    if (utils.el("slateUndoRedo") !== null) {
      try {
        this.slate.options.container.removeChild(utils.el("slateUndoRedo"));
      } catch (err) {
      }
    }
  };

  show(_options) {
    const self = this;

    self.hide();

    var options = {
      height: 80
      , width: 130
      , offset: { left: 10, top: 8 }
    };

    Object.assign(options, _options);

    var c = self.slate.options.container;
    var scx = document.createElement('div');
    scx.setAttribute("id", "slateUndoRedo");
    scx.style.position = "absolute";
    scx.style.height = options.height + "px";
    scx.style.width = options.width + "px";
    scx.style.left = options.offset.left + "px";
    scx.style.top = options.offset.top + "px";
    c.appendChild(scx);

    var x = options.offset.left;
    var y = options.offset.top + 30;

    options.paper = Raphael("slateUndoRedo", options.width, options.height);

    toolbar = [
      options.paper.undo().data({ msg: 'Undo', width: 50, height: 22 }).attr({ fill: "#fff", "cursor": "pointer" }).attr({ "fill": "#333", "stroke": "#fff" }).transform(["t", x, ",", y, "s", "1.5", "1.5"].join())
      , options.paper.redo().data({ msg: 'Redo', width: 50, height: 22 }).attr({ fill: "#fff", "cursor": "pointer" }).attr({ "fill": "#333", "stroke": "#fff" }).transform(["t", x + 50, ",", y, "s", "-1.5", "1.5"].join())
    ];

    toolbar.forEach(function (toolbarElem) {
      toolbarElem.mouseover(function (e) {
        utils.stopEvent(e);
        self.slate.multiSelection && self.slate.multiSelection.hide();
        //$(e.target).style.cursor = "pointer";
        if (!this.data("disabled")) {
          self.slate.glow(this);
          var _text = this.data("msg");
          self.slate.addtip(this.tooltip({ type: 'text', msg: _text }, this.data("width"), this.data("height")));
        }
      });
      toolbarElem.mouseout(function (e) {
        utils.stopEvent(e);
        self.slate.multiSelection && self.slate.multiSelection.show();
        self.slate.unglow();
        this.untooltip();
      });
    });

    toolbar[0].mousedown(function (e) {
      utils.stopEvent(e);
      self.slate.unglow();
      if (!this.data("disabled")) {
        self.undo();
      }
    });

    toolbar[1].mousedown(function (e) {
      utils.stopEvent(e);
      self.slate.unglow();
      if (!this.data("disabled")) {
        self.redo();
      }
    });

    // var _state = document.createElement('div');
    // _state.setAttribute("id", "slateState_" + this.slate.options.id);
    // _state.style.display = "none";
    // c.appendChild(_state);

    //add stateHolder
    // _stateSlate = utils.instance.slate({
    //     container: utils.el("slateState_" + this.slate.options.id)
    //     , viewPort: { allowDrag: false }
    //     , collaboration: { allow: false }
    //     , showZoom: false
    //     , showUndoRedo: false
    //     , showMultiSelect: false
    //     , showbirdsEye: false
    //     , imageFolder: ''
    // }).init();

    //set the buttons both to be disabled
    self.setVisibility();

    //register the initial state
    setTimeout(function () {
      self.snap(true);
    }, 500);
    //actions.splice(actionIndex, 0, this.slate.exportJSON());
    //actionIndex++;
  };

  snap(init) {
    const self = this;
    self.actionIndex++;
    if (self.actionIndex !== self.actions.length) {
      //work has bene performed, so abandon the forked record
      self.actions.splice(self.actionIndex);
    }
    const exp = self.slate.exportJSON();
    self.actions.push(exp);
    clearTimeout(self.saveSnapshot);
    self.saveSnapshot = setTimeout(async () => {
      if (self.slate.events.onTakeSnapshot) { 
        await self.slate.events.onTakeSnapshot({ slateId: self.slate.options.id, snapshot: exp });
      }
    }, 3000); //once the slate settles for 3 secs, take a snapshot
    //actions.splice(self.actionIndex, 0, self.slate.exportJSON());
    !init && self.setVisibility();
  }
}