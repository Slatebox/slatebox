import React from 'react'
import { Meteor } from 'meteor/meteor'
import uniq from 'lodash.uniq'
import { RgbaColorPicker } from 'react-colorful'
import hexToRGB from 'hex-rgb'
import rgbToHex from 'rgb-hex'
import CONSTANTS from '../../../api/common/constants'
import {
  DEFAULT_SWATCHES, toHex, BORDER_WIDTHS, BORDER_STYLES, colourName,
} from '../../../api/common/note-style.mjs'
import { Choices } from './parts'

/** The slate's own colours (its theme's palette), or the default readable fills. */
export function useSlateColours(themeId) {
  const [colours, setColours] = React.useState(DEFAULT_SWATCHES)
  React.useEffect(() => {
    let live = true
    if (!themeId) { setColours(DEFAULT_SWATCHES); return undefined }
    Meteor.callAsync(CONSTANTS.methods.themes.getPresetColors, { themeId }).then((palette) => {
      const list = uniq((palette || []).map((p) => toHex(p.nodeColor)).filter(Boolean))
      if (live && list.length > 2) setColours(list.slice(0, 13).map((colour) => ({ name: colourName(colour), colour })))
    }).catch(() => {})
    return () => { live = false }
  }, [themeId])
  return colours
}

function Swatch({ colour, name, checked, onPick }) {
  return (
    <button type="button" className="sb-swatch" role="radio" aria-checked={Boolean(checked)} aria-label={name}
      title={name} style={{ background: colour }} onClick={() => onPick(colour)} />
  )
}

/** The full colour picker, beside the panel: hex, opacity, Cancel and Use colour. */
export function CustomColour({ colour, opacity = 1, onUse, onCancel }) {
  const start = React.useMemo(() => {
    try {
      const c = hexToRGB(toHex(colour) ?? '#ffffff')
      return { r: c.red, g: c.green, b: c.blue, a: opacity ?? 1 }
    } catch { return { r: 255, g: 255, b: 255, a: 1 } }
  }, [colour, opacity])
  const [value, setValue] = React.useState(start)
  const hex = `#${rgbToHex(value.r, value.g, value.b)}`
  const [typed, setTyped] = React.useState(hex)
  React.useEffect(() => { setTyped(hex) }, [hex])
  return (
    <div className="sb-custom">
      <div className="sb-label">Custom colour</div>
      <RgbaColorPicker color={value} onChange={setValue} aria-label="Custom colour" />
      <label className="sb-field" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <span className="sb-label" style={{ margin: 0 }}>Hex</span>
        <input type="text" aria-label="Hex colour" value={typed} maxLength={7}
          onChange={(e) => {
            setTyped(e.target.value)
            const h = toHex(e.target.value)
            if (h && /^#[0-9a-f]{6}$/i.test(e.target.value.trim())) {
              const c = hexToRGB(h)
              setValue({ r: c.red, g: c.green, b: c.blue, a: value.a })
            }
          }} />
        <span aria-label="Opacity">{Math.round(value.a * 100)}%</span>
      </label>
      <div className="sb-actions">
        <button type="button" className="sb-quiet" onClick={onCancel}>Cancel</button>
        <button type="button" className="sb-primary" onClick={() => onUse(hex, Math.round(value.a * 100) / 100)}>Use colour</button>
      </div>
    </div>
  )
}

/**
 * The colour panel: Fill, Border and Text tabs; recent colours first, then the slate's; "+"
 * for the full picker. Text starts on Auto (dark or white, whichever reads best on the fill).
 */
export function ColourPanel({ tab, onTab, style, recent, slateColours, onFill, onBorder, onText, onCustom, show }) {
  const tabs = [
    show.fill && { key: 'fill', name: 'Fill' },
    show.border && { key: 'border', name: 'Border' },
    show.text && { key: 'text', name: 'Text' },
  ].filter(Boolean)
  const current = tab === 'fill' ? style.fill : tab === 'border' ? style.border : style.textColour
  const pick = tab === 'fill' ? onFill : tab === 'border' ? (c) => onBorder({ colour: c, opacity: 1 }) : (c) => onText(c)
  const selected = (c) => !current.mixed && toHex(current.value) === toHex(c)
  return (
    <div>
      <div className="sb-tabs" role="tablist" aria-label="Colour of">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" className="sb-tab" aria-selected={tab === t.key}
            data-autofocus={tab === t.key ? '' : undefined} onClick={() => onTab(t.key)}>{t.name}</button>
        ))}
      </div>
      {tab === 'text' && (
        <button type="button" className="sb-auto" role="radio" aria-checked={!current.mixed && current.value === 'auto'} onClick={() => onText('auto')}>
          <span className="sb-dot" style={{ background: 'linear-gradient(135deg,#1b1f1d 0 50%,#ffffff 50% 100%)', width: 22, height: 22 }} aria-hidden />
          <span><b>Auto</b><small>Dark or white, whichever reads best on the fill</small></span>
        </button>
      )}
      {recent.length > 0 && (
        <>
          <div className="sb-label">Recent</div>
          <div className="sb-swatches" role="radiogroup" aria-label="Recent colours">
            {recent.map((c) => <Swatch key={c} colour={c} name={colourName(c)} checked={selected(c)} onPick={pick} />)}
          </div>
        </>
      )}
      <div className="sb-label" style={{ marginTop: 10 }}>Slate colours</div>
      <div className="sb-swatches" role="radiogroup" aria-label="Slate colours">
        {slateColours.map((s) => <Swatch key={s.colour} colour={s.colour} name={s.name} checked={selected(s.colour)} onPick={pick} />)}
        <button type="button" className="sb-swatch sb-plus" aria-label="Custom colour…" title="Custom colour…" onClick={onCustom}>+</button>
      </div>
      {tab === 'border' && (
        <>
          <div className="sb-label" style={{ marginTop: 10 }}>Thickness</div>
          <Choices label="Border thickness" value={style.borderWidth.mixed ? null : style.borderWidth.value}
            options={BORDER_WIDTHS.map((b) => ({ key: b.key, name: b.name, text: b.name }))}
            onPick={(key) => onBorder({ width: key })} />
          <div className="sb-label" style={{ marginTop: 10 }}>Line</div>
          <Choices label="Border line" value={style.borderStyle.mixed ? null : style.borderStyle.value}
            options={BORDER_STYLES.map((b) => ({ key: b.key, name: b.name, text: b.name }))}
            onPick={(key) => onBorder({ style: key })} />
        </>
      )}
    </div>
  )
}
