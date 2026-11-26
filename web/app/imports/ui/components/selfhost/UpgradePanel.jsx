// The panel the header's button opens on a self-hosted install (owner, 2026-11-25): two choices,
// each one click, with the reasons for each in plain words.
//   - Unlock enterprise, stay on your servers: what enterprise code adds (only what enterprise/
//     really does), shown as a preview; Start free trial (offered only when Slatebox Cloud says it
//     issues trials, with the length Cloud names) signs this server in to Cloud (a code and link,
//     opened for the person, and printed for any other device; Cancel at any time), Cloud issues a
//     key bound to this server, and enterprise features turn on at once, landing on Integrations.
//     A license key from slatebox.com can be pasted instead. A kept key that has ended (or is in
//     its grace days) is said up front, with Get a license first. Once on, the card confirms it
//     and opens Integrations instead of selling.
//   - Move your team to Slatebox Cloud: what moves and what changes; Move signs in to Cloud, sends
//     the team there with progress, compares the counts, and goes live only on Make it live. This
//     server keeps its copy; a banner pointing everyone at Cloud can be switched on after.
// Members see the same reasons, with Ask your admin in place of the buttons. No price is shown;
// Compare goes to slatebox.com/plans. The server does the work (server/selfhost-options).
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useNavigate } from 'react-router-dom'
import Dialog from '@mui/material/Dialog'
import DialogContent from '@mui/material/DialogContent'
import IconButton from '@mui/material/IconButton'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Link from '@mui/material/Link'
import Alert from '@mui/material/Alert'
import LinearProgress from '@mui/material/LinearProgress'
import Checkbox from '@mui/material/Checkbox'
import FormControlLabel from '@mui/material/FormControlLabel'
import Switch from '@mui/material/Switch'
import useMediaQuery from '@mui/material/useMediaQuery'
import CloseIcon from '@mui/icons-material/Close'
import CheckIcon from '@mui/icons-material/Check'
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined'
import CloudUploadOutlinedIcon from '@mui/icons-material/CloudUploadOutlined'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import ExtensionOutlinedIcon from '@mui/icons-material/ExtensionOutlined'
import {
  ENTERPRISE_VALUE, FLOW_WORDS, FREE_EVERYWHERE, MOVE_WHAT_CHANGES, MOVE_WHAT_MOVES, PLANS_URL, PREVIEW_AGENTS, licenseNotice, trialLabel,
} from '../../../api/common/selfhost-options.mjs'
import { adoptEnterpriseState } from '../../../api/client/enterprise-slots.mjs'
import { refreshSelfhostStatus } from './useSelfhostStatus'

const INK = '#193c2f'
const GOLD = '#f2cf87'
const primarySx = { bgcolor: INK, color: '#fff', '&:hover': { bgcolor: '#2c5444' }, textTransform: 'none', fontWeight: 800 }
// Trial refusals a new try cannot change: the way forward is a license.
const LICENSE_ONLY = new Set(['trial_used', 'trial_used_host', 'trial_needs_public_host', 'host_unproven', 'trial_unavailable'])
const ACTIVE = { trial: ['signing_in', 'issuing', 'applying'], move: ['signing_in', 'exporting', 'uploading', 'confirming'] }
const reasonOf = (error) => error?.reason || error?.message || 'Something went wrong. Try again.'
const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1)} MB`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Slatebox Cloud's approval page in a window of its own. The window is opened on the click itself
// (a window opened after waiting for the server is blocked), then pointed at the page; where none
// opens (blocked, or no browser here), the panel says so and shows the link for another device.
function cloudWindow() {
  let win = null
  try {
    win = window.open('', 'slatebox-cloud', 'width=520,height=720')
  } catch {
    win = null
  }
  return {
    blocked: !win,
    go(url) {
      if (!win || win.closed) return false
      try {
        win.location.href = url
        return true
      } catch {
        return false
      }
    },
    close() {
      try { win?.close() } catch { /* already closed */ }
    },
  }
}

// Follows a flow on the server every 1.5 seconds while it is under way.
function useFlow(initial, kind) {
  const [flow, setFlow] = React.useState(initial || null)
  React.useEffect(() => setFlow((now) => (initial && (!now || initial._id !== now._id || initial.updatedAt > (now.updatedAt || 0)) ? initial : now)), [initial])
  const id = flow?._id
  const state = flow?.state
  React.useEffect(() => {
    if (!id || !ACTIVE[kind].includes(state)) return undefined
    let live = true
    const timer = setInterval(() => {
      Meteor.callAsync('selfhost.follow', id).then((next) => { if (live && next) setFlow(next) }, () => {})
    }, 1500)
    return () => { live = false; clearInterval(timer) }
  }, [id, state, kind])
  return [flow, setFlow]
}

function Bullets({ items, icon = true }) {
  return (
    <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 0.75 }}>
      {items.map((item) => (
        <Box component="li" key={typeof item === 'string' ? item : item.id} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          {icon && <CheckIcon sx={{ fontSize: 18, mt: '2px', color: '#2f7a4f', flex: 'none' }} />}
          {typeof item === 'string' ? <Typography variant="body2">{item}</Typography> : (
            <Typography variant="body2"><b>{item.title}.</b> {item.text}</Typography>
          )}
        </Box>
      ))}
    </Box>
  )
}

// What enterprise code looks like on a slate, drawn here (the real screens are enterprise code,
// loaded only once it is unlocked): the catalog, an invited agent's notes, and a change it proposes.
function EnterprisePreview() {
  return (
    <Box data-testid="enterprise-preview" aria-hidden sx={{ borderRadius: 2, border: '1px solid', borderColor: 'shell.border', bgcolor: 'shell.offset', p: 1.5, display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {PREVIEW_AGENTS.map((name) => (
          <Box key={name} sx={{ fontSize: 12, fontWeight: 650, px: 1, py: 0.25, borderRadius: 999, bgcolor: 'background.paper', border: '1px solid', borderColor: 'shell.border' }}>{name}</Box>
        ))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1 }}>
        <Box sx={{ bgcolor: '#fff6c9', color: INK, borderRadius: 1, px: 1, py: 0.75, fontSize: 12, boxShadow: '0 1px 2px rgba(0,0,0,.12)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <b>Linear · PAY-142</b> Retry declined cards later
        </Box>
        <Box sx={{ bgcolor: '#dcefff', color: INK, borderRadius: 1, px: 1, py: 0.75, fontSize: 12, boxShadow: '0 1px 2px rgba(0,0,0,.12)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          <b>GitHub · #881</b> Back off on soft declines
        </Box>
      </Box>
      <Typography variant="caption" sx={{ px: 0.5 }}>
        <b>Linear agent proposes:</b> create issue “Soft-decline retries” in PAY <Box component="span" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>(waits for a person to approve)</Box>
      </Typography>
    </Box>
  )
}

// A device sign-in under way: the code, the link (opened for the person), and the same link
// printed for any other device, since a server's admin may well be on another computer than the browser that would open.
function SignInBox({ signIn, popupBlocked, onOpen, onCancel, busy }) {
  const [copied, setCopied] = React.useState(false)
  if (!signIn) return null
  const copy = () => navigator.clipboard?.writeText(signIn.verificationUriComplete).then(() => setCopied(true), () => {})
  return (
    <Box data-testid="cloud-sign-in" sx={{ borderRadius: 2, border: '1px solid', borderColor: 'shell.border', p: 1.5, display: 'grid', gap: 1 }}>
      <Typography variant="body2"><b>{FLOW_WORDS.signing_in}.</b> Approve this code on Slatebox Cloud, signed in with your account there (or create one, free).</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Typography data-testid="cloud-user-code" sx={{ fontFamily: 'ui-monospace, monospace', fontSize: 24, fontWeight: 800, letterSpacing: '.12em' }}>{signIn.userCode}</Typography>
        <Button variant="contained" size="small" endIcon={<OpenInNewIcon />} onClick={onOpen} data-testid="cloud-open">Open Slatebox Cloud</Button>
        {onCancel && <Button size="small" disabled={busy} onClick={onCancel} data-testid="cloud-cancel" sx={{ textTransform: 'none' }}>Cancel</Button>}
      </Box>
      {popupBlocked && <Alert severity="info" sx={{ py: 0 }} data-testid="popup-blocked">No window opened (this browser blocked it). Open the link below here or on another device.</Alert>}
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
        Not on this computer? Open this link on any device, your phone included:{' '}
        <Link href={signIn.verificationUriComplete} target="_blank" rel="noopener" data-testid="cloud-link" sx={{ wordBreak: 'break-all' }}>{signIn.verificationUriComplete}</Link>
        <IconButton size="small" aria-label="Copy the link" onClick={copy} sx={{ ml: 0.5 }}><ContentCopyIcon sx={{ fontSize: 14 }} /></IconButton>
        {copied && 'Copied.'}
      </Typography>
    </Box>
  )
}

function Steps({ order, state }) {
  const at = order.indexOf(state)
  return (
    <Box component="ol" sx={{ listStyle: 'none', p: 0, m: 0, display: 'grid', gap: 0.5 }} data-testid="flow-steps">
      {order.map((step, i) => (
        <Box component="li" key={step} data-step={step} data-done={i < at ? 'true' : 'false'} sx={{ display: 'flex', gap: 1, alignItems: 'center', opacity: i > at ? 0.5 : 1 }}>
          <Box sx={{ width: 18, height: 18, borderRadius: '50%', flex: 'none', display: 'grid', placeItems: 'center', bgcolor: i < at ? '#2f7a4f' : i === at ? GOLD : 'shell.border', color: '#fff' }}>
            {i < at && <CheckIcon sx={{ fontSize: 14 }} />}
          </Box>
          <Typography variant="body2" sx={{ fontWeight: i === at ? 700 : 400 }}>{FLOW_WORDS[step]}</Typography>
        </Box>
      ))}
    </Box>
  )
}

function Card({ testid, icon, title, lead, children, grow = true }) {
  return (
    <Box data-testid={testid} component="section" aria-label={title}
      sx={{ flex: grow ? 1 : 'none', minWidth: 0, borderRadius: 3, border: '1px solid', borderColor: 'shell.border', bgcolor: 'background.paper', p: 2.5, display: 'grid', gap: 1.5, alignContent: 'start' }}>
      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'center' }}>
        <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: INK, color: GOLD, display: 'grid', placeItems: 'center', flex: 'none' }}>{icon}</Box>
        <Typography variant="h6" component="h3" sx={{ fontWeight: 800, lineHeight: 1.2 }}>{title}</Typography>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>{lead}</Typography>
      {children}
    </Box>
  )
}

function AskAdmin({ what }) {
  return (
    <Alert severity="info" data-testid="ask-admin" icon={false} sx={{ bgcolor: 'shell.offset', color: 'text.primary' }}>
      <b>Ask your admin.</b> Only an administrator of this Slatebox server can {what}. They can do it in one click from this same button.
    </Alert>
  )
}

// ------------------------------------------------------------------ unlock enterprise

// Whether Slatebox Cloud issues free trials to servers now, and how long they run (asked on open).
function useCloudOffer(ask) {
  const [offer, setOffer] = React.useState(null)
  const check = React.useCallback(() => {
    setOffer(null)
    Meteor.callAsync('selfhost.cloudOffer').then(setOffer, (error) => setOffer({ trial: false, reason: 'not_offered', message: reasonOf(error) }))
  }, [])
  React.useEffect(() => { if (ask) check() }, [ask, check])
  return [offer, check]
}

function UnlockCard({ admin, unlocked, status, onUnlocked, onOpenIntegrations }) {
  const [flow, setFlow] = useFlow(status?.trial, 'trial')
  const [problem, setProblem] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [pasting, setPasting] = React.useState(false)
  const [key, setKey] = React.useState('')
  const [popupBlocked, setPopupBlocked] = React.useState(false)
  const license = status?.license?.license
  const notice = admin ? licenseNotice(status?.license) : null
  const [offer, recheck] = useCloudOffer(admin && !unlocked && !notice)
  const openCloud = (signIn) => setPopupBlocked(!cloudWindow().go(signIn.verificationUriComplete))
  const start = async (resume = false) => {
    setProblem('')
    setBusy(true)
    const win = cloudWindow()
    try {
      const next = resume && flow?._id ? await Meteor.callAsync('selfhost.resumeTrial', flow._id) : await Meteor.callAsync('selfhost.startTrial')
      if (next?.state === 'unlocked' && next.already) {
        win.close()
        return onUnlocked(null)
      }
      setFlow(next)
      if (next?.signIn) setPopupBlocked(!win.go(next.signIn.verificationUriComplete))
      else win.close()
    } catch (error) {
      win.close()
      setProblem(reasonOf(error))
    } finally {
      setBusy(false)
    }
    return undefined
  }
  // Stops a sign-in nobody will finish (the window closed, the wrong account): Start again is at hand.
  const cancel = async () => {
    setBusy(true)
    try {
      setFlow(await Meteor.callAsync('selfhost.cancel', flow._id, 'trial'))
      setPopupBlocked(false)
    } catch (error) {
      setProblem(reasonOf(error))
    } finally {
      setBusy(false)
    }
  }
  const enterKey = async () => {
    setProblem('')
    setBusy(true)
    try {
      const done = await Meteor.callAsync('selfhost.enterKey', key.trim())
      setKey('')
      if (done.unlocked) onUnlocked(done)
      else setProblem('The key was kept, but enterprise features did not turn on. Restart the app.')
    } catch (error) {
      setProblem(reasonOf(error))
    } finally {
      setBusy(false)
    }
  }
  React.useEffect(() => {
    if (flow?.state === 'unlocked' && flow.enterprise) onUnlocked(flow)
  }, [flow?.state])
  const running = flow && ACTIVE.trial.includes(flow.state)
  // A key bought on slatebox.com (or sent by Slatebox for an offline install), checked here, on at once.
  const paste = (
    <>
      {pasting && (
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <TextField size="small" fullWidth autoFocus label="License key" value={key} onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && key.trim() && !busy) enterKey() }}
            inputProps={{ 'data-testid': 'license-key', spellCheck: false, autoComplete: 'off' }} />
          <Button variant="outlined" disabled={busy || !key.trim()} onClick={enterKey} data-testid="enter-key">Unlock</Button>
        </Box>
      )}
      {problem && <Alert severity="warning" data-testid="unlock-problem">{problem}</Alert>}
    </>
  )
  const pasteLink = <Link component="button" type="button" variant="caption" onClick={() => setPasting((v) => !v)} data-testid="paste-key-toggle">I have a license key</Link>
  const getLicense = (testid = 'get-license-button') => (
    <Button variant="contained" size="large" href={status?.licenseUrl} target="_blank" rel="noopener" endIcon={<OpenInNewIcon />} data-testid={testid} sx={primarySx}>Get a license</Button>
  )
  const pasteButton = <Button variant="outlined" size="large" onClick={() => setPasting(true)} data-testid="paste-key-button" sx={{ textTransform: 'none', fontWeight: 700 }}>Paste a license key</Button>
  // A kept key that has ended, is ending or will not unlock here: said first, with the way forward.
  const noticeBox = notice && (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Alert severity="warning" data-testid="license-notice" data-kind={notice.kind}><b>{notice.title}</b> {notice.text}</Alert>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{getLicense()}{!pasting && pasteButton}</Box>
      {paste}
    </Box>
  )

  if (unlocked) {
    return (
      <Card testid="card-unlock" icon={<DnsOutlinedIcon />} title="Unlocked on this server"
        lead="On this server, under your control, and checked offline. Your people connect outside agents once on Integrations, then invite them onto any slate.">
        <Alert severity="success" data-testid="unlocked-state">
          Enterprise features are on{license?.licensee ? `, licensed to ${license.licensee}` : ''}{license?.expiresAt ? ` until ${license.expiresAt}` : ''}{license?.trial ? ' (free trial)' : ''}.
        </Alert>
        {noticeBox}
        <Box>
          <Button variant="contained" size="large" startIcon={<ExtensionOutlinedIcon />} onClick={onOpenIntegrations} data-testid="open-integrations" sx={primarySx}>Open Integrations</Button>
        </Box>
        {admin && !notice && (
          <>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {license?.trial ? 'Keep them on after the trial: ' : ''}<Link href={status?.licenseUrl} target="_blank" rel="noopener" data-testid="get-license">Get a license</Link>{' · '}{pasteLink}
            </Typography>
            {paste}
          </>
        )}
      </Card>
    )
  }
  return (
    <Card testid="card-unlock" icon={<DnsOutlinedIcon />} title="Unlock enterprise, stay on your servers"
      lead="Everything stays on this server, under your control. Enterprise features turn on here in one click, checked offline after that.">
      {noticeBox}
      <Bullets items={ENTERPRISE_VALUE} />
      <EnterprisePreview />
      {!admin ? <AskAdmin what="turn enterprise features on" /> : notice ? null : (
        <Box sx={{ display: 'grid', gap: 1 }}>
          {running && flow.state === 'signing_in' && <SignInBox signIn={flow.signIn} popupBlocked={popupBlocked} onOpen={() => openCloud(flow.signIn)} onCancel={cancel} busy={busy} />}
          {running && flow.state !== 'signing_in' && <><Steps order={['issuing', 'applying', 'unlocked']} state={flow.state} /><LinearProgress /></>}
          {flow && ['failed', 'needs_sign_in'].includes(flow.state) && (
            <Alert severity="warning" data-testid="trial-problem" data-code={flow.failure?.code || ''}
              action={LICENSE_ONLY.has(flow.failure?.code) ? null : <Button color="inherit" size="small" onClick={() => start(true)}>Try again</Button>}>{flow.failure?.message}</Alert>
          )}
          {!running && !offer && (
            <Button variant="contained" size="large" disabled data-testid="start-trial-checking" sx={primarySx}>Checking Slatebox Cloud…</Button>
          )}
          {!running && offer?.trial && !LICENSE_ONLY.has(flow?.failure?.code) && (
            <Button variant="contained" size="large" disabled={busy} onClick={() => start(false)} data-testid="start-trial" sx={primarySx}>
              {trialLabel(offer.trialDays)}
            </Button>
          )}
          {!running && offer && (!offer.trial || LICENSE_ONLY.has(flow?.failure?.code)) && (
            <>
              {!offer.trial && (
                <Alert severity="info" data-testid="cloud-offer-note" data-reason={offer.reason || ''}
                  action={offer.reason === 'unreachable' ? <Button color="inherit" size="small" onClick={recheck} data-testid="cloud-offer-retry">Check again</Button> : null}>
                  {offer.message}
                </Alert>
              )}
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{getLicense()}{!pasting && pasteButton}</Box>
            </>
          )}
          {offer?.trial && !LICENSE_ONLY.has(flow?.failure?.code) && (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              No card. A key bound to this server.{' '}
              <Link href={status?.licenseUrl} target="_blank" rel="noopener" data-testid="get-license">Get a license</Link>
              {' · '}
              {pasteLink}
            </Typography>
          )}
          {paste}
        </Box>
      )}
    </Card>
  )
}

// ------------------------------------------------------------------ move to Cloud

function Verified({ flow }) {
  const v = flow.verify || {}
  const rows = [
    ['Slates', v.slates?.sent ?? flow.slates, v.slates?.arrived],
    ['People', flow.members, v.people],
    ['Files', v.sections?.files?.sent ?? 0, v.files ?? 0],
  ]
  return (
    <Box data-testid="move-verify" data-ok={v.ok ? 'true' : 'false'} sx={{ display: 'grid', gridTemplateColumns: 'auto auto auto', columnGap: 2, rowGap: 0.25, fontSize: 14 }}>
      <Typography variant="caption" sx={{ fontWeight: 700 }} />
      <Typography variant="caption" sx={{ fontWeight: 700 }}>Here</Typography>
      <Typography variant="caption" sx={{ fontWeight: 700 }}>On Cloud</Typography>
      {rows.map(([name, here, there]) => (
        <React.Fragment key={name}>
          <Typography variant="body2">{name}</Typography>
          <Typography variant="body2">{here ?? '-'}</Typography>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>{there ?? '-'}</Typography>
        </React.Fragment>
      ))}
    </Box>
  )
}

function MoveCard({ admin, status }) {
  const [flow, setFlow] = useFlow(status?.move, 'move')
  const [problem, setProblem] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [invite, setInvite] = React.useState(true)
  const [banner, setBanner] = React.useState(Boolean(status?.movedSaved?.banner))
  const [popupBlocked, setPopupBlocked] = React.useState(false)
  const team = status?.team
  const openCloud = (signIn) => setPopupBlocked(!cloudWindow().go(signIn.verificationUriComplete))
  const call = async (fn, { signsIn = true } = {}) => {
    setProblem('')
    setBusy(true)
    const win = signsIn ? cloudWindow() : null
    try {
      const next = await fn()
      if (next) setFlow(next)
      if (next?.state === 'signing_in' && next.signIn) setPopupBlocked(!win?.go(next.signIn.verificationUriComplete))
      else win?.close()
    } catch (error) {
      win?.close()
      setProblem(reasonOf(error))
    } finally {
      setBusy(false)
    }
  }
  const start = (options = {}) => call(() => (flow?._id && ['failed', 'needs_sign_in'].includes(flow.state)
    ? Meteor.callAsync('selfhost.resumeMove', flow._id, options)
    : Meteor.callAsync('selfhost.startMove', options)))
  // Make it live usually needs no new sign-in; when it does (an hour passed), Open Slatebox Cloud opens it.
  const confirm = () => call(() => Meteor.callAsync('selfhost.confirmMove', flow._id, { invite }), { signsIn: false })
  const cancel = () => call(() => Meteor.callAsync('selfhost.cancel', flow._id, 'move'), { signsIn: false })
  const toggleBanner = (on) => {
    setBanner(on)
    Meteor.callAsync('selfhost.movedBanner', on).then(refreshSelfhostStatus, (error) => { setBanner(!on); setProblem(reasonOf(error)) })
  }
  const state = flow?.state
  const running = flow && ACTIVE.move.includes(state)
  return (
    <Card testid="card-move" grow={false} icon={<CloudUploadOutlinedIcon />} title="Move your team to Slatebox Cloud"
      lead="Nothing to run, update or back up. The same slates and the same people, on Slatebox Cloud, with enterprise features on.">
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.5 }}>
        <Box><Typography variant="overline" sx={{ fontWeight: 800 }}>What moves</Typography><Bullets items={MOVE_WHAT_MOVES} /></Box>
        <Box><Typography variant="overline" sx={{ fontWeight: 800 }}>What changes</Typography><Bullets items={MOVE_WHAT_CHANGES} icon={false} /></Box>
      </Box>
      {team?.name && admin && (
        <Typography variant="body2" data-testid="move-team">
          <b>{team.name}</b>{Number.isInteger(team.slates) ? `: ${plural(team.members, 'person', 'people')}, ${plural(team.slates, 'slate')}` : ''}
        </Typography>
      )}
      {!admin ? <AskAdmin what="move the team to Slatebox Cloud" /> : !status?.teamAdmin ? (
        <Alert severity="info">Only a team admin can move a team. You administer this server; ask your team admin, or move from an account that runs the team.</Alert>
      ) : (
        <Box sx={{ display: 'grid', gap: 1 }} data-testid="move-flow" data-state={state || 'idle'}>
          {state === 'signing_in' && <SignInBox signIn={flow.signIn} popupBlocked={popupBlocked} onOpen={() => openCloud(flow.signIn)} onCancel={cancel} busy={busy} />}
          {running && state !== 'signing_in' && (
            <>
              <Steps order={['exporting', 'uploading', 'review', 'confirming', 'moved']} state={state} />
              <LinearProgress data-testid="move-progress" />
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {flow.progress?.bytes > 0 && <Typography variant="caption" sx={{ flex: 1 }}>{megabytes(flow.progress.bytes)} sent</Typography>}
                {['exporting', 'uploading'].includes(state) && (
                  <Button size="small" disabled={busy} onClick={cancel} data-testid="move-cancel" sx={{ textTransform: 'none', ml: 'auto' }}>Cancel the move</Button>
                )}
              </Box>
            </>
          )}
          {state === 'review' && (
            <Box sx={{ display: 'grid', gap: 1 }} data-testid="move-review">
              <Alert severity={flow.verify?.ok ? 'success' : 'warning'}>
                {flow.verify?.ok
                  ? `Everything arrived. ${flow.report?.team || team?.name || 'Your team'} is on Slatebox Cloud, waiting: nobody sees it until you make it live.`
                  : 'Slatebox Cloud skipped a few items (listed in its report). Make it live anyway, or cancel and try again.'}
              </Alert>
              <Verified flow={flow} />
              {flow.others > 0 && (
                <FormControlLabel control={<Checkbox checked={invite} onChange={(e) => setInvite(e.target.checked)} />} label={`Invite the ${plural(flow.others, 'other member')} to sign in on Cloud now`} />
              )}
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button variant="contained" disabled={busy} onClick={confirm} data-testid="move-confirm" sx={{ bgcolor: INK, '&:hover': { bgcolor: '#2c5444' }, textTransform: 'none', fontWeight: 800 }}>Make it live on Slatebox Cloud</Button>
                <Button disabled={busy} onClick={cancel} sx={{ textTransform: 'none' }}>Cancel</Button>
              </Box>
            </Box>
          )}
          {state === 'moved' && (
            <Box sx={{ display: 'grid', gap: 1 }} data-testid="move-done">
              <Alert severity="success"><b>{FLOW_WORDS.moved}.</b> This server keeps its copy, untouched, until you remove it.</Alert>
              <Button variant="contained" href={flow.cloudUrl} target="_blank" rel="noopener" endIcon={<OpenInNewIcon />} data-testid="open-cloud-team" sx={{ bgcolor: INK, textTransform: 'none', fontWeight: 800 }}>Open your team on Slatebox Cloud</Button>
              <FormControlLabel control={<Switch checked={banner} onChange={(e) => toggleBanner(e.target.checked)} inputProps={{ 'data-testid': 'moved-banner-toggle' }} />} label="Show everyone here a banner pointing to Slatebox Cloud" />
            </Box>
          )}
          {flow && ['failed', 'needs_sign_in'].includes(state) && (
            <Alert severity="warning" data-testid="move-problem"
              action={flow.failure?.code === 'move_pending'
                ? <Button color="inherit" size="small" onClick={() => start({ replaceWaiting: true })}>Replace it</Button>
                : <Button color="inherit" size="small" onClick={() => start()}>{state === 'needs_sign_in' ? 'Sign in again' : 'Try again'}</Button>}>
              {flow.failure?.message}
            </Alert>
          )}
          {problem && <Alert severity="warning">{problem}</Alert>}
          {(!flow || ['cancelled'].includes(state)) && (
            <Button variant="contained" size="large" disabled={busy} onClick={() => start()} data-testid="start-move" sx={primarySx}>
              Move to Slatebox Cloud
            </Button>
          )}
          {state !== 'moved' && <Typography variant="caption" sx={{ color: 'text.secondary' }}>Free to move. Signs this server in to Slatebox Cloud for an hour, for this move only.</Typography>}
        </Box>
      )}
    </Card>
  )
}

export default function UpgradePanel({ open, onClose, status, role, unlocked }) {
  const navigate = useNavigate()
  const narrow = useMediaQuery('(max-width:820px)')
  const admin = role === 'admin'
  // Enterprise code turned on here: this page takes the server's new state, loads the enterprise
  // screens, and opens Integrations, where the catalog is live.
  const onUnlocked = async (done) => {
    const state = done?.enterprise || (await Meteor.callAsync('selfhost.status').catch(() => null))?.enterprise
    if (state?.unlocked) await adoptEnterpriseState({ settings: Meteor.settings, state }).catch(() => {})
    refreshSelfhostStatus()
    onClose()
    navigate('/integrations?welcome=enterprise')
  }
  const openIntegrations = () => {
    onClose()
    navigate('/integrations')
  }
  return (
    <Dialog open={open} onClose={onClose} fullScreen={narrow} maxWidth="lg" fullWidth aria-labelledby="selfhost-options-title" data-testid="enterprise-options-panel">
      <DialogContent sx={{ p: { xs: 2, sm: 3.5 }, bgcolor: 'shell.background' }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
          <Box sx={{ flex: 1 }}>
            <Typography id="selfhost-options-title" variant="h5" component="h2" sx={{ fontWeight: 850, letterSpacing: '-.02em' }}>
              {unlocked ? 'Enterprise features are on' : 'Bring outside agents onto your slates'}
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.secondary', mt: 0.5, maxWidth: 760 }}>
              {unlocked
                ? 'Enterprise features are on here. Your team can also move to Slatebox Cloud in one click, with everything it has.'
                : admin
                ? 'Two ways, each one click: unlock enterprise features on your own servers, or move your team to Slatebox Cloud.'
                : 'Your admin can turn these on for everyone here, or move the team to Slatebox Cloud. Here is what each one adds.'}
            </Typography>
          </Box>
          <IconButton aria-label="Close" onClick={onClose}><CloseIcon /></IconButton>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: narrow ? 'column' : 'row', gap: 2, alignItems: narrow ? 'stretch' : 'flex-start' }}>
          <UnlockCard admin={admin} unlocked={unlocked} status={status} onUnlocked={onUnlocked} onOpenIntegrations={openIntegrations} />
          {/* The move, then what stays free whichever is chosen: in view without scrolling on a laptop. */}
          <Box sx={{ flex: 1, minWidth: 0, display: 'grid', gap: 2, alignContent: 'start' }}>
            <MoveCard admin={admin} status={status} />
            <Typography variant="body2" data-testid="free-everywhere" sx={{ color: 'text.secondary', px: 1 }}>
              {FREE_EVERYWHERE}{' '}
              <Link href={PLANS_URL} target="_blank" rel="noopener" data-testid="compare-plans">Compare on slatebox.com</Link>
            </Typography>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  )
}
