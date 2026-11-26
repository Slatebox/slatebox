import React, { useCallback, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTheme } from '@mui/material'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import MenuItem from '@mui/material/MenuItem'
import Switch from '@mui/material/Switch'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import confirmService from '../../common/confirm'
import { FACT_KINDS, KIND_LABELS, LIMITS, groupFacts, profileDownload, sourceLine } from '../../../api/common/personal-facts.mjs'
import { AccountActions, AccountPanel, AccountSection, FinePrint, SPACE } from '../../common/AccountLayout'
import Interview from './Interview'

// Profile › About you: what Slatebox knows about the person, so it can suggest boards and slates
// made for their work. Only they see it. Every fact says where it came from and can be changed,
// hidden or removed; personalization can be switched off; everything can be downloaded or
// deleted. The same actions serve the API, exec and MCP (server/actions/profile.mjs). "Talk with
// Slatebox about your work" opens the interview (Interview.jsx): the agent asks, the person keeps.
const M = CONSTANTS.methods.profile
const reason = (error, fallback) => error?.reason || error?.message || fallback
const field = { maxWidth: 480 }
// Read by screen readers, not shown (as ChatTurn, WorkshopChrome and ManageOrganization do it).
const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }

// Focus moves to an element once React has drawn the change.
const later = (fn) => window.requestAnimationFrame(() => window.requestAnimationFrame(fn))
const editButtonOf = (id) => document.querySelector(`[data-about-you-fact="${id}"] [data-about-you-edit]`)

function KindSelect({ id, value, onChange, disabled }) {
  return (
    <TextField id={id} select size="small" label="Kind" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} sx={{ minWidth: 200 }}>
      {FACT_KINDS.map((kind) => <MenuItem key={kind} value={kind}>{KIND_LABELS[kind]}</MenuItem>)}
    </TextField>
  )
}

KindSelect.propTypes = {
  id: PropTypes.string.isRequired,
  value: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
}
KindSelect.defaultProps = { disabled: false }

const factShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  kind: PropTypes.string.isRequired,
  text: PropTypes.string.isRequired,
  source: PropTypes.shape({ type: PropTypes.string, ref: PropTypes.string, label: PropTypes.string }).isRequired,
  hidden: PropTypes.bool,
})

// A row's controls stay enabled while a change runs (a disabled button drops focus); the parent
// ignores a second click until the first change is done.
function FactRow({ fact, error, onSave, onHide, onRemove }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(fact.text)
  const [kind, setKind] = useState(fact.kind)
  const editButton = useRef(null)
  const textField = useRef(null)
  const wasEditing = useRef(false)
  useEffect(() => {
    // Focus goes into the field when editing starts, and back to Edit when it ends.
    if (editing) textField.current?.focus()
    else if (wasEditing.current) editButton.current?.focus()
    wasEditing.current = editing
  }, [editing])
  const start = () => {
    setText(fact.text)
    setKind(fact.kind)
    setEditing(true)
  }
  const save = async (event) => {
    event.preventDefault()
    if (await onSave(fact, { kind, text })) setEditing(false)
  }
  const textId = `about-you-edit-${fact.id}`
  const errorId = `about-you-error-${fact.id}`
  const said = error && <Alert severity="warning" role="alert" id={errorId} sx={{ flexBasis: '100%' }}>{error}</Alert>
  if (editing) {
    return (
      <Box component="li" sx={{ listStyle: 'none' }}>
        <Box component="form" onSubmit={save} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false) } }}
          sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: SPACE.text }} aria-label={`Change: ${fact.text}`}>
          <TextField id={textId} inputRef={textField} size="small" label="What Slatebox should know" value={text} onChange={(e) => setText(e.target.value)}
            slotProps={{ htmlInput: { maxLength: LIMITS.text, ...(error && { 'aria-describedby': errorId }) } }} sx={{ flex: '1 1 260px', ...field }} required />
          <KindSelect id={`${textId}-kind`} value={kind} onChange={setKind} />
          <Button type="submit" size="small" variant="contained" color="secondary" disabled={!text.trim()}>Save</Button>
          <Button size="small" onClick={() => setEditing(false)}>Cancel</Button>
          {said}
        </Box>
      </Box>
    )
  }
  return (
    <Box component="li" sx={{ listStyle: 'none', display: 'flex', alignItems: 'center', columnGap: SPACE.text, rowGap: SPACE.hair, flexWrap: 'wrap' }} data-about-you-fact={fact.id}>
      <Box sx={{ flex: '1 1 260px', minWidth: 0 }}>
        <Typography sx={{ overflowWrap: 'anywhere' }} color={fact.hidden ? 'text.secondary' : 'text.primary'}>
          {fact.text}
          {fact.hidden && <Typography component="span" variant="body2" color="text.secondary">{' (hidden, not used)'}</Typography>}
        </Typography>
        <FinePrint>{sourceLine(fact.source)}</FinePrint>
      </Box>
      <Button size="small" ref={editButton} onClick={start} data-about-you-edit="" aria-label={`Edit: ${fact.text}`}>Edit</Button>
      <Button size="small" onClick={() => onHide(fact, !fact.hidden)} aria-label={`${fact.hidden ? 'Show' : 'Hide'}: ${fact.text}`}>{fact.hidden ? 'Show' : 'Hide'}</Button>
      <Button size="small" color="error" onClick={() => onRemove(fact)} aria-label={`Remove: ${fact.text}`}>Remove</Button>
      {said}
    </Box>
  )
}

FactRow.propTypes = {
  fact: factShape.isRequired,
  error: PropTypes.string,
  onSave: PropTypes.func.isRequired,
  onHide: PropTypes.func.isRequired,
  onRemove: PropTypes.func.isRequired,
}
FactRow.defaultProps = { error: '' }

export default function AboutYou() {
  const theme = useTheme()
  // null until the first read; a failed first read leaves both null and offers Retry
  const [facts, setFacts] = useState(null)
  const [switches, setSwitches] = useState(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [kind, setKind] = useState('role')
  const [text, setText] = useState('')
  // Each error is shown where its change was made: the top (reading, the switch), the add form,
  // a fact's own row, or the Download or delete section.
  const [error, setError] = useState({ at: '', message: '' })
  // Said to screen readers after each change ("Added.", "Hidden."), the same words again too.
  const [status, setStatus] = useState('')
  // The interview is open here (Interview.jsx).
  const [talking, setTalking] = useState(false)
  const busy = useRef(false)
  const addField = useRef(null)
  const statusTimer = useRef(null)
  // Changes wait for a good read: after a failed one, Retry first.
  const loaded = facts !== null && switches !== null && !loadFailed
  // Until the switches are read they show nothing as on.
  const settings = switches || { on: false, sources: {} }

  const announce = (words) => {
    // Cleared first, so the same words twice are still read out.
    setStatus('')
    window.clearTimeout(statusTimer.current)
    statusTimer.current = window.setTimeout(() => setStatus(words), 100)
  }
  useEffect(() => () => window.clearTimeout(statusTimer.current), [])
  const errorAt = (at) => (error.at === at ? error.message : '')

  const load = useCallback(async () => {
    try {
      const [listed, read] = await Promise.all([Meteor.callAsync(M.facts.list, {}), Meteor.callAsync(M.settings.get, {})])
      setFacts(listed.facts)
      setSwitches(read)
      setLoadFailed(false)
      return true
    } catch (requestError) {
      // What was shown stays (or, before the first read, nothing is): never a made-up state.
      setError({ at: 'load', message: reason(requestError, 'About you could not be read.') })
      setLoadFailed(true)
      return false
    }
  }, [])

  useEffect(() => { load() }, [load])

  const retry = async () => {
    setError({ at: '', message: '' })
    if (await load()) announce('About you is ready.')
  }

  // One change at a time (a second click while one runs is ignored); the list is read again after
  // it, so it always shows what is stored. → { ok, result }
  const run = async (at, work, said) => {
    if (busy.current) return { ok: false }
    busy.current = true
    setError({ at: '', message: '' })
    try {
      const result = await work()
      await load()
      const words = typeof said === 'function' ? said(result) : said
      if (words) announce(words)
      return { ok: true, result }
    } catch (requestError) {
      setError({ at, message: reason(requestError, 'That did not work. Try again.') })
      return { ok: false }
    } finally {
      busy.current = false
    }
  }

  const add = async (event) => {
    event.preventDefault()
    if (!text.trim()) return
    const { ok, result } = await run('add', () => Meteor.callAsync(M.facts.add, { kind, text: text.trim() }), (out) => (out?.added === false ? '' : 'Added.'))
    if (!ok) return
    if (result?.added === false) {
      // Nothing was added: their words stay, and they hear why.
      setError({ at: 'add', message: 'You already have that one.' })
      announce('You already have that one.')
      return
    }
    setText('')
    addField.current?.focus()
  }
  const save = async (fact, change) => {
    const edit = {
      ...(change.kind !== fact.kind && { kind: change.kind }),
      ...(change.text.trim() !== fact.text && { text: change.text.trim() }),
    }
    // nothing changed: nothing to save
    if (!Object.keys(edit).length) return true
    const { ok, result } = await run(fact.id, () => Meteor.callAsync(M.facts.update, { factId: fact.id, ...edit }), 'Saved.')
    // A fact that moved to another kind, or the first-slate fact made their own, is a new row.
    if (ok && result?.fact?.id) later(() => editButtonOf(result.fact.id)?.focus())
    return ok
  }
  const hide = (fact, hidden) => run(fact.id, () => Meteor.callAsync(M.facts.hide, { factId: fact.id, hidden }), hidden ? 'Hidden.' : 'Shown again.')
  const remove = async (fact) => {
    // Focus goes to the next fact's Edit, else the one before, else the list's heading.
    const order = groupFacts(facts || []).flatMap((group) => group.facts.map((item) => item.id))
    const at = order.indexOf(fact.id)
    const next = order[at + 1] ?? order[at - 1]
    const { ok } = await run(fact.id, () => Meteor.callAsync(M.facts.remove, { factId: fact.id }), 'Removed.')
    if (!ok) return
    later(() => {
      const target = (next && editButtonOf(next)) || document.querySelector('[data-about-you-known] h2')
      if (target?.tagName === 'H2') target.setAttribute('tabindex', '-1')
      target?.focus()
    })
  }
  const toggle = (on) => run('page', async () => setSwitches(await Meteor.callAsync(M.settings.set, { on })), on ? 'Personalization is on.' : 'Personalization is off.')
  // The interview as a source: on until switched off (personal-facts.mjs sourceOn).
  const interviewOn = settings.sources?.interview !== false
  const canTalk = loaded && settings.on && interviewOn
  const toggleInterview = (on) => run('talk', async () => setSwitches(await Meteor.callAsync(M.settings.set, { sources: { interview: on } })),
    on ? 'Learning from talks with the agent is on.' : 'Learning from talks with the agent is off.')
  const openTalk = () => {
    if (!canTalk) return
    setTalking(true)
    // focus goes to the talk's name as it opens (Interview.jsx); the scroll respects reduced motion
    const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    later(() => document.querySelector('[data-about-you-interview]')?.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' }))
  }
  const endTalk = (kept) => {
    setTalking(false)
    announce(kept?.length ? `The talk ended. ${kept.length === 1 ? 'One thing was' : `${kept.length} things were`} kept.` : 'The talk ended.')
    later(() => document.querySelector('[data-interview-open]')?.focus())
  }

  const download = () => {
    const doc = profileDownload({ facts, settings: switches })
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `slatebox-about-you-${doc.exportedAt.slice(0, 10)}.json`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    announce('Downloaded.')
  }

  const deleteAll = async () => {
    const sure = await confirmService.show({
      theme,
      title: 'Delete all facts about you?',
      message: 'Every fact in About you is removed, and Slatebox stops using them. Your personalization switch stays as it is, and your slates are not touched. This cannot be undone.',
      actionItems: [
        { label: 'Delete all facts', return: true },
        { label: 'Cancel', return: false },
      ],
    })
    if (!sure) return
    const { ok } = await run('copy', () => Meteor.callAsync(M.facts.clear, {}), 'All facts were deleted.')
    // the button is gone from use now: the add field is where to go next
    if (ok) later(() => addField.current?.focus())
  }

  const groups = groupFacts(facts || [])
  return (
    <AccountPanel>
      <AccountSection title="About you" data-profile-about-you="">
        <Typography>What Slatebox knows about you, so it can suggest boards and slates made for your work. Only you see this.</Typography>
        <FormControlLabel
          sx={{ alignSelf: 'flex-start' }}
          control={<Switch checked={settings.on} onChange={(e) => toggle(e.target.checked)} disabled={!loaded} slotProps={{ input: { role: 'switch' } }} />}
          label="Use what is here to personalize Slatebox"
        />
        {loaded && (
          <FinePrint>
            {settings.on
              ? 'Personalization is on. Slatebox may use what is here, except what you hide.'
              : 'Personalization is off. Slatebox uses nothing here and adds nothing to it. What you keep stays until you remove it.'}
          </FinePrint>
        )}
        {errorAt('page') && <Alert severity="warning" role="alert">{errorAt('page')}</Alert>}
        {errorAt('load') && (
          <Alert severity="warning" role="alert" action={<Button color="inherit" size="small" onClick={retry}>Retry</Button>}>
            {errorAt('load')}
          </Alert>
        )}
        <Box role="status" aria-live="polite" sx={visuallyHidden}>{status}</Box>
      </AccountSection>

      <AccountSection title="Talk with Slatebox" data-about-you-interview="">
        {talking ? <Interview onKept={load} onDone={endTalk} /> : (
          <>
            <Typography>The agent asks about your role, your team and the work you do, one question at a time. You choose what to keep, and you can skip anything.</Typography>
            <FinePrint>To ask better questions, the agent sees the names of the tools you connected to Slatebox, never what they hold.</FinePrint>
            <FormControlLabel
              sx={{ alignSelf: 'flex-start' }}
              control={<Switch checked={loaded && interviewOn} onChange={(e) => toggleInterview(e.target.checked)} disabled={!loaded || !settings.on} slotProps={{ input: { role: 'switch' } }} />}
              label="Learn from talks with the agent"
            />
            {loaded && !settings.on && <FinePrint>Turn on personalization above to talk with the agent.</FinePrint>}
            {loaded && settings.on && !interviewOn && <FinePrint>Switch on &ldquo;Learn from talks with the agent&rdquo; to start a talk.</FinePrint>}
            {errorAt('talk') && <Alert severity="warning" role="alert">{errorAt('talk')}</Alert>}
            <AccountActions>
              <Button variant="contained" color="secondary" onClick={openTalk} disabled={!canTalk} data-interview-open="">Talk with Slatebox about your work</Button>
            </AccountActions>
          </>
        )}
      </AccountSection>

      <AccountSection title="Add something about you">
        <Box component="form" onSubmit={add} sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: SPACE.text }} aria-label="Add something about you">
          <TextField id="about-you-text" inputRef={addField} size="small" label="What Slatebox should know" placeholder="Product manager on a team of six"
            value={text} onChange={(e) => { setText(e.target.value); if (error.at === 'add') setError({ at: '', message: '' }) }}
            error={Boolean(errorAt('add'))} helperText={errorAt('add') || undefined} disabled={loadFailed}
            slotProps={{ htmlInput: { maxLength: LIMITS.text } }} sx={{ flex: '1 1 260px', ...field }} />
          <KindSelect id="about-you-kind" value={kind} onChange={setKind} disabled={loadFailed} />
          <Button type="submit" variant="contained" color="secondary" disabled={loadFailed || !text.trim()}>Add</Button>
        </Box>
        <FinePrint>{`A few words each, up to ${LIMITS.text} characters. About you keeps up to ${LIMITS.perPerson} things.`}</FinePrint>
      </AccountSection>

      <AccountSection title="What Slatebox knows" data-about-you-known="">
        {facts === null && !loadFailed && <FinePrint>Reading…</FinePrint>}
        {facts === null && loadFailed && <FinePrint>Your facts show here once About you can be read.</FinePrint>}
        {loaded && groups.length === 0 && (
          <>
            <FinePrint data-about-you-empty="">
              {canTalk
                ? 'Nothing here yet. Add something above, such as your role or the tools you use, or talk with Slatebox about your work and keep what you choose.'
                : 'Nothing here yet. Add something above, such as your role or the tools you use.'}
            </FinePrint>
            {canTalk && !talking && (
              <AccountActions>
                <Button variant="outlined" color="secondary" onClick={openTalk} data-about-you-empty-talk="">Start a talk with Slatebox</Button>
              </AccountActions>
            )}
          </>
        )}
        {groups.map((group) => (
          <Box key={group.kind} sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.tight }}>
            <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 650 }} id={`about-you-${group.kind}`}>{group.label}</Typography>
            <Box component="ul" aria-labelledby={`about-you-${group.kind}`} sx={{ m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: SPACE.text }}>
              {group.facts.map((fact) => (
                <FactRow key={fact.id} fact={fact} error={errorAt(fact.id)} onSave={save} onHide={hide} onRemove={remove} />
              ))}
            </Box>
          </Box>
        ))}
      </AccountSection>

      <AccountSection title="Download or delete">
        <FinePrint>Download everything About you holds as a file, or delete all its facts.</FinePrint>
        <AccountActions>
          <Button variant="outlined" color="secondary" onClick={download} disabled={!loaded}>Download</Button>
          <Button variant="outlined" color="error" onClick={deleteAll} disabled={!loaded || !facts.length}>Delete all facts</Button>
        </AccountActions>
        {errorAt('copy') && <Alert severity="warning" role="alert">{errorAt('copy')}</Alert>}
      </AccountSection>
    </AccountPanel>
  )
}
