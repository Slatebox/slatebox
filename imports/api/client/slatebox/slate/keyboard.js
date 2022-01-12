import utils from '../helpers/utils.js';

export default class keyboard {

  constructor(slate) {
    const self = this;
    self.slate = slate;
    utils.addEvent(document, "keydown", self.globalDown.bind(self));
    utils.addEvent(document, "keyup", self.globalUp.bind(self));
  }

  // start(hoverNode) {
  //   const self = this;
  //   self.hoverNode = hoverNode;
  //   utils.addEvent(document, "keydown", self.press.bind(self));
  // }

  // press(e) {
  //   const self = this;
  //   var key = utils.getKey(e);
  //   if (self.hoverNode) {
  //     self.hoverNode.context && self.hoverNode.context.remove();
  //     switch (key) {
  //       case 39: //left
  //         self.hoverNode.connectors.addNode(true);
  //         break;
  //       case 8:
  //       case 46: //delete
  //         //self.hoverNode.toolbar.del();
  //         break;
  //     }
  //     return utils.stopEvent(e);
  //   } else if (self.slate.multiSelection && self.slate.multiSelection.isSelecting()) {
  //     switch (key) {
  //       case 8:
  //       case 46: //delete
  //         self.slate.multiSelection.del();
  //         break;
  //     }
  //   }
  // }

  // end() {
  //   const self = this;
  //   self.hoverNode = null;
  //   if (!self.slate.multiSelection.isSelecting()) {
  //     utils.removeEvent(document, "keydown", self.press);
  //   }
  // }


  key(e, isKeyDown) {
    const self = this;
    const node = self.slate.nodes.allNodes.find(n => n.menu.isOpen());
    const isMultiSelect = self.slate.multiSelection && self.slate.multiSelection.isSelecting();
    const key = utils.getKey(e);
    switch (key) {
      case 91:
      case 17: //ctrl
        self.slate.isCtrl = isKeyDown;
        break;
      case 16: //shift
        self.slate.isShift = isKeyDown;
        break;
      case 18: //alt
        self.slate.isAlt = isKeyDown;
        break;
    }
    if (node) {
      /*
        const getAssocs = self.slate.nodes.getRelevantAssociationsWith([node]);
        const pkg = {
          type: "onNodesMove",
          data: self.slate.nodes.nodeMovePackage({ 
            dur: 0,
            moves: [{
              id: node.options.id
              , x: 5
              , y: 0
            }], 
            relationships: getAssocs.relationshipsToTranslate
          })
        }
        console.log("invoking collab pkg", pkg);
        self.slate.nodes.moveNodes(pkg.data, { animate: false });
        self.slate.collab && self.slate.collab.send(pkg);
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        node.menu.show();
        const mPkg = { 
          
        };
        self.slate.nodes.moveNodes(pkg, { animate: true });
        self.slate.nodes.nodeMovePackage(mPkg);
      */
      switch (key) {
        case 37:
        case 38:
        case 39:
        case 40: { // left
          let span = 2;
          if (self.slate.options.viewPort.zoom.r >= 1) {
            span = 1;
          } else if (self.slate.options.viewPort.zoom.r <= .5) {
            span = 5;
          }
          if (isKeyDown) {
            node.relationships._initDrag(self, e);
            if (key === 37) { //left
              node.relationships.enactMove(-span, 0, true);
            } else if (key === 38) { //up
              node.relationships.enactMove(0, -span, true);
            } else if (key === 39) { // right
              if (self.slate.isCtrl) {
                node.connectors.addNode(true);
              } else {
                node.relationships.enactMove(span, 0, true);
              }
            } else if (key === 40) { //down
              node.relationships.enactMove(0, span, true);
            }
            node.relationships.showMenu();
          } else {
            node.relationships.finishDrag(true);
          }
          break;
        }
      }
    }
    // if (isMultiSelect) {
    //   switch (key) {
    //     case 8:
    //     case 46: //delete
    //       self.slate.multiSelection.del();
    //       break;
    //     case 17: //ctrl
    //     case 91: //command
    //       break;
    //   }
    // }
  }

  globalDown (e) {
    this.key(e, true);
  }
  
  globalUp (e) {
    this.key(e, false);
  }
}