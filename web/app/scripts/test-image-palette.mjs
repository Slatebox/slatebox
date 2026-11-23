import assert from 'node:assert/strict'
import sharp from 'sharp'
import extractImagePalette from '../server/common/imagePalette.mjs'

const image = await sharp({
  create: {
    width: 100,
    height: 50,
    channels: 4,
    background: '#ff0000',
  },
})
  .composite([
    {
      input: {
        create: {
          width: 50,
          height: 50,
          channels: 4,
          background: '#0000ff',
        },
      },
      left: 50,
      top: 0,
    },
  ])
  .png()
  .toBuffer()

const palette = await extractImagePalette(
  `data:image/png;base64,${image.toString('base64')}`,
  10
)

assert.ok(palette.length > 0 && palette.length <= 10)
assert.ok(palette.includes('#ff0000'), `missing red in ${palette.join(', ')}`)
assert.ok(palette.includes('#0000ff'), `missing blue in ${palette.join(', ')}`)
await assert.rejects(() => extractImagePalette('not-an-image'))

console.log(`Image palette regression passed: ${palette.join(', ')}`)
