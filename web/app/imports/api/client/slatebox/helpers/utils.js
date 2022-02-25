/* eslint-disable no-underscore-dangle */
/* eslint-disable no-empty */
/* eslint-disable no-plusplus */
/* eslint-disable no-param-reassign */
/* eslint-disable no-cond-assign */
/* eslint-disable no-return-assign */
import { Raphael } from '../deps/raphael/raphael.svg'

export default class Utils {
  static easing = {
    elastic(pos) {
      return (
        -1 * 4 ** (-8 * pos) * Math.sin(((pos * 6 - 1) * (2 * Math.PI)) / 2) + 1
      )
    },
    swingFromTo(pos) {
      let s = 1.70158
      return (pos /= 0.5) < 1
        ? 0.5 * (pos * pos * (((s *= 1.525) + 1) * pos - s))
        : 0.5 * ((pos -= 2) * pos * (((s *= 1.525) + 1) * pos + s) + 2)
    },
    swingFrom(pos) {
      const s = 1.70158
      return pos * pos * ((s + 1) * pos - s)
    },
    swingTo(pos) {
      const s = 1.70158
      return (pos -= 1) * pos * ((s + 1) * pos + s) + 1
    },
    bounce(pos) {
      if (pos < 1 / 2.75) {
        return 7.5625 * pos * pos
      }
      if (pos < 2 / 2.75) {
        return 7.5625 * (pos -= 1.5 / 2.75) * pos + 0.75
      }
      if (pos < 2.5 / 2.75) {
        return 7.5625 * (pos -= 2.25 / 2.75) * pos + 0.9375
      }
      return 7.5625 * (pos -= 2.625 / 2.75) * pos + 0.984375
    },
    bouncePast(pos) {
      if (pos < 1 / 2.75) {
        return 7.5625 * pos * pos
      }
      if (pos < 2 / 2.75) {
        return 2 - (7.5625 * (pos -= 1.5 / 2.75) * pos + 0.75)
      }
      if (pos < 2.5 / 2.75) {
        return 2 - (7.5625 * (pos -= 2.25 / 2.75) * pos + 0.9375)
      }
      return 2 - (7.5625 * (pos -= 2.625 / 2.75) * pos + 0.984375)
    },
    easeFromTo(pos) {
      if ((pos /= 0.5) < 1) {
        return 0.5 * pos ** 4
      }
      return -0.5 * ((pos -= 2) * pos ** 3 - 2)
    },
    easeFrom(pos) {
      return pos ** 4
    },
    easeTo(pos) {
      return pos ** 0.25
    },
    none(pos) {
      return -Math.cos(pos * Math.PI) / 2 + 0.5
    },
  }

  static availColors = [
    { hex: '000000', to: '575757', fore: 'fff' }, // black //six to a row
    { hex: 'FFFFFF', to: 'd9d9d9', fore: '000' }, // white
    { hex: 'FF0000', to: 'a31616', fore: '000' }, // red
    { hex: 'C3FF68', to: 'afff68', fore: '000' }, // green
    { hex: '0B486B', to: '3B88B5', fore: 'fff' }, // blue
    { hex: 'FBB829', to: 'cd900e', fore: '000' }, // orange
    { hex: 'BFF202', to: 'D1F940', fore: '000' }, // yellow
    { hex: 'FF0066', to: 'aa1d55', fore: '000' }, /// pink
    { hex: '800F25', to: '3d0812', fore: 'fff' }, // dark red
    { hex: 'A40802', to: 'd70b03', fore: 'fff' }, // red
    { hex: 'FF5EAA', to: 'cf5d93', fore: '000' }, // strong pink
    { hex: '740062', to: 'D962C6', fore: 'fff' }, // purple
    { hex: 'FF4242', to: 'A61515', fore: 'fff' }, // red
    { hex: 'D15C57', to: '9D5C58', fore: '000' }, // pinkish
    { hex: 'FCFBE3', to: 'c9c56f', fore: '000' }, // light yellow-white
    { hex: 'FF9900', to: 'c98826', fore: '000' }, // orange
    { hex: '369001', to: '9CEE6C', fore: '000' }, // green
    { hex: '9E906E', to: '675324', fore: 'fff' }, // brown
    { hex: 'F3D915', to: 'F9EA7C', fore: '000' }, // yellow 2
    { hex: '031634', to: '2D579A', fore: 'fff' }, // dark blue
    { hex: '556270', to: '7b92ab', fore: 'fff' }, // gray-blue
    { hex: '1693A5', to: '23aad6', fore: 'fff' }, // turquoise
    { hex: 'ADD8C7', to: '59a989', fore: '000' }, // light turquoise
    {
      special: {
        // line options display only colors; node menu displays colors and transparent button
        color: { hex: '8D5800', to: 'EB9605' },
        other: { transparent: true }, // transparent
      },
    },
  ]

  static polygonCache = {}

  static async pause(millis) {
    return new Promise((resolve) => {
      window.setTimeout(() => {
        resolve()
      }, millis)
    })
  }

  static windowSize() {
    let w = 0
    let h = 0

    // IE
    if (!window.innerWidth) {
      // strict mode
      if (!(document.documentElement.clientWidth == 0)) {
        w = document.documentElement.clientWidth
        h = document.documentElement.clientHeight
      }
      // quirks mode
      else {
        w = document.body.clientWidth
        h = document.body.clientHeight
      }
    }
    // w3c
    else {
      w = window.innerWidth
      h = window.innerHeight
    }
    return { width: w, height: h }
  }

  static isElement(o) {
    return typeof HTMLElement === 'object'
      ? o instanceof HTMLElement // DOM2
      : typeof o === 'object' &&
          o.nodeType === 1 &&
          typeof o.nodeName === 'string'
  }

  // convenience
  static el(id) {
    if (id.indexOf('#') > -1 || id.indexOf('.') > -1) {
      return document.querySelector(id)
    }
    return document.getElementById(id)
  }

  // let arr = select("elem.className");
  static select(query) {
    const index = query.indexOf('.')
    if (index !== -1) {
      const tag = query.slice(0, index) || '*'
      const klass = query.slice(index + 1, query.length)
      const els = []
      const all = document.getElementsByTagName(tag)
      for (let d = 0; d < all.length; d++) {
        const elem = all[d]
        if (elem.className && elem.className.indexOf(klass) !== -1) {
          els.push(elem)
        }
      }
      return els
    }
    return null
  }

  static getKey(e) {
    let keyCode = 0
    try {
      keyCode = e.keyCode
    } catch (Err) {
      keyCode = e.which
    }
    return keyCode
  }

  // fix event inconsistencies across browsers
  static stopEvent(e) {
    e = e || window.event

    if (e.preventDefault) {
      e.stopPropagation()
      e.preventDefault()
    } else {
      e.returnValue = false
      e.cancelBubble = true
    }
    return false
  }

  static toShortDateString(jsonDate) {
    let date = jsonDate
    try {
      const d = new Date(parseInt(jsonDate.substr(6), 10))
      date = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
    } catch (Err) {}

    return date
  }

  static addEvent(obj, type, fn, optId = null, once = false) {
    if (obj) {
      if (optId && e.target.id === optId) {
        obj.addEventListener(type, fn, { capture: false, once })
      } else {
        obj.addEventListener(type, fn)
      }
    }
  }

  static removeEvent(obj, type, fn) {
    obj.removeEventListener(type, fn)
  }

  // push an event listener into existing array of listeners
  static bind(to, evt, fn) {
    to[evt] = to[evt] || []
    to[evt].push(fn)
  }

  // static imageExists(u, cb, id) {
  //   const  self = this;
  //   const _id = `temp_${guid()}`
  //   const _img = document.body.appendChild(document.createElement('img'))
  //   _img.style.position = 'absolute'
  //   _img.style.top = '-10000px'
  //   _img.style.left = '-10000px'
  //   _img.setAttribute('src', u)
  //   _img.setAttribute('id', _id)

  //   self.addEvent(_img, 'load', function (e) {
  //     const d = self.getDimensions(_img)
  //     document.body.removeChild(_img)
  //     cb.apply(this, [true, d.width, d.height, id])
  //   })

  //   self.addEvent(_img, 'error', function (e) {
  //     document.body.removeChild(_img)
  //     cb.apply(this, [false, 0, 0, id])
  //   })
  // }

  // static urlExists(url) {
  //   const http = new XMLHttpRequest()
  //   http.open('GET', url, false)
  //   http.send()
  //   return http.status === 200
  // }

  // // static sendPost(opts) {
  // //   // const iframe = document.createElement("iframe");
  // //   // iframe.setAttribute("src", "#");
  // //   // iframe.setAttribute("style", "display: none");

  // //   const form = document.createElement('form')
  // //   form.setAttribute('method', 'post')
  // //   form.setAttribute('action', opts.path)
  // //   form.setAttribute('target', '_top')
  // //   for (const key in opts.params) {
  // //     if (opts.params.hasOwnProperty(key)) {
  // //       const hiddenField = document.createElement('input')
  // //       hiddenField.setAttribute('type', 'hidden')
  // //       hiddenField.setAttribute('name', key)
  // //       hiddenField.setAttribute('value', opts.params[key])
  // //       form.appendChild(hiddenField)
  // //     }
  // //   }
  //   // iframe.appendChild(form);

  //   // iframe.onload) {
  //   //   console.log("iframe loaded");
  //   //   //
  //   // }
  //   document.body.appendChild(form)
  //   form.submit()
  // }

  static ajax(u, f, d, v, x, h) {
    x = this.ActiveXObject
    // the guid is essential to break the cache because ie8< seems to want to cache this. argh.
    u = [u, u.indexOf('?') === -1 ? '?' : '&', `guid=${Utils.guid()}`].join('')
    x = new (x || XMLHttpRequest)('Microsoft.XMLHTTP')
    const vx = d ? v || 'POST' : v || 'GET'
    x.open(vx, u, 1)
    x.setRequestHeader('Content-type', 'application/json; charset=utf-8')
    h.forEach((hElem) => {
      x.setRequestHeader(hElem.n, hElem.v)
    })
    x.onreadystatechange = function () {
      x.readyState > 3 && f ? f(x.responseText, x) : 0
    }
    x.send(d)
  }

  // static hasClass(el, className) {
  //   if (el.classList) el.classList.contains(className)
  //   else new RegExp(`(^| )${className}( |$)`, 'gi').test(el.className)
  // }

  // static addClass(el, className) {
  //   if (el.classList) el.classList.add(className)
  //   else el.className += ` ${className}`
  // }

  static S4() {
    return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1)
  }

  static guid() {
    return this.S4() + this.S4() + this.S4()
  }

  // static number() {
  //   return Math.floor(Math.random() * 9999) + 999
  // }

  static getJSON(url, callback) {
    const id = S4() + S4()
    let script = document.createElement('script')
    const token = `__jsonp${id}`

    // callback should be a global function
    window[token] = callback

    // url should have "?" parameter which is to be replaced with a global callback name
    script.src = url.replace(/\?(&|$)/, `__jsonp${id}$1`)

    // clean up on load: remove script tag, null script variable and delete global callback function
    script.onload = function () {
      // delete script;
      script = null
      // delete global[token];
    }
    document.getElementsByTagName('head')[0].appendChild(script)
  }

  static getBBox(opts) {
    const cont = document.createElement('div')
    cont.setAttribute('id', 'hiddenPaper')
    cont.style.display = 'none'
    document.body.appendChild(cont)
    const pp = new Raphael(cont)
    const bb = pp.path(opts.path).getBBox()
    document.body.removeChild(cont)
    return bb
  }

  static positionedOffset(obj) {
    let curleft = 0
    let curtop = 0
    if (obj.offsetParent) {
      do {
        curleft += obj.offsetLeft
        curtop += obj.offsetTop
      } while ((obj = obj.offsetParent))
    }
    return { left: curleft, top: curtop }
  }

  static getDimensions(ele) {
    let width = 0
    let height = 0
    if (typeof ele.clip !== 'undefined') {
      width = ele.clip.width
      height = ele.clip.height
    } else if (ele.style?.pixelWidth) {
      width = ele.style.pixelWidth
      height = ele.style.pixelHeight
    } else {
      width = ele.offsetWidth
      height = ele.offsetHeight
    }
    return { width, height }
  }

  static isIE() {
    let version = 999 // we assume a sane browser
    if (
      navigator.appVersion.indexOf('MSIE') !== -1 &&
      navigator.appVersion.indexOf('chromeframe') === -1
    )
      version = parseFloat(navigator.appVersion.split('MSIE')[1])
    return version
  }

  static isIpad() {
    return navigator.userAgent.match(/iPad/i) !== null
  }

  static mousePos(e) {
    let mouseX = null
    let mouseY = null
    const _allTouches = []
    if (e.targetTouches) {
      if (e.targetTouches.length) {
        const t = e.targetTouches[0]
        mouseX = t.clientX
        mouseY = t.clientY
        for (const tx in e.targetTouches) {
          _allTouches.push({
            x: e.targetTouches[tx].clientX,
            y: e.targetTouches[tx].clientY,
          })
        }
      }
    } else {
      mouseX = e.pageX
      mouseY = e.pageY
    }
    return { x: mouseX, y: mouseY, allTouches: _allTouches }
  }

  static ensureEle(el) {
    return typeof el === 'string' ? document.getElementById(el) : el
  }

  static onOff(baseUrl, ele, callback) {
    const imgID = guid().replace('-', '').substring(0, 8)
    const _element = ensureEle(ele)
    _element.innerHTML = `<div style='cursor:pointer;overflow:hidden;width:53px;height:20px;'><img id='${imgID}' style='margin-top:0px;' src='${baseUrl}/public/images/checkbox-switch-stateful.png' alt='toggle'/>`
    el(imgID).onclick = function (e) {
      callback.apply(this, [imgID])
    }
    return imgID
  }

  static isOn(ele) {
    const _ele = ensureEle(ele)
    if (_ele.style.marginTop === '0px') return false
    return true
  }

  static toggleOnOff(ele) {
    const _ele = ensureEle(ele)
    if (_ele.style.marginTop === '0px') _ele.style.marginTop = '-22px'
    else _ele.style.marginTop = '0px'
  }

  static div(p, x, y, w, h) {
    const _id = `temp_${guid()}`
    const _div = p.appendChild(document.createElement('div'))
    _div.style.position = 'absolute'
    _div.style.top = `${y}px`
    _div.style.left = `${x}px`
    _div.style.width = `${w}px`
    _div.style.height = `${h}px`
    _div.style.border = '1px solid red'
    _div.style.backgroundColor = '#f8f8f8'
    _div.setAttribute('id', _id)
    return _id
  }

  static centerAndScalePathToFitContainer(opts) {
    // scale and transform the path to fit the box...
    // first get the bbox of the untouched path
    let bb = this.getBBox({ path: opts.path })

    // calculate the scale of the path
    const _scale = opts.scaleSize / Math.max(bb.width, bb.height)

    // scale the untouched path
    let _newPath = this.lowLevelTransformPath(
      opts.path,
      ['s', _scale, ',', _scale].join('')
    )

    // go get the bbox of the scaled path
    bb = this.getBBox({ path: _newPath })

    // finally, move the scaled vector to the centered x,y coords
    // of the enclosed box
    const tp = [
      'T',
      bb.x * -1 + (opts.containerSize - bb.width) / 2,
      ',',
      bb.y * -1 + (opts.containerSize - bb.height) / 2,
    ].join('')

    _newPath = this.lowLevelTransformPath(_newPath, tp) // s" + _scale + "," + _scale).toString();

    return { path: _newPath, width: bb.width, height: bb.height }
  }

  static buildStyle(_styles) {
    let _str = ''
    Object.keys(_styles).forEach((k) => {
      _str += `${k}:${_styles[k]};`
    })
    return _str
  }

  // static _specializedTransformPath(original, transform) {
  //   let t = 0;
  //   let c = null;
  //   let digits = [];
  //   let order = [];
  //   function apply(type) {
  //     if (c?.args.length > 0) {
  //       order.push(c);
  //     }
  //     c = { type: type, args: [] };
  //   }
  //   function digitify() {
  //     if (digits.length > 0) {
  //       c.args.push(parseFloat(digits.join('')));
  //       digits = [];
  //     }
  //   }
  //   for (t = 0; t < transform.length; t++) {
  //     let tx = transform.charAt(t);
  //     if (tx.toLowerCase() === "t") {
  //       apply('translate');
  //     } else if (tx.toLowerCase() === "r") {
  //       apply('rotate');
  //     } else if (tx.toLowerCase() === "s") {
  //       apply('scale');
  //     } else if ([",", " "].includes(tx.toLowerCase())) {
  //       //signifies the end of a number
  //       digitify();
  //     } else {
  //       if (tx.trim() !== "") digits.push(tx);
  //       if (t === transform.length - 1) {
  //         //the last one
  //         digitify();
  //       }
  //     }
  //   }
  //   //always add the last order
  //   order.push(c);

  //   let workingPath = new SVGPathData(original).toAbs().encode();
  //   //console.log("executing transformation ", transform, order, workingPath);

  //   order.forEach(o => {
  //     workingPath = new SVGPathData(workingPath)[o.type](...o.args.map(a => parseFloat(a))).encode();
  //   });

  //   return workingPath;
  // };

  static whiteOrBlack(hex) {
    return Raphael.rgb2hsb(hex).b < 0.4 ? '#fff' : '#000'
  }

  // static rgbToHex(rgb) {
  //   return Raphael.rgb(rgb.r, rgb.g, rgb.b);
  // }

  // static hexToRGB(hex) {
  //   let ccolor = Raphael.getRGB(hex);
  //   if (ccolor.r && ccolor.a == null) {
  //     ccolor.a = 1;
  //   }
  //   return ccolor;
  // };

  static lowLevelTransformPath(original, transform) {
    // let t = 0;
    // let c = null;
    // let digits = [];
    // let order = [];
    // function apply(type) {
    //   if (c?.args.length > 0) {
    //     order.push(c);
    //   }
    //   c = { type: type, args: [] };
    // }
    // function digitify() {
    //   if (digits.length > 0) {
    //     c.args.push(parseFloat(digits.join('')));
    //     digits = [];
    //   }
    // }
    // for (t = 0; t < transform.length; t++) {
    //   let tx = transform.charAt(t);
    //   if (tx.toLowerCase() === "t") {
    //     apply('translate');
    //   } else if (tx.toLowerCase() === "r") {
    //     apply('rotate');
    //   } else if (tx.toLowerCase() === "s") {
    //     apply('scale');
    //   } else if ([",", " "].includes(tx.toLowerCase())) {
    //     //signifies the end of a number
    //     digitify();
    //   } else {
    //     if (tx.trim() !== "") digits.push(tx);
    //     if (t === transform.length - 1) {
    //       //the last one
    //       digitify();
    //     }
    //   }
    // }
    // //always add the last order
    // order.push(c);

    // let workingPath = new SVGPathData(original).toAbs().encode();
    // //console.log("executing transformation ", transform, order, workingPath);

    // order.forEach(o => {
    //   workingPath = new SVGPathData(workingPath)[o.type](...o.args.map(a => parseFloat(a))).encode();
    // });
    // console.log("transform executed", transform, workingPath);

    const rpath = Raphael.transformPath(original, transform).toString()
    return rpath

    // console.log("attempted path", workingPath);
    // console.log("raph path", rpath);
    // return workingPath;
  }

  static transformPath(_node, _transformation) {
    const _path = Raphael.transformPath(
      _node.vect.attr('path').toString(),
      _transformation
    ).toString()
    _node.options.vectorPath = _path
    _node.vect.transform('')
    _node.vect.attr({ path: _node.options.vectorPath })
    const bb = _node.vect.getBBox()
    const rotationContext = {
      point: {
        x: bb.cx,
        y: bb.cy,
      },
    }
    Object.assign(_node.options.rotate, rotationContext)
    const transformString = _node.getTransformString()
    _node.vect.transform(transformString)

    _node.text.transform('')
    // xPos and yPos are updated in the setPosition in Slatebox.Node.js
    _node.text.attr(
      _node.textCoords({ x: _node.options.xPos, y: _node.options.yPos })
    )
    _node.text.transform(transformString)
  }

  // static hashCode(str) {
  //   let hash = 0, i, chr;
  //   if (str.length === 0) return hash;
  //   for (i = 0; i < str.length; i++) {
  //     chr = str.charCodeAt(i);
  //     hash = ((hash << 5) - hash) + chr;
  //     hash |= 0; // Convert to 32bit integer
  //   }
  //   return hash;
  // };

  static htmlToElement(html) {
    const template = document.createElement('template')
    html = html.trim()
    template.innerHTML = html
    return template.content.firstChild
  }

  static toDataUrl = (url) =>
    fetch(url, { mode: 'cors' })
      .then((response) => response.blob())
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onloadend = () => resolve(reader.result)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
      )
}
