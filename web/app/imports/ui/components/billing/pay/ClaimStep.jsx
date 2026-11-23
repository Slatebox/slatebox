import React, { useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import CONSTANTS from '../../../../api/common/constants'
import { claimCopy } from './pay-copy.mjs'

// The Welcome's gentle next step after a guest pays (server/pro-claim.mjs): a password to keep the
// slates on every device, or, when the email already had an account, where the move link went. Never
// a blocker: the Welcome's own button closes the sheet whatever is done here.
export default function ClaimStep({ claim }) {
  const copy = claimCopy(claim)
  const [password, setPassword] = useState('')
  const [stage, setStage] = useState('ask') // ask | saving | saved | skipped
  const [problem, setProblem] = useState('')
  if (!copy || stage === 'skipped') return null

  const save = async e => {
    e.preventDefault()
    if (password.length < 8) { setProblem('Choose a password of at least 8 characters.'); return }
    setStage('saving')
    try {
      await Meteor.callAsync(CONSTANTS.methods.pro.setPassword, { password })
      setStage('saved')
    } catch (err) {
      setStage('ask')
      setProblem(err?.reason || 'The password could not be saved. Try again, or set one later from your profile.')
    }
  }

  return (
    <Box
      component={copy.action && stage !== 'saved' ? 'form' : 'div'}
      onSubmit={copy.action ? save : undefined}
      data-pay-claim={copy.kind}
      sx={{ position: 'relative', maxWidth: 380, mx: 'auto', mt: 2.5, p: 2, textAlign: 'left', borderRadius: '12px', border: theme => `1px solid ${theme.palette.divider}` }}
    >
      <Box component="h3" sx={{ m: 0, fontSize: 15, fontWeight: 700 }}>{copy.title}</Box>
      <Box component="p" sx={{ m: '6px 0 0', fontSize: 13.5, color: 'text.secondary' }}>{stage === 'saved' ? copy.saved : copy.lead}</Box>
      {copy.action && stage !== 'saved' && (
        <>
          <input type="email" name="username" autoComplete="username" value={claim.email} readOnly hidden />
          <TextField
            fullWidth
            size="small"
            type="password"
            name="new-password"
            autoComplete="new-password"
            label="Password"
            value={password}
            disabled={stage === 'saving'}
            error={Boolean(problem)}
            helperText={problem || 'At least 8 characters.'}
            onChange={ev => { setPassword(ev.target.value); setProblem('') }}
            inputProps={{ 'data-pay-claim-password': '' }}
            sx={{ mt: 1.5 }}
          />
          <Box sx={{ display: 'flex', gap: 1, mt: 1.25 }}>
            <Button type="submit" variant="outlined" disabled={stage === 'saving'} data-pay-claim-save="">{stage === 'saving' ? 'Saving…' : copy.action}</Button>
            <Button type="button" variant="text" onClick={() => setStage('skipped')} disabled={stage === 'saving'} data-pay-claim-skip="">{copy.skip}</Button>
          </Box>
        </>
      )}
    </Box>
  )
}

ClaimStep.propTypes = { claim: PropTypes.shape({ kind: PropTypes.string, email: PropTypes.string }) }
ClaimStep.defaultProps = { claim: null }
