import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Table from '@mui/material/Table'
import TableBody from '@mui/material/TableBody'
import TableCell from '@mui/material/TableCell'
import TableContainer from '@mui/material/TableContainer'
import TableHead from '@mui/material/TableHead'
import TableRow from '@mui/material/TableRow'
import Typography from '@mui/material/Typography'
import BindingEditor, { ReasonDialog } from './BindingEditor'
import { GROUPS, chainText, limitsText, offText, paramsText, toolsText } from './bindings-view.mjs'

// Admin › AI control › Bindings: for each part of Slatebox, which model chain answers it, its
// parameters, tools and limits, and whether it is on. A part with no binding follows what it
// follows (Ask Slatebox, Drafting, …), then the settings file and the built-in AI.
const mono = { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.75rem' }
const failure = (err, fallback) => err?.reason || err?.message || fallback

export default function Bindings() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [note, setNote] = useState(null)
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)

  const load = async () => {
    try {
      const [list, snap, eff, listed] = await Promise.all([
        Meteor.callAsync('ai.bindings.list', {}),
        Meteor.callAsync('ai.control.get', {}),
        Meteor.callAsync('ai.control.effective', {}),
        Meteor.callAsync('ai.connections.list', {}),
      ])
      setData({ list, snap, eff, connections: listed.connections })
      setError('')
    } catch (err) {
      setError(failure(err, 'The bindings could not be read.'))
    }
  }
  useEffect(() => { load() }, [])
  if (error) return <Alert severity="warning">{error}</Alert>
  if (!data) return <Typography color="text.secondary">Reading bindings…</Typography>

  const surfaces = Object.fromEntries(data.snap.surfaces.map((s) => [s.id, s]))
  const entries = Object.fromEntries(data.list.surfaces.map((s) => [s.surface, s]))
  const effective = Object.fromEntries(data.eff.surfaces.map((s) => [s.id, s.binding]))
  const models = data.snap.models || []
  const titles = Object.fromEntries(data.snap.surfaces.map((s) => [s.id, s.title]))
  const notInBuild = data.snap.surfaces.filter((s) => !s.inBuild)
  // in this build, but no request of its own yet (a note's rewrite): it follows until it has one
  const notYet = data.snap.surfaces.filter((s) => s.inBuild && s.bindable && s.id !== 'default' && !s.builtinOnly && !entries[s.id])
  const open = editing ? { surface: surfaces[editing], entry: entries[editing], effective: effective[editing] } : null

  return (
    <Box>
      {note && <Alert severity={note.severity} sx={{ mb: 2 }} onClose={() => setNote(null)}>{note.text}</Alert>}
      <Typography variant="body2" color="text.secondary" mb={2}>
        A part with nothing set here follows the part it belongs to, then the settings file and the built-in AI. Click a part to set its own models, fallbacks, parameters, tools and limits, or to turn it off.
      </Typography>
      <TableContainer>
        <Table size="small" aria-label="Bindings">
          <TableHead>
            <TableRow>
              <TableCell>Part of Slatebox</TableCell>
              <TableCell>Model chain</TableCell>
              <TableCell>Parameters</TableCell>
              <TableCell>Tools</TableCell>
              <TableCell>Limits</TableCell>
              <TableCell>On or off</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {GROUPS.map((group) => (
              <React.Fragment key={group.title}>
                <TableRow>
                  <TableCell colSpan={7} sx={{ bgcolor: 'action.hover', py: 0.5 }}><Typography variant="subtitle2">{group.title}</Typography></TableCell>
                </TableRow>
                {group.surfaces.filter((id) => entries[id]).map((id) => {
                  const s = surfaces[id]
                  const entry = entries[id]
                  const head = entry.head
                  const eff = effective[id]
                  const off = head?.enabled === false
                  // no Off of its own, but the part it follows is off: it is off too, and says why
                  const offFollowing = !off && eff?.enabled === false && eff.disabledBy ? offText(eff, titles) : null
                  const draft = entry.versions.find((v) => v.status === 'draft' && (!head || v.version > head.version))
                  return (
                    <TableRow key={id} hover data-testid={`binding-${id}`} sx={{ cursor: 'pointer' }} onClick={() => setEditing(id)}>
                      <TableCell>
                        <Typography variant="body2">{s.title}</Typography>
                        <Typography component="span" sx={mono} color="text.secondary">{id}</Typography>
                      </TableCell>
                      <TableCell>
                        {head?.chain?.length ? (
                          <Typography variant="body2">{chainText(head.chain, models)}</Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">
                            {s.followsTitle ? `Follows ${s.followsTitle}` : 'Settings file and built-in AI'}{eff?.chain?.[0] ? ` · ${eff.chain[0].model || 'built-in AI'}` : ''}
                          </Typography>
                        )}
                        {entry.skipped && <Typography variant="caption" color="error">Not in use: {entry.skipped}</Typography>}
                      </TableCell>
                      <TableCell><Typography variant="body2">{paramsText(head?.params) || '—'}</Typography></TableCell>
                      <TableCell><Typography variant="body2">{toolsText(head?.tools) || '—'}</Typography></TableCell>
                      <TableCell><Typography variant="body2">{limitsText(head?.limits) || '—'}</Typography></TableCell>
                      <TableCell>
                        {off ? <Chip size="small" color="warning" label="Off" title={head.disabledMessage || ''} />
                          : offFollowing ? <Chip size="small" color="warning" variant="outlined" label={offFollowing} title={eff.disabledMessage || ''} />
                            : <Typography variant="body2">On</Typography>}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {head && <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>Version {head.version}</Typography>}
                        {draft && <Chip size="small" label={`Draft ${draft.version}`} sx={{ mr: 1 }} />}
                        {head && <Button size="small" color="error" onClick={() => setRemoving(id)}>Return to {s.followsTitle ? 'following' : 'built in'}</Button>}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </React.Fragment>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {notYet.map((s) => (
        <Typography key={s.id} variant="body2" color="text.secondary" mt={2}>
          {s.title} follows {s.followsTitle} (it cannot be set on its own until this build supports it).
        </Typography>
      ))}
      {notInBuild.length > 0 && (
        <Typography variant="body2" color="text.secondary" mt={1}>Not in this build: {notInBuild.map((s) => s.title).join(', ')}.</Typography>
      )}
      {open?.surface && (
        <BindingEditor
          surface={open.surface}
          entry={open.entry}
          effective={open.effective}
          models={models}
          connections={data.connections}
          onClose={() => setEditing(null)}
          onChanged={(text) => {
            setEditing(null)
            setNote({ severity: 'success', text })
            load()
          }}
        />
      )}
      <ReasonDialog
        open={Boolean(removing)}
        title={removing ? `Remove the binding of ${surfaces[removing]?.title}` : ''}
        action="Remove the binding"
        body={removing && <Typography variant="body2">{surfaces[removing]?.title} then follows {surfaces[removing]?.followsTitle || 'the settings file and the built-in AI'} again. Its versions stay, so it can be published again later.</Typography>}
        onClose={() => setRemoving(null)}
        onConfirm={async (reason) => {
          await Meteor.callAsync('ai.control.reset', { target: 'binding', surface: removing, reason })
          setNote({ severity: 'success', text: `Removed the binding of ${surfaces[removing]?.title}.` })
          setRemoving(null)
          load()
        }}
      />
    </Box>
  )
}
