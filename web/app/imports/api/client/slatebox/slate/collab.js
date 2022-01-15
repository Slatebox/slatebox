import utils from "../helpers/utils";
import omit from "lodash.omit";
import node from "../core/node";

export default class collab {
  
  constructor(slate) {
    this.slate = slate;
    this.invoker = null;
    this.pc = slate.collaboration || {};
    if (!utils.localRecipients) {
      utils.localRecipients = [];
    }
    this._wire();
  }

  exe(pkg) {
    const self = this;
    self.invoke(pkg);
    self.send(pkg);
  }

  _wire() {

    const self = this;

    function resetMultiSelect() {
      self.slate.multiSelection && self.slate.multiSelection.end();
    }

    self.invoker = {

      onZoom: function(pkg) {
        resetMultiSelect();
        const zoomPercent = (self.slate.options.viewPort.originalWidth / pkg.data.zoomLevel) * 100;
        self.slate.canvas.zoom({
          dur: pkg.data.duration || 500,
          zoomPercent: zoomPercent,
          callbacks: {
            during: function(percentComplete, easing) {
              //additional calcs
            },
            after: function(zoomVal) {
              self.addMessage(pkg, 'That was me\n zooming the canvas!');
            }
          }
        });
      },

      onNodePositioned: function(pkg) {
        resetMultiSelect();
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.position(pkg.data.location, function() {}, pkg.data.easing, pkg.data.duration || 500);
        self.addMessage(pkg, 'That was me\n positioning the node!');
        self.closeNodeSpecifics(pkg);
      },

      onNodeLinkRemoved: function(pkg) {
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.links && cn.links.unset();
        self.addMessage(pkg, 'That was me\n removing the link!');
        self.closeNodeSpecifics(pkg);
      },

      onNodeLinkAdded: function(pkg) {
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.links && cn.links.set(pkg.data.linkType, pkg.data.linkData);
        self.addMessage(pkg, 'That was me\n adding the resource link!');
        self.closeNodeSpecifics(pkg);
      },

      onNodeUnlocked: function(pkg) {
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.options.allowDrag = true;
        cn.options.isLocked = false;
        cn.hideLock();
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.addMessage(pkg, 'That was me\n unlocking the node!');
        self.closeNodeSpecifics(pkg);
      },

      onNodeLocked: function(pkg) {
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.options.allowDrag = false;
        cn.options.isLocked = true;
        cn.showLock();
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.addMessage(pkg, 'That was me\n locking the node!');
        self.closeNodeSpecifics(pkg);
      },

      onNodeBehaviorChanged: function(pkg) {
        const cn = self.slate.nodes.one(pkg.data.id);
        pkg.data.behaviorChanges.forEach(b => {
          cn.options[b.name] = b.value;
        });
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.addMessage(pkg, 'That was me\n changing the node behavior!');
        self.closeNodeSpecifics(pkg);
      },

      onNodeToBack: function(pkg) {
        resetMultiSelect();
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.toBack();
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.addMessage(pkg, 'That was me\n send to back!');
      },

      onNodeToFront: function(pkg) {
        resetMultiSelect();
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.toFront();
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.addMessage(pkg, 'That was me\n bringing to front!');
      },

      onNodeShapeChanged: function(pkg) {
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.shapes.set(pkg.data);
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.addMessage(pkg, 'That was me\n changing the shape!');
        self.closeNodeSpecifics(pkg);
      },

      onNodeAdded: function(pkg) {
        resetMultiSelect();
        var blnPreserve = (pkg.preserve !== undefined) ? pkg.preserve : true;
        self.slate.loadJSON(pkg.data, blnPreserve, true);
        //self.slate.birdsEye && self.slate.birdsEye.refresh();
        self.addMessage(pkg, 'That was me\n adding the node!');
      },

      onNodeImageChanged: function(pkg) {
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.images.set(pkg.data.img, pkg.data.w, pkg.data.h);
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.addMessage(pkg, 'That was me\n changing the image!');
        self.closeNodeSpecifics(pkg);
      },

      onNodeDeleted: function(pkg) {
        resetMultiSelect();
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.del()
        self.slate.birdsEye && self.slate.birdsEye.nodeDeleted(pkg);
        self.addMessage(pkg, 'That was me\n deleting the node!');
      },

      onNodeResized: function(pkg) {
        resetMultiSelect();
        self.slate.toggleFilters(true, null, true);
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.hideOwnMenus();
        const opts = {
          associations: pkg.data.associations,
          animate: true
        };

        Object.assign(cn.options, omit(pkg.data, ["associations", "textPosition"]));
        cn.resize.animateSet(pkg.data, opts);
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.addMessage(pkg, 'That was me\n changing the size!');

        self.closeNodeSpecifics(pkg);
      },

      onNodeRotated: function(pkg) {
        resetMultiSelect();
        self.slate.toggleFilters(true, null, true);
        const cn = self.slate.nodes.one(pkg.data.id);
        //needs to be updated
        cn.options.textOffset = pkg.data.textOffset;

        cn.hideOwnMenus();
        const previousRotationAngle = cn.options.rotate.rotationAngle;

        const opts = {
          associations: pkg.data.associations,
          animate: true
        };

        Object.assign(cn.options, omit(pkg.data, "associations"));
        cn.rotate.animateSet(Object.assign({}, pkg.data, { rotationAngle: pkg.data.rotate.rotationAngle - previousRotationAngle }), opts);
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.addMessage(pkg, 'That was me\n rotating the node!');

        self.closeNodeSpecifics(pkg);
      },

      onNodeColorChanged: function(pkg) {
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.colorPicker.set(pkg.data);
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.addMessage(pkg, 'That was me\n changing the color!');
      },

      onNodeTextChanged: function(pkg) {
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.editor.set(pkg.data.text, pkg.data.fontSize, pkg.data.fontFamily, pkg.data.fontColor, pkg.data.textOpacity, pkg.data.textXAlign, pkg.data.textYAlign, true);
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.slate.loadAllFonts();
        self.addMessage(pkg, 'That was me\n changing the text!');
      },

      addRelationship: function(pkg) {
        resetMultiSelect();
        self.slate.nodes.addRelationship(pkg.data);
        self.slate.birdsEye && self.slate.birdsEye.relationshipsChanged(pkg);
        self.addMessage(pkg, 'That was me\n adding the relationship!');
      },

      removeRelationship: function(pkg) {
        resetMultiSelect();
        self.slate.nodes.removeRelationship(pkg.data);
        self.slate.birdsEye && self.slate.birdsEye.relationshipsChanged(pkg);
        self.addMessage(pkg, 'That was me\n removing the relationship!');
      },
      //was replaced by onNodesMove, but I will leave this for now in case we want to animate a single node in future
      // onNodeMove: function(pkg) {
      //   const cn = self.slate.nodes.one(pkg.data.id);
      //   cn.move(pkg);
      //   self.addMessage(pkg, 'That was me\n moving the node!');
      // },

      onNodesMove: function(pkg) {
        resetMultiSelect();
        //const cn = self.slate.nodes.one(pkg.data.id);
        // cn.moveNodes(pkg);
        self.slate.toggleFilters(true, null, true);
        self.slate.nodes.moveNodes(pkg, { animate: true });
        self.slate.birdsEye && self.slate.birdsEye.nodeChanged(pkg);
        self.addMessage(pkg, 'That was me\n moving the node!');

        self.closeNodeSpecifics(pkg);

        //unmark all and remove connectors

        //close this nodes menu if it was open
        //self.slate.nodes.closeAllMenus({nodes: selectedNodes});

      },

      onNodeEffectChanged: function(pkg) {
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.applyFilters(pkg.data.filter);
      },

      onNodeBorderPropertiesChanged: function(pkg) {
        const cn = self.slate.nodes.one(pkg.data.id);
        cn.applyBorder(pkg.data);
      },

      onLinePropertiesChanged: function(pkg) {
        self.slate.toggleFilters(true, null, true);
        if (!pkg.data.forEach) pkg.data = [pkg.data];
        pkg.data.forEach((p) => {
          const cn = self.slate.nodes.one(p.id);
          Object.assign(cn.options, p.options);
          cn.lineOptions.set(p);
        });
      },

      onCanvasMove: function(pkg) {
        //will start ignoring this for collab sake
        self.slate.toggleFilters(true, null, true);
        var opts = {
          x: pkg.data.left,
          y: pkg.data.top,
          dur: pkg.data.duration || 500,
          callback: {
            after: function() {
              self.slate.birdsEye && self.slate.birdsEye.refresh(true);
            }
          },
          isAbsolute: pkg.isRelative ? false : true
        };
        self.slate.canvas.move(opts);
        // self.addMessage(pkg, 'That was me\n moving the canvas!');
      },

      onSlateThemeChanged: function(pkg) {
        self.slate.options.themeId = pkg.data?.theme?._id;
        if (pkg.data?.theme) {
          self.slate.applyTheme(pkg.data.theme, pkg.data.syncWithTheme, pkg.data.revertTheme);
        }
        // self.slate.png({ backgroundOnly: true, base64: true }, (base64) => {
        //   self.slate.canvas.internal.style.background = base64;
        //   self.slate.canvas._bg?.remove();
        // });
      },

      onSlateBackgroundEffectChanged: function(pkg) {
        self.slate.options.containerStyle.backgroundEffect = pkg.data.effect;
				self.slate.canvas.hideBg(1);
        // self.slate.png({ backgroundOnly: true, base64: true }, (base64) => {
        //   self.slate.canvas.internal.style.background = base64;
        //   self.slate.canvas._bg?.remove();
        // });
      },

      onSlateBackgroundImageChanged: function(pkg) {
        console.log("pkg bg changed", pkg);
        if (pkg.data.bg) {
          self.slate.options.containerStyle.backgroundImage = pkg.data.bg.url;
          self.slate.options.containerStyle.backgroundSize = pkg.data.bg.size;
        } else {
          let c = self.slate.options.containerStyle.prevBackgroundColor | "#fff";
          self.slate.options.containerStyle.backgroundColor = c;
          self.slate.options.containerStyle.backgroundImage = null;
          self.slate.options.containerStyle.backgroundEffect = null;
        }
				self.slate.canvas.hideBg(1);
        // self.slate.png({ backgroundOnly: true, base64: true }, (base64) => {
        //   self.slate.canvas.internal.style.background = base64;
        //   self.slate.canvas._bg?.remove();
        // });
      },

      onSlateBackgroundColorChanged: function(pkg) {
        self.slate.options.containerStyle.backgroundColor = pkg.data.color;
        self.slate.options.containerStyle.backgroundColorAsGradient = pkg.data.asGradient;
        self.slate.options.containerStyle.backgroundGradientType = pkg.data.gradientType;
        self.slate.options.containerStyle.backgroundGradientColors = pkg.data.gradientColors;
        self.slate.options.containerStyle.backgroundGradientStrategy = pkg.data.gradientStrategy;
        self.slate.options.containerStyle.backgroundImage = null;
        self.slate.options.containerStyle.backgroundEffect = null;
        self.slate.canvas.hideBg(1);
      },

      onLineColorChanged: function(pkg) {
        self.slate.options.defaultLineColor = pkg.data.color;
        self.slate.nodes.allNodes.forEach((n) => {
          n.options.lineColor = pkg.data.color;
          n.relationships.associations.forEach((a) => {
            a.lineColor = pkg.data.color;
          });
          n.relationships.refreshOwnRelationships();
        });
      },

      onSlateNameChanged: function(pkg) {
        self.slate.options.name = pkg.data.name;
      },

      onSlateDescriptionChanged: function(pkg) {
        self.slate.options.description = pkg.data.description;
      },

      onSlateShowGridChanged: function(pkg) {
        self.slate.options.viewPort.showGrid = pkg.data.showGrid;
        if (pkg.data.showGrid) {
				  self.slate.grid.show();
        } else {
          self.slate.grid.destroy();
        }
      },

      onSlateMindMapModeChanged: function(pkg) {
        self.slate.options.mindMapMode = pkg.data.mindMapMode;
      },

      onSlateTemplateChanged: function(pkg) {
        self.slate.options.isTemplate = pkg.data.isTemplate;
      },

      onSlateSnapToObjectsChanged: function(pkg) {
        self.slate.options.viewPort.snapToObjects = pkg.data.snapToObjects;
      }
      
    }; //this invoker

    self.pc.onCollaboration && self.pc.onCollaboration({ type: "init", slate: self.slate, cb: function(pkg) { self._process(pkg); } });
    if (self.pc.localizedOnly) {
      utils.localRecipients.push(self);
    }

  }

  _process(pkg) {
    const self = this;
    if (utils.localRecipients.length > 1) {
      var _time = 0;
      for (var s in utils.localRecipients) {
        _time += 10;
        (function(rec, t) {
          setTimeout(function() {
            rec["collab"]["invoke"](pkg); 
          }, t);
        })(utils.localRecipients[s], _time);
      }
    } else if (self.invoker[pkg.type]) {
      self.invoker[pkg.type](pkg);
    } else {
      self.pc.onCollaboration && self.pc.onCollaboration({ type: "custom", slate: self.slate, pkg: pkg });
    }
  };
  
  invoke(pkg) {
    const self = this;
    if (self.invoker[pkg.type]) {
      self.invoker[pkg.type](pkg);
    }
  };
  
  closeNodeSpecifics(pkg) {
    const self = this;
    let all = pkg.data.nodeOptions ? pkg.data.nodeOptions : [pkg.data];
    all.forEach(n => { 
      //close self node's marker if open
      let nx = self.slate.nodes.one(n.id);
      if (nx) {
        nx.menu && nx.menu.hide();
        nx.connectors && nx.connectors.remove();
        nx.resize && nx.resize.hide();
        nx.rotate && nx.rotate.hide();

        nx.relationships.associations.forEach(association => {
          nx.lineOptions && nx.lineOptions.hide(association.id);
        });
      } else {
        console.error("Unable to find node with id", n.id);
      }

    });

    //remove any context menus
    self.slate.removeContextMenus();
    self.slate.untooltip();
  };
  
  addMessage(pkg, msg) {
    //CollaborationMessages.insert({userId: getUserId(), slateId: this.slate._id || this.slate.options.id, msg: msg});
  };
  
  send(pkg) {
    const self = this;
    if (pkg.type !== "onMouseMoved") {
      self.slate.undoRedo && self.slate.options.showUndoRedo && self.slate.undoRedo.snap();
    }
    if (self.pc.allow) {
      if (self.slate.options?.onSlateChanged) {
        self.slate.options.onSlateChanged.apply(self, [pkg]);
      }
      self.pc.onCollaboration && self.pc.onCollaboration({ type: "process", slate: self.slate, pkg: pkg });
    }
  };

}