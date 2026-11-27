import React, { useCallback, useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography'
import CONSTANTS from '../../../api/common/constants'
import { KIND_LABELS } from '../../../api/common/personal-facts.mjs'
import { IMPORT_LIMITS, importSwitchKey } from '../../../api/common/profile-import.mjs'
import { keepOutcome } from '../../../api/common/interview.mjs'
import { AccountActions, FinePrint, SPACE } from '../../common/AccountLayout'

// About you › Learn from a data export (S3, 2026-11-26): the person uploads the .zip that LinkedIn
// ("Get a copy of your data"), Facebook or Instagram ("Download your information", in the format other services can import) sent them.
// The server reads a few fields from it (a headline, job titles, skills, topics; never contacts,
// messages or photos), keeps none of the file, and the agent proposes a few facts, shown as chips:
// Keep or Skip each, as with a connected tool. Keeping one switches that upload on; each upload kept
// from has its own switch, and turning it off stops Slatebox using its facts. After Keep or Skip,
// focus moves to the next open chip's Keep, else back to the upload button.
const M = CONSTANTS.methods.profile.import
const reason = (error, fallback) => error?.reason || error?.message || fallback
const MB = Math.round(IMPORT_LIMITS.bytes / (1024 * 1024))
let nextId = 0
const chipId = () => {
  nextId += 1
  return `upload-fact-${nextId}`
}

/**
 * The section's body. setSource(key, on, words) saves a switch through About you's own queue
 * (profile.settings) and resolves once the switches are read again; onKept reads the facts again.
 */
export default function ExportUpload({ settings, setSource, onKept, announce, disabled }) {
  const [uploads, setUploads] = useState([])
  const [reading, setReading] = useState(false)
  const [error, setError] = useState('')
  const [say, setSay] = useState('')
  const [from, setFrom] = useState(null)
  const [chips, setChips] = useState([])
  const [saving, setSaving] = useState(false)
  const [movedFrom, setMovedFrom] = useState(null)
  const fileInput = useRef(null)
  const chooseButton = useRef(null)
  const keepButtons = useRef(new Map())
  const on = Boolean(settings?.on)

  const list = useCallback(async () => {
    try {
      const out = await Meteor.callAsync(M.list, {})
      setUploads(out?.uploads || [])
    } catch {
      setUploads([])
    }
  }, [])
  useEffect(() => { list() }, [list, settings?.sources])
  // personalization off: what was proposed goes, nothing can be kept
  useEffect(() => {
    if (!on) {
      setChips([])
      setSay('')
    }
  }, [on])
  useEffect(() => {
    if (movedFrom === null) return
    const at = chips.findIndex((chip) => chip.id === movedFrom)
    const open = [...chips.slice(at + 1), ...chips.slice(0, Math.max(at, 0))].find((chip) => chip.state === 'open')
    const next = open ? keepButtons.current.get(open.id) : chooseButton.current
    next?.focus()
    setMovedFrom(null)
  }, [movedFrom, chips])

  const upload = async (file) => {
    if (!file) return
    setError('')
    setSay('')
    setChips([])
    if (file.size > IMPORT_LIMITS.bytes) {
      setError(`That file is larger than ${MB} MB. Ask for a smaller export: on LinkedIn the first, smaller file; on Facebook or Instagram only your profile information.`)
      return
    }
    setReading(true)
    announce('Reading your export…')
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const out = await Meteor.callAsync(M.read, { data })
      const proposed = (out?.proposed || []).map((fact) => ({ ...fact, id: chipId(), state: 'open' }))
      setFrom({ ref: out?.ref, name: out?.name })
      setChips(proposed)
      setSay(out?.say || '')
      announce(proposed.length ? `Slatebox found ${proposed.length === 1 ? 'one thing' : `${proposed.length} things`} in your ${out?.name} export to keep. Keep or skip each.` : (out?.say || 'Nothing to keep from that export.'))
    } catch (requestError) {
      setError(reason(requestError, 'Slatebox could not read that file. Try again.'))
    } finally {
      setReading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const decide = (fact, state, extra = {}) => setChips((all) => all.map((chip) => (chip.id === fact.id ? { ...chip, state, ...extra } : chip)))
  const keep = async (fact) => {
    if (saving || !from?.ref) return
    setSaving(true)
    try {
      const outcome = keepOutcome(await Meteor.callAsync(M.keep, { ref: from.ref, facts: [{ kind: fact.kind, text: fact.text }] }))
      if (outcome.error) decide(fact, 'open', { error: outcome.error })
      else {
        decide(fact, 'kept', { error: '' })
        setMovedFrom(fact.id)
        announce(`Kept: ${fact.text}`)
        onKept()
        list()
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
  const onSwitch = (row, value) => setSource(importSwitchKey(row.ref), value, value ? `Slatebox uses what you kept from your ${row.name} upload again.` : `Slatebox no longer uses what you kept from your ${row.name} upload.`)

  const chip = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: SPACE.tight, rowGap: SPACE.hair, px: SPACE.text, py: SPACE.hair,
    border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', listStyle: 'none' }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.tight }} data-export-upload="">
      <input ref={fileInput} type="file" accept=".zip,application/zip" hidden onChange={(e) => upload(e.target.files?.[0])} data-export-upload-file="" aria-label="Your data export (.zip)" />
      <AccountActions>
        <Button ref={chooseButton} variant="outlined" color="secondary" onClick={() => fileInput.current?.click()} disabled={reading || disabled || !on} data-export-upload-choose="">
          {reading ? 'Reading your export…' : 'Upload a data export (.zip)'}
        </Button>
      </AccountActions>
      {error && <Alert severity="warning" role="alert">{error}</Alert>}
      {say && !chips.length && <FinePrint data-export-upload-say="">{say}</FinePrint>}
      {chips.length > 0 && on && (
        <Box component="ul" aria-label={`What Slatebox found in your ${from?.name || ''} export, to keep or skip`} sx={{ m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: SPACE.hair }} data-export-upload-facts="">
          {chips.map((fact) => {
            const words = `${KIND_LABELS[fact.kind] || fact.kind}: ${fact.text}`
            if (fact.state !== 'open') {
              return (
                <Box component="li" key={fact.id} sx={{ ...chip, color: 'text.secondary' }} data-export-upload-fact={fact.id}>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{fact.state === 'kept' ? `Kept: ${fact.text}` : `Skipped: ${fact.text}`}</Typography>
                </Box>
              )
            }
            return (
              <Box component="li" key={fact.id} sx={chip} data-export-upload-fact={fact.id}>
                <Box sx={{ flex: '1 1 160px', minWidth: 0 }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>{KIND_LABELS[fact.kind] || fact.kind}</Typography>
                  <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{fact.text}</Typography>
                </Box>
                <Button size="small" color="secondary" ref={(node) => { if (node) keepButtons.current.set(fact.id, node); else keepButtons.current.delete(fact.id) }} onClick={() => keep(fact)} disabled={saving} aria-label={`Keep: ${words}`} data-export-upload-keep="">Keep</Button>
                <Button size="small" onClick={() => skip(fact)} aria-label={`Skip: ${words}`}>Skip</Button>
                {fact.error && <Alert severity="warning" role="alert" sx={{ flexBasis: '100%' }}>{fact.error}</Alert>}
              </Box>
            )
          })}
        </Box>
      )}
      {uploads.length > 0 && (
        <Box component="ul" aria-label="Your uploads" sx={{ m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: SPACE.hair }} data-export-uploads="">
          {uploads.map((row) => (
            <Box component="li" key={row.ref} sx={{ listStyle: 'none' }} data-export-upload-source={row.ref}>
              <FormControlLabel
                control={<Switch checked={row.on} onChange={(e) => onSwitch(row, e.target.checked)} disabled={disabled || !on} slotProps={{ input: { role: 'switch' } }} />}
                label={`Use your ${row.name} upload to personalize`}
              />
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

ExportUpload.propTypes = {
  settings: PropTypes.shape({ on: PropTypes.bool, sources: PropTypes.object }),
  setSource: PropTypes.func.isRequired,
  onKept: PropTypes.func.isRequired,
  announce: PropTypes.func.isRequired,
  disabled: PropTypes.bool,
}
ExportUpload.defaultProps = { settings: null, disabled: false }
