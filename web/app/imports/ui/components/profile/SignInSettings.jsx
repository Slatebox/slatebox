// Profile › Sign-in: the account's passkeys (add, name, last used, remove) and its password. An
// account always keeps one way in: the last passkey of an account with no password cannot be
// removed (the server refuses it too, server/passkeys/core.mjs). Recovery stays the emailed
// sign-in link and the password reset.
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTheme } from '@mui/material'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import KeyIcon from '@mui/icons-material/Key'
import EditOutlinedIcon from '@mui/icons-material/EditOutlined'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import CONSTANTS from '../../../api/common/constants'
import confirmService from '../../common/confirm'
import { AccountActions, AccountSection, FinePrint, SPACE } from '../../common/AccountLayout'
import { PASSKEY_WORDS, browserErrorText, mayRemove, nameProblem, passkeyDates } from '../../passkeys/passkey-copy.mjs'
import {
  addPasskey, browserHasPasskeys, listPasskeys, removePasskey, renamePasskey, signalAccountDetails,
} from '../../passkeys/passkeys'

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export default function SignInSettings({ user, passwordForm, onMessage }) {
  const theme = useTheme()
  const [state, setState] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  const [editing, setEditing] = React.useState(null)
  const email = user?.emails?.[0]?.address || ''
  const fullName = `${user?.profile?.firstName || ''} ${user?.profile?.lastName || ''}`.trim()

  const say = (text, severity = 'info') => onMessage({ visible: true, text, severity, autoHide: 10000 })
  const refresh = React.useCallback(async () => {
    try {
      const next = await listPasskeys()
      setState(next)
      return next
    } catch (error) {
      say(error?.reason || 'Your passkeys could not be loaded. Reload the page to try again.', 'error')
      return null
    }
  }, [])

  React.useEffect(() => {
    refresh().then((next) => {
      // Keep the device's passkey list showing this account's current address and name.
      if (next?.passkeys?.length) signalAccountDetails({ rpId: next.rpId, userHandle: next.userHandle, email, name: fullName })
    })
  }, [refresh, email, fullName])

  const add = async () => {
    setBusy(true)
    try {
      await addPasskey()
      await refresh()
      say(PASSKEY_WORDS.added)
    } catch (error) {
      const text = browserErrorText(error)
      if (text) say(text, 'error')
    } finally {
      setBusy(false)
    }
  }

  const saveName = async () => {
    const problem = nameProblem(editing?.name)
    if (problem) { setEditing({ ...editing, problem }); return }
    try {
      await renamePasskey(editing.id, editing.name)
      setEditing(null)
      await refresh()
      say(PASSKEY_WORDS.renamed)
    } catch (error) {
      say(error?.reason || 'That name was not saved. Try again.', 'error')
    }
  }

  const remove = async (passkey) => {
    const confirmed = await confirmService.show({
      theme,
      title: PASSKEY_WORDS.removeTitle,
      message: escapeHtml(PASSKEY_WORDS.removeMessage(passkey.name)),
      actionItems: [
        { label: 'Remove passkey', return: true },
        { label: 'Cancel', return: false },
      ],
    })
    if (!confirmed) return
    try {
      await removePasskey(passkey.id, { rpId: state?.rpId, userHandle: state?.userHandle })
      await refresh()
      say(PASSKEY_WORDS.removed)
    } catch (error) {
      say(error?.reason || 'That passkey was not removed. Try again.', 'error')
    }
  }

  const emailPasswordLink = async () => {
    try {
      await Meteor.callAsync(CONSTANTS.methods.users.resetPassword, { email })
      say(`Check ${email}: the link in our email lets you set a password.`)
    } catch (error) {
      say(error?.reason || 'The email was not sent. Try again in a minute.', 'error')
    }
  }

  const passkeys = state?.passkeys || []
  const removable = mayRemove({ passkeys, hasPassword: state?.hasPassword })
  const canAdd = state?.available && browserHasPasskeys()
  return (
    <>
      <AccountSection title={PASSKEY_WORDS.sectionTitle} data-testid="passkeys">
        <Typography color="text.secondary" sx={{ maxWidth: 560 }}>{PASSKEY_WORDS.sectionLede}</Typography>
        {state && !state.available && passkeys.length === 0 ? (
          <FinePrint>{['sso-linked', 'sso-only'].includes(state.reason) ? PASSKEY_WORDS.ssoLinked : PASSKEY_WORDS.off}</FinePrint>
        ) : null}
        {state?.available && !browserHasPasskeys() ? <FinePrint>{PASSKEY_WORDS.unsupported}</FinePrint> : null}
        {state && passkeys.length === 0 && state.available ? <FinePrint>{PASSKEY_WORDS.none}</FinePrint> : null}
        {passkeys.length > 0 && (
          <List dense sx={{ maxWidth: 560, mt: SPACE.tight }} aria-label="Your passkeys">
            {passkeys.map((passkey) => (
              <ListItem
                key={passkey.id}
                disableGutters
                secondaryAction={editing?.id === passkey.id ? null : (
                  <>
                    <Tooltip title="Rename">
                      <IconButton edge="end" aria-label={`Rename ${passkey.name}`} onClick={() => setEditing({ id: passkey.id, name: passkey.name })} sx={{ mr: 0.5 }}>
                        <EditOutlinedIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={removable ? 'Remove' : PASSKEY_WORDS.lastWayIn}>
                      <span>
                        <IconButton edge="end" aria-label={`Remove ${passkey.name}`} disabled={!removable} onClick={() => remove(passkey)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </>
                )}
              >
                <KeyIcon fontSize="small" sx={{ mr: 1.5, color: 'text.secondary' }} />
                {editing?.id === passkey.id ? (
                  <TextField
                    size="small"
                    label="Passkey name"
                    value={editing.name}
                    autoFocus
                    error={Boolean(editing.problem)}
                    helperText={editing.problem || ' '}
                    onChange={(event) => setEditing({ ...editing, name: event.target.value, problem: null })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveName()
                      if (event.key === 'Escape') setEditing(null)
                    }}
                    slotProps={{ htmlInput: { maxLength: 80 } }}
                    sx={{ flex: 1, mr: 1 }}
                  />
                ) : (
                  <ListItemText primary={passkey.name} secondary={passkeyDates(passkey)} />
                )}
                {editing?.id === passkey.id ? (
                  <>
                    <Button size="small" onClick={saveName}>Save</Button>
                    <Button size="small" color="inherit" onClick={() => setEditing(null)}>Cancel</Button>
                  </>
                ) : null}
              </ListItem>
            ))}
          </List>
        )}
        {canAdd ? (
          <AccountActions>
            <Button id="addPasskey" color="secondary" variant="contained" startIcon={<KeyIcon />} onClick={add} disabled={busy}>
              {busy ? PASSKEY_WORDS.signingIn : PASSKEY_WORDS.add}
            </Button>
          </AccountActions>
        ) : null}
        {passkeys.length > 0 && !removable ? <FinePrint>{PASSKEY_WORDS.lastWayIn}</FinePrint> : null}
        <FinePrint>{PASSKEY_WORDS.recovery}</FinePrint>
      </AccountSection>

      <AccountSection title={PASSKEY_WORDS.passwordTitle}>
        {state && !state.hasPassword ? (
          <>
            <Typography color="text.secondary" sx={{ maxWidth: 560 }}>{PASSKEY_WORDS.noPassword}</Typography>
            <AccountActions>
              <Button color="secondary" variant="outlined" onClick={emailPasswordLink} disabled={!email}>{PASSKEY_WORDS.setPassword}</Button>
            </AccountActions>
          </>
        ) : passwordForm}
      </AccountSection>
    </>
  )
}

SignInSettings.propTypes = {
  user: PropTypes.shape({
    emails: PropTypes.arrayOf(PropTypes.shape({ address: PropTypes.string })),
    profile: PropTypes.shape({ firstName: PropTypes.string, lastName: PropTypes.string }),
  }),
  passwordForm: PropTypes.node,
  onMessage: PropTypes.func.isRequired,
}
