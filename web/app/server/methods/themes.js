/* eslint-disable no-underscore-dangle */
/* eslint-disable no-bitwise */
// methods.js
import { Meteor } from 'meteor/meteor'
import uniq from 'lodash.uniq'
import tinycolor from 'tinycolor2'
import tinygradient from 'tinygradient'
import { SVGPathData } from 'svg-pathdata'
import rawMongoSearch from '../common/rawMongoSearch'
import { Slates, Themes, PrivateThemes } from '../../imports/api/common/models'
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

method[CONSTANTS.methods.themes.buildColorPalette] = async (opts) => {
  switch (opts.type) {
    case 'palette':
    case 'shades': {
      const base = tinycolor(opts.base)
      if (opts.type === 'shades') {
        return shades(base)
      }
      // palette
      const palette = []
      base.tetrad().forEach((t) => {
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
      break
  }
}

method[CONSTANTS.methods.themes.getPresetColors] = async (opts) => {
  if (Meteor.userId()) {
    const theme = Themes.findOne({ _id: opts.themeId })
    if (theme) {
      return theme.palette
    }
  }
  return null
}

method[CONSTANTS.methods.themes.getPrivate] = async (opts) => {
  let privateTheme = PrivateThemes.findOne({ _id: opts.slateId })
  if (!privateTheme) {
    const ss = Slates.findOne({ _id: opts.slateId })
    privateTheme = createTheme(ss)
    PrivateThemes.upsert({ _id: privateTheme._id }, privateTheme)
  }
  return privateTheme
}

method[CONSTANTS.methods.themes.getThemes] = async (opts) => {
  if (Meteor.userId()) {
    if (opts && opts.filter) {
      // collection, query, op, sort, skip, limit
      return rawMongoSearch(
        Themes,
        {
          $and: [
            { $text: { $search: opts.filter } },
            { 'options.themeApproved': true },
          ],
        },
        'toArray',
        'name'
      )
    }
    if (opts && opts.themeId) {
      return Themes.findOne(opts.themeId)
    }
    return Themes.find({ 'options.themeApproved': true }).fetch()
  }
  return null
}

function createTheme(slate) {
  if (slate) {
    const palette = []
    const theme = {
      _id: slate._id,
      name: slate.options.name,
      shareId: slate.shareId,
      description: slate.options.description,
      containerStyle: {
        backgroundEffect: slate.options.containerStyle.backgroundEffect,
        backgroundColor: slate.options.containerStyle.backgroundColor,
        backgroundImage: slate.options.containerStyle.backgroundImage,
        backgroundSize: slate.options.containerStyle.backgroundSize,
        backgroundColorAsGradient:
          slate.options.containerStyle.backgroundColorAsGradient,
        backgroundGradientType:
          slate.options.containerStyle.backgroundGradientType,
        backgroundGradientColors:
          slate.options.containerStyle.backgroundGradientColors,
        backgroundGradientStrategy:
          slate.options.containerStyle.backgroundGradientStrategy,
      },
      defaultLineColor: slate.options.defaultLineColor,
      styles: {},
    }
    Array.from({ length: 18 }).forEach((t, ind) => {
      const id = ind === 0 ? `parent` : `child_${ind}`
      const node =
        slate.nodes.find((n) => n.options.id === id) || slate.nodes[ind]
      if (node) {
        const path = new SVGPathData(node.options.vectorPath)
          .translate(node.options.xPos * -1, node.options.yPos * -1)
          .encode()
        palette.push({
          order: ind,
          nodeColor: node.options.backgroundColor,
        })
        const style = {
          image: node.options.image,
          backgroundColor: node.options.backgroundColor,
          opacity: node.options.opacity,
          borderOpacity: node.options.borderOpacity,
          borderColor: node.options.borderColor,
          borderStyle: node.options.borderStyle,
          borderWidth: node.options.borderWidth,
          lineColor: node.options.lineColor,
          lineOpacity: node.options.lineOpacity,
          lineEffect: node.options.lineEffect,
          lineWidth: node.options.lineWidth,
          textOpacity: node.options.textOpacity,
          foregroundColor: node.options.foregroundColor,
          fontSize: node.options.fontSize,
          fontFamily: node.options.fontFamily,
          fontStyle: node.options.fontStyle,
          filters: node.options.filters,
          vectorPath: path,
        }
        theme.styles[id] = style
      }
    })
    palette.sort((a, b) => a.order - b.order)
    theme.palette = palette

    // auto approve templates and themes for master user
    if (Meteor.user().isMasterUser) {
      theme.options = { themeApproved: true }
    }

    Themes.upsert({ _id: slate._id }, theme)
    return theme
  }
  return false
}

method[CONSTANTS.methods.themes.parseSlateIntoTheme] = async (opts) => {
  if (Meteor.userId()) {
    const slate = Slates.findOne({
      _id: opts.slateId,
      'options.eligibleForThemeCompilation': true,
    })
    return createTheme(slate)
  }
  return null
}

Meteor.methods(method)
