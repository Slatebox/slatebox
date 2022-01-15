import '../deps/emile.js';
import utils from  '../helpers/utils.js';

export default class images {

  constructor(slate, node) {
    this.slate = slate;
    this.node = node;
  }

  getTargetImageDimensions() {
    let _transImageHeight, _transImageWidth;
    const origImageRatio = this.node.options.imageOrigWidth / this.node.options.imageOrigHeight;

    const noRotationPath = this.slate.paper.path(this.node.vect.attr("path"));
    let noRotationBB = noRotationPath.getBBox();
    const nodeRatio = noRotationBB.width / noRotationBB.height;
    if (origImageRatio < nodeRatio) {
      _transImageWidth = noRotationBB.width;
      _transImageHeight = noRotationBB.width / origImageRatio;
    } else if (origImageRatio > nodeRatio) {
      _transImageHeight = noRotationBB.height;
      _transImageWidth = noRotationBB.height * origImageRatio;
    } else {
      _transImageWidth = noRotationBB.width;
      _transImageHeight = noRotationBB.height;
    }

    noRotationPath.remove();

    return {
      width: _transImageWidth,
      height: _transImageHeight
    }
  };

  imageSizeCorrection() {
    if (this.node.vect.pattern) {
      const _targetImageDimensions = this.getTargetImageDimensions();
      const img = this.node.vect.pattern.getElementsByTagName("image")[0];
      img.setAttribute("height", _targetImageDimensions.height);
      img.setAttribute("width", _targetImageDimensions.width);
    }
  };

  set(img, w, h, blnKeepResizerOpen, useMainCanvas = false) {

    this.node.vect.data({ relativeFill: true });
    this.node.options.image = img;
    this.node.options.origImage = { w, h }; // needed for image copying if done later 
    this.node.options.imageOrigHeight = h; //for scaling node to image size purposes; this value should never be changed
    this.node.options.imageOrigWidth = w;
    this.node.options["fill-opacity"] = 1;

    //delete previous fill before adding a new image
    //this.node.vect.pattern.parentElement.removeChild(this.node.vect.pattern);
    //$(this.node.vect.pattern).detach();

    const sz = { "fill": "url(" + this.node.options.image + ")", "stroke-width": this.node.options.borderWidth, "stroke": "#000" };

    const _targetImageDimensions = this.getTargetImageDimensions();

    this.node.vect.imageOrigHeight = _targetImageDimensions.height;
    this.node.vect.imageOrigWidth = _targetImageDimensions.width;

    this.node.vect.attr({ "fill-opacity": 1 }); //IMPORTANT: for some reason Raphael breaks when setting 'sz' object and this at the same time
    this.node.vect.attr(sz);

    const rotatedBB = this.node.vect.getBBox();
    this.node.options.width = rotatedBB.width;
    this.node.options.height = rotatedBB.height;

    this.node.relationships.refreshOwnRelationships();
    if (blnKeepResizerOpen) {
      this.node.setPosition({ x: rotatedBB.x, y: rotatedBB.y }, true);
      this.node.menu && this.node.menu.hide();
      this.node.rotate && this.node.rotate.hide();
      //this.node.resize && this.node.resize.hide();
    } else {
      this.node.setPosition({ x: rotatedBB.x, y: rotatedBB.y });
    }
    this.node.connectors && this.node.connectors.remove();
    //this.node.resize && this.node.resize.hide();
    //this.node.rotate && this.node.rotate.hide();
    // tempPath && tempPath.remove();

  };
}