import { Meteor } from 'meteor/meteor'
import { Picker } from 'meteor/communitypackages:picker'
import { Buffer } from 'buffer'
import { Readable } from 'stream'
import { CachedImages } from '../imports/api/common/models'

const gets = Picker.filter(
  Meteor.bindEnvironment((req) => req.method === 'GET')
)

gets.route('/sbimages/:url', (params, req, res) => {
  const finalize = Meteor.bindEnvironment(async () => {
    const q = {
      url: params.url,
    }
    const image = CachedImages.findOne(q)
    if (image) {
      let mime = 'image/jpeg'
      if (image.url.endsWith('.gif')) {
        mime = 'image/gif'
      } else if (image.url.endsWith('.png')) {
        mime = 'image/png'
      }
      const imgBuf = Buffer.from(image.bytes, 'binary') // .toString("base64"); //, "binary");
      res.writeHead(200, {
        'Content-Type': mime,
        'Content-Length': imgBuf.length,
      })
      Readable.from(Buffer.from(image.bytes, 'binary')).pipe(res)
    } else {
      res.end()
    }
  })
  finalize()
})
