import utils from '../helpers/utils.js';

export default class customShapes {

  constructor(slate, node) {
    this.slate = slate;
    this.node = node;
  }

  set(path, width, height, sendCollab) {
    if (width && height) {
      //calculate the scale of the path
      const _scale = Math.max(this.node.options.width, this.node.options.height) / Math.max(width, height);
      path = utils._transformPath(path, ["s", _scale, ",", _scale].join(""));
    }
    console.log("setting shape ", sendCollab);
    this.node.shapes.set({ shape: path.toString(), sendCollab: sendCollab != null ? sendCollab : true });
  };

}
