import { WheelGestures } from 'wheel-gestures'
import utils from '../helpers/Utils'

export default class Inertia {
  constructor(slate) {
    this.slate = slate
    this.scale = 1
    this.wheelEnd = null
    this.xyOffset = null
    if (slate.options.viewPort.useInertiaScrolling) {
      this.init()
    }
  }

  setScale(val) {
    this.scale = val
  }

  init() {
    // create an instance per element
    const self = this
    const wheelGestures = WheelGestures({ momentum: true })

    // this disabled the fwd/back gesture navigation
    // document.body.style["overscroll-behavior-x"] = "none";
    // document.body.html.style["overscroll-behavior-x"] = "none";

    // find and observe the element the user can interact with
    wheelGestures.observe(self.slate.canvas.internal)

    let start = {}
    wheelGestures.on('wheel', (e) => {
      if (self.slate.options.allowDrag) {
        if (e.event.ctrlKey) {
          // will not include this for now
          // if (!self.snappedZoom) {
          //   self.snappedZoom = self.slate.options.viewPort.zoom.w;
          // }
          // self.scale -= e.event.deltaY * 0.005;
          // console.log("scale is ", e.isEnding, self.scale, self.slate.options.viewPort.zoom.r);
          // let val = self.scale * self.snappedZoom;
          // if (val > 6000 && val < 100000) {
          //   self.slate.zoomSlider.set(val);
          // }
          // //self.slate.zoom(self.scale, self.initZoomVal);
          // //scale();
          // if (e.isEnding) {
          //   delete self.snappedZoom;
          //   //self.slate?.collab?.send({ type: "onCanvasMove", data: { left: self.slate.options.viewPort.left, top: self.slate.options.viewPort.top } });
          // }
        } else {
          const deltaX = e.event.deltaX * 0.8 // .5 is the modifier to slow self down a bit
          const deltaY = e.event.deltaY * 0.8

          if (e.isStart) {
            start = utils.positionedOffset(self.slate.canvas.internal)
            // hide filters during dragging
            self.slate.toggleFilters(true)
          }
          self.slate.canvas.move({
            x: deltaX,
            y: deltaY,
            dur: 0,
            isAbsolute: false,
          })
          // self.slate.birdsEye && self.slate.birdsEye.refresh(true);
          // console.trace();

          if (e.isEnding) {
            const end = utils.positionedOffset(self.slate.canvas.internal)
            if (self.slate.birdsEye) self.slate.birdsEye.refresh(true)
            self.slate.canvas.broadcast({
              x: start.left - end.left,
              y: start.top - end.top,
            })

            // show filters after dragging
            self.slate.toggleFilters(false)
          }
        }
      }
    })
  }
}
