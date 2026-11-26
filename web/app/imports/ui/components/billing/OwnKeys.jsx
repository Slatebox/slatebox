import React, { useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import CONSTANTS from '../../../api/common/constants'

// Own AI and Daily keys, for a person or (admins) their team. Keys are encrypted on the
// server and only the last four characters come back.
export default function OwnKeys({ owner = 'me', onChange }) {
  const [state, setState] = useState(null)
  const [adding, setAdding] = useState(null) // 'ai' | 'daily'
  const [provider, setProvider] = useState('deepinfra')
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [error, setError] = useState('')

  const load = () => Meteor.callAsync(CONSTANTS.methods.keys.list).then(setState).catch(() => setState(null))
  useEffect(() => { load() }, [])
  if (!state?.available) return null

  const keys = owner === 'team' ? state.team : state.personal
  const canEdit = owner === 'me' || state.canEditTeam
  const aiKey = keys.find(k => k.provider !== 'daily')
  const dailyKey = keys.find(k => k.provider === 'daily')

  const open = family => {
    setAdding(family)
    setProvider(family === 'daily' ? 'daily' : 'deepinfra')
    setKey(''); setBaseUrl(''); setModel(''); setError('')
  }
  const save = async () => {
    setError('')
    try {
      await Meteor.callAsync(CONSTANTS.methods.keys.save, { owner, provider, key, ...(provider === 'openai-compatible' && { baseUrl, model }) })
      setAdding(null)
      await load()
      onChange?.()
    } catch (err) {
      setError(err.reason || 'The key was not saved. Try again.')
    }
  }
  const remove = async provider => {
    await Meteor.callAsync(CONSTANTS.methods.keys.remove, { owner, provider })
    await load()
    onChange?.()
  }

  const row = (title, current, family, addLabel) => (
    <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 1.5, rowGap: 1, flexWrap: 'wrap' }}>
      <Typography>{title}: {current ? current.label : 'none'}</Typography>
      {current?.lastError && <Typography variant="body2" color="warning.main">{current.lastError}</Typography>}
      {canEdit && (current
        ? <Button size="small" onClick={() => remove(current.provider)}>Remove</Button>
        : <Button variant="outlined" onClick={() => open(family)}>{addLabel}</Button>)}
    </Box>
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {row('AI', aiKey, 'ai', 'Add an AI key')}
      {row('Calls', dailyKey, 'daily', 'Add a Daily key')}
      <Typography variant="body2" color="text.secondary">
        Optional and free to use: requests on your own key spend no Slatebox credits. To choose a connection for each feature, use {owner === 'team' ? 'the team settings\' AI tab' : 'the AI tab'}.
      </Typography>
      <Dialog open={Boolean(adding)} onClose={() => setAdding(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{adding === 'daily' ? 'Add a Daily key' : 'Add an AI key'}</DialogTitle>
        <DialogContent>
          {adding === 'ai' && (
            <ToggleButtonGroup exclusive value={provider} onChange={(e, v) => v && setProvider(v)} sx={{ mb: 2 }}>
              <ToggleButton value="deepinfra">DeepInfra key</ToggleButton>
              <ToggleButton value="openai-compatible">Your own model</ToggleButton>
            </ToggleButtonGroup>
          )}
          {provider === 'openai-compatible' && (
            <>
              <Typography variant="body2" sx={{ mb: 1 }}>Used for drafts and conversation. Presentations and image search use your Pro credits or balance.</Typography>
              <TextField fullWidth margin="dense" label="Address (OpenAI-compatible)" placeholder="https://llm.example.com/v1" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} />
              <TextField fullWidth margin="dense" label="Model" value={model} onChange={e => setModel(e.target.value)} />
            </>
          )}
          <TextField fullWidth margin="dense" type="password" autoComplete="off" label={provider === 'openai-compatible' ? 'Key (if your model needs one)' : 'Key'} value={key} onChange={e => setKey(e.target.value)} />
          {error && <Alert severity="warning" sx={{ mt: 1 }}>{error}</Alert>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAdding(null)}>Cancel</Button>
          <Button variant="contained" onClick={save}>Save key</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

OwnKeys.propTypes = {
  owner: PropTypes.oneOf(['me', 'team']),
  onChange: PropTypes.func,
}
