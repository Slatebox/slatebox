/* eslint-disable no-underscore-dangle */
import React from 'react'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import List from '@mui/material/List'
import ListItem from '@mui/material/ListItem'
import ListItemText from '@mui/material/ListItemText'
import TextField from '@mui/material/TextField'
import Tooltip from '@mui/material/Tooltip'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import CONSTANTS from '../../../api/common/constants'
import { agentLabel, firstNameOf } from '../../../api/common/agent-label.mjs'
import { permissionLabel, tokenPermissions } from '../../../api/common/token-permissions.mjs'
import { AccountActions, AccountNote, AccountPanel, AccountSection, FinePrint, MONO, SPACE } from '../../common/AccountLayout'

// commands to copy: one quiet monospace block, scrolling sideways on a phone instead of widening the page
const codeBlock = { m: 0, px: SPACE.group, py: SPACE.text, bgcolor: 'action.hover', borderRadius: 1, overflowX: 'auto', fontFamily: MONO, fontSize: 13, lineHeight: 1.6 }


function formatDate(value) {
  return value ? new Date(value).toLocaleString() : 'Never'
}

export default function DeveloperAccess() {
  const [tokens, setTokens] = React.useState([])
  const [name, setName] = React.useState('Codex and Claude')
  const [scopes, setScopes] = React.useState(['slates:read', 'slates:write'])
  const [newToken, setNewToken] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  // What this instance says about itself: the same document GET /api/v1/instance serves.
  const [instance, setInstance] = React.useState(null)

  React.useEffect(() => {
    Meteor.callAsync(CONSTANTS.methods.instance.describe)
      .then(setInstance)
      .catch((requestError) => setError(requestError.reason || requestError.message))
  }, [])

  const load = React.useCallback(async () => {
    try {
      setTokens((await Meteor.callAsync(CONSTANTS.methods.apiTokens.list)).tokens)
    } catch (requestError) {
      setError(requestError.reason || requestError.message)
    }
  }, [])

  React.useEffect(() => {
    load()
  }, [load])

  const createToken = async () => {
    setBusy(true)
    setError('')
    try {
      const created = await Meteor.callAsync(
        CONSTANTS.methods.apiTokens.create,
        {
          name,
          scopes,
        }
      )
      setScopes(['slates:read', 'slates:write'])
      setNewToken(created.token)
      await load()
    } catch (requestError) {
      setError(requestError.reason || requestError.message)
    } finally {
      setBusy(false)
    }
  }

  // Apps that signed in (OAuth) are listed apart from the tokens made here. An app's connection
  // that lapsed (thirty days unused) is not listed.
  const apps = tokens.filter((token) => token.kind === 'oauth' && !token.revokedAt && token.refreshExpiresAt > Date.now())
  const personal = tokens.filter((token) => token.kind !== 'oauth')

  const revoke = async (tokenId) => {
    setBusy(true)
    setError('')
    try {
      await Meteor.callAsync(CONSTANTS.methods.apiTokens.revoke, { tokenId })
      await load()
    } catch (requestError) {
      setError(requestError.reason || requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AccountPanel>
      <AccountSection title="Developer access">
      <Typography>
        Use one token for the Slatebox API and MCP server. Tokens inherit your
        slate permissions and can be revoked here at any time.
      </Typography>

      {error && (
        <Alert severity="error">
          {error}
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: SPACE.group, justifyItems: 'start', pt: SPACE.tight }}>
        <TextField
          label="Token name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          sx={{ width: '100%', maxWidth: 480 }}
        />
        <Box component="fieldset" disabled={busy} sx={{ border: 0, m: 0, p: 0, display: 'grid', gap: SPACE.hair }}>
          <Typography component="legend" variant="subtitle2" sx={{ mb: SPACE.tight }}>Token permissions</Typography>
          {tokenPermissions.map(({ scope, label }) => (
            <label key={scope}>
              <input type="checkbox" checked={scopes.includes(scope)}
                onChange={event => {
                  const checked = event.target.checked
                  setScopes(current => checked ? [...current, scope] : current.filter(item => item !== scope))
                }} />{' '}{label}
            </label>
          ))}
        </Box>
        <AccountActions>
          <Button
            variant="contained"
            onClick={createToken}
            disabled={busy || !name.trim() || !scopes.length}
          >
            Create token
          </Button>
        </AccountActions>
      </Box>

      {newToken && (
        <AccountNote role="status" aria-live="polite">
          <Typography variant="subtitle2">Copy this token now</Typography>
          <FinePrint>
            For security, Slatebox will not show the complete token again.
          </FinePrint>
          <TextField
            fullWidth
            value={newToken}
            sx={{ mt: SPACE.text }}
            slotProps={{
              input: {
                readOnly: true,
                endAdornment: (
                  <Tooltip title="Copy token">
                    <IconButton
                      onClick={() => navigator.clipboard.writeText(newToken)}
                    >
                      <ContentCopyIcon />
                    </IconButton>
                  </Tooltip>
                ),
              },
            }}
          />
        </AccountNote>
      )}
      </AccountSection>

      {instance && (
        <>
          <AccountSection title="This instance">
          <Box component="dl" data-testid="instance-description"
            sx={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: SPACE.block, rowGap: SPACE.tight, m: 0, '& dt': { color: 'text.secondary' }, '& dd': { m: 0, overflowWrap: 'anywhere' } }}>
            <dt>Name</dt><dd>{instance.instance.name}</dd>
            <dt>API address</dt><dd><code>{instance.api.base}</code></dd>
            <dt>Contract version</dt><dd>{instance.contract.version}</dd>
            <dt>Instance id</dt><dd><code>{instance.instance.id}</code></dd>
          </Box>
          </AccountSection>

          <AccountSection title="Connect Codex or Claude">
          <Typography>
            In Claude, ChatGPT or any MCP app that signs in, add <code>{instance.connect.hosted}</code> as
            a custom connector. The app sends you here to sign in and choose what it may do; no token to copy.
          </Typography>
          <Typography>
            Or, on your computer,{' '}
            <a href={instance.connect.guide}>install the CLI and MCP tools</a>,
            then set <code>SLATEBOX_API_TOKEN</code> in your agent’s environment and launch the local server.
          </Typography>
          <Typography component="pre" sx={codeBlock}>
            {instance.connect.mcp}
          </Typography>
          </AccountSection>

          <AccountSection title="Your agent on a slate">
          <Typography>
            When a script saves to a slate, everyone who can open it sees a pointer named
            “{agentLabel(firstNameOf(Meteor.user()))}” move to what it changed. A script can show its plan
            with <code>slatebox.presence.plan</code> and tick steps with <code>slatebox.presence.step</code>.
            On a workshop, <code>workshop_edits</code> makes the same edits people make, by the same rules;
            removing anything waits for your yes.
          </Typography>
          </AccountSection>

          <AccountSection title="HTTP API">
          <Typography>
            Read a slate summary or apply the same validated operation plan over
            HTTP. Send <code>&quot;mode&quot;:&quot;preview&quot;</code> first and an{' '}
            <code>Idempotency-Key</code> when saving. Every route is described at{' '}
            <code>{instance.api.openapi}</code>, and{' '}
            <code>{`${instance.api.base}/instance`}</code> describes this instance.
          </Typography>
          <Typography
            component="pre"
            sx={codeBlock}
          >
            {`curl -H "Authorization: Bearer <token>" \\
  "${instance.api.base}/slates/<share-id>"`}
          </Typography>
          <Typography
            component="pre"
            sx={codeBlock}
          >
            {`curl -X POST \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: <unique-request-id>" \\
  -d '{"mode":"preview","expectedRevision":<revision>,"userMessage":"Add a triangle","plan":{"message":"Done — I added a triangle.","operations":[{"kind":"add_nodes","count":1,"shape":"triangle"}]}}' \\
  "${instance.api.base}/slates/<share-id>/operations"`}
          </Typography>
          </AccountSection>
        </>
      )}

      <AccountSection title="Connected apps">
      <FinePrint>
        Apps you allowed when they asked to sign in. Each acts as you with the permissions you
        chose; disconnect one and its next request is refused.
      </FinePrint>
      <List disablePadding>
        {apps.map((token) => (
          <ListItem
            key={token._id}
            divider
            disableGutters
            secondaryAction={
              !token.revokedAt && (
                <Button size="small" color="error" onClick={() => revoke(token._id)} disabled={busy}>
                  Disconnect
                </Button>
              )
            }
          >
            <ListItemText
              primary={token.name}
              secondary={`${token.scopes.map(permissionLabel).join(' · ')} · Connected ${formatDate(token.createdAt)} · Last used: ${formatDate(
                token.lastUsedAt
              )}${token.revokedAt ? ` · Disconnected ${formatDate(token.revokedAt)}` : ''}`}
            />
          </ListItem>
        ))}
        {!apps.length && (
          <ListItem disableGutters>
            <ListItemText primary="No connected apps." />
          </ListItem>
        )}
      </List>
      </AccountSection>

      <AccountSection title="Active tokens">
      <List disablePadding>
        {personal.map((token) => (
          <ListItem
            key={token._id}
            divider
            disableGutters
            secondaryAction={
              !token.revokedAt && (
                <Tooltip title="Revoke token">
                  <IconButton
                    onClick={() => revoke(token._id)}
                    disabled={busy}
                    color="error"
                  >
                    <DeleteOutlineIcon />
                  </IconButton>
                </Tooltip>
              )
            }
          >
            <ListItemText
              primary={`${token.name} · sbx_${token.prefix}_…`}
              secondary={`Scopes: ${token.scopes.join(', ')} · Last used: ${formatDate(
                token.lastUsedAt
              )}${token.revokedAt ? ` · Revoked ${formatDate(token.revokedAt)}` : ''}`}
            />
          </ListItem>
        ))}
        {!personal.length && (
          <ListItem disableGutters>
            <ListItemText primary="No API tokens yet." />
          </ListItem>
        )}
      </List>
      </AccountSection>
    </AccountPanel>
  )
}
