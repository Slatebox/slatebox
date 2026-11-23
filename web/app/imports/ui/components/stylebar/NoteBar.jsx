import React from 'react'
import { Meteor } from 'meteor/meteor'
import { Slatebox } from 'slateboxjs'
import { useAtom, useSetAtom } from 'jotai'
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft'
import FormatAlignCenterIcon from '@mui/icons-material/FormatAlignCenter'
import FormatAlignRightIcon from '@mui/icons-material/FormatAlignRight'
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop'
import VerticalAlignCenterIcon from '@mui/icons-material/VerticalAlignCenter'
import VerticalAlignBottomIcon from '@mui/icons-material/VerticalAlignBottom'
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import MoreHorizIcon from '@mui/icons-material/MoreHoriz'
import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import AlignHorizontalLeftIcon from '@mui/icons-material/AlignHorizontalLeft'
import AlignHorizontalCenterIcon from '@mui/icons-material/AlignHorizontalCenter'
import AlignHorizontalRightIcon from '@mui/icons-material/AlignHorizontalRight'
import AlignVerticalTopIcon from '@mui/icons-material/AlignVerticalTop'
import AlignVerticalCenterIcon from '@mui/icons-material/AlignVerticalCenter'
import AlignVerticalBottomIcon from '@mui/icons-material/AlignVerticalBottom'
import ViewWeekOutlinedIcon from '@mui/icons-material/ViewWeekOutlined'
import TableRowsOutlinedIcon from '@mui/icons-material/TableRowsOutlined'
// A line from a note (the hollow circle its end handle carries) to a free end (the diamond).
const LineIcon = () => <svg viewBox="0 0 24 24" aria-hidden className="sb-line-icon"><circle cx="6" cy="17" r="3" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M8.5 15 L 15.5 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeDasharray="3 2.5" /><path d="M18 3.5 L 21.5 7 L 18 10.5 L 14.5 7 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
const LINE_TIP = 'Draw a line from this note: click a note to connect to it, or anywhere on the canvas to leave the end free. Esc cancels.'
import CONSTANTS from '../../../api/common/constants'
import defaultShapes from '../node/defaultShapes'
import {
  SIZES, sizeChoice, sizePackage, selectionStyle, barControls, moreRows, panelsStillShown, fillPackages, borderPackages,
  textColourPackage, alignPackage, shapePackage, customShapePackage, fontPackage, boldPackage, effectPackage, animationPackage,
  imagePackage, linkPackage, lockPackage, orderPackage, copyStyleOf, pasteStylePackages, recentColoursAfter,
  MIN_SIZE, MAX_SIZE,
} from '../../../api/common/note-style.mjs'
import { recentColoursBySlate, copiedNoteStyle, globalMessage, registrationDetails } from '../../jotai/atoms'
import { BarButton, Pop, Sheet, Choices, useRoving, focusInto } from './parts'
import { ColourPanel, CustomColour, useSlateColours } from './ColourPanel'
import { MoreRows, Back, FontPanel, PicturePanel, EffectsPanel, LinkPanel, OrderPanel } from './MoreMenu'
import ShapeMaker, { ShapePreview } from '../shapes/ShapeMaker'

const ALIGN_X = [
  { key: 'left', name: 'Left', icon: <FormatAlignLeftIcon /> },
  { key: 'middle', name: 'Centre', icon: <FormatAlignCenterIcon /> },
  { key: 'right', name: 'Right', icon: <FormatAlignRightIcon /> },
]
const ALIGN_Y = [
  { key: 'top', name: 'Top', icon: <VerticalAlignTopIcon /> },
  { key: 'middle', name: 'Middle', icon: <VerticalAlignCenterIcon /> },
  { key: 'bottom', name: 'Bottom', icon: <VerticalAlignBottomIcon /> },
]

function ShapeIcon({ path }) {
  return <svg viewBox="0 0 24 24" aria-hidden><path d={path} fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.4" /></svg>
}

function useRecent(slateId) {
  const [all, setAll] = useAtom(recentColoursBySlate)
  const key = `sb-recent-colours:${slateId}`
  const list = all[slateId] ?? (() => { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } })()
  const add = (colour) => {
    const next = recentColoursAfter(list, colour)
    setAll((prev) => ({ ...prev, [slateId]: next }))
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* private window */ }
  }
  return [Array.isArray(list) ? list : [], add]
}

/** Your most recent custom shapes (the shape library), for one tap. */
function RecentShapes({ onCustom }) {
  const [shapes, setShapes] = React.useState([])
  React.useEffect(() => {
    if (!Meteor.userId() || Meteor.user()?.isAnonymous) return
    Meteor.callAsync('shapes.list', { scope: 'all', limit: 8 }).then((r) => setShapes(r?.shapes ?? []), () => setShapes([]))
  }, [])
  if (!shapes.length) return null
  return (
    <>
      <div className="sb-label" style={{ marginTop: 10 }}>Your shapes</div>
      <div className="sb-shapes" role="group" aria-label="Your shapes">
        {shapes.map((s) => (
          <BarButton key={s.id} label={s.name} onClick={() => onCustom(s)}><ShapePreview shape={s} fill="currentColor" stroke="currentColor" label={false} size={24} /></BarButton>
        ))}
      </div>
    </>
  )
}

/** Shapes: every built-in shape, named, your custom shapes, a shape from words, and the icon search. */
function ShapePanel({ onShape, onRegister, onCustom, onDescribe }) {
  const [query, setQuery] = React.useState('')
  const [found, setFound] = React.useState([])
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
  async function search(e) {
    e.preventDefault()
    if (!query.trim() || busy) return
    if (Meteor.user()?.isAnonymous) { onRegister?.('Want to search icons? It takes a second to register.'); return }
    setBusy(true)
    setProblem('')
    try {
      const res = await Meteor.callAsync(CONSTANTS.methods.nounProject.get, { limit: 15, query: query.trim(), page: 1 })
      setFound(res?.data ?? [])
      if (!res?.data?.length) setProblem('No icons found. Try other words.')
    } catch (err) { setProblem(err.reason || 'Icons could not be searched just now.') }
    finally { setBusy(false) }
  }
  return (
    <div style={{ width: 268 }}>
      <div className="sb-label">Shape</div>
      <div className="sb-shapes" role="group" aria-label="Shapes">
        {defaultShapes.map((s, i) => (
          <BarButton key={s.key} label={s.name} data-autofocus={i === 0 ? '' : undefined}
            onClick={() => onShape({ path: s.path, hint: s.key })}><ShapeIcon path={s.path} /></BarButton>
        ))}
      </div>
      {onCustom && <RecentShapes onCustom={onCustom} />}
      {onDescribe && (
        <button type="button" className="sb-primary" style={{ marginTop: 10, width: '100%' }} onClick={onDescribe}>Describe a shape…</button>
      )}
      <form className="sb-field" style={{ display: 'flex', gap: 6, marginTop: 10 }} onSubmit={search}>
        <input type="search" aria-label="Search icons" placeholder="Search icons…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="sb-primary" disabled={busy || !query.trim()}>{busy ? '…' : 'Search'}</button>
      </form>
      {problem && <p className="sb-error" role="alert">{problem}</p>}
      {found.length > 0 && (
        <div className="sb-results" role="group" aria-label="Icons found">
          {found.map((icon) => (
            <button key={icon.id} type="button" aria-label={`Use icon: ${icon.title || 'icon'}`}
              onClick={() => onShape({ path: icon.path, hint: 'custom', width: icon.width, height: icon.height })}>
              <svg viewBox={`0 0 ${icon.width || 100} ${icon.height || 100}`} aria-hidden><path d={icon.path} fill="currentColor" /></svg>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The bar for one note or several. Every change goes to `send`, which the canvas page passes
 * through updateNode (packageUp, collab.invoke, collab.send): saved, shared and undoable.
 */
export default function NoteBar({
  slate, nodes, mode, send, onAsk, canAsk, layer, barRef, noteRect, onDone, phoneSheet, setPhoneSheet,
}) {
  const [open, setOpen] = React.useState(null)
  const [colourTab, setColourTab] = React.useState('fill')
  const [custom, setCustom] = React.useState(null)
  const [moreView, setMoreView] = React.useState(null)
  const [sizeDraft, setSizeDraft] = React.useState('')
  const [copied, setCopied] = useAtom(copiedNoteStyle)
  const setMessage = useSetAtom(globalMessage)
  const setRegistration = useSetAtom(registrationDetails)
  const anchors = React.useRef({})
  const slateId = slate?.options?.id
  const [recent, addRecent] = useRecent(slateId)
  const slateColours = useSlateColours(slate?.options?.basedOnThemeId)
  const v2 = slate?.v2
  const several = nodes.length > 1
  const options = nodes.map((n) => n.options)
  const style = selectionStyle(options)
  const show = barControls(options)
  const locked = options.some((o) => o.isLocked)
  // The line tool: a line from this note to another note, or to anywhere, without making a note.
  const engine = slate?.v2 ?? slate
  const [drawing, setDrawing] = React.useState(false)
  const canLine = !several && !locked && engine?.capabilitiesOf?.(nodes[0])?.canConnect !== false && typeof engine?.startLineFrom === 'function'
  const drawLine = () => {
    if (drawing) { engine.cancelLineTool?.(); return }
    setDrawing(true)
    Promise.resolve(engine.startLineFrom(nodes[0])).finally(() => setDrawing(false))
  }
  const template = Boolean(slate?.options?.basedOnTemplate)
  const rows = moreRows(options, { copiedStyle: copied, template, phone: mode === 'phone', animations: slate?.filters?.availableAnimations ?? {} })
    .filter((r) => !locked || ['locked', 'copy-picture', 'selection-svg', 'order'].includes(r.key))
    .filter((r) => r.key !== 'line' || canLine)
  const register = (message) => setRegistration({ type: 'registration', registrationOpen: true, registrationMessage: message || 'Want to search pictures? It just takes a second to register.' })

  useRoving(barRef, [mode, nodes.length, locked])
  React.useEffect(() => { setOpen(null); setCustom(null); setMoreView(null) }, [nodes.map((n) => n.id).join(',')])
  // A control hidden (by chat, exec or another person) or a lock arriving while its panel is
  // open closes that panel with its button: it cannot keep restyling the note.
  const allRowKeys = moreRows(options, { template, phone: mode === 'phone', animations: slate?.filters?.availableAnimations ?? {} }).map((r) => r.key)
  const shownKey = JSON.stringify([show, allRowKeys, locked])
  React.useEffect(() => {
    const still = panelsStillShown({ open, colourTab, moreView, phoneSheet: mode === 'phone' ? (phoneSheet ?? null) : undefined }, show, allRowKeys, locked)
    if (still.open !== open) { setOpen(still.open); setCustom(null) }
    if (still.moreView !== moreView) setMoreView(still.moreView)
    if (mode === 'phone' && still.phoneSheet !== (phoneSheet ?? null)) { setPhoneSheet?.(still.phoneSheet); setCustom(null) }
  }, [shownKey]) // eslint-disable-line react-hooks/exhaustive-deps
  // A row of More opened (or Back) by mouse or keys: the keyboard follows into what opened.
  const moreOpened = React.useRef(false)
  React.useEffect(() => {
    if (!moreOpened.current) return
    focusInto(document.querySelector(mode === 'phone' ? '.sb-sheet' : '#sb-pop-more'))
  }, [moreView]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = (refocus) => {
    const was = open
    setOpen(null)
    setCustom(null)
    setMoreView(null)
    if (refocus && was) anchors.current[was]?.focus()
  }
  const toggle = (key) => { setCustom(null); setMoreView(null); setOpen((cur) => (cur === key ? null : key)) }
  const anchorOf = (key) => (el) => { anchors.current[key] = el }

  // Each note gets its own packages (a fill with Auto text depends on the note).
  const forEach = (make) => send((node) => [].concat(make(node.options) || []).filter(Boolean))
  const fill = (colour, opacity = 1) => { addRecent(colour); forEach((o) => fillPackages(o, colour, opacity)) }
  const border = (change) => { if (change.colour) addRecent(change.colour); send(borderPackages(change)) }
  const text = (colour, opacity) => { if (colour !== 'auto') addRecent(colour); forEach((o) => textColourPackage(colour, o, opacity)) }
  const size = (n) => { const pkg = sizePackage(n); if (pkg) send([pkg]) }

  // A custom shape on every selected note, each sized from its own width: one change, one undo.
  const [makerOpen, setMakerOpen] = React.useState(false)
  const customShape = (s) => { forEach((o) => customShapePackage(s, o)); Meteor.callAsync('shapes.used', { id: s.id, count: nodes.length }).catch(() => {}) }
  const describeShape = () => {
    if (Meteor.user()?.isAnonymous || !Meteor.userId()) { register('Want to draw shapes with AI? It takes a second to register.'); return }
    close(false)
    setMakerOpen(true)
  }

  async function shape({ path, hint, width, height }) {
    const node = nodes[0]
    const o = node.options
    const box = width ? { width, height } : Slatebox.utils.getBBox({ path })
    const rootWidth = o.hasResized ? o.width : 175
    const rootHeight = o.hasResized ? o.height : 100
    const ratio = Math.min(10, Math.max(rootWidth / box.width, rootHeight / box.height))
    try {
      const scaled = await Meteor.callAsync(CONSTANTS.methods.slates.scale, { path, width: ratio, height: ratio })
      send(shapePackage({ path: scaled, hint, width: box.width * ratio, height: box.height * ratio }, o))
    } catch (err) {
      setMessage({ visible: true, text: `The shape could not be changed: ${err.reason || err.message}`, severity: 'error', autoHide: 8000 })
    }
  }

  function copyPicture(kind) {
    const ids = nodes.map((n) => n.id)
    const done = (what) => setMessage({ visible: true, text: `${several ? 'These notes' : 'This note'} ${what} copied to the clipboard.`, severity: 'info', autoHide: 6000 })
    const failed = (err) => setMessage({ visible: true, text: `Could not copy to the clipboard: ${err?.message ?? err}`, severity: 'error', autoHide: 8000 })
    if (kind === 'png') {
      v2.png({ nodes: ids, noBackground: true, asBinary: true }, (blob) => {
        navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(() => done('as a picture was'), failed)
      })
    } else {
      v2.svg({ nodes: ids, noBackground: true }, (res) => {
        navigator.clipboard.writeText(typeof res === 'string' ? res : res?.svg ?? '').then(() => done('as SVG was'), failed)
      })
    }
  }

  function onRow(key) {
    switch (key) {
      case 'locked': send([lockPackage(!style.locked.value)]); break
      // On a phone the line tool is in More: the sheet closes, then a tap on a note or the canvas ends the line.
      case 'line': setPhoneSheet?.(null); close(false); drawLine(); break
      case 'duplicate': slate.duplicateSelection?.(); close(false); break
      case 'copy-style': setCopied(copyStyleOf(options[0])); setMessage({ visible: true, text: 'Style copied. Select notes and choose Paste style in More.', severity: 'info', autoHide: 5000 }); close(false); break
      case 'paste-style': send(pasteStylePackages(copied)); close(false); break
      case 'copy-picture': copyPicture('png'); close(false); break
      case 'selection-svg': copyPicture('svg'); close(false); break
      default: moreOpened.current = true; setMoreView((cur) => (cur === key ? null : key))
    }
  }

  const effects = slate?.filters?.availableFilters ?? {}
  const animations = slate?.filters?.availableAnimations ?? {}
  const moreDetail = moreView && (
    <div>
      <Back onBack={() => { moreOpened.current = true; setMoreView(null) }} title={rows.find((r) => r.key === moreView)?.label ?? ''} />
      {moreView === 'font' && <FontPanel style={style} onFont={(k) => send([fontPackage(k)])} onBold={(on) => send([boldPackage(on)])} />}
      {moreView === 'picture' && <PicturePanel hasPicture={Boolean(options[0].image)} onRegister={() => register()}
        onPick={(item) => { send([imagePackage(item)]); close(false) }} onRemove={() => send([imagePackage(null)])} />}
      {moreView === 'effects' && <EffectsPanel available={effects} animations={animations}
        current={{ vect: several ? null : options[0].filters?.vect, text: several ? null : options[0].filters?.text, animVect: several ? null : options[0].animations?.vect, animText: several ? null : options[0].animations?.text }}
        onEffect={(target, id) => send([effectPackage(target, id)])} onAnimation={(target, id) => send([animationPackage(target, id)])} />}
      {moreView === 'link' && <LinkPanel link={options[0].link}
        onSave={(url) => { const res = linkPackage(url); if (res.pkg) { send([res.pkg]); close(false) } return res }}
        onRemove={() => { send([linkPackage(null, { remove: true }).pkg]); close(false) }} />}
      {moreView === 'order' && <OrderPanel onOrder={(where) => { send([orderPackage(where)]); close(false) }} />}
      {moreView === 'border' && <ColourPanel tab="border" onTab={() => {}} style={style} recent={recent} slateColours={slateColours}
        show={{ border: true }} onFill={fill} onBorder={border} onText={text} onCustom={() => setCustom('border')} />}
      {moreView === 'alignment' && <AlignPanel style={style} onAlign={(a) => send([alignPackage(a)])} />}
    </div>
  )

  const colourPanel = (
    <ColourPanel tab={colourTab} onTab={setColourTab} style={style} recent={recent} slateColours={slateColours}
      show={{ fill: show.fill, border: show.border, text: show.textColour }}
      onFill={fill} onBorder={border} onText={text} onCustom={() => setCustom(colourTab)} />
  )
  const customPanel = custom && (
    <CustomColour
      colour={custom === 'fill' ? style.fill.value : custom === 'border' ? style.border.value : style.textColour.value === 'auto' ? '#1b1f1d' : style.textColour.value}
      opacity={custom === 'fill' ? options[0].opacity ?? 1 : custom === 'border' ? options[0].borderOpacity ?? 1 : options[0].textOpacity ?? 1}
      onCancel={() => setCustom(null)}
      onUse={(hex, opacity) => {
        if (custom === 'fill') fill(hex, opacity)
        else if (custom === 'border') border({ colour: hex, opacity })
        else text(hex, opacity)
        setCustom(null)
      }} />
  )
  const choice = sizeChoice(style.size.mixed ? undefined : style.size.value)
  // The custom size field follows the note's size (a preset, or someone else's change).
  React.useEffect(() => { if (!style.size.mixed && style.size.value) setSizeDraft(String(style.size.value)) }, [style.size.value, style.size.mixed])
  const sizeLabel = style.size.mixed ? 'Mixed' : choice.key === 'custom' ? String(choice.size) : choice.key ?? 'M'

  const sizeGroup = (
    <div className="sb-sizes" role="radiogroup" aria-label="Text size">
      {SIZES.map((s) => (
        <BarButton key={s.key} role="radio" checked={!style.size.mixed && choice.key === s.key} label={s.name} tip={false}
          aria-label={`${s.name} text`} onClick={() => size(s.size)}>{s.key}</BarButton>
      ))}
      <BarButton ref={anchorOf('size')} role="radio" checked={!style.size.mixed && choice.key === 'custom'} tip={false}
        label={choice.key === 'custom' ? `Custom size, ${choice.size}` : 'Custom size'} expanded={open === 'size'} controls="sb-pop-size"
        onClick={() => { setSizeDraft(String(choice.size ?? style.size.value ?? 18)); toggle('size') }}>
        {choice.key === 'custom' ? `✓ ${choice.size}` : 'Custom'}
      </BarButton>
    </div>
  )
  const sizePop = (
    <Pop id="sb-pop-size" open={open === 'size'} onClose={close} anchor={anchors.current.size} layer={layer} note={noteRect} label="Text size" takeFocus={mode !== 'compact'}>
      {mode === 'compact' && (
        <div className="sb-sizes" role="radiogroup" aria-label="Text size" style={{ marginBottom: 8 }}>
          {SIZES.map((s) => (
            <BarButton key={s.key} role="radio" checked={!style.size.mixed && choice.key === s.key} label={`${s.name} text`} tip={false}
              data-autofocus={choice.key === s.key ? '' : undefined} onClick={() => size(s.size)}>{s.key}</BarButton>
          ))}
        </div>
      )}
      <form className="sb-field" style={{ display: 'flex', gap: 6, alignItems: 'end' }} onSubmit={(e) => { e.preventDefault(); size(Number(sizeDraft)); close(true) }}>
        <label style={{ display: 'grid', gap: 4 }}>
          <span className="sb-label" style={{ margin: 0 }}>Custom size</span>
          <input type="number" min={MIN_SIZE} max={MAX_SIZE} value={sizeDraft} style={{ width: 90 }} data-autofocus={mode === 'compact' ? undefined : ''}
            onChange={(e) => setSizeDraft(e.target.value)} />
        </label>
        <button type="submit" className="sb-primary" disabled={!sizePackage(Number(sizeDraft))}>Apply</button>
      </form>
    </Pop>
  )

  const fillDot = <span className={`sb-dot ${style.fill.mixed ? 'sb-mixed' : ''}`} style={{ background: style.fill.value }} aria-hidden />
  const textMark = (
    <span className="sb-textmark" aria-hidden>A<i style={{ background: style.textColour.mixed ? 'linear-gradient(90deg,#1b1f1d 50%,#fff 50%)' : style.textColour.value === 'auto' ? 'linear-gradient(90deg,#1b1f1d 50%,#fff 50%)' : style.textColour.value }} /></span>
  )
  const isGroup = several && (() => { const g = options.map((o) => o.groupId || null); return g[0] && g.every((x) => x === g[0]) })()

  const shapeMaker = (
    <ShapeMaker open={makerOpen} onClose={() => setMakerOpen(false)} target={nodes.length}
      fill={options[0]?.backgroundColor} stroke={options[0]?.borderColor || '#333'} onApply={customShape} />
  )

  if (mode === 'phone') {
    return (
      <>
        {shapeMaker}
        <div ref={barRef} className="sb-style-bar" data-mode="phone" role="toolbar" aria-label={several ? `${nodes.length} notes` : 'Note'}>
          {!locked && (show.fill || show.border || show.textColour) && (
            <BarButton className="sb-phone-btn" tip={false} label="Colour" expanded={phoneSheet === 'colour'} onClick={() => setPhoneSheet('colour')}>
              {fillDot}<span>Colour</span>
            </BarButton>
          )}
          {!locked && (show.sizes || show.shape) && (
            <BarButton className="sb-phone-btn" tip={false} label="Style" expanded={phoneSheet === 'style'} onClick={() => setPhoneSheet('style')}>
              <PaletteOutlinedIcon aria-hidden /><span>Style</span>
            </BarButton>
          )}
          {canAsk && show.ask && (
            <BarButton className="sb-phone-btn" tip={false} label={several ? `Ask Slatebox about these ${nodes.length} notes` : 'Ask Slatebox about this note'} onClick={() => onAsk(nodes)}>
              <AutoAwesomeIcon aria-hidden /><span>Ask</span>
            </BarButton>
          )}
          <BarButton className="sb-phone-btn" tip={false} label="More" expanded={phoneSheet === 'more'} onClick={() => setPhoneSheet('more')}>
            <MoreHorizIcon aria-hidden /><span>More</span>
          </BarButton>
          {!locked && (
            <BarButton className="sb-phone-btn sb-danger" tip={false} label="Delete" onClick={() => slate.deleteSelection?.()}>
              <DeleteOutlineIcon aria-hidden /><span>Delete</span>
            </BarButton>
          )}
        </div>
        {phoneSheet === 'colour' && (
          <Sheet title="Colour" onClose={() => setPhoneSheet(null)}>
            {custom ? customPanel : colourPanel}
          </Sheet>
        )}
        {phoneSheet === 'style' && (
          <Sheet title="Style" onClose={() => setPhoneSheet(null)}>
            {custom ? customPanel : (
              <>
                {show.fill && (
                  <>
                    <div className="sb-label">Fill colour</div>
                    <div className="sb-swatches" role="radiogroup" aria-label="Fill colour">
                      {slateColours.map((s) => (
                        <button key={s.colour} type="button" className="sb-swatch" role="radio" aria-label={s.name}
                          aria-checked={!style.fill.mixed && style.fill.value === s.colour} style={{ background: s.colour }} onClick={() => fill(s.colour)} />
                      ))}
                      <button type="button" className="sb-swatch sb-plus" aria-label="Custom fill colour…" onClick={() => setCustom('fill')}>+</button>
                    </div>
                  </>
                )}
                {show.textColour && (
                  <>
                    <div className="sb-label" style={{ marginTop: 12 }}>Text colour</div>
                    <Choices label="Text colour" value={style.textColour.mixed ? null : style.textColour.value === 'auto' ? 'auto' : style.textColour.value}
                      options={[
                        { key: 'auto', name: 'Auto', text: 'Auto' },
                        { key: '#1b1f1d', name: 'Dark', icon: <span className="sb-dot" style={{ background: '#1b1f1d', width: 22, height: 22 }} /> },
                        { key: '#ffffff', name: 'White', icon: <span className="sb-dot" style={{ background: '#fff', width: 22, height: 22 }} /> },
                      ]}
                      onPick={(k) => text(k)} />
                    <button type="button" className="sb-quiet" onClick={() => setCustom('text')}>Other text colour…</button>
                  </>
                )}
                {show.sizes && (
                  <>
                    <div className="sb-label" style={{ marginTop: 12 }}>Text size</div>
                    <div className="sb-sizes" role="radiogroup" aria-label="Text size">
                      {SIZES.map((s) => (
                        <BarButton key={s.key} role="radio" tip={false} checked={!style.size.mixed && choice.key === s.key} label={`${s.name} text`} onClick={() => size(s.size)}>{s.key}</BarButton>
                      ))}
                    </div>
                    <form className="sb-field" style={{ display: 'flex', gap: 6, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); size(Number(sizeDraft)) }}>
                      <input type="number" aria-label="Custom size" min={MIN_SIZE} max={MAX_SIZE} placeholder={`Custom (${sizeLabel})`} value={sizeDraft} onChange={(e) => setSizeDraft(e.target.value)} />
                      <button type="submit" className="sb-primary" disabled={!sizePackage(Number(sizeDraft))}>Apply</button>
                    </form>
                  </>
                )}
                {show.shape && (
                  <>
                    <div className="sb-label" style={{ marginTop: 12 }}>Shape</div>
                    {open === 'shape' ? <ShapePanel onShape={shape} onRegister={register} onCustom={customShape} onDescribe={describeShape} /> : (
                      <div className="sb-choices" role="group" aria-label="Shape">
                        {['roundedRect', 'circle', 'rhombus', 'triangle'].map((k) => {
                          const s = defaultShapes.find((d) => d.key === k)
                          return s && <BarButton key={k} label={s.name} onClick={() => shape({ path: s.path, hint: s.key })}><ShapeIcon path={s.path} /></BarButton>
                        })}
                        <BarButton label="All shapes" tip={false} onClick={() => setOpen('shape')}>All</BarButton>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </Sheet>
        )}
        {phoneSheet === 'more' && (
          <Sheet title={several ? `${nodes.length} notes` : (options[0].text || 'Note').slice(0, 40)} onClose={() => setPhoneSheet(null)}>
            {custom ? customPanel : moreDetail || <MoreRows rows={rows} open={moreView} onRow={onRow} />}
          </Sheet>
        )}
      </>
    )
  }

  const compact = mode === 'compact'
  return (
    <>
      {shapeMaker}
      <div ref={barRef} className="sb-style-bar" data-mode={mode} role="toolbar" aria-label={several ? `${nodes.length} notes` : 'Note'}>
        {several && <span className="sb-count">{nodes.length} notes</span>}
        {!locked && show.fill && (
          <BarButton ref={anchorOf('colour-fill')} label="Fill colour" caret expanded={open === 'colour' && colourTab === 'fill'} controls="sb-pop-colour"
            onClick={() => { setColourTab('fill'); setOpen((c) => (c === 'colour' && colourTab === 'fill' ? null : 'colour')); setCustom(null); anchors.current.colour = anchors.current['colour-fill'] }}>
            {fillDot}
          </BarButton>
        )}
        {!locked && show.border && (
          <BarButton ref={anchorOf('colour-border')} label="Border" caret expanded={open === 'colour' && colourTab === 'border'} controls="sb-pop-colour"
            onClick={() => { setColourTab('border'); setOpen((c) => (c === 'colour' && colourTab === 'border' ? null : 'colour')); setCustom(null); anchors.current.colour = anchors.current['colour-border'] }}>
            <CropSquareIcon aria-hidden style={{ color: style.border.mixed ? undefined : style.border.value || undefined }} />
          </BarButton>
        )}
        {!locked && show.textColour && (
          <BarButton ref={anchorOf('colour-text')} label="Text colour" caret expanded={open === 'colour' && colourTab === 'text'} controls="sb-pop-colour"
            onClick={() => { setColourTab('text'); setOpen((c) => (c === 'colour' && colourTab === 'text' ? null : 'colour')); setCustom(null); anchors.current.colour = anchors.current['colour-text'] }}>
            {textMark}
          </BarButton>
        )}
        {!locked && show.sizes && <span className="sb-sep" aria-hidden />}
        {!locked && show.sizes && (compact
          ? <BarButton ref={anchorOf('size')} label={`Text size: ${sizeLabel}`} tip={false} caret expanded={open === 'size'} controls="sb-pop-size"
              onClick={() => { setSizeDraft(String(choice.size ?? style.size.value ?? 18)); toggle('size') }}>Size: {sizeLabel}</BarButton>
          : sizeGroup)}
        {!locked && show.align && (
          <BarButton ref={anchorOf('align')} label="Alignment" caret expanded={open === 'align'} controls="sb-pop-align" onClick={() => toggle('align')}>
            {(ALIGN_X.find((a) => a.key === (style.alignX.value || 'middle')) ?? ALIGN_X[1]).icon}
          </BarButton>
        )}
        {!locked && (show.shape || several) && <span className="sb-sep" aria-hidden />}
        {!locked && show.shape && (
          <BarButton ref={anchorOf('shape')} label="Shape" caret expanded={open === 'shape'} controls="sb-pop-shape" onClick={() => toggle('shape')}>
            <CategoryOutlinedIcon aria-hidden />
          </BarButton>
        )}
        {canLine && (
          <BarButton label={LINE_TIP} aria-label="Line" pressed={drawing} onClick={drawLine}>
            <LineIcon />{!compact && 'Line'}
          </BarButton>
        )}
        {!locked && several && (
          <>
            <BarButton ref={anchorOf('arrange')} label="Arrange" caret expanded={open === 'arrange'} controls="sb-pop-arrange" onClick={() => toggle('arrange')}>
              <AlignHorizontalLeftIcon aria-hidden />
            </BarButton>
            <BarButton label={isGroup ? 'Ungroup' : 'Group'} tip={false} onClick={() => (isGroup ? slate.ungroupNodes(nodes) : slate.groupNodes(nodes))}>
              {isGroup ? 'Ungroup' : 'Group'}
            </BarButton>
          </>
        )}
        <span className="sb-sep" aria-hidden />
        {canAsk && show.ask && (
          <BarButton className="sb-ask" tip={compact || several}
            label={several ? `Ask Slatebox about these ${nodes.length} notes` : 'Ask Slatebox about this note'} onClick={() => onAsk(nodes)}>
            <AutoAwesomeIcon aria-hidden style={{ width: 16, height: 16 }} />{compact ? 'Ask' : 'Ask Slatebox'}
          </BarButton>
        )}
        <BarButton ref={anchorOf('more')} label="More" tip={false} caret expanded={open === 'more'} controls="sb-pop-more" onClick={() => toggle('more')}>More</BarButton>
        {!locked && (
          <BarButton className="sb-danger" label={several ? `Delete ${nodes.length} notes` : 'Delete'} onClick={() => slate.deleteSelection?.()}>
            <DeleteOutlineIcon aria-hidden />
          </BarButton>
        )}
      </div>
      <Pop id="sb-pop-colour" open={open === 'colour'} onClose={close} anchor={anchors.current.colour} layer={layer} note={noteRect} label="Colour">
        {colourPanel}
      </Pop>
      <Pop id="sb-pop-custom" open={open === 'colour' && Boolean(custom)} onClose={() => setCustom(null)} anchor={anchors.current.colour} layer={layer} note={noteRect} label="Custom colour" side>
        {customPanel}
      </Pop>
      {sizePop}
      <Pop id="sb-pop-align" open={open === 'align'} onClose={close} anchor={anchors.current.align} layer={layer} note={noteRect} label="Alignment">
        <AlignPanel style={style} onAlign={(a) => send([alignPackage(a)])} />
      </Pop>
      <Pop id="sb-pop-shape" open={open === 'shape'} onClose={close} anchor={anchors.current.shape} layer={layer} note={noteRect} label="Shape">
        <ShapePanel onShape={shape} onRegister={register} onCustom={customShape} onDescribe={describeShape} />
      </Pop>
      <Pop id="sb-pop-arrange" open={open === 'arrange'} onClose={close} anchor={anchors.current.arrange} layer={layer} note={noteRect} label="Arrange">
        <ArrangePanel count={nodes.length} onAlign={(m) => slate.alignNodes(m, nodes)} onDistribute={(axis) => slate.distributeNodes(axis, nodes)} />
      </Pop>
      <Pop id="sb-pop-more" open={open === 'more'} onClose={close} anchor={anchors.current.more} layer={layer} note={noteRect} label="More" side>
        {moreDetail || <MoreRows rows={rows} open={moreView} onRow={onRow} />}
      </Pop>
      <Pop id="sb-pop-more-custom" open={open === 'more' && Boolean(custom)} onClose={() => setCustom(null)} anchor={anchors.current.more} layer={layer} note={noteRect} label="Custom colour" side>
        {customPanel}
      </Pop>
    </>
  )
}

function AlignPanel({ style, onAlign }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <Choices label="Across" value={style.alignX.mixed ? null : style.alignX.value || 'middle'} options={ALIGN_X} onPick={(x) => onAlign({ x })} />
      <Choices label="Up and down" value={style.alignY.mixed ? null : style.alignY.value || 'middle'} options={ALIGN_Y} onPick={(y) => onAlign({ y })} />
    </div>
  )
}

function ArrangePanel({ count, onAlign, onDistribute }) {
  const item = (label, icon, act, disabled = false) => (
    <BarButton label={label} onClick={act} disabled={disabled}>{icon}</BarButton>
  )
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div className="sb-label">Line up</div>
      <div className="sb-choices" role="group" aria-label="Line up">
        {item('Line up left edges', <AlignHorizontalLeftIcon />, () => onAlign('left'))}
        {item('Line up centres across', <AlignHorizontalCenterIcon />, () => onAlign('centerH'))}
        {item('Line up right edges', <AlignHorizontalRightIcon />, () => onAlign('right'))}
        {item('Line up top edges', <AlignVerticalTopIcon />, () => onAlign('top'))}
        {item('Line up middles', <AlignVerticalCenterIcon />, () => onAlign('middle'))}
        {item('Line up bottom edges', <AlignVerticalBottomIcon />, () => onAlign('bottom'))}
      </div>
      {count >= 3 && (
        <>
          <div className="sb-label">Space evenly</div>
          <div className="sb-choices" role="group" aria-label="Space evenly">
            {item('Space evenly across', <ViewWeekOutlinedIcon />, () => onDistribute('horizontal'))}
            {item('Space evenly up and down', <TableRowsOutlinedIcon />, () => onDistribute('vertical'))}
          </div>
        </>
      )}
    </div>
  )
}
