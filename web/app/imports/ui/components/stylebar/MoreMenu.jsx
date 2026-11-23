import React from 'react'
import { Meteor } from 'meteor/meteor'
import PayNotice from '../PayNotice'
import TextFieldsIcon from '@mui/icons-material/TextFields'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import AutoAwesomeMotionIcon from '@mui/icons-material/AutoAwesomeMotion'
import LinkIcon from '@mui/icons-material/Link'
import LockOutlinedIcon from '@mui/icons-material/LockOutlined'
import FlipToFrontIcon from '@mui/icons-material/FlipToFront'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import BrushOutlinedIcon from '@mui/icons-material/BrushOutlined'
import FormatPaintIcon from '@mui/icons-material/FormatPaint'
import PhotoCameraOutlinedIcon from '@mui/icons-material/PhotoCameraOutlined'
import CodeIcon from '@mui/icons-material/Code'
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined'
import BorderStyleIcon from '@mui/icons-material/BorderStyle'
import FormatAlignCenterIcon from '@mui/icons-material/FormatAlignCenter'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import CONSTANTS from '../../../api/common/constants'
import { FONTS, effectName } from '../../../api/common/note-style.mjs'

const ICONS = {
  border: BorderStyleIcon, alignment: FormatAlignCenterIcon, font: TextFieldsIcon, picture: ImageOutlinedIcon,
  effects: AutoAwesomeMotionIcon, link: LinkIcon, locked: LockOutlinedIcon, order: FlipToFrontIcon,
  duplicate: ContentCopyIcon, 'copy-style': BrushOutlinedIcon, 'paste-style': FormatPaintIcon,
  'copy-picture': PhotoCameraOutlinedIcon, 'selection-svg': CodeIcon, behaviour: SettingsOutlinedIcon,
}
// Rows that open a list of their own (the rest act at once).
const OPENS = new Set(['border', 'alignment', 'font', 'picture', 'effects', 'link', 'order'])

/** The rows of More, each with its current value. */
export function MoreRows({ rows, open, onRow }) {
  return (
    <div className="sb-menu" role="group" aria-label="More">
      {rows.map((row, i) => {
        const Icon = ICONS[row.key]
        return (
          <React.Fragment key={row.key}>
            {row.divider && i > 0 && <div className="sb-row-sep" aria-hidden />}
            <button type="button" className="sb-row" data-autofocus={(open ? row.key === open : i === 0) ? '' : undefined}
              aria-label={row.value && !row.toggle ? `${row.label}: ${row.value}` : row.label}
              role={row.toggle ? 'switch' : undefined} aria-checked={row.toggle ? row.value === 'On' : undefined}
              aria-expanded={OPENS.has(row.key) ? open === row.key : undefined}
              onClick={() => onRow(row.key)}>
              {Icon ? <Icon aria-hidden /> : <span />}
              <span>{row.label}</span>
              {row.toggle
                ? <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><span className="sb-value">{row.value}</span><span className="sb-switch" data-on={row.value === 'On'} aria-hidden /></span>
                : <span className="sb-value">{row.value ?? ''}</span>}
              {OPENS.has(row.key) ? <ChevronRightIcon aria-hidden /> : <span />}
            </button>
          </React.Fragment>
        )
      })}
    </div>
  )
}

export function Back({ onBack, title }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
      <button type="button" className="sb-quiet" aria-label="Back to More" onClick={onBack} style={{ padding: 6 }}><ArrowBackIcon fontSize="small" /></button>
      <span className="sb-label" style={{ margin: 0 }}>{title}</span>
    </div>
  )
}

/** Font: four fonts in a 2x2 grid, each written in its own lettering, and Bold. */
export function FontPanel({ style, onFont, onBold }) {
  const current = style.font.mixed ? null : style.font.value
  return (
    <div>
      <div className="sb-fonts" role="radiogroup" aria-label="Font">
        {FONTS.map((f) => (
          <button key={f.key} type="button" className="sb-font" role="radio" aria-checked={current === f.key}
            data-autofocus={current === f.key ? '' : undefined} onClick={() => onFont(f.key)}>
            <span style={{ fontFamily: `'${f.family}'` }} aria-hidden>Aa</span>
            <span>{f.name}</span>
          </button>
        ))}
      </div>
      {current === 'other' && <p className="sb-value" style={{ margin: '8px 0 0' }}>This note uses another font until you pick one.</p>}
      <button type="button" className="sb-row" role="switch" aria-checked={Boolean(style.bold.value)} style={{ marginTop: 8, width: '100%' }}
        onClick={() => onBold(!style.bold.value)}>
        <span style={{ fontWeight: 800 }} aria-hidden>B</span><span>Bold</span>
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <span className="sb-value">{style.bold.mixed ? 'Mixed' : style.bold.value ? 'On' : 'Off'}</span>
          <span className="sb-switch" data-on={Boolean(style.bold.value)} aria-hidden />
        </span><span />
      </button>
    </div>
  )
}

/** Picture: search (on the server, behind the AI meter), pick one, or remove the one there. */
export function PicturePanel({ hasPicture, onPick, onRemove, onRegister }) {
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState({ items: [], more: false, page: 0, query: '' })
  const [busy, setBusy] = React.useState(false)
  const [problem, setProblem] = React.useState('')
  // a refusal by the meter (no Pro, the included amount used up): the pay sheet in place, then this search again
  const [refused, setRefused] = React.useState(null)
  async function search(page = 0) {
    const q = page === 0 ? query.trim() : results.query
    if (!q || busy) return
    setBusy(true)
    setProblem('')
    setRefused(null)
    try {
      const res = await Meteor.callAsync(CONSTANTS.methods.images.search, { query: q, page })
      setResults((prev) => ({ items: page === 0 ? res.items : [...prev.items, ...res.items], more: res.more, page, query: q }))
      if (!res.items.length && page === 0) setProblem('No pictures found. Try other words.')
    } catch (err) {
      if (err.error === 'register') onRegister?.()
      setProblem(err.reason || 'Pictures could not be searched just now.')
      if (err.details?.pay) setRefused({ error: err.error, reason: err.reason, details: err.details, page })
    } finally { setBusy(false) }
  }
  return (
    <div style={{ width: 300 }}>
      <form className="sb-field" style={{ display: 'flex', gap: 6 }} onSubmit={(e) => { e.preventDefault(); search(0) }}>
        <input type="search" aria-label="Search for a picture" placeholder="Search for a picture" value={query} data-autofocus=""
          onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" className="sb-primary" disabled={busy || !query.trim()}>{busy ? 'Searching…' : 'Search'}</button>
      </form>
      <p className="sb-value" style={{ margin: '6px 0 0', fontSize: 12 }}>A search counts as AI use.</p>
      {problem && <p className="sb-error" role="alert">{problem}</p>}
      {refused && <PayNotice plain refusal={refused} from="pictures" retry={() => search(refused.page)} />}
      {results.items.length > 0 && (
        <div className="sb-results" role="group" aria-label="Pictures found">
          {results.items.map((item) => (
            <button key={item.link} type="button" aria-label={`Use picture: ${item.title || 'untitled'}`} onClick={() => onPick(item)}>
              <img src={item.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" />
            </button>
          ))}
        </div>
      )}
      <div className="sb-actions" style={{ marginTop: 8 }}>
        {results.more && <button type="button" className="sb-quiet" disabled={busy} onClick={() => search(results.page + 1)}>More pictures</button>}
        {hasPicture && <button type="button" className="sb-quiet" onClick={onRemove}>Remove picture</button>}
      </div>
    </div>
  )
}

/** Effects and animation, with readable names; "None" clears. */
export function EffectsPanel({ available, current, onEffect, onAnimation, animations }) {
  const list = (target) => ['', ...Object.keys(available).filter((id) => (available[id].types || []).includes(target === 'vect' ? 'vect' : 'text'))]
  const anims = (target) => ['', ...Object.keys(animations).filter((id) => (animations[id].types || []).includes(target))]
  const group = (title, items, value, pick, name = effectName) => (
    <>
      <div className="sb-label" style={{ marginTop: 8 }}>{title}</div>
      <div role="radiogroup" aria-label={title} className="sb-choices">
        {items.map((id) => (
          <button key={id || 'none'} type="button" className="sb-btn" role="radio" aria-checked={(value || '') === id}
            style={{ border: '1px solid var(--sb-border)' }} onClick={() => pick(id)}>{name(id)}</button>
        ))}
      </div>
    </>
  )
  const animName = (id) => (id ? animations[id]?.display || effectName(id) : 'None')
  return (
    <div style={{ width: 320 }}>
      {group('Note effect', list('vect'), current.vect, (id) => onEffect('vect', id))}
      {group('Text effect', list('text'), current.text, (id) => onEffect('text', id))}
      {anims('vect').length > 1 && group('Animation', anims('vect'), current.animVect, (id) => onAnimation('vect', id), animName)}
      {anims('text').length > 1 && group('Text animation', anims('text'), current.animText, (id) => onAnimation('text', id), animName)}
    </div>
  )
}

/** Link: a web address, said wrong in place, and Remove. */
export function LinkPanel({ link, onSave, onRemove }) {
  const [url, setUrl] = React.useState(link?.data || '')
  const [problem, setProblem] = React.useState('')
  return (
    <form className="sb-field" style={{ display: 'grid', gap: 8, width: 280 }} onSubmit={(e) => {
      e.preventDefault()
      const res = onSave(url)
      if (res?.error) setProblem(res.error)
    }}>
      <label>
        <span className="sb-label">Web address</span>
        <input type="text" inputMode="url" autoComplete="url" value={url} placeholder="https://example.com" data-autofocus="" aria-invalid={Boolean(problem)}
          aria-describedby={problem ? 'sb-link-problem' : undefined} onChange={(e) => { setUrl(e.target.value); setProblem('') }} />
      </label>
      {problem && <span id="sb-link-problem" className="sb-error" role="alert">{problem}</span>}
      <div className="sb-actions">
        {link?.show && <button type="button" className="sb-quiet" onClick={onRemove}>Remove link</button>}
        <button type="submit" className="sb-primary">Save link</button>
      </div>
    </form>
  )
}

export function OrderPanel({ onOrder }) {
  return (
    <div className="sb-menu" role="group" aria-label="Order">
      <button type="button" className="sb-row" data-autofocus="" onClick={() => onOrder('front')}><FlipToFrontIcon aria-hidden /><span>Bring to front</span><span /><span /></button>
      <button type="button" className="sb-row" onClick={() => onOrder('back')}><FlipToFrontIcon aria-hidden style={{ transform: 'scaleX(-1)' }} /><span>Send to back</span><span /><span /></button>
    </div>
  )
}
