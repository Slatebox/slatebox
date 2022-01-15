import utils from "../helpers/utils";
import { Raphael } from '../deps/raphael/raphael.svg.js'

export default class zoomSlider {

  constructor(slate) {
    const self = this;
    self.slate = slate;
    self.slider = null;
    self.sliderId = `sb-zoom-slider-${utils.guid().substring(8)}`;
  }

  setValue(val) {
    this.slider && this.slider.setValue(val);
  };

  hide() {
    if (utils.el("slateSlider_" + this.slate.options.id) !== null) {
      this.slate.options.container.removeChild(utils.el("slateSlider_" + this.slate.options.id));
    }
  };

  show(_options) {
    const self = this;
    if (!self.slate.isReadOnly() && !self.slate.isCommentOnly()) {

      self.hide();

      var options = {
        height: 320
        , width: 28
        , offset: { left: 39, top: 85 }
        , slider: { height: 300, min: 6000, max: 200000, set: 5000 }
      };

      Object.assign(options, _options);

      var c = self.slate.options.container;
      var scx = document.createElement('div');
      scx.setAttribute("id", "slateSlider_" + self.slate.options.id);
      scx.style.position = "absolute";
      scx.style.height = options.height + "px";
      scx.style.width = options.width + "px";
      scx.style.left = options.offset.left + "px";
      scx.style.top = options.offset.top + "px";
      scx.style.borderRadius = '7px';
      scx.style.border = '1px solid #ccc';
      scx.style.backgroundColor = '#fff';
      c.appendChild(scx);

      //options.paper = new Raphael("slateSlider_" + self.slate.options.id, options.width, options.height);

      
      self.slider = document.createElement('input');
      self.slider.setAttribute("orient", "vertical");
      self.slider.setAttribute("type", "range");
      // self.slider.setAttribute("min", "0.25");
      // self.slider.setAttribute("step", "0.01");
      // self.slider.setAttribute("max", "5.05");
      self.slider.setAttribute("min", "6000");
      self.slider.setAttribute("step", "50");
      self.slider.setAttribute("max", "200000");
      self.slider.setAttribute("value", self.slate.options.viewPort.zoom.w); // self.slate.options.viewPort.zoom.r);
      self.slider.setAttribute("id", self.sliderId);
      self.slider.style["writing-mode"] = "bt-lr";
      self.slider.style["-webkit-appearance"] = "slider-vertical";
      self.slider.style["width"] = `20px`;
      self.slider.style["height"] = `${options.height - 5}px`;
      self.slider.style["padding"] = `0 5px`;
      self.slider.style["transform"] = `rotate(180deg)`;

      self.slider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        self.set(val);
        self.slate.birdsEye?.refresh(true);
      });

      self.slider.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        self.set(val);
        self.slate.collab && self.slate.collab.send({ type: 'onZoom', data: { zoomLevel: val } });
      })

      scx.appendChild(self.slider);
    }

    // self.slider = options.paper.slider(options.slider.height, options.slider.min, options.slider.max, options.slider.set
    //   , function (val) { //length, start, end, initVal, onSlide, onDone
    //     self.slate.zoom(0, 0, val, val, false);
    //     self.slate.canvas.resize(val);
    //   }, function (val) {
    //     self.set(val);
    //     self.slate.collab && self.slate.collab.send({ type: 'onZoom', data: { zoomLevel: val } });
    // });

  };

  set(val) {
    const self = this;
    if (self.slider) self.slider.value = val;
    if (self.slate.canvas.resize(val) || !self.slate.canvas.completeInit) {
      self.slate.zoom(0, 0, val, val, false);
      var z = self.slate.options.viewPort.zoom;
      self.slate.options.viewPort.width = z.w;
      self.slate.options.viewPort.height = z.h;
      self.slate.options.viewPort.left = z.l;
      self.slate.options.viewPort.top = z.t;
    }
    // self.slate.options.viewPort.zoom.r = val;
    // self.slider.value = val; //.setAttribute("value", val);
    // self.slate.zoom(xy);
  };

}