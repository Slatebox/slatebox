import React from 'react'
import { useAtom } from 'jotai'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import EastIcon from '@mui/icons-material/East'
import WestIcon from '@mui/icons-material/West'
import LabelOutlinedIcon from '@mui/icons-material/LabelOutlined'
import { LINE_WIDTHS, lineWidthKey, lineValues, linePackage, lineEnds, lineEndsPackages, effectName, recentColoursAfter, DEFAULT_SWATCHES, LINE_SWATCHES, colourName } from '../../../api/common/note-style.mjs'
import { recentColoursBySlate } from '../../jotai/atoms'
import { BarButton, Pop, Choices, useRoving } from './parts'
import { CustomColour } from './ColourPanel'

const Curved = () => <svg viewBox="0 0 24 24" aria-hidden><path d="M4 18 C 10 18, 14 6, 20 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
const Elbow = () => <svg viewBox="0 0 24 24" aria-hidden><path d="M5 19 V 12 H 19 V 5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
// The marks the line's own end handles carry: a hollow circle follows its note, a filled square is pinned.
const Follows = () => <svg viewBox="0 0 24 24" aria-hidden><path d="M3 12 H 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="16" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
const Pinned = () => <svg viewBox="0 0 24 24" aria-hidden><path d="M3 12 H 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><rect x="12" y="8" width="8" height="8" fill="currentColor" /></svg>
const Thickness = ({ w }) => <svg viewBox="0 0 24 24" aria-hidden><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth={w} strokeLinecap="round" /></svg>

/**
 * The bar for a selected line: colour, thickness, arrow ends, curved or elbow, whether its ends
 * follow their notes or are pinned, label, More, Delete. Its values are the line's own. Every
 * change goes through updateLine.
 */
export default function LineBar({ slate, line, mode, sendLine, layer, barRef, noteRect }) {
  const [open, setOpen] = React.useState(null)
  const [custom, setCustom] = React.useState(false)
  const anchors = React.useRef({})
  const v = lineValues(line.association, line.node.options)
  const [label, setLabel] = React.useState(v.label)
  const labelTimer = React.useRef(null)
  const [allRecent, setAllRecent] = useAtom(recentColoursBySlate)
  const slateId = slate?.options?.id
  const recent = allRecent[slateId] ?? []
  useRoving(barRef, [mode])
  // The sliders in More follow the line (a chip, or someone else's change).
  const [widthDraft, setWidthDraft] = React.useState(v.width)
  const [bendDraft, setBendDraft] = React.useState(v.curviness)
  React.useEffect(() => { setWidthDraft(v.width) }, [v.width])
  React.useEffect(() => { setBendDraft(v.curviness) }, [v.curviness])
  React.useEffect(() => { setOpen(null); setLabel(v.label) }, [line.association.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const send = (prop, val) => sendLine(linePackage(prop, val, line.association))
  // Follow or pinned, for both ends that are on notes. Pinned keeps each end where it is now.
  const ends = lineEnds(line.association)
  const engine = slate?.v2 ?? slate
  const setEnds = (mode) => lineEndsPackages(line.association, mode, (which) => engine?.lineEndAnchor?.(line.node.id, line.association.id, which))
    .forEach((pkg) => sendLine(pkg))
  const colour = (c, opacity) => {
    setAllRecent((prev) => ({ ...prev, [slateId]: recentColoursAfter(prev[slateId] ?? [], c) }))
    send('lineColor', c)
    if (opacity !== undefined) send('lineOpacity', opacity)
  }
  const close = (refocus) => { const was = open; setOpen(null); setCustom(false); if (refocus && was) anchors.current[was]?.focus() }
  const toggle = (key) => setOpen((c) => (c === key ? null : key))
  const anchorOf = (key) => (el) => { anchors.current[key] = el }
  const compact = mode !== 'full'
  // On a phone the bar keeps what is changed most (colour, arrows, ends, label); thickness and
  // path move into More, so the bar fits a 390px screen.
  const phone = mode === 'phone'
  const width = lineWidthKey(v.width)
  // Colours that show as lines (not the pale note fills), recent ones first, each with a name.
  const listed = [...recent.map((c) => ({ name: colourName(c), colour: c })), ...LINE_SWATCHES.filter((s) => !recent.includes(s.colour))]
  // The line's own colour is always there, ticked, even when it is none of the listed ones.
  const swatches = listed.some((s) => s.colour.toLowerCase() === String(v.colour).toLowerCase())
    ? listed : [{ name: `Current colour, ${colourName(v.colour)}`, colour: v.colour }, ...listed]

  return (
    <>
      <div ref={barRef} className="sb-style-bar" data-mode={mode} role="toolbar" aria-label="Line">
        <BarButton ref={anchorOf('colour')} label="Line colour" caret expanded={open === 'colour'} controls="sb-pop-line-colour" onClick={() => toggle('colour')}>
          <span className="sb-dot" style={{ background: v.colour }} aria-hidden />
        </BarButton>
        {!phone && (
          <>
            <span className="sb-sep" aria-hidden />
            {compact ? (
              <BarButton ref={anchorOf('width')} label={`Thickness: ${LINE_WIDTHS.find((w) => w.key === width).name}`} caret expanded={open === 'width'} controls="sb-pop-line-width" onClick={() => toggle('width')}>
                <Thickness w={LINE_WIDTHS.find((w) => w.key === width).width / 2 + 1} />
              </BarButton>
            ) : (
              <div className="sb-sizes" role="radiogroup" aria-label="Thickness">
                {LINE_WIDTHS.map((w) => (
                  <BarButton key={w.key} role="radio" checked={width === w.key} label={w.name} onClick={() => send('lineWidth', w.width)}>
                    <Thickness w={w.width / 2 + 1} />
                  </BarButton>
                ))}
              </div>
            )}
          </>
        )}
        <span className="sb-sep" aria-hidden />
        <BarButton label="Arrow at the start" pressed={v.startArrow} onClick={() => send('showParentArrow', !v.startArrow)}><WestIcon aria-hidden /></BarButton>
        <BarButton label="Arrow at the end" pressed={v.endArrow} onClick={() => send('showChildArrow', !v.endArrow)}><EastIcon aria-hidden /></BarButton>
        {!phone && (
          <>
            <span className="sb-sep" aria-hidden />
            <div className="sb-sizes" role="radiogroup" aria-label="Path">
              <BarButton role="radio" checked={!v.elbow} label="Curved" onClick={() => send('lineType', 'bezier')}><Curved /></BarButton>
              <BarButton role="radio" checked={v.elbow} label="Elbow" onClick={() => send('lineType', 'orthogonal')}><Elbow /></BarButton>
            </div>
          </>
        )}
        <span className="sb-sep" aria-hidden />
        <div className="sb-sizes" role="radiogroup" aria-label={`Ends: ${ends.summary}`}>
          <BarButton role="radio" checked={ends.mode === 'follow'} label="Ends follow the notes: each takes the shortest way round its note as the notes move"
            aria-label="Ends follow the notes" onClick={() => setEnds('follow')}><Follows /></BarButton>
          <BarButton role="radio" checked={ends.mode === 'pinned'} label="Ends pinned: each stays at its spot on the note's edge. Drag an end to move it"
            aria-label="Ends pinned" onClick={() => setEnds('pinned')}><Pinned /></BarButton>
        </div>
        <BarButton ref={anchorOf('label')} label="Label" tip={compact} expanded={open === 'label'} controls="sb-pop-line-label" onClick={() => toggle('label')}>
          <LabelOutlinedIcon aria-hidden />{!compact && 'Label'}
        </BarButton>
        <span className="sb-sep" aria-hidden />
        <BarButton ref={anchorOf('more')} label="More" tip={false} caret expanded={open === 'more'} controls="sb-pop-line-more" onClick={() => toggle('more')}>More</BarButton>
        <BarButton className="sb-danger" label="Delete line" onClick={() => slate.removeSelectedLine?.()}><DeleteOutlineIcon aria-hidden /></BarButton>
      </div>
      <Pop id="sb-pop-line-colour" open={open === 'colour'} onClose={close} anchor={anchors.current.colour} layer={layer} note={noteRect} label="Line colour">
        <div className="sb-swatches" role="radiogroup" aria-label="Line colour">
          {swatches.slice(0, 20).map((s, i) => (
            <button key={s.colour + i} type="button" className="sb-swatch" role="radio" aria-label={s.name} title={s.name} style={{ background: s.colour }}
              aria-checked={v.colour?.toLowerCase() === s.colour.toLowerCase()} data-autofocus={i === 0 ? '' : undefined} onClick={() => colour(s.colour)} />
          ))}
          <button type="button" className="sb-swatch sb-plus" aria-label="Custom colour…" onClick={() => setCustom(true)}>+</button>
        </div>
      </Pop>
      <Pop id="sb-pop-line-custom" open={open === 'colour' && custom} onClose={() => setCustom(false)} anchor={anchors.current.colour} layer={layer} note={noteRect} label="Custom colour" side>
        <CustomColour colour={v.colour} opacity={v.opacity} onCancel={() => setCustom(false)} onUse={(hex, opacity) => { colour(hex, opacity); setCustom(false) }} />
      </Pop>
      <Pop id="sb-pop-line-width" open={open === 'width'} onClose={close} anchor={anchors.current.width} layer={layer} note={noteRect} label="Thickness">
        <Choices label="Thickness" value={width} options={LINE_WIDTHS.map((w) => ({ key: w.key, name: w.name, text: w.name }))}
          onPick={(key) => send('lineWidth', LINE_WIDTHS.find((w) => w.key === key).width)} />
      </Pop>
      <Pop id="sb-pop-line-label" open={open === 'label'} onClose={close} anchor={anchors.current.label} layer={layer} note={noteRect} label="Label" takeFocus>
        <form className="sb-field" style={{ display: 'grid', gap: 8, width: 240 }} onSubmit={(e) => { e.preventDefault(); clearTimeout(labelTimer.current); send('label', label.trim()); close(true) }}>
          <label><span className="sb-label">Label on the line</span>
            <input type="text" value={label} maxLength={120} data-autofocus="" onChange={(e) => {
              setLabel(e.target.value)
              clearTimeout(labelTimer.current)
              const next = e.target.value
              labelTimer.current = setTimeout(() => send('label', next.trim()), 400)
            }} />
          </label>
          <div className="sb-actions">
            {v.label && <button type="button" className="sb-quiet" onClick={() => { clearTimeout(labelTimer.current); setLabel(''); send('label', ''); close(true) }}>Remove label</button>}
            <button type="submit" className="sb-primary">Done</button>
          </div>
        </form>
      </Pop>
      <Pop id="sb-pop-line-more" open={open === 'more'} onClose={close} anchor={anchors.current.more} layer={layer} note={noteRect} label="More" side>
        <div style={{ display: 'grid', gap: 6, width: 280 }}>
          {phone && (
            <>
              <div className="sb-label">Thickness</div>
              <Choices label="Thickness" value={width} options={LINE_WIDTHS.map((w) => ({ key: w.key, name: w.name, text: w.name }))}
                onPick={(key) => send('lineWidth', LINE_WIDTHS.find((w) => w.key === key).width)} />
              <div className="sb-label" style={{ marginTop: 6 }}>Path</div>
              <Choices label="Path" value={v.elbow ? 'elbow' : 'curved'} options={[{ key: 'curved', name: 'Curved', text: 'Curved' }, { key: 'elbow', name: 'Elbow', text: 'Elbow' }]}
                onPick={(key) => send('lineType', key === 'elbow' ? 'orthogonal' : 'bezier')} />
              <div className="sb-label" style={{ marginTop: 6 }}>Pattern</div>
            </>
          )}
          {!phone && <div className="sb-label">Pattern</div>}
          <Choices label="Pattern" value={v.dash} options={[{ key: 'solid', name: 'Solid', text: 'Solid' }, { key: 'dashed', name: 'Dashed', text: 'Dashed' }, { key: 'dotted', name: 'Dotted', text: 'Dotted' }]}
            onPick={(key) => send('lineDash', key)} />
          {!v.elbow && (
            <>
              <div className="sb-label" style={{ marginTop: 6 }}>Curve</div>
              <Choices label="Curve" value={v.curveType} options={[{ key: 'cubic', name: 'Smooth', text: 'Smooth' }, { key: 'quadratic', name: 'Simple', text: 'Simple' }]}
                onPick={(key) => send('lineCurveType', key)} />
              <label className="sb-field" style={{ display: 'grid', gap: 4 }}>
                <span className="sb-value">How much it bends</span>
                <input type="range" min="0.01" max="1" step="0.01" value={bendDraft} aria-label="How much it bends"
                  onChange={(e) => { clearTimeout(labelTimer.current); const val = Number(e.target.value); setBendDraft(val); labelTimer.current = setTimeout(() => send('lineCurviness', val), 200) }} />
              </label>
            </>
          )}
          <label className="sb-field" style={{ display: 'grid', gap: 4 }}>
            <span className="sb-label" style={{ marginTop: 6 }}>Exact thickness</span>
            <input type="range" min="1" max="30" step="1" value={widthDraft} aria-label="Exact thickness"
              onChange={(e) => { clearTimeout(labelTimer.current); const val = Number(e.target.value); setWidthDraft(val); labelTimer.current = setTimeout(() => send('lineWidth', val), 200) }} />
          </label>
          <div className="sb-label" style={{ marginTop: 6 }}>Effect</div>
          <Choices label="Effect" value={v.effect || ''}
            options={['', 'dropShadow', 'blur', 'postItNote', 'pencil'].map((id) => ({ key: id, name: effectName(id), text: effectName(id) }))}
            onPick={(key) => send('lineEffect', key)} />
        </div>
      </Pop>
    </>
  )
}

export { DEFAULT_SWATCHES }
