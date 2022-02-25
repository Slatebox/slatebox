/* eslint-disable */
import sbIcons from '../../helpers/sbIcons.js'

export const shapes = function (R) {
  var c =
    'M16,1.466C7.973,1.466,1.466,7.973,1.466,16c0,8.027,6.507,14.534,14.534,14.534c8.027,0,14.534-6.507,14.534-14.534C30.534,7.973,24.027,1.466,16,1.466z'
  // var cl = "M 24 2.199 C 11.9595 2.199 2.199 11.9595 2.199 24 c 0 12.0405 9.7605 21.801 21.801 21.801 c 12.0405 0 21.801 -9.7605 21.801 -21.801 C 45.801 11.9595 36.0405 2.199 24 2.199 z";
  // var r = "M 4.5 4.5 h 27 v 27 H 4.5 z";

  const icons = sbIcons.icons

  R.fn.handle = function (x, y) {
    return this.path(icons.handle + c)
  }

  R.fn.editor = function (x, y) {
    return this.path(icons.editor + c)
  }

  R.fn.deleter = function (x, y) {
    return this.path(icons.deleter + c)
  }

  R.fn.trash = function () {
    return this.path(icons.trash + c).attr({ fill: '#000' })
  }

  R.fn.searcher = function (x, y) {
    return this.path(icons.searcher + c)
  }

  R.fn.plus = function (x, y) {
    return this.path(icons.plus + c)
  }

  R.fn.merge = function (x, y) {
    return this.path(icons.plus + c)
  }

  R.fn.copy = function (x, y) {
    return this.path(icons.copy + c)
  }

  // R.fn.group = function (x, y) {
  //   return this.path(icons.group + cl);
  // };

  // R.fn.ungroup = function (x, y) {
  //   return this.path(icons.ungroup + cl);
  // };

  R.fn.minus = function (x, y) {
    return this.path(icons.minus + c)
  }

  R.fn.link = function (x, y) {
    return this.path(icons.link + c)
  }

  R.fn.up = function (x, y) {
    return this.path(icons.up)
  }

  R.fn.down = function (x, y) {
    return this.path(icons.up).transform('r180')
  }

  R.fn.setting = function (x, y) {
    return this.path(icons.settings + c).transform('s,.9,.9')
  }

  R.fn.arrow = function () {
    return this.path(icons.arrow + c)
  }

  R.fn.arrowHead = function () {
    return this.path(icons.arrowHead)
      .attr({ fill: '#648CB2' })
      .transform('s0.7')
  }

  R.fn.linkArrow = function () {
    return this.path(icons.arrow + c).attr({ fill: '#648CB2' })
  }

  R.fn.lockClosed = function () {
    return this.path(icons.lockClosed)
  }

  R.fn.lockOpen = function () {
    return this.path(icons.lockOpen)
  }

  R.fn.speechbubble = function (x, y, txt) {
    var _bubble = this.set()
    _bubble
      .push(
        this.path(icons.speechbubble)
          .transform(['t', x, ',', y].join())
          .scale(6, 4)
          .scale(-1, 1)
      )
      .attr({ fill: '#fff', stroke: '#000', 'stroke-width': 3 })
    _bubble.push(this.text(x + 10, y + 10, txt).attr({ 'font-size': 12 }))
    return _bubble
  }

  R.fn.undo = function (path) {
    return this.path(icons.undo)
  }

  R.fn.redo = function (path) {
    return this.path(icons.undo).transform('s-1,1')
  }

  R.fn.resize = function () {
    //return this.rect(0,0,10,10);
    // var _resize = this.set();
    // _resize.push(this.rect(0, 0, 20, 5))
    // _resize.push(this.rect(0, 20, 20, 5));
    // return _resize;
    //return this.path("M8.818,9.464l9.712,10.792L8.818,9.464zM 11.783,20.823 17.326,18.918 19.804,13.604 24.348,26.72 zM 15.565,8.896 10.022,10.802 7.544,16.115 3,3 z");
    //var _resize = this.set();
    //_resize.push(this.path("M 56.6875 0.125 L 29.875 26.625 L -0.3125 56.53125 L 25.46875 56.53125 L 56.6875 25.375 L 56.6875 0.125 z").attr({stroke: "#fff", fill: "#fff"}).transform("s.5") );
    //_resize.push(this.path("M 0,56.829931 56.539823,0.29010776 zM 14.289023,56.569787 56.693882,14.164916 zM 25.229778,56.521813 57.03342,24.71816 z").attr({stroke: "#000"}).transform("s.5") );
    //_resize.push(this.path(icons.resizeMarker2));
    //return _resize;
    return this.path(
      `M24 10.999v-10.999h-11l3.379 3.379-13.001 13-3.378-3.378v10.999h11l-3.379-3.379 13.001-13z`
    )
    //return this.image("data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAXCAYAAAAP6L+eAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAEBJREFUeNpiYKAuYAPijUD8n1aGVowaOmoo/QyNpYWh+UB8g1aGSowaOmroqKEEAE0MZaCVoQxEFH3e5BgKEGAAnnVBs4ro6nUAAAAASUVORK5CYII=", 0, 0, 22, 23);
  }

  R.fn.resizeLines = function () {
    return this.image(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAXCAYAAAAP6L+eAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAAEBJREFUeNpiYKAuYAPijUD8n1aGVowaOmoo/QyNpYWh+UB8g1aGSowaOmroqKEEAE0MZaCVoQxEFH3e5BgKEGAAnnVBs4ro6nUAAAAASUVORK5CYII=',
      0,
      0,
      22,
      23
    )
  }

  // R.fn.rectangle = function(opts) {

  //     return this.path(shapes.rectangle(opts));
  // };

  // R.fn.rectanglePath = function(opts) {
  //     return shapes.rectangle(opts);
  // };

  // R.fn.straightPath = function(opts) {
  //   return this.path("M5480,5300 h130 a10,10 0 0 1 10,10 v80 a10,10 0 0 1 -10,10 h-130 a10,10 0 0 1 -10,-10 v-80 a10,10 0 0 1 10,-10 z");
  //   //console.log("path is ", shapes.roundedRectangle(opts));
  //   //return this.path(opts.pathString);
  // };

  // R.fn.roundedRectangle = function(opts) {
  //     return this.path(shapes.roundedRectangle(opts));
  // };

  // R.fn.roundedRectanglePath = function(opts) {
  //     return "M ${x + 123}, ${y + 43} h30 a3,3 0 0 1 3,3 v25 a3,3 0 0 1 -3,3 h-30 a3,3 0 0 1 -3,-3 v-25 a3,3 0 0 1 3,-3 z";
  // };

  R.fn.slider = function (
    length,
    start,
    end,
    initVal,
    onSlide,
    onDone,
    onInit,
    _x,
    _y,
    _isHorizontal,
    z
  ) {
    z = z || 1

    var _slider = this.set()
    _slider.push(
      this.rect(_x || 10, _y || 10, 10, length, 5).attr({
        fill: '#ccc',
        stroke: '#333',
        'stroke-width': 2,
      })
    )
    var _sl = this.path(icons.sliderHandle).transform(
      ['t', _x - 10 || 0, ',', _y || 0, 'r270'].join('')
    )
    _sl.attr({ fill: '#eee', stroke: '#ccc' })
    _slider.push(_sl)

    //globals
    var _lockX,
      _initY,
      _lyp,
      _lastDy = 0

    _slider.setValue = function (val) {
      var _setCurrent = (val * length) / end + (_y || 0) // / (z || 1);
      _slider[1].transform(['t', _x - 10 || 0, ',', _setCurrent, 'r270'].join())
      ;(_lockX = _slider[1].attr('x') + (_x - 10 || 0)),
        (_initY = _slider[1].attr('y') + (_y || 0)),
        (_lyp = _setCurrent),
        (_lastDy = _y || 0)
    }

    //set current value
    _slider.setValue(initVal)

    var init = function (x, y) {
      onInit && onInit(x, y)
    }

    var move = function (dx, dy) {
      dx = dx + (dx / z - dx)
      dy = dy + (dy / z - dy)

      //dx = dx / z;
      //dy = dy / z;

      dy = _lyp + dy

      if (dy < 0) dy = 0
      if (dy > length + (_y || 0) - 15) dy = length + (_y || 0) - 15
      if (dy < (_y || 0) - 15) dy = _y - 15
      _lastDy = dy

      //moving 1 0 2 5272.32 raphael.fn.objects.js:89
      //moving  5801.08 85

      _slider[1].transform(['t', _lockX, ',', dy, 'r270'].join())

      var currentValue = ((dy - _initY) * end) / length + start

      onSlide && onSlide(currentValue)
    }

    var up = function () {
      _lyp = _lastDy - _initY
      var currentValue = (_lyp * end) / length + start
      onSlide && onSlide(currentValue)
      onDone && onDone(currentValue)
    }

    _slider[1].drag(move, init, up)

    return _slider
  }

  // var shapes = {
  //     rectangle: function({x = 5500, y = 5300, width = 150, height = 100}) {
  //         return `M${x} ${y} h${width} v${height} h${-(width)} v${-(height)} z`;
  //     }
  //     , roundedRectangle: function({x = 5500, y = 5300, width = 150, height = 100, curveRadius = 10}) {
  //         return `M${x},${y} h${width - 2* curveRadius} a${curveRadius},${curveRadius} 0 0 1 ${curveRadius},${curveRadius} v${height - 2 * curveRadius} a${curveRadius},${curveRadius} 0 0 1 -${curveRadius},${curveRadius} h-${width - 2 * curveRadius} a${curveRadius},${curveRadius} 0 0 1 -${curveRadius},-${curveRadius} v-${height - 2 * curveRadius} a${curveRadius},${curveRadius} 0 0 1 ${curveRadius},-${curveRadius} z`;
  //     }
  // }
}
