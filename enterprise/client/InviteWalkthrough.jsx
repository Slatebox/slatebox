// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// "Invite an agent": pick from the gallery or paste an address → discovery → (a server that needs sign-in: a popup on its own page,
// a pasted client id, or a pasted key or token) → what it can do, in plain words → which lookups
// and changes it may use (changes start on, each waiting on a card you approve; destructive ones
// start off, with a warning) → what it may see, and what leaves Slatebox → it arrives as a named cursor.
// With `reconnect` (an agent that needs sign-in again) it stops after the sign-in.
// `invited`: the agents already on this slate. A gallery card for one of yours says ✓ On this slate
// and offers Manage (its chip) instead of inviting it again; a pasted address of one says so too.
// With more cards than fit at a glance, chips (All, then each GROUPS chip: Work, Docs, chat and
// meetings, Developer tools …) and a search box narrow the gallery (filterCards), and a hidden status
// line says how many show; the address box always takes any server. A card whose vendor needs an app
// this server has not registered (notSetUp) shows greyed out with "Not set up on this server yet".
// `integrations`: the person's connected integrations, invited onto this slate in one step (no
// sign-in, no consent again); a server they already connected says so and offers the same.
// Without a shareId it is "Connect an integration" (the Integrations page): the same steps, ending
// in integrations.connect, with when it joins slates in place of what it may see on one. There a
// card for one of the person's integrations says ✓ Connected and offers Manage (onManageIntegration);
// on a slate it offers Invite. No card is tinted for any other reason (a featured card is only first).
// With `upgrade` ({ address, replaces, name }: an integration connected at its card's read-only
// address) it signs in at the card's own address and the consent moves that integration there.
// Two tabs say the two ways in (owner, 2026-11-25): Existing (the gallery: chips, search, the cards,
// Community cards among them) and Custom (paste any MCP address, an optional name, and "Check it",
// which reaches the server and lists its tools and sign-in before anything is saved). The last tab
// is remembered for this browser session only. A custom server connected from the Integrations page
// ends on a success step that offers "Suggest for the Slatebox library" (SuggestIntegration: the
// library's review queue, kind integration; free, reviewed before anyone sees it).
// Slack's card (native, on Slack's Web API) is one click: its window opens on Slack's own page, Allow
// there connects it (slack.js), and on a slate it is invited at once. No consent step: its tools are
// fixed, and every change it proposes waits on a card you approve.
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Link } from 'react-router-dom'
import MenuItem from '@mui/material/MenuItem'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Checkbox from '@mui/material/Checkbox'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import FormControlLabel from '@mui/material/FormControlLabel'
import LinearProgress from '@mui/material/LinearProgress'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Tab from '@mui/material/Tab'
import Tabs from '@mui/material/Tabs'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded'
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded'
import InfoOutlined from '@mui/icons-material/InfoOutlined'
import LightbulbOutlined from '@mui/icons-material/LightbulbOutlined'
import LockOutlined from '@mui/icons-material/LockOutlined'
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded'
import Hexagon from '/imports/ui/components/AgentMark.jsx'
import { enterpriseSlots } from '/imports/api/client/enterprise-slots.mjs'
import { GALLERY, addressProblem, cardFor, filterCards, groupsIn, lookalikeHost, settingsLinkOf } from '../common/gallery.mjs'
import { cardState, connectedAction, STATUS_WORDS } from '../common/integration-words.mjs'
import { followSignIn, openSignInWindow } from './signin'
import { connectSlack, SLACK_ADMIN_NOTE } from './slack'
import SuggestIntegration from './SuggestIntegration'

// The walkthrough's look, light and dark (the app's palette: greens on warm neutrals, sticky
// yellow only for the "Try" suggestion). Text on every surface here meets WCAG AA.
const MARK = '#3f7d58' // the hexagon before an agent has its own colour (chosen when it arrives)
const surface = (theme) => ({
  bgcolor: '#fffef8', border: '1px solid #e1e3d6', borderRadius: '14px',
  boxShadow: '0 1px 2px rgba(32,61,50,0.06), 0 6px 18px rgba(32,61,50,0.06)',
  ...theme.applyStyles('dark', { bgcolor: '#23362d', borderColor: '#3a5244', boxShadow: '0 1px 2px rgba(0,0,0,0.3), 0 8px 22px rgba(0,0,0,0.28)' }),
})
const section = (theme) => ({ ...surface(theme), p: { xs: 1.75, sm: 2 } })
const heading = (theme) => ({
  display: 'block', fontSize: 13.5, fontWeight: 750, letterSpacing: 0, lineHeight: 1.5, mb: 1, color: '#3b6a50',
  ...theme.applyStyles('dark', { color: '#bed7b5' }),
})
const success = (theme) => ({
  bgcolor: '#ebf3e4', border: '1px solid #c8dcbb', borderRadius: '14px', p: { xs: 1.5, sm: 1.75 }, display: 'grid', gap: 0.75,
  ...theme.applyStyles('dark', { bgcolor: 'rgba(190,215,181,0.10)', borderColor: 'rgba(190,215,181,0.28)' }),
})
const checkIcon = (theme) => ({ fontSize: 19, mt: '1px', flexShrink: 0, color: '#2f6b45', ...theme.applyStyles('dark', { color: '#bed7b5' }) })
const option = (theme, on, disabled) => ({
  m: 0, width: '100%', alignItems: 'flex-start', gap: 0.5, py: 1, pl: 0.75, pr: 1.5, borderRadius: '12px', border: '1px solid',
  transition: 'border-color 120ms, background-color 120ms, box-shadow 120ms',
  borderColor: on ? '#3f7d58' : '#dfe2d4', bgcolor: on ? '#eef5e7' : '#fffef8',
  boxShadow: on ? 'inset 0 0 0 1px #3f7d58' : 'none',
  ...(!disabled && { cursor: 'pointer', '&:hover': { borderColor: on ? '#3f7d58' : '#a9bfa6' } }),
  ...(disabled && { bgcolor: '#f4f3ec', borderStyle: 'dashed' }),
  '&:has(.Mui-focusVisible)': { outline: '2px solid #254b3b', outlineOffset: 2 },
  '& .MuiFormControlLabel-label': { pt: '9px', flex: 1, minWidth: 0 },
  ...theme.applyStyles('dark', {
    borderColor: on ? '#bed7b5' : '#3f574a', bgcolor: on ? 'rgba(190,215,181,0.12)' : '#1e3027',
    boxShadow: on ? 'inset 0 0 0 1px #bed7b5' : 'none',
    ...(!disabled && { '&:hover': { borderColor: on ? '#bed7b5' : '#6b8a76' } }),
    ...(disabled && { bgcolor: 'rgba(255,255,255,0.03)' }),
    '&:has(.Mui-focusVisible)': { outline: '2px solid #f2ce8b', outlineOffset: 2 },
  }),
})
const callout = (kind) => (theme) => ({
  display: 'flex', gap: 1, alignItems: 'flex-start', borderRadius: '12px', p: 1.25, pl: 1.5, fontSize: 14, lineHeight: 1.5,
  ...{
    info: { bgcolor: '#eef3ee', borderLeft: '4px solid #5b8a6e', color: '#2c4a3b' },
    warning: { bgcolor: '#fff4e0', border: '1px solid #f0d29c', color: '#6e4300' },
    error: { bgcolor: '#fdeceb', border: '1px solid #f3c4c0', color: '#9d1f17' },
  }[kind],
  ...theme.applyStyles('dark', {
    info: { bgcolor: 'rgba(190,215,181,0.07)', borderLeftColor: '#8fb39a', color: '#dfe9da' },
    warning: { bgcolor: 'rgba(255,183,77,0.12)', borderColor: 'rgba(255,183,77,0.35)', color: '#ffd59a' },
    error: { bgcolor: 'rgba(255,138,128,0.12)', borderColor: 'rgba(255,138,128,0.35)', color: '#ffb4ab' },
  }[kind]),
})
const calloutIcon = { fontSize: 19, mt: '1px', flexShrink: 0 }

/** A ✓ line of what Slatebox found, with a lock for "sign-in needed". */
function Found({ children, lock = false, ...rest }) {
  const Icon = lock ? LockOutlined : CheckCircleRounded
  return (
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }} {...rest}>
      <Icon aria-hidden="true" sx={checkIcon} />
      <Typography variant="body2" component="div" sx={{ lineHeight: 1.5 }}>{children}</Typography>
    </Box>
  )
}
Found.propTypes = { children: PropTypes.node, lock: PropTypes.bool }

function Callout({ kind = 'info', children, sx, ...rest }) {
  const Icon = { info: InfoOutlined, warning: WarningAmberRounded, error: ErrorOutlineRounded }[kind]
  return (
    <Box sx={[callout(kind), ...(Array.isArray(sx) ? sx : [sx])]} {...rest}>
      <Icon aria-hidden="true" sx={calloutIcon} />
      <Box sx={{ minWidth: 0 }}>{children}</Box>
    </Box>
  )
}
Callout.propTypes = { kind: PropTypes.oneOf(['info', 'warning', 'error']), children: PropTypes.node, sx: PropTypes.oneOfType([PropTypes.shape({}), PropTypes.arrayOf(PropTypes.shape({}))]) }

function Lookalike() {
  return <Callout kind="warning">This address looks like it stands for another site. Check it before you go on.</Callout>
}
// link: a refusing server's own settings page (settingsLinkOf), opened in a new tab; the text is ours.
function Problem({ text, link = null }) {
  return (
    <Callout kind="error" role="alert">
      {text}
      {link && (
        <Box component="span" sx={{ display: 'block', mt: 0.5 }}>
          <Box component="a" href={link} target="_blank" rel="noopener noreferrer" data-invite-problem-settings="" sx={{ color: 'inherit', fontWeight: 600 }}>Open settings</Box>
        </Box>
      )}
    </Callout>
  )
}
Problem.propTypes = { text: PropTypes.string.isRequired, link: PropTypes.string }


const RULE_CHOICES = [
  { value: 'ask', label: 'When I invite it to a slate' },
  { value: 'my_slates', label: 'On every slate I own, by itself' },
]

const SEES = [
  { value: 'request', label: 'Only what I ask' },
  { value: 'selection', label: 'What I ask, and the notes I select' },
  { value: 'slate', label: 'What I ask, and every note on this slate' },
]

// What the outside service asks of you, in plain words (cardCost): the service's own price, never Slatebox's.
// The chips and search box show once the gallery has more cards than this.
export const FILTER_FROM = 8
// Where an administrator reads how to register a vendor's app (docs/integrations.md).
export const APPS_DOC = 'https://github.com/Slatebox/slatebox/blob/main/docs/integrations.md#apps-an-operator-registers'
const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }
// The built-in cards, when the gallery could not be loaded: a vendor that needs a registered app is
// never offered blind (its app may not be set up here), only named as not set up.
export const fallbackGallery = () => ({ cards: GALLERY.filter((c) => !c.needsApp), notSetUp: GALLERY.filter((c) => c.needsApp) })

// The two ways in, and the one line each says about itself.
export const CONNECT_TABS = Object.freeze([
  { id: 'existing', label: 'Existing', line: 'Pick an agent Slatebox lists. You choose what it may do before it connects.' },
  { id: 'custom', label: 'Custom', line: 'Paste the address of any MCP server. Slatebox reaches it first and shows its tools and what sign-in it needs, before anything is saved.' },
])
// Remembered for this browser session only (a new session starts on Existing).
const TAB_KEY = 'slatebox.connectTab'
const rememberedTab = () => {
  try {
    const tab = window.sessionStorage?.getItem(TAB_KEY)
    return CONNECT_TABS.some((t) => t.id === tab) ? tab : 'existing'
  } catch {
    return 'existing'
  }
}
const rememberTab = (tab) => {
  try { window.sessionStorage?.setItem(TAB_KEY, tab) } catch {}
}

export const cardCost = (item) => (item.signIn ? item.cost : item.cost === 'Free' ? 'No sign-in needed' : `No sign-in needed · ${item.cost}`)

// A refusal because the server's key ended (enterprise_locked) also empties the app's enterprise slots.
const errorText = (error) => {
  enterpriseSlots.lockIfRefused(error)
  return error?.reason || error?.message || 'That did not work. Try again.'
}

export default function InviteWalkthrough({ open, onClose, shareId = null, slateName, onInvited, reconnect, invited = [], onManage = null, integrations = [], onConnected = null, onManageIntegration = null, upgrade = null }) {
  const integrationMode = !shareId
  const [step, setStep] = useState('choose') // choose | discovering | signin | waiting | consent | inviting | reconnected | connected
  const [rule, setRule] = useState('ask')
  // A server this person already connected (from discovery): offered to invite in one step.
  const [connected, setConnected] = useState(null)
  // The slate owner's choice of who may bring outside agents here (null until it answers).
  const [setting, setSetting] = useState(null)
  const [clientId, setClientId] = useState('')
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const pending = useRef(null)
  const [address, setAddress] = useState('')
  const [found, setFound] = useState(null)
  const [name, setName] = useState('')
  const [allowed, setAllowed] = useState({})
  const [sees, setSees] = useState('request')
  const [showAll, setShowAll] = useState(false)
  // The problem shown in the dialog, and a link to the refusing server's settings when it named one.
  const [problem, setProblem] = useState({ text: '', link: null })
  const error = problem.text
  const setError = (text, link = null) => setProblem({ text: text || '', link })
  // A problem with the address pasted under Custom, shown under that field.
  const [addressError, setAddressError] = useState('')
  // A pasted address (or a card) for an agent of yours already here: { agentId, name, text }.
  const [already, setAlready] = useState(null)
  // The gallery as administrators set it (/admin/ai › Gallery); null until it answers (cards an
  // administrator turned off are never shown), the built-in cards only if it cannot be asked.
  const [gallery, setGallery] = useState({ cards: null })
  // The gallery's chip (a GROUPS id, or 'all') and search words.
  const [filter, setFilter] = useState({ group: 'all', query: '' })
  // Existing or Custom (CONNECT_TABS), and Custom's optional name for the agent.
  const [tab, setTabState] = useState(rememberedTab)
  const setTab = (next) => { setTabState(next); rememberTab(next) }
  const [customName, setCustomName] = useState('')
  // A custom server just connected from the Integrations page (the success step), and its suggestion dialog.
  const [justConnected, setJustConnected] = useState(null)
  const [suggesting, setSuggesting] = useState(false)
  // On a phone the walkthrough is a full-height sheet; its footer stays in reach.
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const shownCards = filterCards(gallery.cards || [], filter)
  const shownNotSetUp = gallery.cards ? filterCards(gallery.notSetUp || [], filter) : []
  const live = useRef(true)
  useEffect(() => () => { live.current = false }, [])
  useEffect(() => {
    if (open && !reconnect && !upgrade) Meteor.callAsync('connectors.gallery', {}).then((answer) => {
      if (live.current) setGallery(Array.isArray(answer?.cards) ? { cards: answer.cards, notSetUp: Array.isArray(answer.notSetUp) ? answer.notSetUp : [] } : fallbackGallery())
    }).catch(() => { if (live.current) setGallery(fallbackGallery()) })
    if (open && shareId && !reconnect) Meteor.callAsync('integrations.slateSetting', { shareId }).then((answer) => { if (live.current) setSetting(answer) }).catch(() => {})
    if (!open) {
      pending.current?.cancel()
      setStep('choose'); setFound(null); setError(''); setAddressError(''); setAddress(''); setShowAll(false); setKey(''); setClientId(''); setShowKey(false); setAlready(null); setConnected(null); setRule('ask'); setFilter({ group: 'all', query: '' })
      setCustomName(''); setJustConnected(null); setSuggesting(false)
    } else if (!reconnect && !upgrade) {
      setTabState(rememberedTab())
    } else if (reconnect?.address) {
      setAddress(reconnect.address)
      discover(reconnect.address)
    } else if (upgrade?.address) {
      setAddress(upgrade.address)
      discover(upgrade.address)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Slack (native): Connect, Allow on Slack, done. Inside the click (the window opens at once).
  async function slackConnect() {
    setError('')
    setStep('slack')
    try {
      const outcome = await connectSlack({ onPending: (cancel) => { pending.current = { cancel } } })
      pending.current = null
      if (!live.current) return
      if (!outcome.ok) {
        setStep('choose')
        setError(outcome.message)
        return
      }
      if (integrationMode) {
        onConnected?.()
        onClose()
        return
      }
      // On a slate: invited here at once, with no new sign-in.
      const listed = await Meteor.callAsync('integrations.list', {})
      const slack = (listed?.integrations || []).find((row) => row.galleryId === 'slack' && row.status === 'active')
      if (slack) return inviteIntegration(slack)
      setStep('choose')
    } catch (e) {
      pending.current = null
      if (!live.current) return
      setStep('choose')
      setError(errorText(e))
    }
  }

  // One of this person's integrations onto this slate: no sign-in, no consent again.
  async function inviteIntegration(integration) {
    setError('')
    setStep('inviting')
    try {
      const connection = await Meteor.callAsync('integrations.invite', { shareId, integrationId: integration.integrationId })
      if (!live.current) return
      onInvited?.(connection)
      onClose()
    } catch (e) {
      if (!live.current) return
      setStep('choose')
      if (e?.error === 'already_here') return setAlready({ ...(e.details || {}), text: e.reason })
      setError(errorText(e))
    }
  }

  // fromCustom: the Custom tab's own "Check it", whose problems show under its address field.
  async function discover(raw, { fromCustom = false } = {}) {
    const target = (raw ?? address).trim()
    if (!target) return
    setError('')
    setAddressError('')
    setAlready(null)
    setStep('discovering')
    try {
      const result = integrationMode
        ? await Meteor.callAsync('integrations.discover', { address: target })
        : await Meteor.callAsync('connectors.discover', { shareId, address: target })
      if (!live.current) return
      // Already connected (on another slate, or from the Integrations page): invite it in one step.
      if (!integrationMode && result.integration && !result.alreadyHere && !reconnect && !result.signIn) {
        setStep('choose')
        setConnected(result.integration)
        return
      }
      // Already one of yours here: say so and offer its chip, never a second copy.
      if (result.alreadyHere && !result.alreadyHere.lookAgain && !reconnect) {
        setStep('choose')
        setAlready(result.alreadyHere)
        return
      }
      setFound(result)
      if (result.signIn) {
        setShowKey(result.signIn.method === 'key')
        setStep('signin')
        return
      }
      if (reconnect) {
        setStep('reconnected')
        return
      }
      // Custom's name, when one was typed (the consent step still shows it, and the same rules clean it).
      setName(result.alreadyHere?.lookAgain ? result.alreadyHere.name : upgrade?.name || (!result.card && customName.trim().slice(0, 32)) || result.suggestedName)
      setAllowed(Object.fromEntries(result.tools.map((tool) => [tool.name, tool.policy === 'allow'])))
      setStep('consent')
    } catch (e) {
      if (!live.current) return
      setStep('choose')
      // A server that refused this app, with its settings page: the dialog's problem, with the link.
      const link = settingsLinkOf(e)
      if (fromCustom && !link) {
        enterpriseSlots.lockIfRefused(e)
        setAddressError(addressProblem(e))
        return
      }
      setError(errorText(e), link)
    }
  }

  // The popup is opened inside the click, before the server is asked, so the browser allows it.
  async function signIn() {
    setError('')
    const win = openSignInWindow()
    setStep('waiting')
    try {
      const started = await Meteor.callAsync('connectors.signIn', { ...(shareId && { shareId }), address: found.address, ...(clientId.trim() && { clientId: clientId.trim() }) })
      if (!live.current) return win?.close()
      const follow = followSignIn(win, started)
      pending.current = follow
      const outcome = await follow.promise
      pending.current = null
      if (!live.current) return
      try { if (!win?.closed) win.close() } catch {}
      if (outcome.ok) return discover(found.address)
      setStep('signin')
      setError(outcome.message || 'Sign-in didn\'t finish. Try again.')
    } catch (e) {
      try { win?.close() } catch {}
      if (!live.current) return
      setStep('signin')
      setError(errorText(e))
    }
  }

  async function useKey(event) {
    event?.preventDefault()
    if (!key.trim()) return
    setError('')
    setStep('waiting')
    try {
      if (integrationMode) await Meteor.callAsync('integrations.useKey', { address: found.address, key: key.trim() })
      else await Meteor.callAsync('connectors.useKey', { shareId, address: found.address, key: key.trim() })
      setKey('')
      if (live.current) discover(found.address)
    } catch (e) {
      if (!live.current) return
      setStep('signin')
      setError(errorText(e))
    }
  }

  async function invite() {
    setError('')
    setStep('inviting')
    try {
      const tools = found.tools.map(({ name: tool, hash }) => ({ name: tool, hash, policy: allowed[tool] ? 'allow' : 'off' }))
      if (integrationMode) {
        const integration = await Meteor.callAsync('integrations.connect', { address: found.address, name, tools, ...(upgrade?.replaces ? { replaces: upgrade.replaces } : { rule }) })
        if (!live.current) return
        onConnected?.(integration)
        // A custom server (no card in the gallery): say it worked, and offer to suggest it for everyone.
        if (!found.card && !upgrade && integration?.integrationId) {
          setJustConnected({ ...integration, host: integration.host || found.host })
          setStep('connected')
          return
        }
        onClose()
        return
      }
      const connection = await Meteor.callAsync('connectors.connect', { shareId, address: found.address, name, tools, contextLevel: sees })
      if (!live.current) return
      onInvited?.(connection)
      onClose()
    } catch (e) {
      if (!live.current) return
      setStep('consent')
      if (e?.error === 'tools_changed') {
        setError(errorText(e))
        return discover(found.address)
      }
      if (e?.error === 'already_here') {
        setStep('choose')
        setAlready({ ...(e.details || {}), text: e.reason })
        return
      }
      setError(errorText(e))
    }
  }

  const lookups = found?.tools.filter((tool) => tool.group === 'lookup') || []
  const changes = found?.tools.filter((tool) => tool.group === 'change') || []
  const chosen = found?.tools.filter((tool) => allowed[tool.name]) || []
  const card = found?.card ? cardFor(found.address) : null
  const plan = found?.signIn
  const signInWith = plan?.provider || plan?.authHost || found?.host


  const agentName = step === 'consent' || step === 'inviting' ? name : step === 'connected' ? justConnected?.name : reconnect?.name || found?.suggestedName
  const subtitle = found && step !== 'choose' && step !== 'discovering' ? [agentName, found.host].filter(Boolean).join(' · ') : ''
  const toolLabel = (tool) => tool.title || tool.name.replace(/[_-]+/g, ' ')

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth fullScreen={phone} aria-labelledby="invite-agent-title" data-invite-agent=""
      PaperProps={{ sx: (t) => ({ bgcolor: '#f6f5ed', backgroundImage: 'none', ...(!phone && { borderRadius: '20px' }), ...t.applyStyles('dark', { bgcolor: '#17251f' }) }) }}>
      <Box sx={(t) => ({
        display: 'flex', alignItems: 'center', gap: 1.5, px: { xs: 2, sm: 3 }, pt: { xs: 2, sm: 2.5 }, pb: 2,
        background: 'linear-gradient(180deg, #fffef8 0%, #f6f5ed 100%)', borderBottom: '1px solid #e3e5d8',
        ...t.applyStyles('dark', { background: 'linear-gradient(180deg, #23362d 0%, #17251f 100%)', borderBottomColor: '#33493d' }),
      })}>
        <Box aria-hidden="true" sx={(t) => ({
          width: 44, height: 44, borderRadius: '13px', display: 'grid', placeItems: 'center', flexShrink: 0,
          bgcolor: '#e6efdf', boxShadow: 'inset 0 0 0 1px #cfdfc4', ...t.applyStyles('dark', { bgcolor: 'rgba(190,215,181,0.12)', boxShadow: 'inset 0 0 0 1px rgba(190,215,181,0.25)' }),
        })}>
          <Hexagon color={MARK} size={28} style={{}} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 1 }}>
          <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
            <DialogTitle id="invite-agent-title" sx={{ p: 0, fontSize: { xs: 17, sm: 19 }, fontWeight: 750, lineHeight: 1.3, letterSpacing: '-0.01em' }}>
              {upgrade ? `Let ${upgrade.name} make changes too` : integrationMode ? 'Connect an integration' : `Invite an agent to “${slateName || 'this slate'}”`}
            </DialogTitle>
            {subtitle && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflowWrap: 'anywhere' }} data-invite-subtitle="">{subtitle}</Typography>}
          </Box>
          {/* The slate owner's choice of who may bring outside agents here: a small control in the
              header's corner (under the title when the dialog is narrow), only for whoever may change it.
              It never pushes the dialog wider than the window: it may shrink, and its label wraps above
              the select when the two do not fit on one line. */}
          {step === 'choose' && !upgrade && setting?.canChange && (
            <Box sx={{ flex: '0 1 auto', minWidth: 0, maxWidth: '100%', display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1, rowGap: 0.5 }} data-invite-outside-agents="">
              <Typography component="span" id="invite-outside-agents-label" sx={(t) => ({ fontSize: 13, fontWeight: 650, color: '#3b6a50', whiteSpace: 'nowrap', ...t.applyStyles('dark', { color: '#bed7b5' }) })}>Who can add agents</Typography>
              <TextField select size="small" value={setting.outsideAgents} title="Who can bring outside agents onto this slate"
                SelectProps={{ labelId: 'invite-outside-agents-label' }}
                inputProps={{ 'data-invite-outside-agents-select': '' }}
                sx={{ minWidth: 0, maxWidth: '100%', '& .MuiInputBase-root': { fontSize: 13.5, bgcolor: 'background.paper' }, '& .MuiSelect-select': { py: 0.625, pl: 1.25 } }}
                onChange={(e) => Meteor.callAsync('integrations.setSlateSetting', { shareId, outsideAgents: e.target.value }).then((answer) => live.current && setSetting(answer)).catch((err) => setError(errorText(err)))}>
                <MenuItem value="editors">Anyone who can edit</MenuItem>
                <MenuItem value="owner">Only me</MenuItem>
                <MenuItem value="off">No one</MenuItem>
              </TextField>
            </Box>
          )}
        </Box>
      </Box>
      <DialogContent sx={{ px: { xs: 2, sm: 3 }, py: { xs: 2, sm: 2.5 }, borderTop: 'none' }}>
        {step === 'choose' && upgrade && (
          <Box sx={{ display: 'grid', gap: 1.5 }} data-invite-upgrade-problem="">
            {error ? <Problem text={error} link={problem.link} /> : <Typography variant="body2">Close this and try again from the Integrations page.</Typography>}
          </Box>
        )}
        {step === 'choose' && !upgrade && (
          // minmax(0, 1fr): one column no wider than the dialog, so the chip row (it scrolls sideways on
          // a narrow window) never stretches the body past the right edge.
          <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2 }}>
            <Typography variant="body2" sx={{ fontSize: 15, lineHeight: 1.55 }}>
              {integrationMode
                ? 'Connect it once, then invite it onto any slate or let it join every slate you own, with no new sign-in.'
                : 'Agents work on this slate with you: everyone here sees each one as a cursor, and its suggestions as ghost notes to keep or discard.'}
            </Typography>
            {connected && (
              <Box role="status" data-invite-connected={connected.name} sx={(t) => ({ ...section(t), display: 'flex', alignItems: 'center', gap: 1 })}>
                <Typography variant="body2" sx={{ flex: 1 }}>✓ You already connected {connected.name}. Invite it here with no new sign-in.</Typography>
                <Button size="small" variant="contained" data-invite-connected-go="" disabled={connected.status !== 'active'} onClick={() => inviteIntegration(connected)}>Invite to this slate</Button>
              </Box>
            )}
            <Box sx={(t) => ({ borderBottom: '1px solid #e1e3d6', ...t.applyStyles('dark', { borderBottomColor: '#3a5244' }) })}>
              <Tabs value={tab} onChange={(_event, next) => { setTab(next); setError(''); setAddressError('') }} aria-label="How to connect" variant="fullWidth"
                sx={(t) => ({
                  minHeight: 44,
                  '& .MuiTab-root': { minHeight: 44, textTransform: 'none', fontSize: 15, fontWeight: 700, color: '#4a5d52' },
                  '& .MuiTab-root.Mui-selected': { color: '#254b3b' },
                  '& .MuiTabs-indicator': { height: 3, borderRadius: 3, bgcolor: '#3f7d58' },
                  '& .MuiTab-root.Mui-focusVisible': { outline: '2px solid #254b3b', outlineOffset: -2 },
                  ...t.applyStyles('dark', { '& .MuiTab-root': { color: '#b9cdb6' }, '& .MuiTab-root.Mui-selected': { color: '#e6f0e1' }, '& .MuiTabs-indicator': { bgcolor: '#a5c99a' }, '& .MuiTab-root.Mui-focusVisible': { outline: '2px solid #f2ce8b' } }),
                })}>
                {CONNECT_TABS.map((t) => (
                  <Tab key={t.id} value={t.id} label={t.label} id={`connect-tab-${t.id}`} aria-controls={`connect-panel-${t.id}`} data-invite-tab={t.id} />
                ))}
              </Tabs>
            </Box>
            {error && <Problem text={error} link={problem.link} />}
            {already && (
              <Box role="status" data-invite-already={already.name} sx={(t) => ({ ...section(t), display: 'flex', alignItems: 'center', gap: 1 })}>
                <Typography variant="body2" sx={{ flex: 1 }}>✓ {already.text || `${already.name} is already on this slate.`}</Typography>
                {onManage && <Button size="small" variant="outlined" data-invite-manage="" onClick={() => onManage(already.agentId)}>Manage</Button>}
              </Box>
            )}
            {tab === 'existing' && (
              <Box role="tabpanel" id="connect-panel-existing" aria-labelledby="connect-tab-existing" data-invite-panel="existing" sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }} data-invite-tab-line="existing">{CONNECT_TABS.find((t) => t.id === 'existing').line}</Typography>
                {!integrationMode && integrations.length > 0 && (
                  <Box sx={(t) => ({ ...section(t), display: 'grid', gap: 1 })} data-invite-integrations="">
                    <Typography component="div" sx={heading}>Your integrations</Typography>
                    {integrations.map((integration) => {
                      const here = invited.some((c) => c.mine && c.status !== 'removed' && c.integrationId === integration.integrationId)
                      const blocked = integration.status !== 'active'
                      return (
                        <Box key={integration.integrationId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }} data-invite-integration={integration.name}>
                          <Hexagon color={MARK} size={18} style={{}} />
                          <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                            <b>{integration.name}</b> · {integration.host}{blocked ? ` · ${STATUS_WORDS[integration.status] || integration.status}` : ''}
                          </Typography>
                          {here
                            ? <Typography variant="caption" color="text.secondary">✓ On this slate</Typography>
                            : <Button size="small" variant="outlined" disabled={blocked || step === 'inviting'} data-invite-integration-go="" onClick={() => inviteIntegration(integration)}>Invite to this slate</Button>}
                        </Box>
                      )
                    })}
                    <Typography variant="caption" color="text.secondary" component="div">No new sign-in. It sees only what you ask, unless you change that on its chip. <Link to="/integrations">Manage integrations</Link></Typography>
                  </Box>
                )}
                {(gallery.cards || []).length > FILTER_FROM && (
                  <Box data-gallery-filter="" sx={{ display: 'flex', flexDirection: { xs: 'column', sm: 'row' }, gap: 1, alignItems: { xs: 'stretch', sm: 'center' } }}>
                    <Box role="group" aria-label="Show agents for" sx={{ display: 'flex', gap: 0.75, flexWrap: { xs: 'nowrap', sm: 'wrap' }, overflowX: { xs: 'auto', sm: 'visible' }, flex: 1, pb: { xs: 0.25, sm: 0 } }}>
                      {[{ id: 'all', label: 'All' }, ...groupsIn([...gallery.cards, ...(gallery.notSetUp || [])])].map((g) => {
                        const on = filter.group === g.id
                        return (
                          <Chip key={g.id} label={g.label} size="small" clickable data-gallery-chip={g.id} aria-pressed={on}
                            onClick={() => setFilter({ ...filter, group: g.id })}
                            sx={(t) => ({
                              flexShrink: 0, fontWeight: 650, border: '1px solid', borderColor: on ? '#3f7d58' : '#d6dccb', bgcolor: on ? '#3f7d58' : '#fffef8', color: on ? '#fff' : '#2c4a3a',
                              '&:hover': { bgcolor: on ? '#356b4b' : '#eef4e8' },
                              '&.Mui-focusVisible': { outline: '2px solid #254b3b', outlineOffset: 2 },
                              ...t.applyStyles('dark', { borderColor: on ? '#a5c99a' : '#3a5244', bgcolor: on ? '#a5c99a' : '#23362d', color: on ? '#14261c' : '#d7e6d0', '&:hover': { bgcolor: on ? '#b6d6ab' : '#2b4337' }, '&.Mui-focusVisible': { outline: '2px solid #f2ce8b', outlineOffset: 2 } }),
                            })} />
                        )
                      })}
                    </Box>
                    <TextField size="small" type="search" placeholder="Search agents" value={filter.query} onChange={(e) => setFilter({ ...filter, query: e.target.value })}
                      sx={{ width: { xs: '100%', sm: 200 }, flexShrink: 0 }} inputProps={{ 'aria-label': 'Search agents', 'data-gallery-search': '', maxLength: 80 }} />
                  </Box>
                )}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(200px, 1fr))' }, gap: 1.5 }}>
                  {!gallery.cards && <Box data-gallery-loading="" sx={{ gridColumn: '1 / -1' }}><LinearProgress aria-label="Loading the gallery" /></Box>}
                  {gallery.cards && (
                    <Box component="span" role="status" data-gallery-count="" sx={visuallyHidden}>
                      {shownCards.length ? `${shownCards.length} ${shownCards.length === 1 ? 'agent' : 'agents'}` : shownNotSetUp.length ? `${shownNotSetUp.map((c) => c.name).join(', ')}: not set up on this server yet` : 'None of the agents here match'}
                    </Box>
                  )}
                  {gallery.cards && !shownCards.length && !shownNotSetUp.length && (
                    <Typography variant="body2" color="text.secondary" data-gallery-none="" sx={{ gridColumn: '1 / -1', py: 1 }}>None of the agents here match. Any MCP server works: <Button size="small" onClick={() => setTab('custom')} data-gallery-none-custom="" sx={{ p: 0, minWidth: 0, verticalAlign: 'baseline', textTransform: 'none', fontSize: 'inherit' }}>paste its address under Custom</Button>.</Typography>
                  )}
                  {shownCards.map((item) => {
                    const state = cardState(item, invited, integrations)
                    const next = connectedAction(state, integrationMode)
                    const go = () => {
                      if (next?.act === 'manage-agent') return onManage?.(state.here.agentId)
                      if (next?.act === 'manage-integration') return onManageIntegration?.(state.linked.integrationId)
                      if (next?.act === 'invite') return inviteIntegration(state.linked)
                      if (item.signIn === 'slack') return slackConnect()
                      setAddress(item.url)
                      return discover(item.url)
                    }
                    return (
                      <Box key={item.id} component="button" type="button" data-gallery-card={item.id} data-gallery-here={state.here ? '' : undefined} data-gallery-connected={next ? '' : undefined}
                        aria-label={next ? `${item.name}: ${next.words.replace('✓ ', '').replace(' · ', '. ')}` : item.origin === 'community' ? `${item.name}, Community` : undefined}
                        onClick={go}
                        sx={(t) => ({
                          // Every card has the same surface; only a connected one has a green edge and its ✓ line.
                          // Hover lifts any card; keyboard focus is an outline outside the edge, never green.
                          ...surface(t), textAlign: 'left', p: 1.75, cursor: 'pointer', font: 'inherit', color: 'inherit', display: 'flex', flexDirection: 'column', gap: 0.75,
                          transition: 'transform 140ms ease, box-shadow 140ms ease, border-color 140ms ease',
                          ...(next && { borderColor: '#2e7d32', boxShadow: 'inset 0 0 0 1px #2e7d32' }),
                          '&:hover': { borderColor: next ? '#2e7d32' : '#7fa78a', boxShadow: `${next ? 'inset 0 0 0 1px #2e7d32, ' : ''}0 2px 4px rgba(32,61,50,0.08), 0 10px 24px rgba(32,61,50,0.10)`, transform: 'translateY(-1px)' },
                          '&:focus-visible': { outline: '3px solid #254b3b', outlineOffset: 3 },
                          '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
                          ...t.applyStyles('dark', {
                            ...(next && { borderColor: '#81c784', boxShadow: 'inset 0 0 0 1px #81c784' }),
                            '&:hover': { borderColor: next ? '#81c784' : '#8fb39a', boxShadow: `${next ? 'inset 0 0 0 1px #81c784, ' : ''}0 10px 26px rgba(0,0,0,0.35)`, transform: 'translateY(-1px)' },
                            '&:focus-visible': { outline: '3px solid #f2ce8b', outlineOffset: 3 },
                          }),
                        })}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                          <Box aria-hidden="true" sx={(t) => ({ width: 34, height: 34, borderRadius: '10px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: '#e6efdf', ...t.applyStyles('dark', { bgcolor: 'rgba(190,215,181,0.12)' }) })}>
                            <Hexagon color={item.featured ? MARK : '#6f8d78'} size={20} style={{}} />
                          </Box>
                          <Box sx={{ minWidth: 0 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                              <Typography variant="subtitle2" sx={{ fontWeight: 750, lineHeight: 1.3 }}>{item.name}</Typography>
                              {item.origin === 'community' && (
                                <Box component="span" data-gallery-community="" title={item.sharedBy ? `Suggested by ${item.sharedBy} and reviewed by Slatebox` : 'Suggested by a Slatebox user and reviewed by Slatebox'}
                                  sx={(t) => ({ fontSize: 11, fontWeight: 750, letterSpacing: '0.02em', lineHeight: 1.6, px: 0.75, borderRadius: 999, bgcolor: '#eef0fb', color: '#33417a', border: '1px solid #cdd3f0', ...t.applyStyles('dark', { bgcolor: 'rgba(170,184,255,0.14)', color: '#cdd6ff', borderColor: 'rgba(170,184,255,0.35)' }) })}>
                                  Community
                                </Box>
                              )}
                            </Box>
                            <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.35 }}>{item.job} · {cardCost(item)}</Typography>
                          </Box>
                        </Box>
                        {next && (
                          <Typography variant="caption" component="div" data-gallery-on-slate={state.here ? '' : undefined} data-gallery-connected-words=""
                            sx={(t) => ({ alignSelf: 'flex-start', px: 1, py: 0.25, borderRadius: 999, bgcolor: '#e3f0e1', color: '#1b5e20', fontWeight: 700, ...t.applyStyles('dark', { bgcolor: 'rgba(129,199,132,0.16)', color: '#a5d6a7' }) })}>
                            {next.words}
                          </Typography>
                        )}
                        <Typography variant="body2" sx={{ lineHeight: 1.45 }}>{item.lands}</Typography>
                        {item.origin === 'community' && item.sharedBy && <Typography variant="caption" color="text.secondary" component="div">Suggested by {item.sharedBy}</Typography>}
                      </Box>
                    )
                  })}
                  {shownNotSetUp.map((item) => (
                    <Box key={item.id} data-gallery-not-set-up={item.id} aria-disabled="true"
                      sx={(t) => ({ ...surface(t), p: 1.75, display: 'flex', flexDirection: 'column', gap: 0.75, opacity: 0.72, borderStyle: 'dashed' })}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                        <Box aria-hidden="true" sx={(t) => ({ width: 34, height: 34, borderRadius: '10px', display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: '#eceee8', ...t.applyStyles('dark', { bgcolor: 'rgba(255,255,255,0.06)' }) })}>
                          <Hexagon color="#9aa39a" size={20} style={{}} />
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle2" sx={{ fontWeight: 750, lineHeight: 1.3 }}>{item.name}</Typography>
                          <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.35 }}>{item.job}</Typography>
                        </Box>
                      </Box>
                      <Typography variant="body2" sx={{ lineHeight: 1.45, fontWeight: 650 }} data-gallery-not-set-up-words="">Not set up on this server yet.</Typography>
                      <Typography variant="caption" color="text.secondary" component="div" sx={{ lineHeight: 1.45 }}>
                        Its administrator registers an app with the vendor first: <Box component="a" href={APPS_DOC} target="_blank" rel="noopener noreferrer" sx={{ color: 'inherit', fontWeight: 650 }}>how to set it up</Box>.
                      </Typography>
                    </Box>
                  ))}
                </Box>
                <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, lineHeight: 1.5 }} data-invite-footer="">Not listed here? Any MCP server works under Custom. Community cards were suggested by people using Slatebox and reviewed by Slatebox. Each agent&apos;s answers become suggestions on your slate.</Typography>
              </Box>
            )}
            {tab === 'custom' && (
              <Box role="tabpanel" id="connect-panel-custom" aria-labelledby="connect-tab-custom" data-invite-panel="custom" sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2 }}>
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.5 }} data-invite-tab-line="custom">{CONNECT_TABS.find((t) => t.id === 'custom').line}</Typography>
                <Box component="form" onSubmit={(e) => { e.preventDefault(); discover(undefined, { fromCustom: true }) }} sx={(t) => ({ ...section(t), display: 'grid', gap: 1.5 })} data-invite-custom="">
                  <TextField size="small" fullWidth label="Paste an MCP address" placeholder="https://example.com/mcp" value={address} autoFocus
                    error={Boolean(addressError)} helperText={addressError || undefined}
                    FormHelperTextProps={{ id: 'invite-address-problem', role: 'alert', 'data-invite-address-problem': '' }}
                    onChange={(e) => { setAddress(e.target.value); if (addressError) setAddressError('') }}
                    inputProps={{ 'data-invite-address': '', inputMode: 'url', autoCapitalize: 'none', spellCheck: false, ...(addressError && { 'aria-describedby': 'invite-address-problem', 'aria-invalid': true }) }} />
                  <TextField size="small" fullWidth label="Name on your slates (optional)" value={customName} onChange={(e) => setCustomName(e.target.value)}
                    helperText="Left empty, Slatebox suggests one. You can change it before you connect." inputProps={{ maxLength: 32, 'data-invite-custom-name': '' }} />
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
                    <Button type="submit" variant="contained" disabled={!address.trim()} data-invite-check="" sx={{ px: 2.5, width: { xs: '100%', sm: 'auto' } }}>Check it</Button>
                    <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 200 }}>Nothing is saved until you choose its tools and connect.</Typography>
                  </Box>
                </Box>
                {lookalikeHost(address.trim()) && <Lookalike />}
                <Typography variant="caption" color="text.secondary" component="p" sx={{ m: 0, lineHeight: 1.5 }} data-invite-custom-footer="">Open servers connect straight away; others after you sign in on their own page or paste a key. Only public https addresses work. Once it works, you can suggest it for the Slatebox library.</Typography>
              </Box>
            )}
          </Box>
        )}
        {step === 'slack' && (
          <Box aria-live="polite" sx={(t) => ({ ...section(t), py: 3, px: 3, textAlign: 'center', display: 'grid', gap: 1 })} data-invite-slack-waiting="">
            <Hexagon color={MARK} size={34} style={{}} />
            <Typography variant="body1" sx={{ fontWeight: 650 }}>Allow Slatebox in the Slack window that opened.</Typography>
            <Typography variant="body2" color="text.secondary">Slatebox reads Slack as you, only what you can see, and each message it would post waits on a card you approve. {SLACK_ADMIN_NOTE}</Typography>
            <LinearProgress sx={{ mt: 1, height: 6, borderRadius: 3 }} />
          </Box>
        )}
        {step === 'discovering' && (
          <Box aria-live="polite" sx={(t) => ({ ...section(t), py: 3, px: 3, textAlign: 'center' })}>
            <Hexagon color={MARK} size={34} style={{}} />
            <Typography variant="body1" sx={{ mt: 1, fontWeight: 650, overflowWrap: 'anywhere' }}>Connecting to {address}…</Typography>
            <LinearProgress sx={{ mt: 2, height: 6, borderRadius: 3 }} />
          </Box>
        )}
        {(step === 'signin' || step === 'waiting') && found && plan && (
          <Box data-invite-signin={plan.method} sx={{ display: 'grid', gap: 1.5 }}>
            <Box sx={success}>
              <Found>Reached <b>{found.host}</b></Found>
              <Found lock>
                {plan.again ? `${reconnect?.name || 'This agent'} needs you to sign in to ${found.host} again.` : 'Sign-in needed'}
                {plan.method === 'oauth' && plan.authHost ? ` · opens ${plan.authHost}` : ''}
              </Found>
            </Box>
            {found.lookalike && <Lookalike />}
            {step === 'waiting' && (
              <Box aria-live="polite" sx={section}>
                <Typography variant="body2">Finish signing in in the window that opened. Slatebox carries on here by itself.</Typography>
                <LinearProgress sx={{ mt: 1.5, height: 6, borderRadius: 3 }} />
              </Box>
            )}
            {step === 'signin' && (plan.method === 'oauth' || plan.keyAllowed) && (
              <Box sx={(t) => ({ ...section(t), display: 'grid', gap: 1.5 })}>
                {plan.method === 'oauth' && (
                  <Box>
                    {plan.needsClientId && (
                      <TextField size="small" fullWidth label={`Client id from ${found.host}`} value={clientId} onChange={(e) => setClientId(e.target.value)} sx={{ mb: 1.5 }}
                        helperText="This server needs a registered app. Paste the client id it gave you." inputProps={{ maxLength: 500, 'data-invite-client-id': '' }} />
                    )}
                    <Button variant="contained" data-invite-sign-in="" disabled={plan.needsClientId && !clientId.trim()} onClick={signIn} sx={{ px: 2.5, width: { xs: '100%', sm: 'auto' } }}>Sign in to {signInWith} →</Button>
                    <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1.25, mb: 0, lineHeight: 1.5 }} data-invite-sign-in-reach="">
                      A window opens on {plan.authHost || found.host}'s own page. Slatebox never sees your password.
                      {plan.sendsTo && plan.sendsTo !== plan.authHost ? ` Your ${signInWith} sign-in will be sent to ${plan.sendsTo}, and only there.` : ''}
                      {plan.reach ? ` ${plan.reach}` : ''}
                      {' '}What it gives Slatebox is kept encrypted for you alone, never shown to anyone on the slate, and removed when you remove the agent.
                    </Typography>
                  </Box>
                )}
                {plan.keyAllowed && (
                  <Box sx={(t) => (plan.method === 'oauth' ? { borderTop: '1px solid #e7e8dd', pt: 1.25, ...t.applyStyles('dark', { borderTopColor: '#3a5244' }) } : {})}>
                    {plan.method === 'oauth' && !showKey && (
                      <Button size="small" onClick={() => setShowKey(true)}>{card?.keyHint || 'Or paste a key or token'}</Button>
                    )}
                    {showKey && (
                      <Box component="form" onSubmit={useKey} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        <TextField size="small" fullWidth type="password" autoComplete="off" label={`Key or token for ${found.host}`} value={key} onChange={(e) => setKey(e.target.value)}
                          helperText="Stored encrypted, never shown to anyone on the slate." inputProps={{ maxLength: 4096, 'data-invite-key': '' }} />
                        <Button type="submit" variant={plan.method === 'key' ? 'contained' : 'outlined'} disabled={!key.trim()} data-invite-use-key="" sx={{ flexShrink: 0, px: 2 }}>Use key</Button>
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            )}
            {error && <Problem text={error} link={problem.link} />}
          </Box>
        )}
        {step === 'reconnected' && found && (
          <Box sx={success} data-invite-reconnected="">
            <Found>Signed in to {found.host}. {reconnect?.name || 'Your agent'} is ready: ask it again.</Found>
          </Box>
        )}
        {step === 'connected' && justConnected && (
          <Box data-invite-done="" sx={{ display: 'grid', gap: 1.5 }}>
            <Box sx={success} role="status">
              <Found><b>{justConnected.name}</b> is connected. Invite it onto any slate from + Invite agent{justConnected.rule === 'my_slates' ? ', or let it join every slate you own (it will)' : ''}.</Found>
            </Box>
            <Box sx={(t) => ({ ...section(t), display: 'grid', gap: 1 })} data-invite-suggest="">
              <Typography component="div" sx={heading}>Suggest it for the Slatebox library</Typography>
              <Typography variant="body2" sx={{ lineHeight: 1.5 }}>
                Others could use {justConnected.host || 'this server'} too. Suggest it and, once Slatebox reviews it, it is listed under Existing for everyone, marked Community, with your name as the person who suggested it. Your sign-in is never shared.
              </Typography>
              <Box><Button variant="outlined" data-invite-suggest-open="" onClick={() => setSuggesting(true)}>Suggest for the library</Button></Box>
            </Box>
            <SuggestIntegration open={suggesting} integration={justConnected} onClose={() => setSuggesting(false)} />
          </Box>
        )}
        {(step === 'consent' || step === 'inviting') && found && (
          <Box data-invite-consent="" sx={{ display: 'grid', gap: 1.5 }}>
            {found.alreadyHere?.lookAgain && <Box sx={section} data-invite-look-again=""><Typography variant="body2">{found.alreadyHere.text}</Typography></Box>}
            {upgrade && (
              <Callout kind="info" data-invite-upgrade="">
                <Box component="span" sx={{ display: 'block' }}>{upgrade.name} moves to {found.host}&apos;s full address, where it can make changes. Its name, its slates and when it joins them stay as they are; its read-only sign-in is removed. Each change still waits on a card you approve.</Box>
              </Callout>
            )}
            <Box sx={success}>
              <Found>Reached <b>{found.host}</b>{found.serverName ? ` · it calls itself “${found.serverName}” (self-reported)` : ''}</Found>
              <Found>{found.signedIn ? `Signed in${found.signedIn.kind === 'key' ? ' with your key' : ''}: it acts as you on ${found.host}, and only you can ask it` : 'No sign-in: anyone with this address can use this server'}</Found>
              <Found>Found {lookups.length} {lookups.length === 1 ? 'way' : 'ways'} to look things up{changes.length ? ` and ${changes.length} that change things elsewhere` : ''}</Found>
            </Box>
            {found.reviewDrift && (
              <Callout kind="warning" data-invite-review-drift="">
                <Box component="span" sx={{ display: 'block' }}>Its tools changed since Slatebox reviewed it. Look at each one below before you allow it.</Box>
              </Callout>
            )}
            {found.lookalike && <Lookalike />}
            <Box sx={section}>
              <TextField size="small" fullWidth label="Name on your slate" value={name} onChange={(e) => setName(e.target.value)} inputProps={{ maxLength: 32, 'data-invite-name': '' }}
                helperText={`Shown as “${name || '…'} · added by you”. Names can't say Slatebox, admin, support or a person's name.`} />
            </Box>
            <Box sx={section}>
              <Typography component="div" sx={heading}>Look things up</Typography>
              <Box sx={{ display: 'grid', gap: 1 }}>
                {lookups.map((tool) => (
                  <FormControlLabel key={tool.name} sx={(t) => option(t, Boolean(allowed[tool.name]))}
                    control={<Checkbox checked={Boolean(allowed[tool.name])} onChange={(e) => setAllowed({ ...allowed, [tool.name]: e.target.checked })} />}
                    label={(
                      <>
                        <Typography component="span" sx={{ display: 'block', fontWeight: 700, fontSize: 14.5, lineHeight: 1.35 }}>{toolLabel(tool)}</Typography>
                        <Typography component="span" variant="body2" color="text.secondary" sx={{ display: 'block', lineHeight: 1.4 }}>→ {found.summary.lookups.find((l) => l.name === tool.name)?.lands || 'adds notes'}</Typography>
                      </>
                    )} />
                ))}
              </Box>
              {changes.length > 0 && (
                <>
                  <Typography component="div" sx={(t) => ({ ...heading(t), mt: 2 })}>Change things outside Slatebox</Typography>
                  <Box sx={{ display: 'grid', gap: 1 }}>
                    {changes.map((tool) => (
                      <FormControlLabel key={tool.name} sx={(t) => option(t, Boolean(allowed[tool.name]), tool.destructive)} data-invite-change={tool.name}
                        control={<Checkbox checked={Boolean(allowed[tool.name])} onChange={(e) => setAllowed({ ...allowed, [tool.name]: e.target.checked })} />}
                        label={(
                          <>
                            <Typography component="span" sx={{ display: 'block', fontWeight: 700, fontSize: 14.5, lineHeight: 1.35 }}>{toolLabel(tool)}</Typography>
                            <Typography component="span" variant="body2" color={tool.destructive ? 'error' : 'text.secondary'} sx={{ display: 'block', lineHeight: 1.4 }} data-invite-change-words="">
                              {tool.destructive
                                ? 'Deletes, closes or merges things outside Slatebox. Off unless you turn it on; even then each one waits for your approval and cannot be undone from Slatebox.'
                                : '→ lands as a card on the slate: nothing changes until you approve it'}
                            </Typography>
                          </>
                        )} />
                    ))}
                  </Box>
                  <Callout kind="info" sx={{ mt: 1.25 }}>
                    <Box component="span" sx={{ display: 'block' }}>When you ask for a change (“file an issue for this”), it lands on the slate as a card saying exactly what would happen. Keep the card to approve it, Discard to decline. Only you approve, unless you let others on its chip.</Box>
                  </Callout>
                </>
              )}
              <Button size="small" onClick={() => setShowAll(!showAll)} sx={{ mt: 1.25, ml: -0.75 }}>{showAll ? 'Hide' : 'Show'} all tools as the server describes them</Button>
              {showAll && (
                <Box component="ul" sx={(t) => ({ m: 0, mt: 0.75, py: 1, pr: 1.5, pl: 3, maxHeight: 180, overflow: 'auto', fontSize: 13, lineHeight: 1.5, borderRadius: '10px', bgcolor: '#f4f3ec', border: '1px solid #e3e4d9', '& li + li': { mt: 0.5 }, ...t.applyStyles('dark', { bgcolor: '#1b2b23', borderColor: '#33493d' }) })}>
                  {found.tools.map((tool) => <li key={tool.name}><b>{tool.name}</b>: {tool.description || '(no description)'}</li>)}
                </Box>
              )}
            </Box>
            <Box sx={section}>
              <Typography component="div" sx={heading}>On this slate it may</Typography>
              <Typography variant="body2" sx={{ lineHeight: 1.5 }}><b>Suggest:</b> its work arrives as ghost notes anyone who can edit may keep or discard.</Typography>
              {changes.length > 0 && <Typography variant="body2" sx={{ lineHeight: 1.5, mt: 0.5 }}><b>Ask before changing things elsewhere:</b> each change waits on a card for you. You can let it act without asking later, on its chip.</Typography>}
            </Box>
            {integrationMode && !upgrade && (
              <Box sx={section} data-invite-rule="">
                <Typography component="div" sx={heading} id="invite-rule-label">It joins slates</Typography>
                <RadioGroup value={rule} onChange={(e) => setRule(e.target.value)} aria-labelledby="invite-rule-label" sx={{ display: 'grid', gap: 1 }}>
                  {RULE_CHOICES.map((choice) => (
                    <FormControlLabel key={choice.value} value={choice.value} control={<Radio size="small" />} sx={(t) => ({ ...option(t, rule === choice.value), '& .MuiFormControlLabel-label': { pt: '7px', flex: 1, fontSize: 14.5, fontWeight: rule === choice.value ? 700 : 500 } })}
                      label={choice.label} />
                  ))}
                </RadioGroup>
                <Callout kind="info" sx={{ mt: 1.5 }}>
                  <Box component="span" sx={{ display: 'block' }}>On each slate it sees only what you ask, unless you change that there. Removing it from one slate keeps it away from that slate.</Box>
                </Callout>
              </Box>
            )}
            {!integrationMode && <Box sx={section}>
              <Typography component="div" sx={heading} id="invite-sees-label">It may see</Typography>
              <RadioGroup value={sees} onChange={(e) => setSees(e.target.value)} aria-labelledby="invite-sees-label" sx={{ display: 'grid', gap: 1 }}>
                {SEES.map((option_) => (
                  <FormControlLabel key={option_.value} value={option_.value} control={<Radio size="small" />} sx={(t) => ({ ...option(t, sees === option_.value), '& .MuiFormControlLabel-label': { pt: '7px', flex: 1, fontSize: 14.5, fontWeight: sees === option_.value ? 700 : 500 } })}
                    label={option_.label} />
                ))}
              </RadioGroup>
              <Callout kind="info" sx={{ mt: 1.5 }}>
                <Box component="span" sx={{ display: 'block' }}><b>What leaves Slatebox:</b> {sees === 'request' ? 'only what you type when you ask it.' : sees === 'selection' ? 'what you type, and the text of the notes you select.' : 'what you type, and the text of every note on this slate, including notes by others.'}</Box>
                <Box component="span" sx={{ display: 'block', mt: 0.5 }}>Never: other slates, people's names or emails, comments, links or share settings.</Box>
              </Callout>
            </Box>}
            <Box sx={section}>
              <Typography component="div" sx={heading}>Who can ask it</Typography>
              <Typography variant="body2" sx={{ lineHeight: 1.5 }}>Only you. Everyone on {integrationMode ? 'a slate it is on' : 'the slate'} sees its cursor and suggestions.</Typography>
            </Box>
            {card?.try && (
              <Box sx={(t) => ({
                justifySelf: 'start', display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.5, py: 0.75, borderRadius: 999, fontSize: 14, lineHeight: 1.4,
                bgcolor: '#fff4b8', border: '1px solid #e9d671', color: '#4a3d00', boxShadow: '0 1px 2px rgba(110,90,0,0.10)',
                ...t.applyStyles('dark', { bgcolor: 'rgba(242,206,139,0.14)', borderColor: 'rgba(242,206,139,0.40)', color: '#ffe0a4' }),
              })}>
                <LightbulbOutlined aria-hidden="true" sx={{ fontSize: 18 }} />
                <span>Try: “{card.try}”</span>
              </Box>
            )}
            {error && <Problem text={error} link={problem.link} />}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={(t) => ({
        px: { xs: 2, sm: 3 }, py: 1.5, pb: { xs: 'max(12px, env(safe-area-inset-bottom))', sm: 1.5 }, gap: 1,
        bgcolor: '#fffef8', borderTop: '1px solid #e3e5d8', boxShadow: '0 -6px 16px rgba(32,61,50,0.06)',
        '& > :not(style) ~ :not(style)': { ml: 0 },
        ...t.applyStyles('dark', { bgcolor: '#1e3027', borderTopColor: '#33493d', boxShadow: '0 -8px 20px rgba(0,0,0,0.3)' }),
      })}>
        {step === 'consent' || step === 'inviting' ? (
          <>
            <Button onClick={() => (upgrade ? onClose() : (setStep('choose'), setError('')))}>{upgrade ? 'Cancel' : 'Back'}</Button>
            <Button variant="contained" data-invite-go="" disabled={step === 'inviting' || !name.trim() || !chosen.length} onClick={invite} sx={{ px: 3, py: 1, flex: { xs: 1, sm: 'none' } }}>
              {step === 'inviting' ? (integrationMode ? 'Connecting…' : 'Inviting…') : upgrade ? `Save ${name || 'agent'} ⬡` : `${integrationMode ? 'Connect' : 'Invite'} ${name || 'agent'} ⬡`}
            </Button>
          </>
        ) : step === 'signin' || step === 'waiting' ? (
          <>
            {!reconnect && !upgrade && <Button onClick={() => { pending.current?.cancel(); setStep('choose'); setError('') }}>Back</Button>}
            <Button onClick={() => { pending.current?.cancel(); onClose() }}>{step === 'waiting' ? 'Cancel' : 'Close'}</Button>
          </>
        ) : (
          <Button onClick={onClose} variant={step === 'connected' ? 'contained' : 'text'} data-invite-close="">{step === 'reconnected' || step === 'connected' ? 'Done' : 'Close'}</Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

InviteWalkthrough.propTypes = {
  open: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  shareId: PropTypes.string,
  slateName: PropTypes.string,
  onInvited: PropTypes.func,
  reconnect: PropTypes.shape({ connectionId: PropTypes.string, address: PropTypes.string, name: PropTypes.string }),
  invited: PropTypes.arrayOf(PropTypes.shape({ agentId: PropTypes.string, name: PropTypes.string, galleryId: PropTypes.string, mine: PropTypes.bool, status: PropTypes.string })),
  onManage: PropTypes.func,
  integrations: PropTypes.arrayOf(PropTypes.shape({ integrationId: PropTypes.string, name: PropTypes.string, host: PropTypes.string, status: PropTypes.string, galleryId: PropTypes.string, kind: PropTypes.string })),
  onConnected: PropTypes.func,
  onManageIntegration: PropTypes.func,
  upgrade: PropTypes.shape({ address: PropTypes.string, replaces: PropTypes.string, name: PropTypes.string }),
}
