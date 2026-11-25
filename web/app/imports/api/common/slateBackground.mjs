// The background a slate is shown on, the same answer for its canvas and for its card on My slates.
//
// A slate keeps its own background in options.containerStyle. A slate made on the server (a first-run
// board, a smart board, a workshop) is stored without one: its canvas opens on the team's style, the
// brand kit's default preset, and so must its card. White is the background nobody chose (in dark mode
// it is shown as the dark canvas, ui/common/canvasTheme.mjs).

/** A slate's background when nothing is chosen: white, with the shades a gradient of it would use. */
export function defaultContainerStyle() {
  const shades = ['#ffffff', '#f0f0f0', '#e1e1e1', '#d2d2d2', '#c3c3c3']
  return {
    width: 'auto',
    height: 'auto',
    backgroundColor: shades[0],
    backgroundImage: null,
    backgroundSize: 'cover',
    backgroundEffect: null,
    prevBackgroundColor: 'transparent',
    backgroundColorAsGradient: false,
    backgroundGradientType: 'radial',
    backgroundGradientColors: shades,
    backgroundGradientStrategy: 'shades',
  }
}

/**
 * The containerStyle a team's style (the default preset's value) gives a slate: its colour, gradient or
 * picture over the default. No preset, or one without a background, gives the default.
 */
export function presetContainerStyle(presetValue) {
  let containerStyle = defaultContainerStyle()
  const presetBg = presetValue?.background
  if (!presetBg) return containerStyle
  containerStyle = {
    ...containerStyle,
    backgroundColor: presetBg.colorValue || containerStyle.backgroundColor,
    backgroundImage: presetBg.backgroundImage || containerStyle.backgroundImage,
    backgroundSize: presetBg.backgroundSize || containerStyle.backgroundSize,
    backgroundEffect: presetBg.backgroundEffect || containerStyle.backgroundEffect,
    backgroundColorAsGradient: presetBg.backgroundColorAsGradient != null
      ? presetBg.backgroundColorAsGradient
      : containerStyle.backgroundColorAsGradient,
    backgroundGradientType: presetBg.gradientConfig?.gradientType || containerStyle.backgroundGradientType,
    backgroundGradientStrategy: presetBg.gradientConfig?.gradientStrategy || containerStyle.backgroundGradientStrategy,
  }
  if (presetBg.activeType === 'gradient' && presetBg.gradientConfig) {
    const colors = presetBg.gradientConfig.gradientColors
    if (Array.isArray(colors) && colors.length > 0) {
      // The preset's own shades.
      containerStyle.backgroundColor = presetBg.gradientConfig.baseColorValue || containerStyle.backgroundColor
      containerStyle.backgroundGradientColors = colors
      containerStyle.backgroundColorAsGradient = true
    } else {
      // A gradient preset saved without its shades: its base colour, solid.
      containerStyle.backgroundColor = presetBg.gradientConfig.baseColorValue || containerStyle.backgroundColor
      containerStyle.backgroundColorAsGradient = false
      containerStyle.backgroundGradientColors = []
    }
  } else if (presetBg.activeType === 'color' && presetBg.colorValue) {
    containerStyle.backgroundColor = presetBg.colorValue
    containerStyle.backgroundColorAsGradient = false
    containerStyle.backgroundGradientColors = []
  }
  return containerStyle
}

/** The colours a background is made of, first the one it starts from (a new AI slate's ink is read from it). */
export function backgroundColors(containerStyle) {
  const shades = containerStyle?.backgroundGradientColors
  return Array.isArray(shades) && shades.length ? shades : [containerStyle?.backgroundColor]
}

/**
 * The background a stored slate is shown on: its own containerStyle when it keeps one, else the team's
 * style (`presetValue`, the default preset's value; null for a person with no team style), as its canvas
 * opens it (api/client/createSlate.js: the canvas starts on the team's style and a slate's own
 * containerStyle replaces it when the slate is loaded).
 */
export function shownContainerStyle(stored, presetValue) {
  if (stored && typeof stored === 'object') return { backgroundColor: '#ffffff', ...stored }
  return presetContainerStyle(presetValue)
}
