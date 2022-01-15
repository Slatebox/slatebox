import utils from '../helpers/utils.js';

export default class controller {

  constructor(slate) {
    this.slate = slate;
  }

  _perform(pkg, node, op, cb) {
    const _det = op.split('@');
    let _dur =  pkg.defaultDuration || 300;
    const _param = _det[1];

    switch (_det[0]) {
      case 'zoom':
        _dur = _det.length > 2 ? parseFloat(_det[2], 10) : pkg.defaultDuration;
        node.zoom(_param, _dur, cb);
        break;
      case 'position':
        const _ease = _det.length > 2 ? _det[2] : pkg.defaultEasing;
        _dur = _det.length > 3 ? parseFloat(_det[3], 10) : pkg.defaultDuration;
        node.position(_param, cb, _ease, _dur);
        break;
    }
  };
    
  scaleToFitNodes(_opts) {
      const opts = {
        nodes: null,
        dur: 0,
        cb: null,
        offset: 0,
        minWidth: 60,
        minHeight: 30
      };
      Object.assign(opts, _opts);

      const orient = this.slate.getOrientation(opts.nodes);
      const d = utils.getDimensions(this.slate.options.container);
      const r =this.slate.options.viewPort.zoom.r || 1;
      const _widthZoomPercent = parseInt((d.width / (orient.width / r)) * 100); //division by r converts it back from the scaled version
      const _heightZoomPercent = parseInt((d.height / (orient.height / r)) * 100);

      //zoom canvas
     this.slate.canvas.zoom({
        dur: opts.dur,
        callbacks: {
          after: function() {
            opts.cb && opts.cb();
          }
        },
        easing: 'easeFromTo',
        zoomPercent: Math.min(_widthZoomPercent, _heightZoomPercent)
      });
    };

    //useful for centering the canvas on a collection of nodes
    centerOnNodes(_opts) {
      const self = this;

      const opts = {
        nodes: null,
        dur: 500,
        cb: null
      };
      Object.assign(opts, _opts);
      const orient = self.slate.getOrientation(opts.nodes);
      const d = utils.getDimensions(self.slate.options.container);
      const cw = d.width;
      const ch = d.height;
      const nw = orient.width;
      const nh = orient.height;

      //get upper left coords
      const _x = orient.left - (cw / 2 - nw / 2);
      const _y = orient.top - (ch / 2 - nh / 2);

     self.slate.canvas.move({ 
        x: _x
        , y: _y
        , isAbsolute: true
        , dur: opts.dur
        , easing: 'swingFromTo'
        , callbacks: { 
          after: function() {
            setTimeout(() => {self.slate.birdseye && self.slate.birdseye.refresh(true); }, 100);
            //self.slate.birdseye &&self.slate.birdseye.refresh(true);
            opts.cb && opts.cb();
          }
        } 
      });
    };

    //useful for centering the canvas by comparing the viewport's previous width/height to its current width/height        
    center(_opts) {
      const opts = {
        previousWindowSize: {},
        dur: 500,
        cb: null
      };
      Object.assign(opts, _opts);
      const ws = utils.windowSize();
      this.slate.canvas.move({
        x: ((ws.width - opts.previousWindowSize.w) / 2) * -1,
        y: ((ws.height - opts.previousWindowSize.h) / 2) * -1,
        duration: opts.dur,
        isAbsolute: false,
        easing: 'swingFromTo',
        callbacks: {
          after: () => {
           this.slate.birdseye && this.slate.birdseye.refresh(true);
            opts.cb && opts.cb();
          }
        }
      });
      return ws;
    };

    // {
    //   nodes: [{ 
    //     name: "b017a13144b0" 
    //     , operations: ["zoom@zoomPercent@duration", "position@center@defaultEasing@duration"]
    //   }]
    //   , nodeChanged: (node) => {
    //     console.log("node changed", node);
    //   }
    //   , opChanged: (op) => {
    //     console.log("op changed", op);
    //   }
    //   , complete: () => {
    //     console.log("complete!");
    //   },
    //   sync: {
    //     zoom: true
    //     , position: true
    //   }
    // }

    // slate.present({
    //   nodes: [{ 
    //     name: "" 
    //     , operations: ["zoom@zoomPercent@duration", "position@lowerright|lowerleft|upperright|upperleft|center@easeTo|swingFromTo@duration"]
    //   }]
    //   , nodeChanged: (node) => {
    //     console.log("node changed", node);
    //   }
    //   , opChanged: (op) => {
    //     console.log("op changed", op);
    //   }
    //   , complete: () => {
    //     console.log("complete!");
    //   },
    //   sync: {
    //     zoom: true
    //     , position: true
    //   }
    // });

    //experimental
    bop(opts) {

      const _dur = opts && opts.dur && opts.dur !== 0 ? opts.dur : 300;
      const _per = opts && opts.per && opts.per !== 0 ? opts.per : 150;
      const _locale = "center";
      const _ease = "easeTo";

      const _presentNodes = _.map(this.slate.nodes.allNodes, (a) => { 
        return {
          name: a.options.name
          , operations: [`position@${_locale}@${_ease}@${_dur}`]
        }
      });

     this.slate.controller.present({
        nodes: _presentNodes
        , nodeChanged: (node) => {
          console.log("node changed", node);
        }
        , opChanged: (op) => {
          console.log("op changed", op);
        }
        , complete: () => {
          console.log("complete!");
        },
        sync: {
          zoom: true
          , position: true
        }
      });

    };

    //expiremental
    shakeNodes(opts) {
      const self = this;
      let s = 0;

      function _move() {
        s++;
        const _mPkg = { 
            dur: 500
          , moves: [{
            id: "*"
            , x: (s % 2 === 0 ? 20 : -20)
            , y: (s % 2 === 0 ? -20 : -20)
          }]
        };
        const _pkg = self.slate.nodes.nodeMovePackage(_mPkg);
        self.slate.nodes.moveNodes(_pkg, {
          animate: true
          , cb: () => {
            setTimeout(() => {
              _move();
              console.log("all done!");
            }, 4000);
          }
        });
      };

      _move();

    };

    pulse(opts) {
      let _cycles = 0;
      let _dur = 10000; //slow
      let _czp
      let _zp;

      function _calc() {
        _czp =this.slate.options.viewPort.zoom.r * 100;
        _zp = { in: _czp + 5, out: _czp - 5 }; //nuance;

        if (opts) {
          switch (opts.speed) {
            case "fast":
              _dur = 3000;
              break;
          }
          switch (opts.subtlety) {
            case "trump":
              _zp = { in: _czp + 60, out: _czp - 60 };
              break;
          }
        }
      };
      
      function _run(zp, cb) {
       this.slate.canvas.zoom({
          dur: _dur,
          callbacks: {
            after: function() {
              cb && cb();
            }
          },
          easing: 'easeFromTo',
          zoomPercent: zp
        });
      }

      function _cycle() {
        _run(_zp.in, () => {
          _run(_zp.out, () => {
            _cycles++;
            if (opts && opts.cycle && _cycles >= opts.cycle) {
              opts.cb && opts.cb();
            } else {
              _cycle();
            }
          })
        })
      };

      if (opts && opts.center) {
        this.scaleToFitAndCenter(() => {
          _calc();
          _cycle();
        });
      } else {
        _calc();
        _cycle();
      }
     
    };

    scaleToFitAndCenter(cb, dur) {
      this.slate.controller.scaleToFitNodes({ 
        dur: dur != null ? dur : 0
        , cb: () => {
          this.centerOnNodes({ dur: 0 });
          cb && cb();
        }
      })
    };

    present(pkg) {

      let _currentOperations = [];
      let n = null;

      function next() {
        if (_currentOperations.length === 0) {
          if (pkg.nodes.length > 0) {
            const node = pkg.nodes.shift();
            n = _.find(this.slate.nodes.allNodes, (n) => { return n.options.name == node.name; });
            _currentOperations = node.operations;
            pkg.nodeChanged && pkg.nodeChanged(node);
          }
        }

        if (_currentOperations.length > 0) {
          const op = _currentOperations.shift();
          pkg.opChanged && pkg.opChanged(op);

          perform(pkg, n, op, function(p) {
            const _sync = pkg.sync !== undefined ? pkg.sync[p.operation] : false;
            switch (p.operation) {
              case "zoom":
                _sync &&this.slate.collab &&this.slate.collab.send({ type: 'onZoom', data: { id: p.id, zoomLevel: p.zoomLevel } });
                break;
              case "position":
                _sync &&this.slate.collab &&this.slate.collab.send({ type: "onNodePositioned", data: { id: p.id, location: p.location, easing: p.easing } });
                break;
            }
            next();
          });
        } else {
          pkg.complete && pkg.complete();
        }
      };
      next();
    };

  }