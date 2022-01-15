import { Raphael } from '../deps/raphael/raphael.svg.js'
import utils from '../helpers/utils.js';
import node from '../core/node.js';

export default class comments {

  constructor(slate) {
    this.slate = slate;
    this.engaged = false;
  }

  engage() {
    const self = this;
    if (!self.engaged) {
      let comment = `M 14.4761 0 H 3.102 C 1.3888 0 0 1.3888 0 3.102 V 8.5307 c 0 1.7132 1.3888 3.102 3.102 3.102 H 9.8297 l 2.803 4.2412 l 0.9018 -4.2412 h 0.9418 c 1.7132 0 3.102 -1.3888 3.102 -3.102 V 3.102 C 17.5781 1.3888 16.1893 0 14.4761 0 z`;
      const svg = self.slate.canvas.internal.querySelector("svg");
      svg.addEventListener("mousedown", (e) => {
        const mp = utils.mousePos(e);
        const x = mp.x + self.slate.options.viewPort.left;
        const y = mp.y + self.slate.options.viewPort.top;

        let tpath = utils._transformPath(comment, `T${x},${y}s2,2`);
        let pbox = utils.getBBox({ path: tpath });  

        let commentNodeOpts = {
          text: ''
          , xPos: x
          , yPos: y
          , height: pbox.height
          , width: pbox.width
          , vectorPath: tpath
          , allowMenu: false
          , allowDrag: true
          , opacity: 1
          , borderOpacity: 1
          , textOpacity: 1
        };

        //console.log("comment opts", commentNodeOpts);

        const commentNode = new node(commentNodeOpts);
        self.slate.nodes.add(commentNode);

        //console.log("added comment node ", commentNode);

      })


      // function setDimens(tString) {
      //   let bcopy = cloneDeep(baseOpts);
      //   let tpath = Slatebox.utils._transformPath(path, tString);
      //   let pbox = Slatebox.utils.getBBox({ path: tpath });
      //   let iOpts = {
      //     text: ''
      //     , xPos: xPos + pbox.width / 2 + 20
      //     , yPos: yPos + pbox.height / 2 + 20
      //     , height: pbox.height
      //     , width: pbox.width
      //     , vectorPath: tpath
      //     , allowMenu: true
      //     , allowDrag: true
      //     , opacity: 1
      //     , borderOpacity: 1
      //     , textOpacity: 1
      //   };
    
      // let gbg = self.slate.options.containerStyle.backgroundColor;
      // let borderColor = utils.whiteOrBlack(gbg);

      // const svg = self.slate.canvas.internal.querySelector("svg");
      // const defs = svg.querySelector("defs");
      // //defs.insertAdjacentHTML("beforeend", `<circle id="comment" cx="5" cy="5" r="4" stroke="blue"/>`);
      // //<g id='comment' transform='translate(9600,9600)'><path d='M 14.4761 0 H 3.102 C 1.3888 0 0 1.3888 0 3.102 V 8.5307 c 0 1.7132 1.3888 3.102 3.102 3.102 H 9.8297 l 2.803 4.2412 l 0.9018 -4.2412 h 0.9418 c 1.7132 0 3.102 -1.3888 3.102 -3.102 V 3.102 C 17.5781 1.3888 16.1893 0 14.4761 0 z' fill='#B76C0D' stroke-color='#000'/></g>
      // defs.insertAdjacentHTML("beforeend", `<g id='comment'><path d='M 14.4761 0 H 3.102 C 1.3888 0 0 1.3888 0 3.102 V 8.5307 c 0 1.7132 1.3888 3.102 3.102 3.102 H 9.8297 l 2.803 4.2412 l 0.9018 -4.2412 h 0.9418 c 1.7132 0 3.102 -1.3888 3.102 -3.102 V 3.102 C 17.5781 1.3888 16.1893 0 14.4761 0 z' fill='#B76C0D' stroke-color='${borderColor}'/></g>`);
      // console.log("added comment def", borderColor);

      // let c = document.createElement(`use`);
      // c.setAttribute("transform", "translate(9600,9600)");
      // c.setAttribute("id", "testComment1");
      // c.setAttribute("href", "#comment");
      
      // console.log("found svg ", svg);
      // svg.appendChild(c);

      // console.log("added comment");
      self.engaged = true;
      //<use x="0" y="0" xlink:href="#comment"/>
    }
 
  }
  
}