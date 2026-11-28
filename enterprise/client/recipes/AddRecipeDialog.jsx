// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Add a recipe to a project, in four steps:
//  1. Pick a recipe: what it makes, when it runs and how much agent work it does.
//  2. Connect its integration, in one click, when it is not connected yet (skipped otherwise).
//  3. Set it up: the form its configSchema makes (ConfigForm), and which triggers it listens to.
//  4. Preview the first run: still pictures of each slate it would make, the counts and a token
//     estimate, nothing saved. Changes outside Slatebox are separate opt-in rows, off by default.
//     Turn on activates it and queues the first run, which suggests (ghost notes with Keep all).
// A draft made at step 3 stays in the project (Finish setting up) if the dialog closes before Turn on.
import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Stepper from '@mui/material/Stepper'
import Step from '@mui/material/Step'
import StepLabel from '@mui/material/StepLabel'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CircularProgress from '@mui/material/CircularProgress'
import SnapSlate from '/imports/ui/components/SnapSlate'
import { openSignInWindow } from '../signin'
import { refreshCatalog, useCatalog } from './availability'
import recipesApi from './recipesApi'
import ConfigForm from './ConfigForm'
import RecipePermissions from './RecipePermissions'
import {
  COST_WORDS, INTEGRATION_WORDS, addRecipeSteps, createdInstance, defaultConfig, defaultTriggers, grantsOf, groupCatalog, instanceName, needsConnection,
  optionalTriggers, outputsLine, previewSummary, recipeErrorWords, triggerFrom, triggerKey, triggerWords, validateConfig, withoutEmptyMaps,
} from './recipesModel.mjs'

const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } catch { return 'UTC' } }

function RecipeChoice({ manifest, onPick }) {
  return (
    <Box component="button" type="button" onClick={() => onPick(manifest)} data-recipe-choice={manifest.id}
      sx={{ textAlign: 'left', font: 'inherit', color: 'text.primary', bgcolor: 'background.paper', border: 1, borderColor: 'divider', borderRadius: 2, p: 2,
        cursor: 'pointer', display: 'grid', gap: 0.75, '&:hover': { borderColor: 'primary.main' }, '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main' } }}>
      <Typography fontWeight={700}>{manifest.label}</Typography>
      {manifest.summary && <Typography variant="body2">{manifest.summary}</Typography>}
      <Typography variant="body2" color="text.secondary">{outputsLine(manifest)}</Typography>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {(manifest.triggers || []).filter((t) => t.kind !== 'inbound').map((t) => <Chip key={triggerKey(t)} size="small" variant="outlined" label={triggerWords(t)} />)}
      </Box>
      <Typography variant="caption" color="text.secondary">{COST_WORDS[manifest.cost?.class] || ''}</Typography>
    </Box>
  )
}

function ConnectStep({ manifest, projectId }) {
  const [note, setNote] = useState('')
  const name = INTEGRATION_WORDS[manifest.integration]
  async function connect() {
    setNote('')
    const win = openSignInWindow()
    if (!win) { setNote('Your browser blocked the window. Allow pop-ups for Slatebox, then try again.'); return }
    let url = manifest.connectUrl
    // GitHub: the Slatebox GitHub App's install screen, which comes back to this project.
    if (manifest.integration === 'github') url = (await recipesApi.githubInstallations(projectId ? { projectId } : {}).catch(() => null))?.installUrl || url
    win.location.href = url
    // Watch for the connection while the window is open: once the catalog says connected, the
    // window has done its job (GitHub sent it back to Slatebox), so close it and move on.
    let ticks = 0
    const timer = setInterval(async () => {
      ticks += 1
      if (win.closed || ticks > 600) { clearInterval(timer); refreshCatalog(); return }
      if (ticks % 3) return
      const got = await refreshCatalog()
      if (got?.answer?.recipes?.find((r) => r.id === manifest.id)?.connected) { clearInterval(timer); try { win.close() } catch {} }
    }, 1000)
  }
  const label = manifest.integration === 'github' ? 'Install Slatebox on GitHub' : `Connect ${name}`
  return (
    <Box sx={{ display: 'grid', gap: 2, justifyItems: 'start' }}>
      <Typography>
        {manifest.integration === 'github'
          ? 'Pick the repos Slatebox may read. It writes only what you allow for each recipe, such as pull requests on slatebox/… branches.'
          : `${manifest.label} reads ${name} as you. Connect it once and every recipe can use it.`}
      </Typography>
      {manifest.connectUrl
        ? <Button variant="contained" disableElevation onClick={connect}>{label}</Button>
        : <Typography color="text.secondary">{name} is not set up on this server yet. An admin adds it in Admin › Integration apps.</Typography>}
      {note && <Typography role="alert" color="error" variant="body2">{note}</Typography>}
    </Box>
  )
}

export default function AddRecipeDialog({ open, projectId, draft = null, onClose, onDone }) {
  const { state, recipes } = useCatalog()
  const [manifest, setManifest] = useState(null)
  const [step, setStep] = useState('pick')
  const [config, setConfig] = useState({})
  const [name, setName] = useState('')
  const [triggers, setTriggers] = useState([])
  const [errors, setErrors] = useState({})
  const [instance, setInstance] = useState(null)
  const [grants, setGrants] = useState([])
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // A recipe's manifest as the catalog has it now (connected changes after Connect).
  const current = manifest ? recipes.find((r) => r.id === manifest.id) || manifest : null

  useEffect(() => {
    if (!open) return
    setError(''); setBusy(false); setPreview(null); setErrors({})
    if (draft) {
      const m = recipes.find((r) => r.id === draft.recipeId) || null
      setManifest(m); setConfig(draft.config || {}); setName(draft.name || ''); setTriggers(draft.triggers || []); setInstance(draft)
      setStep('configure')
    } else {
      setManifest(null); setInstance(null); setStep('pick'); setGrants([])
    }
  }, [open, draft?._id, recipes.length]) // eslint-disable-line react-hooks/exhaustive-deps

  function pick(m) {
    setManifest(m)
    setConfig(defaultConfig(m.configSchema))
    setTriggers(defaultTriggers(m, tz()))
    setName('')
    setStep(needsConnection(m) ? 'connect' : 'configure')
  }
  useEffect(() => { if (step === 'connect' && current && !needsConnection(current)) setStep('configure') }, [step, current?.connected]) // eslint-disable-line react-hooks/exhaustive-deps

  const optional = current ? optionalTriggers(current) : []
  const on = (key) => triggers.some((t) => triggerKey(t) === key)
  function toggleTrigger(t, checked) {
    setTriggers((had) => (checked
      ? [...had.filter((x) => triggerKey(x) !== triggerKey(t)), triggerFrom(t, tz())]
      : had.filter((x) => triggerKey(x) !== triggerKey(t))))
  }

  async function toPreview() {
    const sent = withoutEmptyMaps(config)
    const check = validateConfig(current.configSchema, sent)
    setErrors(check.errors)
    if (!check.ok) return
    setBusy(true); setError('')
    try {
      const withManual = triggers.some((t) => t.kind === 'manual') ? triggers : [...triggers, { kind: 'manual' }]
      const input = { config: sent, triggers: withManual, name: name.trim() || instanceName(current, sent) }
      let made = instance
      if (made) await recipesApi.update({ instanceId: made._id, ...input })
      else made = createdInstance(await recipesApi.create({ projectId, recipeId: current.id, ...input }))
      setInstance(made)
      setStep('preview')
      setPreview(null)
      const [shown, got] = await Promise.all([recipesApi.preview({ instanceId: made._id }), recipesApi.get({ instanceId: made._id })])
      setPreview(shown)
      setGrants(grantsOf(got))
    } catch (e) {
      setError(recipeErrorWords(e))
      if (e?.details?.errors) setErrors(e.details.errors)
    } finally { setBusy(false) }
  }

  async function turnOn() {
    setBusy(true); setError('')
    try { await recipesApi.activate({ instanceId: instance._id }); onDone(instance) } catch (e) { setError(recipeErrorWords(e)); setBusy(false) }
  }

  const steps = addRecipeSteps(current)
  const active = Math.max(0, steps.findIndex((s) => s.id === step))
  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="add-recipe-title">
      <DialogTitle id="add-recipe-title">{current ? current.label : 'Add a recipe'}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2 }}>
        <Stepper activeStep={active} alternativeLabel>{steps.map((s) => <Step key={s.id}><StepLabel>{s.label}</StepLabel></Step>)}</Stepper>
        {step === 'pick' && (state === 'loading'
          ? <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress aria-label="Finding recipes" /></Box>
          : groupCatalog(recipes).map((g) => (
            <Box key={g.integration ?? 'none'} component="section" sx={{ display: 'grid', gap: 1 }}>
              <Typography component="h3" variant="subtitle1" fontWeight={700}>{g.label}</Typography>
              <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
                {g.recipes.map((m) => <RecipeChoice key={m.id} manifest={m} onPick={pick} />)}
              </Box>
            </Box>
          )))}
        {step === 'connect' && current && <ConnectStep manifest={current} projectId={projectId} />}
        {step === 'configure' && current && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            <TextField label="Name" value={name} placeholder={instanceName(current, config)} onChange={(e) => setName(e.target.value)} helperText="Shown on the project page and in the run history." />
            <ConfigForm schema={current.configSchema} recipeId={current.id} projectId={projectId} value={config} onChange={setConfig} errors={errors} />
            {optional.length > 0 && (
              <Box sx={{ display: 'grid' }}>
                <Typography fontWeight={650}>When it runs</Typography>
                {optional.map((t) => (
                  <FormControlLabel key={t.key} control={<Switch checked={on(t.key)} onChange={(e) => toggleTrigger(t, e.target.checked)} />} label={t.label} />
                ))}
                <Typography variant="caption" color="text.secondary">Run now always works. Webhooks that run it are added after it is on.</Typography>
              </Box>
            )}
          </Box>
        )}
        {step === 'preview' && (
          <Box sx={{ display: 'grid', gap: 2 }} data-recipe-preview="">
            {!preview && busy && <Typography sx={{ display: 'flex', gap: 1, alignItems: 'center' }} color="text.secondary"><CircularProgress size={18} /> Working out the first run. Nothing is saved yet…</Typography>}
            {preview && (
              <>
                <Typography>{previewSummary(preview)}</Typography>
                {preview.partial && <Typography variant="body2" color="text.secondary">Part of it was left out to stay within its budget: {preview.partial}.</Typography>}
                <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))' }}>
                  {(preview.slates || []).map((s) => (
                    <Box key={`${s.role}:${s.name}`} sx={{ display: 'grid', gap: 0.5 }}>
                      <Box role="img" aria-label={s.name} sx={{ height: 170, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
                        <Box inert="" sx={{ width: '100%', height: '100%' }}><SnapSlate slate={s.slate} allowDrag={false} allowZoom={false} /></Box>
                      </Box>
                      <Typography fontWeight={650} noWrap>{s.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {[s.counts?.notes && `${s.counts.notes} notes`, s.counts?.connectors && `${s.counts.connectors} connectors`, s.counts?.cards && `${s.counts.cards} cards`].filter(Boolean).join(' · ') || 'Empty for now'}
                      </Typography>
                    </Box>
                  ))}
                </Box>
                <Typography variant="body2" color="text.secondary">
                  The first run suggests its notes on each slate: keep them all or one by one. After you keep a first run you can let it apply updates by itself.
                </Typography>
                {instance && <RecipePermissions instanceId={instance._id} manifest={current} config={config} grants={grants} disabled={busy}
                  onChanged={async () => setGrants(grantsOf(await recipesApi.get({ instanceId: instance._id })))} />}
              </>
            )}
          </Box>
        )}
        {error && <Typography role="alert" color="error" variant="body2">{error}</Typography>}
      </DialogContent>
      <DialogActions>
        {step !== 'pick' && !draft && <Button onClick={() => setStep(step === 'preview' ? 'configure' : 'pick')} disabled={busy} sx={{ mr: 'auto' }}>Back</Button>}
        {step === 'preview' && draft && <Button onClick={() => setStep('configure')} disabled={busy} sx={{ mr: 'auto' }}>Back</Button>}
        <Button onClick={onClose} disabled={busy}>{instance ? 'Finish later' : 'Cancel'}</Button>
        {step === 'configure' && <Button variant="contained" disableElevation onClick={toPreview} disabled={busy}>Preview the first run</Button>}
        {step === 'preview' && <Button variant="contained" disableElevation onClick={turnOn} disabled={busy || !preview}>Turn on</Button>}
      </DialogActions>
    </Dialog>
  )
}

AddRecipeDialog.propTypes = {
  open: PropTypes.bool.isRequired,
  projectId: PropTypes.string.isRequired,
  draft: PropTypes.object,
  onClose: PropTypes.func.isRequired,
  onDone: PropTypes.func.isRequired,
}
