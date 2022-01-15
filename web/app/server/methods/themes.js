// methods.js
import { CONSTANTS } from '../../imports/api/common/constants.js';
import { Slates, Themes, PrivateThemes } from '../../imports/api/common/models.js';
import { Meteor } from 'meteor/meteor';
import rawMongoSearch from '../common/rawMongoSearch.js';
import uniq from 'lodash.uniq';
import tinycolor from 'tinycolor2';
import tinygradient from 'tinygradient';
import { SVGPathData } from 'svg-pathdata';

let method = {};

// gratuitous theft: https://stackoverflow.com/questions/35969656/how-can-i-generate-the-opposite-color-according-to-current-color
function invertHex(hex) {
  return (Number(`0x1${hex}`) ^ 0xFFFFFF).toString(16).substr(1).toUpperCase();
}

function shades(base) {
  return tinygradient([
    base,
    invertHex(base.toHexString())
  ]).rgb(18).map(p => p.toHexString());
}

method[CONSTANTS.methods.themes.buildColorPalette] = async function(opts) {
  switch (opts.type) {
    case "palette": 
    case "shades": {
      let base = tinycolor(opts.base);
      if (opts.type === "shades") {
        return shades(base);
      } else {
        // palette
        let palette = [];
        base.tetrad().forEach(t => {
          palette.push(t.toHexString());
        });
        if (uniq(palette).length === 1) {
          return shades(base);
        } else {
          palette.forEach(p => {
            tinycolor(p).analogous().forEach((tc, i) => {
              palette.push(tc.toHexString());
            });
          });
          return uniq(palette).slice(0, 18);
        }
      }
    }
    case "viaImage": {
      return null;
    }
  }
};

method[CONSTANTS.methods.themes.getPresetColors] = async function(opts) {
  if (Meteor.userId()) {
    const theme = Themes.findOne({ _id: opts.themeId });
    if (theme) {
      return theme.palette;
    }
  }
}

method[CONSTANTS.methods.themes.getPrivate] = async function(opts) {
  let privateTheme = PrivateThemes.findOne({ _id: opts.slateId });
  if (!privateTheme) {
    let ss = Slates.findOne({ _id: opts.slateId });
    console.log('ss', opts.slateId, ss);
    privateTheme = createTheme(ss);
    console.log('creating private ', ss, privateTheme);
    PrivateThemes.upsert({ _id: privateTheme._id }, privateTheme);
  }
  return privateTheme;
}

method[CONSTANTS.methods.themes.getThemes] = async function(opts) {
  if (Meteor.userId()) {
    if (opts && opts.filter) {
      // collection, query, op, sort, skip, limit
      return await rawMongoSearch(Themes, { $and: [{ $text: { $search: opts.filter } }, { "options.themeApproved": true }] }, "toArray", "name");
    } else if (opts && opts.themeId) {
      return Themes.findOne(opts.themeId);
    } else {
      return Themes.find({ "options.themeApproved": true }).fetch();
    }
  }
}

function createTheme(slate) {
  if (slate) {
    let palette = [];
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
        backgroundColorAsGradient: slate.options.containerStyle.backgroundColorAsGradient,
        backgroundGradientType: slate.options.containerStyle.backgroundGradientType,
        backgroundGradientColors: slate.options.containerStyle.backgroundGradientColors,
        backgroundGradientStrategy: slate.options.containerStyle.backgroundGradientStrategy
      },
      defaultLineColor: slate.options.defaultLineColor,
      styles: {}
    };
    Array.from({ length: 18 }).forEach((t, ind) => {
      let id = ind === 0 ? `parent` : `child_${ind}`;
      const node = slate.nodes.find(n => n.options.id === id) || slate.nodes[ind];
      if (node) {
        const path = new SVGPathData(node.options.vectorPath).translate(node.options.xPos * -1, node.options.yPos * -1).encode();
        palette.push({
          order: ind, 
          nodeColor: node.options.backgroundColor
        });
        const style = {
          image: node.options.image
          , backgroundColor: node.options.backgroundColor
          , opacity: node.options.opacity
          , borderOpacity: node.options.borderOpacity
          , borderColor: node.options.borderColor
          , borderStyle: node.options.borderStyle
          , borderWidth: node.options.borderWidth
          , lineColor: node.options.lineColor
          , lineOpacity: node.options.lineOpacity
          , lineEffect: node.options.lineEffect
          , lineWidth: node.options.lineWidth
          , textOpacity: node.options.textOpacity
          , foregroundColor: node.options.foregroundColor
          , fontSize: node.options.fontSize
          , fontFamily: node.options.fontFamily
          , fontStyle: node.options.fontStyle
          , filters: node.options.filters
          , vectorPath: path
        };
        theme.styles[id] = style;
      }
    });
    palette.sort((a, b) => { return a.order - b.order });
    theme.palette = palette;

    //auto approve templates and themes for master user
    if (Meteor.user().isMasterUser) {
      theme.options = { themeApproved: true };
    }

    Themes.upsert({ _id: slate._id }, theme);
    return theme;
  } else {
    return false;
  }
}

method[CONSTANTS.methods.themes.parseSlateIntoTheme] = async function(opts) {
  if (Meteor.userId()) {
    const slate = Slates.findOne({ _id: opts.slateId, "options.eligibleForThemeCompilation": true });
    return createTheme(slate);
  }
}

Meteor.methods(method);