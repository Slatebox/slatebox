import Utils from '../helpers/Utils'

export default class CustomShapes {
  constructor(slate, node) {
    this.slate = slate
    this.node = node
  }

  set(path, width, height, sendCollab) {
    let upath = path
    if (width && height) {
      // calculate the scale of the path
      const scale =
        Math.max(this.node.options.width, this.node.options.height) /
        Math.max(width, height)
      upath = Utils.lowLevelTransformPath(
        path,
        ['s', scale, ',', scale].join('')
      )
    }
    this.node.shapes.set({
      shape: upath.toString(),
      sendCollab: sendCollab != null ? sendCollab : true,
    })
  }
}
