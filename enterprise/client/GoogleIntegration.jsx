// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Google in the app (enterprise/server/google): its section on the Integrations page (connect once,
// what Slatebox may reach in plain words, when the Drive agent joins slates, disconnect), the slate
// export's "Save to Google Drive" and "Export to Google Docs" (the slate.export.google slot), the +
// menu's "Import from Google Drive" (addmenu.import), and the Drive agent's "Drive files" on its chip.
// Free accounts on Slatebox Cloud see the controls and get the Pro sheet; where enterprise code is
// locked none of this exists (empty slots).
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useAtomValue, useSetAtom } from 'jotai'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Grid from '@mui/material/Grid2'
import MenuItem from '@mui/material/MenuItem'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { usePaySheet } from '/imports/ui/components/billing/pay/PaySheetHost.jsx'
import { currentSlate, globalMessage } from '/imports/ui/jotai/atoms'
import { enterpriseState } from '/imports/api/common/edition.mjs'
import { enterpriseSlots } from '/imports/api/client/enterprise-slots.mjs'
import { connectGoogle, pickFiles, preloadGoogle } from './google'

const errorText = (error) => {
  enterpriseSlots.lockIfRefused(error)
  return error?.reason || error?.message || 'That did not work. Try again.'
}
const cloud = () => enterpriseState(Meteor.settings).via === 'cloud'
const PAY_REASON = 'Save slates to Google Drive, export them to Google Docs and bring your files in.'

// One answer from google.status per page view, shared by every Google control on it.
let statusPromise = null
export function googleStatus({ fresh = false } = {}) {
  if (fresh || !statusPromise) statusPromise = Meteor.callAsync('google.status', {}).catch((error) => {
    statusPromise = null
    enterpriseSlots.lockIfRefused(error)
    return null
  })
  return statusPromise
}

function useGoogleStatus() {
  const [status, setStatus] = useState(null)
  useEffect(() => {
    let live = true
    googleStatus().then((answer) => live && setStatus(answer))
    return () => { live = false }
  }, [])
  return [status, () => googleStatus({ fresh: true }).then(setStatus)]
}

/** The Integrations page's Google section. */
export default function GoogleIntegration({ integrations = [], pro = true, onPay, onChanged }) {
  const [status, refresh] = useGoogleStatus()
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const row = integrations.find((integration) => integration.kind === 'google')
  useEffect(() => { if (status?.enabled && status?.configured) preloadGoogle().catch(() => {}) }, [status?.enabled, status?.configured])
  if (!status?.enabled) return null
  const connect = () => {
    if (!pro) return onPay(() => refresh())
    setNote('')
    setBusy(true)
    connectGoogle(status.clientId).then(() => { refresh(); onChanged?.() }).catch((e) => setNote(errorText(e))).finally(() => setBusy(false))
  }
  const disconnect = () => Meteor.callAsync('integrations.disconnect', { integrationId: row.integrationId }).then(() => { refresh(); onChanged?.() }).catch((e) => setNote(errorText(e)))
  const setRule = (rule) => Meteor.callAsync('integrations.setRule', { integrationId: row.integrationId, rule }).then(() => onChanged?.()).catch((e) => setNote(errorText(e)))
  return (
    <Box data-google-integration={row ? row.status : 'none'} sx={(t) => ({ bgcolor: '#fffef8', border: '1px solid #e1e3d6', borderRadius: '14px', p: { xs: 1.75, sm: 2 }, ...t.applyStyles('dark', { bgcolor: '#23362d', borderColor: '#3a5244' }) })}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h6" component="h2" sx={{ flex: 1, fontWeight: 700 }}>Google Drive and Docs</Typography>
        {!row && <Button variant="contained" data-google-connect="" disabled={busy || !status.configured} onClick={connect}>{busy ? 'Connecting…' : 'Connect Google'}</Button>}
        {row && !confirming && <Button color="error" data-google-disconnect="" onClick={() => setConfirming(true)}>Disconnect</Button>}
      </Box>
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        Save slates to your Drive, export them to Google Docs, bring Docs and sheets in as notes, and invite Google Drive onto a slate as an agent that reads the files you pick for it.
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.75, mb: 0 }} data-google-scope="">
        Slatebox asks Google only for the files it makes and the files you pick. It cannot see the rest of your Drive.
      </Typography>
      {!status.configured && <Typography variant="body2" sx={{ mt: 1 }}>Google is not set up on this server yet.</Typography>}
      {row && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mt: 1.25 }}>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 200 }}>
            {row.status === 'needs_sign_in' ? 'Google needs you to connect again.' : row.status === 'pro_ended' ? 'Pro ended: Google is paused.' : 'Connected.'}
            {row.slateCount ? ` The Drive agent is on ${row.slateCount} ${row.slateCount === 1 ? 'slate' : 'slates'}.` : ''}
          </Typography>
          {row.status === 'needs_sign_in' && <Button size="small" variant="contained" onClick={connect}>Connect again</Button>}
          <TextField select size="small" label="Drive agent joins slates" value={row.rule} onChange={(e) => setRule(e.target.value)} sx={{ minWidth: 220 }} inputProps={{ 'data-google-rule': '' }}>
            <MenuItem value="ask">When I invite it</MenuItem>
            <MenuItem value="my_slates">On every slate I own</MenuItem>
          </TextField>
        </Box>
      )}
      {confirming && (
        <Box role="alertdialog" aria-label="Disconnect Google?" sx={{ mt: 1 }}>
          <Typography variant="body2">Disconnect Google? Slatebox&apos;s access is revoked at Google and the Drive agent leaves every slate. Files already in your Drive stay.</Typography>
          <Box sx={{ display: 'flex', gap: 1, mt: 0.5 }}>
            <Button size="small" variant="contained" color="error" data-google-disconnect-yes="" onClick={() => { setConfirming(false); disconnect() }}>Disconnect</Button>
            <Button size="small" onClick={() => setConfirming(false)}>Cancel</Button>
          </Box>
        </Box>
      )}
      {note && <Typography role="status" variant="body2" sx={{ mt: 1 }}>{note}</Typography>}
    </Box>
  )
}
GoogleIntegration.propTypes = { integrations: PropTypes.arrayOf(PropTypes.shape({ kind: PropTypes.string })), pro: PropTypes.bool, onPay: PropTypes.func.isRequired, onChanged: PropTypes.func }

// Runs fn once Google is connected: the Pro sheet first for a free account on Cloud, Connect Google first when not connected.
function useGoogleAction() {
  const { open: openPay } = usePaySheet()
  const setMessage = useSetAtom(globalMessage)
  const say = (text, line2, severity = 'info') => setMessage({ visible: true, text, line2, severity, autoHide: 6000 })
  const [status, refresh] = useGoogleStatus()
  const run = async (fn) => {
    if (!status?.enabled) return
    if (cloud() && status.pro === false) return openPay({ action: 'pro', from: 'google', reason: PAY_REASON, retry: () => refresh() })
    try {
      if (!status.connected) {
        await connectGoogle(status.clientId)
        refresh()
      }
      await fn()
    } catch (e) {
      if (e?.error === 'pro_required') return openPay({ action: 'pro', from: 'google', reason: PAY_REASON, retry: () => refresh() })
      say(errorText(e), undefined, 'error')
    }
  }
  return { status, run, say }
}

/** slate.export.google: "Save to Google Drive" and "Export to Google Docs" in the slate's export panel. */
export function GoogleExport({ onExport }) {
  const slate = useAtomValue(currentSlate)
  const { status, run, say } = useGoogleAction()
  const [last, setLast] = useState(null)
  useEffect(() => { if (status?.enabled) preloadGoogle().catch(() => {}) }, [status?.enabled])
  useEffect(() => {
    if (!status?.connected || !slate?.shareId) return
    Meteor.callAsync('google.lastDoc', { shareId: slate.shareId }).then((answer) => setLast(answer?.url ? answer : null)).catch(() => {})
  }, [status?.connected, slate?.shareId])
  if (!status?.enabled || !slate?.shareId) return null
  const png = () => new Promise((resolve) => onExport('png', { base64: true }, resolve))
  const saveToDrive = () => run(async () => {
    say('Saving to Google Drive…')
    const data = await png()
    const saved = await Meteor.callAsync('google.saveToDrive', { shareId: slate.shareId, format: 'png', data })
    say('Saved to Google Drive.', saved.webViewLink)
    window.open(saved.webViewLink, '_blank', 'noopener')
  })
  const exportDoc = (update) => run(async () => {
    say(update ? 'Updating your Google Doc…' : 'Exporting to Google Docs…')
    const image = await png()
    const made = await Meteor.callAsync('google.exportDoc', { shareId: slate.shareId, image, ...(update && { update: true }) })
    setLast({ url: made.url, documentId: made.documentId })
    say(update ? 'Google Doc updated.' : 'Exported to Google Docs.', made.url)
    window.open(made.url, '_blank', 'noopener')
  })
  return (
    <>
      <Grid size={12}>
        <Button variant="outlined" color="secondary" fullWidth data-google-save-drive="" onClick={saveToDrive}>Save to Google Drive</Button>
      </Grid>
      <Grid size={last ? 6 : 12}>
        <Button variant="outlined" color="secondary" fullWidth data-google-export-doc="" onClick={() => exportDoc(false)}>Export to Google Docs</Button>
      </Grid>
      {last && (
        <Grid size={6}>
          <Button variant="outlined" color="secondary" fullWidth data-google-update-doc="" onClick={() => exportDoc(true)}>Update this Doc</Button>
        </Grid>
      )}
    </>
  )
}
GoogleExport.propTypes = { onExport: PropTypes.func.isRequired }

/** addmenu.import: "Import from Google Drive" in the + menu: the Picker, then one suggestion on the slate. */
export function GoogleImport({ onDone, variant = 'row' }) {
  const slate = useAtomValue(currentSlate)
  const { status, run, say } = useGoogleAction()
  useEffect(() => { if (status?.enabled && status?.pickerReady) preloadGoogle({ picker: true }).catch(() => {}) }, [status?.enabled, status?.pickerReady])
  if (!status?.enabled || !status?.pickerReady || !slate?.shareId) return null
  const go = () => run(async () => {
    const [file] = await pickFiles({ clientId: status.clientId, apiKey: Meteor.settings.public?.google?.pickerApiKey, appId: Meteor.settings.public?.google?.appId })
    onDone?.()
    if (!file) return
    say(`Bringing in ${file.name}…`)
    const result = await Meteor.callAsync('google.importFile', { shareId: slate.shareId, fileId: file.id })
    say(`${result.name}: ${result.added.notes} ${result.added.notes === 1 ? 'note' : 'notes'} to keep or discard.`)
  })
  if (variant === 'dock') {
    return <ButtonBase onClick={go} data-import-google-open="" sx={{ whiteSpace: 'nowrap', fontSize: 13, px: 1, py: 0.5, fontWeight: 600, color: 'primary.main', borderRadius: 1 }}>Import from Google Drive</ButtonBase>
  }
  return <button type="button" className="sb-btn" data-import-google-open="" onClick={go} style={{ marginTop: 6, marginLeft: 6, height: 'auto' }}>Import from Google Drive</button>
}
GoogleImport.propTypes = { onDone: PropTypes.func, variant: PropTypes.oneOf(['row', 'dock']) }

/** On the Google Drive agent's chip (its owner only): the Drive files it may read on this slate. */
export function DriveFiles({ shareId }) {
  const { status, run, say } = useGoogleAction()
  const [files, setFiles] = useState(null)
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  useEffect(() => {
    if (!shareId) return
    Meteor.callAsync('google.slateFiles', { shareId }).then((answer) => live.current && setFiles(answer.files || [])).catch(() => {})
  }, [shareId])
  useEffect(() => { if (status?.pickerReady) preloadGoogle({ picker: true }).catch(() => {}) }, [status?.pickerReady])
  if (!status?.pickerReady) return null
  const pick = () => run(async () => {
    const picked = await pickFiles({ clientId: status.clientId, apiKey: Meteor.settings.public?.google?.pickerApiKey, appId: Meteor.settings.public?.google?.appId, multiple: true })
    if (!picked.length) return
    const answer = await Meteor.callAsync('google.attachFiles', { shareId, files: picked })
    if (live.current) setFiles(answer.files)
    say(`Google Drive may read ${answer.files.length} ${answer.files.length === 1 ? 'file' : 'files'} on this slate.`)
  })
  return (
    <Box sx={{ mt: 1 }} data-drive-files={files?.length ?? 0}>
      <Typography variant="caption" color="text.secondary" component="div">
        {files?.length ? `Reads: ${files.map((file) => file.name).join(', ')}` : 'It reads only the Drive files you pick for this slate.'}
      </Typography>
      <Button size="small" variant="outlined" sx={{ mt: 0.5 }} data-drive-files-pick="" onClick={pick}>Drive files</Button>
    </Box>
  )
}
DriveFiles.propTypes = { shareId: PropTypes.string }
