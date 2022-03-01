// methods.js
import { Meteor } from 'meteor/meteor'
import fetch from 'node-fetch'
import SVGO from 'svgo'
import sharp from 'sharp'
import CONSTANTS from '../../imports/api/common/constants'

const svgo = new SVGO({
  plugins: [{ removeUnknownsAndDefaults: false }], // feDropShadow and the like should stay
})

const method = {}
method[CONSTANTS.methods.utils.base64StringFromRemoteUrl] = async (opts) => {
  if (Meteor.user()) {
    // TODO: let the
    const base64 = await fetch(opts.url)
      .then((r) => r.buffer())
      .then((buf) =>
        sharp(buf)
          [opts.type]({ quality: opts.quality || 50 })
          .toBuffer()
      )
      .then((buf) => `data:image/${opts.type};base64,${buf.toString('base64')}`)
    return base64
  }
}

method[CONSTANTS.methods.utils.optimizeSVG] = async (svg) => {
  if (Meteor.user()) {
    const optimizedSVG = await svgo.optimize(svg)
    return optimizedSVG.data
  }
  return null
}

method[CONSTANTS.methods.utils.createImage] = async (opts) => {
  if (Meteor.user()) {
    const img = await sharp(Buffer.from(opts.svg, 'utf8'))
      [opts.type]({ quality: opts.quality || 50 })
      .toBuffer()
      .then((buf) => `data:image/${opts.type};base64,${buf.toString('base64')}`)
    return img
  }
  return null
}

Meteor.methods(method)
