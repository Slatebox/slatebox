/* eslint-disable no-bitwise */
// Generated colour palettes for notes, slates and team gradients.
import { Meteor } from 'meteor/meteor'
import uniq from 'lodash.uniq'
import tinycolor from 'tinycolor2'
import tinygradient from 'tinygradient'
import CONSTANTS from '../../imports/api/common/constants'

const method = {}

// gratuitous theft: https://stackoverflow.com/questions/35969656/how-can-i-generate-the-opposite-color-according-to-current-color
function invertHex(hex) {
  return (Number(`0x1${hex}`) ^ 0xffffff).toString(16).substr(1).toUpperCase()
}

function shades(base) {
  return tinygradient([base, invertHex(base.toHexString())])
    .rgb(18)
    .map((p) => p.toHexString())
}

method[CONSTANTS.methods.colors.buildColorPalette] = async (opts) => {
  if (!Meteor.userId() || !opts) return null
  switch (opts.type) {
    case 'palette':
    case 'shades': {
      const baseColors = [
        '#FF6F61', // Coral Red
        '#6B5B95', // Elegant Purple
        '#88B04B', // Fresh Green
        '#F7CAC9', // Soft Pink
        '#92A8D1', // Cool Blue
        '#955251', // Warm Brown
        '#B565A7', // Vibrant Orchid
        '#009B77', // Teal
        '#DD4124', // Fiery Orange
        '#45B8AC', // Aqua Mint
      ]
      const base = opts.base
        ? tinycolor(opts.base)
        : tinycolor(baseColors[Math.floor(Math.random() * baseColors.length)])
      if (opts.type === 'shades') {
        return shades(base)
      }
      // palette
      const palette = []
      base.analogous().forEach((t) => {
        palette.push(t.toHexString())
      })
      if (uniq(palette).length === 1) {
        return shades(base)
      }
      palette.forEach((p) => {
        tinycolor(p)
          .analogous()
          .forEach((tc, i) => {
            palette.push(tc.toHexString())
          })
      })
      return uniq(palette).slice(0, 18)
    }
    case 'viaImage': {
      return null
    }
    default:
      return null
  }
}

Meteor.methods(method)
