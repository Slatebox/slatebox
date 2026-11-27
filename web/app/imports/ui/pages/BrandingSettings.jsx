/* eslint-disable no-underscore-dangle */
// /team/branding: the brand kit, on one page. Left, the kit: logos, colors, and the one style every
// slate gets (fonts, note colors, background, presentation bar: the default preset). Right, a live
// preview that follows every edit. Under both, where the brand shows up today, and where it doesn't
// yet. Team admins change it; everyone else in the team sees it read-only.
//
// It saves through the same calls as before (organizationSettings.save and .deletePreset, the
// upload route and images.removeImage), with the same checks on the server. Changes save as they
// are made; Undo walks them back one at a time.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useTracker } from 'meteor/react-meteor-data'
import { Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Collapse from '@mui/material/Collapse'
import Link from '@mui/material/Link'
import LinearProgress from '@mui/material/LinearProgress'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import UndoIcon from '@mui/icons-material/Undo'
import CheckIcon from '@mui/icons-material/CheckCircleOutline'
import ErrorIcon from '@mui/icons-material/ErrorOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import AuthManager from '../../api/common/AuthManager'
import CONSTANTS from '../../api/common/constants'
import { OrganizationSettings } from '../../api/common/models'
import { DEFAULT_PRESET_QUERY, currentLogo, defaultPreset, logoDocs } from '../../api/common/brandSettings.mjs'
import {
  LOGO_TYPES, LOGO_RULES, NOT_YET, ROLES, brandUses, cleanPreset, colorsFromLogo, contrastWarnings,
  LARGE_TEXT_PX, effectiveStyle, paletteOf, presetFromColors, presetIsEmpty,
} from '../components/brand/brandKit.mjs'
import { Section, card } from '../components/brand/ui'
import LogoField from '../components/brand/LogoField'
import ColorsSection from '../components/brand/ColorsSection'
import StyleSection from '../components/brand/StyleSection'
import BrandPreview from '../components/brand/BrandPreview'
import pullColors from '../components/brand/pullColors'
import AppPage, { AppPageHeader } from '../common/AppPage'
import usePhoneView from '../common/usePhoneView'

const SAVE_DELAY = 600

const errorText = (error) => error?.reason || error?.message || 'That did not save. Try again.'

function SaveState({ state, onUndo, canUndo, undoLabel }) {
  const icon = state.kind === 'error' ? <ErrorIcon fontSize="small" color="error" /> : state.kind === 'saved' ? <CheckIcon fontSize="small" sx={{ color: 'success.main' }} /> : null
  const words = { idle: 'Changes save as you make them', saving: 'Saving…', saved: 'All changes saved', error: state.text || 'Not saved' }[state.kind]
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
      <Box role="status" aria-live="polite" data-brand-save-state={state.kind} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        {icon}
        <Typography variant="body2" color={state.kind === 'error' ? 'error' : 'text.secondary'}>{words}</Typography>
      </Box>
      <Button size="small" startIcon={<UndoIcon />} onClick={onUndo} disabled={!canUndo} data-brand-undo="" title={canUndo ? `Undo: ${undoLabel}` : 'Nothing to undo'}>
        {canUndo ? `Undo ${undoLabel.toLowerCase()}` : 'Undo'}
      </Button>
    </Box>
  )
}
SaveState.propTypes = {
  state: PropTypes.shape({ kind: PropTypes.string, text: PropTypes.string }).isRequired,
  onUndo: PropTypes.func.isRequired,
  canUndo: PropTypes.bool.isRequired,
  undoLabel: PropTypes.string.isRequired,
}

export default function BrandingSettings() {
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('md'))
  const phoneView = usePhoneView()
  const [admin, setAdmin] = useState(null)
  const userId = Meteor.userId()
  useEffect(() => {
    let live = true
    if (userId) AuthManager.userHasClaim(userId, [CONSTANTS.claims.admin._id]).then((yes) => live && setAdmin(Boolean(yes)))
    // The client check waits for the person to hold some permission: someone with none is told the
    // page is read-only after a moment (a late answer still counts).
    const wait = setTimeout(() => live && setAdmin((known) => (known === null ? false : known)), 5000)
    return () => { live = false; clearTimeout(wait) }
  }, [userId])

  const { ready, orgId, settings } = useTracker(() => {
    const id = Meteor.user()?.orgId
    if (!id) return { ready: true, orgId: null, settings: [] }
    const ok = Meteor.subscribe(CONSTANTS.publications.organizationSettings).ready()
    return { ready: ok, orgId: id, settings: ok ? OrganizationSettings.find({ orgId: id }).fetch() : [] }
  }, [])

  const live = settings.filter((s) => !s.deleted)
  const palette = useMemo(() => paletteOf(live), [JSON.stringify(live.filter((s) => s.type === 'color'))])
  const typography = useMemo(() => Object.fromEntries(live.filter((s) => s.type === 'typography' && s.value?.name).map((s) => [s.value.name, s.value.value])), [JSON.stringify(live.filter((s) => s.type === 'typography'))])
  // The logo in use is the newest one not removed: the same pick as published presentations make.
  const logos = Object.fromEntries(LOGO_TYPES.map((t) => [t.key, currentLogo(settings, t.key)]))
  // ── The one slate style (the default preset) ──────────────────────────────────────────────
  const styleDoc = defaultPreset(settings)
  const savedPreset = styleDoc?.value || {}
  const savedKey = JSON.stringify(savedPreset)
  const [draft, setDraft] = useState(savedPreset)
  const pending = useRef(null) // { timer, label, value }
  const newId = useRef(null) // the style's id chosen here before the server has it
  useEffect(() => { if (!pending.current) setDraft(savedPreset) }, [savedKey])

  const [saveState, setSaveState] = useState({ kind: 'idle' })
  const [undo, setUndo] = useState([]) // newest last: { label, run }
  const pushUndo = (label, run) => setUndo((u) => [...u.slice(-29), { label, run }])
  const call = async (name, args) => {
    setSaveState({ kind: 'saving' })
    try {
      const out = await Meteor.callAsync(name, args)
      setSaveState({ kind: 'saved' })
      return out
    } catch (error) {
      setSaveState({ kind: 'error', text: errorText(error) })
      throw error
    }
  }

  // Timers and undo steps outlive the render that made them: they read the newest of these.
  const latest = useRef({})
  const savePreset = async (value) => {
    const clean = cleanPreset(value)
    const existing = latest.current.styleDoc
    if (presetIsEmpty(clean)) {
      if (existing || newId.current) await call(CONSTANTS.methods.organizationSettings.deletePreset, { intentionId: DEFAULT_PRESET_QUERY.intentionId })
      newId.current = null
      return
    }
    if (!existing && !newId.current) newId.current = Random.id()
    await call(CONSTANTS.methods.organizationSettings.save, { _id: existing?._id || newId.current, ...DEFAULT_PRESET_QUERY, value: clean, orgId })
  }
  latest.current = { savePreset, styleDoc }

  const flush = useCallback(async () => {
    const p = pending.current
    if (!p) return
    clearTimeout(p.timer)
    pending.current = null
    try { await latest.current.savePreset(p.value) } catch { /* said in the save state */ }
  }, [])

  const editPreset = (next, label) => {
    // One undo step per burst of edits to one field: the value before the burst.
    if (!pending.current || pending.current.label !== label) {
      const before = draft
      pushUndo(label, async () => {
        if (pending.current) { clearTimeout(pending.current.timer); pending.current = null }
        setDraft(before)
        await latest.current.savePreset(before)
      })
    }
    setDraft(next)
    if (pending.current) clearTimeout(pending.current.timer)
    pending.current = { label, value: next, timer: setTimeout(flush, SAVE_DELAY) }
    setSaveState({ kind: 'saving' })
  }
  // Leaving the page saves what is waiting.
  useEffect(() => () => { flush() }, [])

  // ── Colors ────────────────────────────────────────────────────────────────────────────────
  const saveColor = (doc) => call(CONSTANTS.methods.organizationSettings.save, { ...doc, type: 'color', orgId })
  const addColors = async (colors, label = 'Add color') => {
    const ids = []
    for (const c of colors) {
      const _id = Random.id()
      ids.push(_id)
      // A role is held by one color: a new color with a role takes it from the one that had it.
      if (c.role) for (const other of palette.filter((o) => o.role === c.role)) await saveColor({ _id: other._id, value: { name: other.name, value: other.value, role: null } })
      await saveColor({ _id, value: { name: c.name, value: c.value, role: c.role || null } })
    }
    pushUndo(label, async () => { for (const _id of ids) await saveColor({ _id, deleted: true }) })
  }
  const changeColor = async (color, patch) => {
    const before = { name: color.name, value: color.value, role: color.role }
    const after = { ...before, ...patch }
    const taken = patch.role ? palette.filter((o) => o._id !== color._id && o.role === patch.role) : []
    for (const other of taken) await saveColor({ _id: other._id, value: { name: other.name, value: other.value, role: null } })
    await saveColor({ _id: color._id, value: after })
    pushUndo(patch.role !== undefined ? 'Role' : patch.name ? 'Rename' : 'Color', async () => {
      await saveColor({ _id: color._id, value: before })
      for (const other of taken) await saveColor({ _id: other._id, value: { name: other.name, value: other.value, role: other.role } })
    })
  }
  const removeColor = async (color) => {
    await saveColor({ _id: color._id, deleted: true })
    pushUndo('Remove color', () => saveColor({ _id: color._id, deleted: false, value: { name: color.name, value: color.value, role: color.role } }))
  }

  // ── Pull colors from the logo ─────────────────────────────────────────────────────────────
  const [pull, setPull] = useState({ busy: false, error: '', suggestions: null })
  const [applyOffer, setApplyOffer] = useState(null) // after colors are added: offer them to the style
  const logoForColors = logos.squareLogo?.value?.url || logos.primaryLogo?.value?.url || null
  // `quiet`: after an upload, say nothing unless the logo has colors the kit lacks.
  const pullFrom = async (source, { quiet = false } = {}) => {
    setPull({ busy: true, error: '', suggestions: null })
    try {
      const hexes = await pullColors(source)
      const found = colorsFromLogo(hexes, palette)
      setPull({ busy: false, error: '', suggestions: quiet && !found.length ? null : found })
    } catch {
      setPull({ busy: false, error: quiet ? '' : 'Slatebox could not read colors from that logo. Add them by hand instead.', suggestions: null })
    }
  }

  // ── Logos ─────────────────────────────────────────────────────────────────────────────────
  // The newest logo document of the kind (removed or not) is the one edited, so a team with several
  // from the old page edits the one presentations would show.
  const anyLogoDoc = (key) => logoDocs(settings, key)[0] || null
  const saveLogo = async (type, { file, url }) => {
    const doc = anyLogoDoc(type.key)
    const before = logos[type.key]?.value || null
    await call(CONSTANTS.methods.organizationSettings.save, { _id: doc?._id || Random.id(), type: 'logo', value: { logoType: type.key, name: file.name, url }, deleted: false, orgId })
    // The file it replaced is the team's no more.
    if (before?.url && before.url !== url) Meteor.callAsync(CONSTANTS.methods.images.removeImage, { url: before.url }).catch(() => null)
    // A new square logo offers its colors whenever the kit lacks some of them.
    if (type.key === 'squareLogo') pullFrom(file, { quiet: true })
  }
  const removeLogo = async (type) => {
    const doc = anyLogoDoc(type.key)
    if (!doc) return
    // Its value goes too: presentations read a square logo whether or not it is marked deleted.
    await call(CONSTANTS.methods.organizationSettings.save, { _id: doc._id, type: 'logo', value: { logoType: type.key, name: '', url: null }, deleted: true, orgId })
    if (doc.value?.url) Meteor.callAsync(CONSTANTS.methods.images.removeImage, { url: doc.value.url }).catch(() => null)
  }

  // ── Reset ─────────────────────────────────────────────────────────────────────────────────
  const [confirmReset, setConfirmReset] = useState(false)
  const reset = async () => {
    setConfirmReset(false)
    if (pending.current) { clearTimeout(pending.current.timer); pending.current = null }
    const before = draft
    setDraft({})
    await savePreset({})
    pushUndo('Reset', async () => { setDraft(before); await latest.current.savePreset(before) })
  }

  const runUndo = async () => {
    const step = undo[undo.length - 1]
    if (!step) return
    setUndo((u) => u.slice(0, -1))
    try { await step.run() } catch { /* said in the save state */ }
  }

  // ── What the preview and the warnings show ────────────────────────────────────────────────
  const style = useMemo(() => effectiveStyle(draft, typography), [JSON.stringify(draft), typography])
  const warnings = contrastWarnings(style)
  const uses = brandUses({ squareLogo: logos.squareLogo, primaryLogo: logos.primaryLogo, palette, defaultPreset: draft }, { phone: phoneView })
  const editable = admin === true
  // On a phone the preview starts folded (a "Show preview" bar), so the kit's first control is on the
  // first screen; on a wider screen it is always open beside the kit.
  const [previewChoice, setPreviewOpen] = useState(null)
  const previewOpen = previewChoice ?? !phone

  if (!orgId && ready) {
    return (
      <AppPage title="Brand kit"
        subtitle={<>A brand kit belongs to a team. <Link component={RouterLink} to="/team">Make or join a team</Link> to set one up.</>} />
    )
  }

  const kit = (
    <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
      <Section id="logos" title="Logos" intro={LOGO_RULES}>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          {LOGO_TYPES.map((t) => (
            <LogoField key={t.key} type={t} logo={logos[t.key]?.value || null} disabled={!editable}
              onUploaded={(upload) => saveLogo(t, upload)} onRemove={() => removeLogo(t)} />
          ))}
        </Box>
      </Section>

      <Section id="colors" title="Colors" intro="Name your colors and give them roles. Styles pick from them.">
        <ColorsSection palette={palette} disabled={!editable}
          onAdd={(c) => addColors([c])} onChange={changeColor} onRemove={removeColor}
          applyOffer={applyOffer ? {
            title: applyOffer.title,
            onApply: () => {
              setApplyOffer(null)
              editPreset(presetFromColors(palette, draft), 'Use my colors')
            },
            onDismiss: () => setApplyOffer(null),
          } : null}
          pull={{
            available: Boolean(logoForColors), busy: pull.busy, error: pull.error, suggestions: pull.suggestions,
            onPull: () => pullFrom(logoForColors),
            onAdd: async (list) => {
              setPull({ busy: false, error: '', suggestions: null })
              await addColors(list, 'Add colors from logo')
              if (editable) setApplyOffer({ title: list.length === 1 ? '1 color added from your logo.' : `${list.length} colors added from your logo.` })
            },
            onDismiss: () => setPull({ busy: false, error: '', suggestions: null }),
          }} />
      </Section>

      <Section id="style" title="Slate style"
        intro="Fonts, note colors, background and the presentation bar for every slate."
        action={editable && palette.length > 0 ? (
          <Button size="small" variant="outlined" onClick={() => editPreset(presetFromColors(palette, draft), 'Use my colors')} data-brand-use-colors=""
            title={`Headings in your ${ROLES[0].name.toLowerCase()} color, notes in your accent, background in your neutral`}>
            Use my colors
          </Button>
        ) : null}>
        <StyleSection preset={draft} style={style} palette={palette} disabled={!editable} onChange={editPreset} />
        {warnings.length > 0 && (
          <Box role="note" data-brand-contrast-warnings={warnings.length} sx={(t) => ({ borderRadius: '10px', p: 1.5, bgcolor: '#fbefe9', ...t.applyStyles('dark', { bgcolor: '#3e2a24' }) })}>
            <Typography variant="body2" sx={{ fontWeight: 650 }}>
              {warnings.length === 1 ? '1 pair is hard to read' : `${warnings.length} pairs are hard to read`} (below WCAG AA at the size it is drawn: 4.5:1, or 3:1 for text {LARGE_TEXT_PX}px and up)
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {warnings.map((w) => `${w.label} ${w.ratio.toFixed(1)}:1 at ${w.size}px`).join(' · ')}. Choose &quot;Automatic&quot; text, or a darker or lighter color.
            </Typography>
          </Box>
        )}
        {editable && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', pt: 0.5 }}>
            {confirmReset ? (
              <Box role="alertdialog" aria-label="Reset to Slatebox defaults?" sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="body2">Reset the slate style to Slatebox defaults? Your logos and colors stay. You can undo it.</Typography>
                <Button size="small" onClick={() => setConfirmReset(false)}>Cancel</Button>
                <Button size="small" variant="outlined" color="error" onClick={reset} data-brand-reset-confirm="">Reset</Button>
              </Box>
            ) : (
              <Button size="small" color="inherit" onClick={() => setConfirmReset(true)} disabled={presetIsEmpty(draft)} data-brand-reset="">Reset to Slatebox defaults</Button>
            )}
          </Box>
        )}
      </Section>
    </Box>
  )

  const preview = (
    <Box component="aside" aria-label="Live preview" sx={(t) => ({ ...card(t), position: { md: 'sticky' }, top: { md: 16 }, alignSelf: 'start', minWidth: 0 })} data-brand-preview="">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: previewOpen ? 1.5 : 0 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 750 }}>Live preview</Typography>
          <Typography variant="caption" color="text.secondary">Every slate, before it saves.</Typography>
        </Box>
        {phone && (
          <Button size="small" variant={previewOpen ? 'text' : 'outlined'} onClick={() => setPreviewOpen(!previewOpen)} aria-expanded={previewOpen} aria-controls="brand-preview-body"
            endIcon={<ExpandMoreIcon sx={{ transform: previewOpen ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }} />} data-brand-preview-toggle="">
            {previewOpen ? 'Hide preview' : 'Show preview'}
          </Button>
        )}
      </Box>
      <Collapse in={previewOpen || !phone} id="brand-preview-body">
        <BrandPreview style={style} logoUrl={logos.squareLogo?.value?.url || null} compact={phone} />
      </Collapse>
    </Box>
  )

  return (
    <AppPage data-brand-kit=""
      header={(
        <AppPageHeader sx={{ mb: 1 }} title="Brand kit"
          eyebrow={<Link component={RouterLink} to="/team/settings" underline="hover" variant="body2">Team settings</Link>}
          subtitle="Your logos, colors and fonts, and the one style every slate and presentation starts with."
          actions={editable ? <SaveState state={saveState} onUndo={runUndo} canUndo={undo.length > 0} undoLabel={undo[undo.length - 1]?.label || ''} /> : null} />
      )}
      sx={{ display: 'grid', gap: 2, alignContent: 'start' }}>
      {admin === false && (
        <Box sx={card} data-brand-read-only="">
          <Typography variant="body2">Only team admins can change the brand kit. This is what your team uses now.</Typography>
        </Box>
      )}
      {!ready && <LinearProgress aria-label="Loading the brand kit" />}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(340px, 440px)' }, gap: 2, alignItems: 'start' }}>
        {phone ? <>{preview}{kit}</> : <>{kit}{preview}</>}
      </Box>

      <Section id="where" title="Where your brand shows up" intro="Only these places use the kit today.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
          {uses.map((u) => (
            <Box key={u.key} data-brand-use={u.key} data-brand-use-state={u.state} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: '10px', p: 1.5, display: 'grid', gap: 0.25 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>{u.place}</Typography>
                <Typography variant="caption" sx={{ color: u.state === 'on' ? 'success.main' : 'text.secondary', fontWeight: 650 }}>{u.state === 'on' ? 'Using your kit' : 'Slatebox defaults'}</Typography>
              </Box>
              <Typography variant="body2" color="text.secondary">{u.what}</Typography>
              <Typography variant="caption" color="text.secondary">From: {u.from}{u.link && <> · <Link component={RouterLink} to={u.link.to}>{u.link.label}</Link></>}</Typography>
            </Box>
          ))}
        </Box>
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 650 }}>Not yet</Typography>
          <Box component="ul" sx={{ m: 0, pl: 2.5, color: 'text.secondary' }}>
            {NOT_YET.map((line) => <Typography component="li" variant="body2" key={line}>{line}</Typography>)}
          </Box>
        </Box>
      </Section>
    </AppPage>
  )
}
