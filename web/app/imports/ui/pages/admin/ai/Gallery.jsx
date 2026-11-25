import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

// Admin › AI control › Gallery: the outside agents people can invite onto a slate (Slatebox Cloud and
// licensed installs). Turn a card on or off, move it, change what it says, and edit its recipe: the
// asks it runs with fixed steps (no planner reads the server's words), as JSON the server checks. A
// card's address never changes here. The hint each card's planner gets is a prompt in the Prompts tab
// (connectors.recipe.<id>), versioned and published there. Every change is in Changes; only a
// person saves (ai.agents.gallery.list, .save, .reorder).
const failure = (err, fallback) => err?.reason || err?.message || fallback
const FIELDS = [['name', 'Name'], ['job', 'What it is for'], ['lands', 'What lands on the slate'], ['try', 'Example ask'], ['cost', 'What it costs'], ['keyHint', 'Key hint']]

/** One card's editor: its words, on/off and recipe; Save sends only what changed. */
function CardEditor({ card, onSaved }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(FIELDS.map(([key]) => [key, card[key] || ''])))
  const [recipe, setRecipe] = useState(() => JSON.stringify(card.recipe ?? { intents: [] }, null, 2))
  const [problem, setProblem] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async (extra = {}) => {
    const changes = { ...extra }
    for (const [key] of FIELDS) if ((draft[key] || '') !== (card[key] || '')) changes[key] = draft[key]
    try {
      const parsed = JSON.parse(recipe)
      if (JSON.stringify(parsed) !== JSON.stringify(card.recipe ?? { intents: [] })) changes.recipe = parsed
    } catch {
      return setProblem('The recipe is not valid JSON.')
    }
    if (!Object.keys(changes).length) return setProblem('Nothing changed.')
    setBusy(true)
    setProblem('')
    try {
      await Meteor.callAsync('ai.agents.gallery.save', { id: card.id, changes })
      onSaved()
    } catch (err) {
      setProblem(failure(err, 'That card could not be saved.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Box data-gallery-editor={card.id} sx={{ mt: 1.5, display: 'grid', gap: 1.5 }}>
      {FIELDS.map(([key, label]) => (
        <TextField key={key} size="small" label={label} value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} />
      ))}
      <Typography variant="caption" color="text.secondary">Address (fixed: people consented to it): {card.url}</Typography>
      <TextField label="Recipe (JSON)" multiline minRows={6} maxRows={20} value={recipe} onChange={(e) => setRecipe(e.target.value)}
        inputProps={{ spellCheck: false, style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12 }, 'data-gallery-recipe': card.id }}
        helperText="intents: [{ key, keywords (patterns), steps: [{ tool, args, extract?, each? }], output? }]. A step calls only tools the inviter allowed, and only lookups." />
      <Typography variant="caption" color="text.secondary">{card.promptId ? <>The planner&apos;s hint for this card is the prompt {card.promptId}, in Prompts.</> : 'This card has no planner hint yet: its agent is planned from its tools\' own descriptions.'}</Typography>
      {problem && <Alert severity="warning">{problem}</Alert>}
      <Box><Button variant="contained" size="small" disabled={busy} onClick={() => save()}>Save card</Button></Box>
    </Box>
  )
}

export default function Gallery() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = async () => {
    try {
      setData(await Meteor.callAsync('ai.agents.gallery.list', {}))
      setError('')
    } catch (err) {
      setError(err?.error === 404 || /not found/i.test(err?.reason || err?.message || '')
        ? 'Invited agents are part of Slatebox Cloud and licensed installs.'
        : failure(err, 'The gallery could not be read.'))
    }
  }
  useEffect(() => { load() }, [])
  const run = async (fn) => {
    setBusy(true)
    try {
      await fn()
      await load()
    } catch (err) {
      setError(failure(err, 'That did not work.'))
    } finally {
      setBusy(false)
    }
  }
  const move = (index, by) => run(() => {
    const ids = data.cards.map((card) => card.id)
    const [id] = ids.splice(index, 1)
    ids.splice(index + by, 0, id)
    return Meteor.callAsync('ai.agents.gallery.reorder', { ids })
  })
  if (error) return <Alert severity="info">{error}</Alert>
  if (!data) return <Typography variant="body2">Reading the gallery…</Typography>
  return (
    <Box data-ai-gallery="">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        The agents people can invite onto a slate, in the order the invite dialog shows them. Slatebox draws diagrams itself, so the gallery lists agents that bring in what it cannot: code, issues, papers, docs, facts and the web. Community cards are custom servers people suggested and an administrator approved in Library review.
      </Typography>
      {data.configuration?.cloudLibrary && (
        <Alert severity={data.configuration.cloudLibrary.lastError ? 'warning' : 'info'} sx={{ mb: 2 }} data-gallery-cloud="">
          {data.configuration.cloudLibrary.fetchedAt
            ? `Community cards from Slatebox Cloud: ${data.configuration.cloudLibrary.cards}, last updated ${new Date(data.configuration.cloudLibrary.fetchedAt).toLocaleString()}.`
            : 'Community cards from Slatebox Cloud: not fetched yet.'}
          {data.configuration.cloudLibrary.lastError ? ` The last try did not work (${data.configuration.cloudLibrary.lastError}); the last good copy is still used.` : ''}
          {' '}Turn this off with settings.enterprise.cloudLibrary: false.
        </Alert>
      )}
      {data.cards.map((card, index) => (
        <Box key={card.id} data-gallery-admin-card={card.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, mb: 1.5, opacity: card.enabled ? 1 : 0.7 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
            <Typography variant="subtitle2" sx={{ flex: '1 1 160px' }}>⬡ {card.name} <Typography component="span" variant="caption" color="text.secondary">· {card.job}</Typography></Typography>
            {card.edited && <Chip size="small" label="Edited" />}
            {card.origin === 'community' && <Chip size="small" color="primary" variant="outlined" label={card.from === 'cloud' ? 'Community · Slatebox Cloud' : 'Community'} data-gallery-admin-community="" />}
            <Chip size="small" variant="outlined" label={`${card.recipe?.intents?.length || 0} known asks`} />
            <FormControlLabel control={<Switch size="small" checked={card.enabled} disabled={busy} onChange={(e) => run(() => Meteor.callAsync('ai.agents.gallery.save', { id: card.id, changes: { enabled: e.target.checked } }))} />} label={card.enabled ? 'On' : 'Off'} />
            <Button size="small" disabled={busy || index === 0} aria-label={`Move ${card.name} up`} onClick={() => move(index, -1)}>↑</Button>
            <Button size="small" disabled={busy || index === data.cards.length - 1} aria-label={`Move ${card.name} down`} onClick={() => move(index, 1)}>↓</Button>
            <Button size="small" onClick={() => setOpen(open === card.id ? null : card.id)}>{open === card.id ? 'Close' : 'Edit'}</Button>
          </Box>
          <Typography variant="body2" sx={{ mt: 0.5 }}>{card.lands}</Typography>
          {open === card.id && <CardEditor card={card} onSaved={() => { setOpen(null); load() }} />}
        </Box>
      ))}
      {data.native?.length > 0 && (
        <Box sx={{ mt: 3 }} data-gallery-native="">
          <Typography variant="overline">Built into Slatebox</Typography>
          {data.native.map((card) => (
            <Box key={card.id} data-gallery-admin-card={card.id} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5, mb: 1.5, opacity: card.enabled ? 1 : 0.7 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ flex: '1 1 160px' }}>⬡ {card.name} <Typography component="span" variant="caption" color="text.secondary">· {card.job}</Typography></Typography>
                {card.edited && <Chip size="small" label="Edited" />}
                <FormControlLabel control={<Switch size="small" checked={card.enabled} disabled={busy} onChange={(e) => run(() => Meteor.callAsync('ai.agents.gallery.save', { id: card.id, changes: { enabled: e.target.checked } }))} />} label={card.enabled ? 'On' : 'Off'} />
                <Button size="small" onClick={() => setOpen(open === card.id ? null : card.id)}>{open === card.id ? 'Close' : 'Edit'}</Button>
              </Box>
              <Typography variant="body2" sx={{ mt: 0.5 }}>{card.lands}</Typography>
              {card.id === 'googledrive' && data.configuration?.google && (
                // Yes or no only: whether this server has what Google needs (never a value).
                <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.5 }} data-gallery-google-config="">
                  Configuration: OAuth client {data.configuration.google.client ? 'set' : 'missing'} · Picker key {data.configuration.google.pickerKey ? 'set' : 'missing'} · App id {data.configuration.google.appId ? 'set' : 'missing'} · Key-encryption key {data.configuration.google.vaultKey ? 'set' : 'missing'}
                </Typography>
              )}
              {open === card.id && <CardEditor card={card} onSaved={() => { setOpen(null); load() }} />}
            </Box>
          ))}
        </Box>
      )}
      {data.retired?.length > 0 && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="overline">No longer listed</Typography>
          {data.retired.map((card) => <Typography key={card.id} variant="body2" color="text.secondary">{card.name}: {card.why}</Typography>)}
        </Box>
      )}
    </Box>
  )
}
