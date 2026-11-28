// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// A project's Recipes tab (slot project.recipes) and its two small pieces: the tab itself
// (project.recipesTab) and "Add a recipe" on an empty project (project.addRecipe). Each instance card
// says which agent runs it and for whom, its state, its last and next run, and offers Run now (and,
// for a recipe that keeps slates in a repository, Save to repo now), Pause or Resume, and a menu
// with Settings, Runs, Webhooks, Changes outside Slatebox and Delete. Changes outside Slatebox lists
// the changes waiting for approval: approve or decline, and a pull request's files to download.
// Managers pause every recipe in the project at once; a manager takes over a recipe whose owner
// lost access. Where recipes are off, a server admin sees the one switch and everyone else nothing.
import React, { useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link } from 'react-router-dom'
import { useTheme } from '@mui/material/styles'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import IconButton from '@mui/material/IconButton'
import Menu from '@mui/material/Menu'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import FormControlLabel from '@mui/material/FormControlLabel'
import Typography from '@mui/material/Typography'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import CircularProgress from '@mui/material/CircularProgress'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import AddIcon from '@mui/icons-material/Add'
import confirmService from '/imports/ui/common/confirm'
import usePhoneView from '/imports/ui/common/usePhoneView'
import { ProjectTab } from '/imports/ui/components/projects/ProjectHeader'
import { ROLE_RANK } from '/imports/ui/components/projects/projectsModel.mjs'
import { RecipeInstances } from '../collections'
import { useCatalog } from './availability'
import recipesApi from './recipesApi'
import AddRecipeDialog from './AddRecipeDialog'
import RecipeRunsTable from './RecipeRuns'
import RecipeHooks from './RecipeHooks'
import RecipePermissions from './RecipePermissions'
import ConfigForm from './ConfigForm'
import { RecipesOffSwitch } from './RecipesAdmin'
import {
  INTEGRATION_WORDS, canPause, canResume, downloadName, grantsOf, instanceChip, formatTokens, groupCatalog, lastRunLine, nextRunLine, outputsLine, recipeErrorWords, runsFor, validateConfig, withoutEmptyMaps,
  writePermissionText,
} from './recipesModel.mjs'

/** A recipe that keeps slates in step with files (a sync map): it offers Save to repo now. */
const syncsSlates = (manifest) => (manifest?.triggers || []).some((t) => t.kind === 'slate_saved')

function download(path, content) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = downloadName(path)
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// Changes waiting for the owner's approval: what each is, approve or decline, its files to download.
function WaitingChanges({ instance, waiting, onChanged }) {
  const mine = instance.ownerId === Meteor.userId()
  const [busy, setBusy] = useState(null)
  const [note, setNote] = useState('')
  if (!waiting?.length) return null
  async function decide(cardId, decision) {
    setBusy(cardId); setNote('')
    try {
      const done = await recipesApi.decideWrite({ cardId, decision })
      setNote(decision === 'approve' ? (done?.state === 'done' ? 'Done: the change was made.' : 'It could not be made. See Runs.') : 'Declined.')
      await onChanged()
    } catch (e) { setNote(recipeErrorWords(e)) } finally { setBusy(null) }
  }
  return (
    <Box component="section" sx={{ display: 'grid', gap: 1.5, mb: 2 }} data-recipe-waiting="">
      <Typography fontWeight={650}>Waiting for approval</Typography>
      {waiting.map((c) => (
        <Box key={c.cardId} sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5, display: 'grid', gap: 1 }}>
          <Typography variant="body2">{writePermissionText(c.kind, { repos: c.target?.repo ? [c.target.repo] : [], paths: (c.files || []).map((f) => f.path) })}</Typography>
          {(c.files || []).length > 0 && (
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {c.files.map((f) => <Button key={f.path} size="small" onClick={() => download(f.path, f.content)}>Download {downloadName(f.path)}</Button>)}
            </Box>
          )}
          {mine
            ? (
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button size="small" variant="contained" disableElevation disabled={busy !== null} onClick={() => decide(c.cardId, 'approve')}>Approve</Button>
                <Button size="small" disabled={busy !== null} onClick={() => decide(c.cardId, 'decline')}>Decline</Button>
              </Box>
            )
            : <Typography variant="caption" color="text.secondary">The person this recipe runs for approves it.</Typography>}
        </Box>
      ))}
      {note && <Typography role="status" variant="body2">{note}</Typography>}
    </Box>
  )
}

const atLeast = (role, wanted) => (ROLE_RANK[role] ?? 0) >= ROLE_RANK[wanted]

/** project.recipesTab: the Recipes tab, only where recipes are on (or, for a server admin, switchable). */
export function RecipesTab({ selected, onSelect, Tab = ProjectTab }) {
  const { state } = useCatalog()
  if (state !== 'on' && state !== 'off-admin') return null
  return <Tab id="recipes" selected={selected} onSelect={onSelect}>Recipes</Tab>
}

/** project.addRecipe: "Add a recipe" on an empty project, for editors where recipes are on. */
export function AddRecipeButton({ projectId, role, onAdded }) {
  const { state } = useCatalog()
  const [open, setOpen] = useState(false)
  const phone = usePhoneView()
  if (state !== 'on' || phone || !atLeast(role, 'editor')) return null
  return (
    <>
      <Button variant="outlined" size="large" sx={{ borderRadius: 6, px: 3 }} onClick={() => setOpen(true)}>Add a recipe</Button>
      <AddRecipeDialog open={open} projectId={projectId} onClose={() => setOpen(false)} onDone={() => { setOpen(false); onAdded?.() }} />
    </>
  )
}

const DETAIL_TABS = [['runs', 'Runs'], ['settings', 'Settings'], ['hooks', 'Webhooks'], ['outside', 'Changes outside Slatebox']]

function RecipeDetails({ instance, manifest, canEdit, initial, onClose }) {
  const [tab, setTab] = useState(initial || 'runs')
  const [got, setGot] = useState(null)
  const [config, setConfig] = useState(instance.config || {})
  const [errors, setErrors] = useState({})
  const [note, setNote] = useState('')
  const load = () => recipesApi.get({ instanceId: instance._id }).then(setGot, () => setGot({}))
  React.useEffect(() => { load() }, [instance._id]) // eslint-disable-line react-hooks/exhaustive-deps
  // The live list carries no settings: they come with recipes.get.
  React.useEffect(() => { if (got?.recipe?.config && !Object.keys(config || {}).length) setConfig(got.recipe.config) }, [got]) // eslint-disable-line react-hooks/exhaustive-deps
  async function saveSettings() {
    const sent = withoutEmptyMaps(config)
    const check = validateConfig(manifest?.configSchema, sent)
    setErrors(check.errors)
    if (!check.ok) return
    try { await recipesApi.update({ instanceId: instance._id, config: sent }); setNote('Saved. The next run uses these settings.') } catch (e) { setNote(recipeErrorWords(e)) }
  }
  const tabs = DETAIL_TABS.filter(([id]) => (id !== 'outside' || (manifest?.writes || []).length) && (id === 'runs' || canEdit))
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg" aria-labelledby="recipe-details-title">
      <DialogTitle id="recipe-details-title">{instance.name}</DialogTitle>
      <DialogContent dividers sx={{ display: 'grid', gap: 2, alignContent: 'start', minHeight: 360 }}>
        <Box role="tablist" aria-label="Recipe" sx={{ display: 'flex', gap: 0.5, borderBottom: 1, borderColor: 'divider' }}>
          {tabs.map(([id, label]) => <ProjectTab key={id} id={`recipe-${id}`} selected={tab === id} onSelect={() => setTab(id)}>{label}</ProjectTab>)}
        </Box>
        <Box role="tabpanel" aria-labelledby={`project-tab-recipe-${tab}`}>
          {tab === 'runs' && <RecipeRunsTable instance={instance} canEdit={canEdit} />}
          {tab === 'settings' && (
            <Box sx={{ display: 'grid', gap: 2, maxWidth: 640 }}>
              <ConfigForm schema={manifest?.configSchema} recipeId={instance.recipeId} projectId={instance.projectId} value={config} onChange={setConfig} errors={errors} />
              <Button variant="contained" disableElevation sx={{ justifySelf: 'start' }} onClick={saveSettings}>Save settings</Button>
              {note && <Typography role="status" variant="body2">{note}</Typography>}
            </Box>
          )}
          {tab === 'hooks' && <RecipeHooks instance={instance} manifest={manifest} />}
          {tab === 'outside' && (got
            ? (
              <>
                <WaitingChanges instance={instance} waiting={got.waiting} onChanged={load} />
                <RecipePermissions instanceId={instance._id} manifest={manifest} config={got.recipe?.config || instance.config} grants={grantsOf(got)} onChanged={load} />
              </>
            )
            : <CircularProgress size={20} aria-label="Finding permissions" />)}
        </Box>
      </DialogContent>
      <DialogActions><Button onClick={onClose}>Done</Button></DialogActions>
    </Dialog>
  )
}

function InstanceCard({ instance, manifest, role, onSetUp, onOpen }) {
  const theme = useTheme()
  const userId = Meteor.userId()
  const mine = instance.ownerId === userId
  const manager = atLeast(role, 'manager')
  // On a phone a recipe is watched, not changed: Pause stays (a stop is a safety switch), the rest
  // waits for a computer or tablet.
  const phone = usePhoneView()
  const canEdit = !phone && (mine || manager)
  const editor = !phone && atLeast(role, 'editor')
  const canStop = mine || manager
  const [menu, setMenu] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const chip = instanceChip(instance)
  async function act(fn, done = '') {
    setBusy(true); setNote('')
    try { await fn(); if (done) setNote(done) } catch (e) { setNote(recipeErrorWords(e)) } finally { setBusy(false) }
  }
  async function remove() {
    setMenu(null)
    const ok = await confirmService.show({ theme, title: `Delete “${instance.name}”?`, message: 'It stops running. The slates it made stay in the project, and become ordinary slates.' })
    if (ok) act(() => recipesApi.remove({ instanceId: instance._id }))
  }
  return (
    <Box component="article" data-recipe-instance={instance._id} aria-label={instance.name}
      sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 2, display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography fontWeight={700} noWrap>{instance.name}</Typography>
          <Typography variant="body2" color="text.secondary" noWrap>{runsFor(manifest?.agentName || 'Agent', instance.ownerName)}</Typography>
        </Box>
        <Chip size="small" label={chip.label} color={chip.color} title={chip.help} />
        {canEdit && <IconButton size="small" aria-label={`Options for ${instance.name}`} onClick={(e) => setMenu(e.currentTarget)}><MoreVertIcon /></IconButton>}
      </Box>
      <Typography variant="body2">{instance.state === 'draft' ? 'Not turned on yet' : lastRunLine(instance.lastRun)}</Typography>
      <Typography variant="body2" color="text.secondary">{instance.state === 'draft' ? outputsLine(manifest) : nextRunLine(instance)}</Typography>
      {Number.isFinite(instance.tokensThisMonth) && instance.tokensThisMonth > 0 && (
        <Typography variant="caption" color="text.secondary">{formatTokens(instance.tokensThisMonth)} agent tokens this month</Typography>
      )}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
        {instance.state === 'draft' && canEdit && <Button size="small" variant="contained" disableElevation onClick={() => onSetUp(instance)}>Finish setting up</Button>}
        {instance.state === 'active' && canEdit && <Button size="small" variant="outlined" disabled={busy} onClick={() => act(() => recipesApi.run({ instanceId: instance._id, reason: 'Run now' }), 'Started. It shows in Runs.')}>Run now</Button>}
        {instance.state === 'active' && editor && syncsSlates(manifest) && (
          <Button size="small" variant="outlined" disabled={busy} data-recipe-save-now={instance._id}
            onClick={() => act(() => recipesApi.saveNow({ instanceId: instance._id }), 'Saving to the repository now. It shows in Runs.')}>Save to repo now</Button>
        )}
        {canPause(instance.state) && canStop && <Button size="small" disabled={busy} onClick={() => act(() => recipesApi.pause({ instanceId: instance._id }))}>Pause</Button>}
        {canResume(instance.state) && canEdit && <Button size="small" disabled={busy} onClick={() => act(() => recipesApi.resume({ instanceId: instance._id }))}>Resume</Button>}
        {instance.state === 'needs_sign_in' && mine && <Button size="small" component={Link} to="/integrations">Sign in again</Button>}
        {instance.state === 'blocked_access' && manager && !mine && <Button size="small" disabled={busy} onClick={() => act(() => recipesApi.transfer({ instanceId: instance._id }), 'It now runs for you. Turn on its changes outside Slatebox again if you want them.')}>Take it over</Button>}
        {instance.state !== 'draft' && <Button size="small" onClick={() => onOpen(instance, 'runs')}>Runs</Button>}
      </Box>
      {instance.firstRunKept && mine && instance.state !== 'draft' && (
        <FormControlLabel control={<Switch size="small" checked={instance.applyMode === 'auto'} disabled={busy}
          onChange={(e) => act(() => recipesApi.update({ instanceId: instance._id, applyMode: e.target.checked ? 'auto' : 'suggest' }))} />}
        label={<Typography variant="body2">Apply future updates automatically (each run stays one undo)</Typography>} />
      )}
      {note && <Typography role="status" variant="body2">{note}</Typography>}
      <Menu anchorEl={menu} open={Boolean(menu)} onClose={() => setMenu(null)}>
        <MenuItem onClick={() => { setMenu(null); onOpen(instance, 'settings') }}>Settings</MenuItem>
        <MenuItem onClick={() => { setMenu(null); onOpen(instance, 'hooks') }}>Webhooks</MenuItem>
        {(manifest?.writes || []).length > 0 && <MenuItem onClick={() => { setMenu(null); onOpen(instance, 'outside') }}>Changes outside Slatebox</MenuItem>}
        <MenuItem onClick={remove} sx={{ color: 'error.main' }}>Delete</MenuItem>
      </Menu>
    </Box>
  )
}

/** project.recipes: the Recipes tab's panel. */
export default function ProjectRecipes({ projectId, project, role }) {
  const { state, recipes } = useCatalog()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(null)
  const [open, setOpen] = useState(null)
  const [paused, setPaused] = useState(Boolean(project?.recipesPaused))
  const [note, setNote] = useState('')
  const phone = usePhoneView()
  const { instances, ready } = useTracker(() => {
    const sub = Meteor.subscribe('recipes.forProject', projectId)
    return { ready: sub.ready(), instances: RecipeInstances.find({ projectId }, { sort: { created: 1 } }).fetch() }
  }, [projectId])
  if (state === 'loading') return <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress aria-label="Finding recipes" /></Box>
  if (state === 'off-admin') return <RecipesOffSwitch />
  if (state !== 'on') return null
  const byId = new Map(recipes.map((r) => [r.id, r]))
  const editor = !phone && atLeast(role, 'editor')
  async function setProjectPaused(next) {
    setNote('')
    try { await recipesApi.pauseProject({ projectId, paused: next }); setPaused(next) } catch (e) { setNote(recipeErrorWords(e)) }
  }
  return (
    <Box sx={{ display: 'grid', gap: 2, pt: 2 }} data-project-recipes={projectId}>
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography color="text.secondary" sx={{ flex: '1 1 320px' }}>
          Recipes are agents that keep this project’s slates up to date from your tools, on a schedule or as things change. Their changes show as suggestions until you trust them.
        </Typography>
        {atLeast(role, 'manager') && instances.length > 0 && (
          <FormControlLabel control={<Switch checked={paused} onChange={(e) => setProjectPaused(e.target.checked)} />} label="Pause recipes in this project" />
        )}
        {editor && <Button variant="contained" disableElevation startIcon={<AddIcon />} onClick={() => { setDraft(null); setAdding(true) }}>Add a recipe</Button>}
      </Box>
      {paused && <Typography role="status" color="warning.main">Every recipe in this project is paused. Nothing runs until a manager turns this off.</Typography>}
      {note && <Typography role="alert" color="error" variant="body2">{note}</Typography>}
      {!ready && <CircularProgress size={20} aria-label="Finding this project’s recipes" />}
      {ready && instances.length > 0 && (
        <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
          {instances.map((i) => (
            <InstanceCard key={i._id} instance={i} manifest={byId.get(i.recipeId)} role={role}
              onSetUp={(d) => { setDraft(d); setAdding(true) }} onOpen={(inst, tab) => setOpen({ instance: inst, tab })} />
          ))}
        </Box>
      )}
      {ready && instances.length === 0 && (
        <Box sx={{ display: 'grid', gap: 2 }} data-recipes-empty="">
          {groupCatalog(recipes).map((g) => (
            <Box key={g.integration ?? 'none'} component="section" sx={{ display: 'grid', gap: 0.5 }}>
              <Typography component="h2" variant="subtitle1" fontWeight={700}>{INTEGRATION_WORDS[g.integration]}</Typography>
              {g.recipes.map((m) => (
                <Typography key={m.id} variant="body2"><b>{m.label}.</b> {m.summary || outputsLine(m)}</Typography>
              ))}
            </Box>
          ))}
        </Box>
      )}
      {editor && <AddRecipeDialog open={adding} projectId={projectId} draft={draft} onClose={() => setAdding(false)} onDone={() => setAdding(false)} />}
      {open && <RecipeDetails instance={open.instance} manifest={byId.get(open.instance.recipeId)} initial={open.tab}
        canEdit={!phone && (open.instance.ownerId === Meteor.userId() || atLeast(role, 'manager'))} onClose={() => setOpen(null)} />}
    </Box>
  )
}

ProjectRecipes.propTypes = {
  projectId: PropTypes.string.isRequired,
  project: PropTypes.shape({ recipesPaused: PropTypes.bool }),
  role: PropTypes.string,
}
