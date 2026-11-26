import React, { useCallback, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Link as RouterLink } from 'react-router-dom'
import Link from '@mui/material/Link'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import { KIND_LABELS } from '../../../api/common/personal-facts.mjs'
import { toolSwitchKey } from '../../../api/common/profile-sources.mjs'
import { keepOutcome } from '../../../api/common/interview.mjs'
import { AccountActions, FinePrint, SPACE } from '../../common/AccountLayout'

// About you › Use your tools to personalize (S3, 2026-11-26): one switch per connected tool that
// Slatebox can read, off until the person turns it on. With it on, "Look around in <tool>" runs a
// small read-only look (a few lookups, capped) and the agent proposes a few facts from it, shown as
// chips: Keep or Skip each. Nothing is saved until they keep it; the tool's facts say where they came
// from, and turning the switch off stops Slatebox using them (and clears what it proposed). After Keep
// or Skip, focus moves to the next open chip's Keep, else back to "Look around". Shown only where
// integrations run.
const M = CONSTANTS.methods.profile.sources
const reason = (error, fallback) => error?.reason || error?.message || fallback
let nextId = 0
const chipId = () => {
  nextId += 1
  return `source-fact-${nextId}`
}

function ToolRow({ tool, personalizationOn, onSwitch, onKept, announce, disabled }) {
  const [looking, setLooking] = useState(false)
  const [error, setError] = useState('')
  const [say, setSay] = useState('')
  const [chips, setChips] = useState([])
  const [saving, setSaving] = useState(false)
  const lookButton = useRef(null)
  const keepButtons = useRef(new Map())
  // The chip a decision was made on: once the list re-renders, focus moves on from it.
  const [movedFrom, setMovedFrom] = useState(null)
  const label = `Use ${tool.name} to personalize`
  const look = async () => {
    setLooking(true)
    setError('')
    setSay('')
    try {
      const out = await Meteor.callAsync(M.read, { ref: tool.ref })
      const proposed = (out?.proposed || []).map((fact) => ({ ...fact, id: chipId(), state: 'open' }))
      setChips(proposed)
      setSay(out?.say || '')
      announce(proposed.length ? `Slatebox found ${proposed.length === 1 ? 'one thing' : `${proposed.length} things`} in ${tool.name} to keep. Keep or skip each.` : (out?.say || `Nothing to keep from ${tool.name}.`))
    } catch (requestError) {
      setError(reason(requestError, `Slatebox could not read ${tool.name}. Try again.`))
    } finally {
      setLooking(false)
    }
  }
  const decide = (fact, state, extra = {}) => setChips((all) => all.map((chip) => (chip.id === fact.id ? { ...chip, state, ...extra } : chip)))
  // Switching the tool off drops what it proposed: nothing from a tool whose switch is off can be kept.
  useEffect(() => {
    if (!tool.on || !personalizationOn) {
      setChips([])
      setSay('')
    }
  }, [tool.on, personalizationOn])
  useEffect(() => {
    if (movedFrom === null) return
    const at = chips.findIndex((chip) => chip.id === movedFrom)
    const open = [...chips.slice(at + 1), ...chips.slice(0, Math.max(at, 0))].find((chip) => chip.state === 'open')
    const next = open ? keepButtons.current.get(open.id) : lookButton.current
    next?.focus()
    setMovedFrom(null)
  }, [movedFrom, chips])
  const keep = async (fact) => {
    if (saving) return
    setSaving(true)
    try {
      const outcome = keepOutcome(await Meteor.callAsync(M.keep, { ref: tool.ref, facts: [{ kind: fact.kind, text: fact.text }] }))
      if (outcome.error) decide(fact, 'open', { error: outcome.error })
      else {
        decide(fact, 'kept', { error: '' })
        setMovedFrom(fact.id)
        announce(`Kept: ${fact.text}`)
        onKept()
      }
    } catch (requestError) {
      decide(fact, 'open', { error: reason(requestError, 'That could not be kept. Try again.') })
    } finally {
      setSaving(false)
    }
  }
  const skip = (fact) => {
    decide(fact, 'skipped')
    setMovedFrom(fact.id)
    announce(`Skipped: ${fact.text}`)
  }
  const chip = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: SPACE.tight, rowGap: SPACE.hair, px: SPACE.text, py: SPACE.hair,
    border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', listStyle: 'none' }
  return (
    <Box component="li" sx={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: SPACE.tight }} data-tool-source={tool.ref}>
      <FormControlLabel
        sx={{ alignSelf: 'flex-start' }}
        control={<Switch checked={tool.on} onChange={(e) => onSwitch(tool, e.target.checked)} disabled={disabled || !personalizationOn} slotProps={{ input: { role: 'switch' } }} />}
        label={label}
      />
      {tool.on && personalizationOn && (
        <AccountActions>
          <Button ref={lookButton} variant="outlined" color="secondary" size="small" onClick={look} disabled={looking || disabled} data-tool-source-look="">
            {looking ? `Looking around in ${tool.name}…` : `Look around in ${tool.name}`}
          </Button>
        </AccountActions>
      )}
      {error && <Alert severity="warning" role="alert">{error}</Alert>}
      {say && !chips.length && <FinePrint>{say}</FinePrint>}
      {chips.length > 0 && tool.on && personalizationOn && (
        <Box component="ul" aria-label={`What Slatebox found in ${tool.name}, to keep or skip`} sx={{ m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: SPACE.hair }}>
          {chips.map((fact) => {
            const words = `${KIND_LABELS[fact.kind] || fact.kind}: ${fact.text}`
            if (fact.state !== 'open') {
              return (
                <Box component="li" key={fact.id} sx={{ ...chip, color: 'text.secondary' }} data-tool-source-fact={fact.id}>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{fact.state === 'kept' ? `Kept: ${fact.text}` : `Skipped: ${fact.text}`}</Typography>
                </Box>
              )
            }
            return (
              <Box component="li" key={fact.id} sx={chip} data-tool-source-fact={fact.id}>
                <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>{KIND_LABELS[fact.kind] || fact.kind}</Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{fact.text}</Typography>
                </Box>
                <Button size="small" color="secondary" ref={(node) => { if (node) keepButtons.current.set(fact.id, node); else keepButtons.current.delete(fact.id) }} onClick={() => keep(fact)} disabled={saving} aria-label={`Keep: ${words}`} data-tool-source-keep="">Keep</Button>
                <Button size="small" onClick={() => skip(fact)} aria-label={`Skip: ${words}`}>Skip</Button>
                {fact.error && <Alert severity="warning" role="alert" sx={{ flexBasis: '100%' }}>{fact.error}</Alert>}
              </Box>
            )
          })}
        </Box>
      )}
    </Box>
  )
}

ToolRow.propTypes = {
  tool: PropTypes.shape({ ref: PropTypes.string.isRequired, name: PropTypes.string.isRequired, on: PropTypes.bool.isRequired }).isRequired,
  personalizationOn: PropTypes.bool.isRequired,
  onSwitch: PropTypes.func.isRequired,
  onKept: PropTypes.func.isRequired,
  announce: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
}
ToolRow.defaultProps = { disabled: false }

/**
 * The section's body: the tools, each with its switch. setSource(key, on) saves a switch through
 * About you's own queue (profile.settings) and resolves once the switches are read again.
 */
export default function ToolSources({ settings, setSource, onKept, announce, disabled }) {
  const [tools, setTools] = useState(null)
  const [error, setError] = useState('')
  const read = useCallback(async () => {
    try {
      const out = await Meteor.callAsync(M.list, {})
      setTools(out?.tools || [])
      setError('')
    } catch (requestError) {
      setTools([])
      setError(reason(requestError, 'Your tools could not be read.'))
    }
  }, [])
  // read again when a switch changes, so each row shows what is stored
  useEffect(() => { read() }, [read, settings?.sources])
  if (tools === null) return <FinePrint>Reading your tools…</FinePrint>
  if (error) return <Alert severity="warning" role="alert">{error}</Alert>
  if (!tools.length)
    return (
      <FinePrint data-tool-sources-none="">
        Tools Slatebox can use here include GitHub, Linear, Notion, Jira, Sentry and Slack. Connect one on
        the <Link component={RouterLink} to="/integrations">Integrations page</Link> and it shows here.
      </FinePrint>
    )
  const onSwitch = (tool, on) => setSource(toolSwitchKey(tool), on, on ? `Slatebox may now look around in ${tool.name} when you ask.` : `Slatebox reads nothing from ${tool.name} now.`)
  return (
    <Box component="ul" aria-label="Your connected tools" sx={{ m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: SPACE.text }} data-tool-sources="">
      {tools.map((tool) => (
        <ToolRow key={tool.ref} tool={tool} personalizationOn={Boolean(settings?.on)} onSwitch={onSwitch} onKept={onKept} announce={announce} disabled={disabled} />
      ))}
    </Box>
  )
}

ToolSources.propTypes = {
  settings: PropTypes.shape({ on: PropTypes.bool, sources: PropTypes.object }),
  setSource: PropTypes.func.isRequired,
  onKept: PropTypes.func.isRequired,
  announce: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
}
ToolSources.defaultProps = { settings: null, disabled: false }
