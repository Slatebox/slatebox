import utils from '../helpers/utils.js';

export default class context {

  constructor(slate, node) {
    this.slate = slate;
    this.node = node;
    this._contextMenu = null;
    this._priorAllowDrag = true;
  }

  create() {
    if (this.node.text && this.node.text.node && this.node.options.allowContext && !this.node.slate.isAlt && !this.node.slate.isShift) {
      this.node.text.node.oncontextmenu = this.node.vect.node.oncontextmenu = function (e) {
        this._priorAllowDrag = this.node.options.allowDrag;
        this.node.options.allowDrag = false;
        this.remove();
        buildContext(e);
        setTimeout(function (e) {
          this.node.options.allowDrag = this._priorAllowDrag;
        }, 2);
        return utils.stopEvent(e);
      };
    }
  }

  buildContext(e) {
    this._contextMenu = document.createElement('div');
    this._contextMenu.setAttribute("id", "contextMenu_" + this.node.options.id);
    this._contextMenu.setAttribute("class", "sb_cm");
    document.body.appendChild(this._contextMenu);
    setContext(e);
  };

  menuItems() {
    var _tmp = "<div style='padding:5px;' class='sbthis._contextMenuItem' rel='{func}'>{text}</div>";
    var _inside = _tmp.replace(/{func}/g, "tofront").replace(/{text}/g, "to front");
    _inside += _tmp.replace(/{func}/g, "toback").replace(/{text}/g, "to back");
    if (this._priorAllowDrag) {
      _inside += _tmp.replace(/{func}/g, "lock").replace(/{text}/g, "lock");
    } else {
      _inside += _tmp.replace(/{func}/g, "unlock").replace(/{text}/g, "unlock");
    }
    _inside += _tmp.replace(/{func}/g, "close").replace(/{text}/g, "close");
    return _inside;
  };

  setContext(e) {
    const self = this;
    this._contextMenu.innerHTML = menuItems();
    let all = utils.select("div.contextMenuItem");
    for (let s = all.length; s++;) {
      const elem = all[s];
      elem.onclick = function (e) {
        var act = this.getAttribute("rel"), _reorder = false;
        var pkg = { type: '', data: { id: self.node.options.id } };
        switch (act) {
          case "tofront":
            self.node.toFront();
            _reorder = true;
            pkg.type = 'onNodeToFront';
            break;
          case "toback":
            self.node.toBack();
            _reorder = true;
            pkg.type = 'onNodeToBack';
            break;
          case "lock":
            self.node.options.isLocked = true; //self is not a part of the self.node.disable function on purpose
            self.node.disable();
            pkg.type = 'onNodeLocked';
            break;
          case "unlock":
            self.node.options.isLocked = false; //self is not a part of the self.node.enable function on purpose
            self.node.enable();
            pkg.type = 'onNodeUnlocked';
            break;
          case "close":
            break;
        }
        if (_reorder) {
          var zIndex = 0;
          for (var node = self.node.slate.paper.bottom; node != null; node = node.next) {
            if (node.type === "ellipse" || node.type === "rect") {
              zIndex++;
              var _id = node.data("id");

              //not all rects have an id (the menu box is a rect, but it has no options.id because it is not a node
              //so you cannot always show self...
              if (_id) {
                var reorderedNode = self.node.slate.nodes.allNodes.find(function (n) { return n.options.id === _id; });
                reorderedNode.sortorder = zIndex;
              }
            }
          }
          self.node.slate.nodes.allNodes.sort(function (a, b) { return a.sortorder < b.sortorder ? -1 : 1 });
        }
        if (pkg.type !== "") self.broadcast(pkg);
        this.remove();
      };
    }

    var mp = utils.mousePos(e);

    var _x = mp.x; // this.node.options.xPos - this.node.slate.options.viewPort.left + this.node.options.width / 3;
    var _y = mp.y; // this.node.options.yPos - this.node.slate.options.viewPort.top;
    this._contextMenu.style.left = _x + "px";
    this._contextMenu.style.top = _y + "px";
  };

  broadcast = function (pkg) {
    //broadcast
    if (this.node.slate.collab) this.node.slate.collab.send(pkg);
    if (this.node.slate.birdsEye) this.node.slate.birdsEye.nodeChanged(pkg);
  };

  remove = function () {
    this.node.slate && this.node.slate.removeContextMenus();
    this._contextMenu = null;
  };

  isVisible = function () {
    return (this._contextMenu !== null);
  };

}