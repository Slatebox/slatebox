/* eslint-disable no-underscore-dangle */
// Team settings (/team/settings): the one home for a team's configuration, in sections with a
// left list (a scrolling row on a phone). Each section shows only what exists on this server:
//   General          the team's name, and facts about it (kind, created, your role, people)
//   Members & roles  the team page (/team) and team slates
//   Plan & billing   Slatebox Business (BusinessPanel, prices from Stripe) and the team balance
//   Agents & AI      the team's AI connections and choices (self-hosted), outside agents, Integrations
//   Branding         the brand kit (/team/branding)
//   Data             export everything (team.export)
//   Danger zone      delete the team (organizations.delete), with the team's name typed to confirm
// Which sections a person sees, the name rule and the delete copy live in
// components/teams/team-settings-model.mjs. ?section=<id> opens a section.
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link as RouterLink, useSearchParams } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import Link from '@mui/material/Link'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useTheme } from '@mui/material/styles'
import TuneOutlined from '@mui/icons-material/TuneOutlined'
import GroupOutlined from '@mui/icons-material/GroupOutlined'
import CreditCardOutlined from '@mui/icons-material/CreditCardOutlined'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import PaletteOutlined from '@mui/icons-material/PaletteOutlined'
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined'
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined'
import ChevronRight from '@mui/icons-material/ChevronRight'
import { useTranslator } from '../common/i18n'
import CONSTANTS from '../../api/common/constants'
import { ownKeysAllowed } from '../../api/common/own-keys.mjs'
import { enterpriseState } from '../../api/common/edition.mjs'
import { Organizations } from '../../api/common/models'
import AuthManager from '../../api/common/AuthManager'
import TeamBalance from '../components/billing/TeamBalance'
import BusinessPanel from '../components/teams/BusinessPanel'
import ExportEverything from '../components/teams/ExportEverything'
import { Level } from '../components/profile/AISettings'
import { paymentsHere } from '../components/billing/pay/pay-env'
import {
  confirmsName, deleteTeamState, pickSection, teamNameProblem, teamSettingsSections, TEAM_NAME_MAX,
} from '../components/teams/team-settings-model.mjs'

const ICONS = {
  general: TuneOutlined,
  members: GroupOutlined,
  billing: CreditCardOutlined,
  ai: AutoAwesomeOutlined,
  branding: PaletteOutlined,
  data: FileDownloadOutlined,
  danger: WarningAmberOutlined,
}

// The card the new pages share (Integrations, the invite walkthrough): warm paper, a soft border.
const card = (theme) => ({
  bgcolor: '#fffef8', border: '1px solid #e1e3d6', borderRadius: '14px', p: { xs: 2, sm: 2.5 }, minWidth: 0,
  ...theme.applyStyles('dark', { bgcolor: '#23362d', borderColor: '#3a5244' }),
})
// AA in both schemes: MUI's dark error red is 4.3:1 on the dark page, and white on it 3.7:1
const dangerInk = (theme) => ({ color: 'error.main', ...theme.applyStyles('dark', { color: '#ff9e94' }) })
const dangerButton = (theme) => theme.applyStyles('dark', { bgcolor: '#c62828', color: '#fff', '&:hover': { bgcolor: '#b71c1c' } })
const dangerCard = (theme) => ({
  ...card(theme), borderColor: '#e3b4ae',
  ...theme.applyStyles('dark', { bgcolor: '#3a2624', borderColor: '#7a3d36' }),
})

function Card({ title, icon: Icon, children, danger, ...props }) {
  return (
    // eslint-disable-next-line react/jsx-props-no-spreading
    <Box component="section" sx={danger ? dangerCard : card} {...props}>
      {title && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          {Icon && <Icon fontSize="small" aria-hidden sx={danger ? dangerInk : { color: 'text.secondary' }} />}
          <Typography variant="subtitle1" component="h3" sx={{ fontWeight: 700, lineHeight: 1.3 }}>{title}</Typography>
        </Box>
      )}
      <Box sx={{ display: 'grid', gap: 1.25, minWidth: 0 }}>{children}</Box>
    </Box>
  )
}
Card.propTypes = { title: PropTypes.node, icon: PropTypes.elementType, children: PropTypes.node, danger: PropTypes.bool }
Card.defaultProps = { title: null, icon: null, children: null, danger: false }

function SectionHeader({ id, title, intro }) {
  return (
    <Box sx={{ mb: 0.5 }}>
      <Typography variant="h6" component="h2" id={`team-settings-${id}`} sx={{ fontWeight: 750 }}>{title}</Typography>
      {intro && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{intro}</Typography>}
    </Box>
  )
}
SectionHeader.propTypes = { id: PropTypes.string.isRequired, title: PropTypes.string.isRequired, intro: PropTypes.node }
SectionHeader.defaultProps = { intro: null }

function Fact({ label, value }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 1, borderTop: '1px solid', borderColor: 'divider', '&:first-of-type': { borderTop: 0, pt: 0 } }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>{value}</Typography>
    </Box>
  )
}
Fact.propTypes = { label: PropTypes.string.isRequired, value: PropTypes.node.isRequired }

// A row that opens another page: what it is, one line on what is there, and a chevron.
function LinkRow({ to, title, detail, testId }) {
  return (
    <Box component={RouterLink} to={to} data-testid={testId}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, mx: -1.5, borderRadius: '10px', color: 'inherit', textDecoration: 'none',
        '&:hover': { bgcolor: 'action.hover' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body1" sx={{ fontWeight: 650 }}>{title}</Typography>
        <Typography variant="body2" color="text.secondary">{detail}</Typography>
      </Box>
      <ChevronRight aria-hidden sx={{ color: 'text.secondary' }} />
    </Box>
  )
}
LinkRow.propTypes = { to: PropTypes.string.isRequired, title: PropTypes.string.isRequired, detail: PropTypes.node.isRequired, testId: PropTypes.string }
LinkRow.defaultProps = { testId: undefined }

function TeamName({ org, admin, noun }) {
  const [name, setName] = React.useState(org?.name ?? '')
  const [note, setNote] = React.useState(null)
  const [busy, setBusy] = React.useState(false)
  React.useEffect(() => { setName(org?.name ?? '') }, [org?.name])
  const problem = teamNameProblem(name, noun)
  const changed = name !== (org?.name ?? '')
  const save = async (event) => {
    event.preventDefault()
    if (problem || !changed || !admin) return
    setBusy(true)
    setNote(null)
    try {
      // the same write as before: the Organizations allow rule lets a team admin change the name only
      await Organizations.updateAsync({ _id: org._id }, { $set: { name } })
      setNote({ severity: 'success', text: 'Saved.' })
    } catch (err) {
      setNote({ severity: 'error', text: err?.reason || 'The name was not saved. Try again.' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title={`${noun === 'classroom' ? 'Classroom' : 'Team'} name`} data-testid="team-name">
      <Box component="form" onSubmit={save} noValidate sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
        <TextField id="orgName" name="orgName" label="Name" size="small" fullWidth value={name} disabled={!admin}
          onChange={(e) => { setName(e.target.value); setNote(null) }}
          error={changed && Boolean(problem)} helperText={changed && problem ? problem : `Shown to everyone in the ${noun}, in invitations and emails.`}
          inputProps={{ maxLength: TEAM_NAME_MAX + 1, 'data-testid': 'team-name-input' }} />
        {admin && (
          <Button type="submit" variant="contained" disableElevation disabled={busy || !changed || Boolean(problem)} sx={{ flexShrink: 0, minHeight: 40 }}>
            Save
          </Button>
        )}
      </Box>
      {!admin && <Typography variant="body2" color="text.secondary">Only {noun} admins can change the name.</Typography>}
      {note && <Typography role="status" variant="body2" color={note.severity === 'error' ? 'error' : 'success.main'}>{note.text}</Typography>}
    </Card>
  )
}
TeamName.propTypes = { org: PropTypes.shape({ _id: PropTypes.string, name: PropTypes.string }), admin: PropTypes.bool.isRequired, noun: PropTypes.string.isRequired }
TeamName.defaultProps = { org: null }

function DeleteTeam({ org, owner, implications, noun, people }) {
  const [open, setOpen] = React.useState(false)
  const [typed, setTyped] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState('')
  const teamName = org?.name ?? ''
  const plan = deleteTeamState({
    implications, owner, teamName, noun, people,
    metered: Meteor.settings.public.metered === true, payments: paymentsHere(),
  })
  const close = () => { if (!busy) { setOpen(false); setTyped(''); setError('') } }
  const remove = async () => {
    setBusy(true)
    setError('')
    try {
      const out = await Meteor.callAsync(CONSTANTS.methods.organizations.delete)
      if (out?.success) {
        window.location.href = '/'
        return
      }
      setError(out?.reason || 'The team was not deleted. Try again.')
    } catch (err) {
      setError(err?.reason || err?.message || 'The team was not deleted. Try again.')
    }
    setBusy(false)
  }
  return (
    <Card danger title={`Delete this ${noun}`} icon={WarningAmberOutlined} data-testid="danger-zone" data-delete-state={plan.state}>
      {plan.state === 'loading' && <Typography variant="body2" color="text.secondary">Checking who and what is still in the {noun}…</Typography>}
      {plan.lines.map((line) => <Typography key={line} variant="body2">{line}</Typography>)}
      {plan.state === 'members-left' && (
        <Box><Button component={RouterLink} to="/team" variant="outlined">Go to the {noun} page</Button></Box>
      )}
      {plan.state === 'ready' && (
        <Box>
          <Button color="error" variant="contained" disableElevation sx={dangerButton} onClick={() => setOpen(true)} data-team-delete-open="">
            Delete {teamName}
          </Button>
        </Box>
      )}
      <Dialog open={open} onClose={close} maxWidth="sm" fullWidth aria-labelledby="delete-team-title" aria-describedby="delete-team-body">
        <DialogTitle id="delete-team-title">Delete {teamName} and your account?</DialogTitle>
        <DialogContent id="delete-team-body">
          {plan.state === 'ready' && (
            <Box sx={{ display: 'grid', gap: 1.5 }}>
              <Box>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>Removed for good</Typography>
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{plan.removed.map((l) => <Typography component="li" variant="body2" key={l}>{l}</Typography>)}</Box>
              </Box>
              {plan.first.length > 0 && (
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700 }}>Before anything is removed</Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>{plan.first.map((l) => <Typography component="li" variant="body2" key={l}>{l}</Typography>)}</Box>
                  {plan.safety && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{plan.safety}</Typography>}
                </Box>
              )}
              <TextField autoFocus fullWidth size="small" label={`Type the ${noun} name, ${teamName}, to confirm`} value={typed}
                onChange={(e) => setTyped(e.target.value)} autoComplete="off" inputProps={{ 'data-testid': 'delete-team-typed', spellCheck: false }} />
              {error && <Alert severity="error">{error}</Alert>}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close} disabled={busy}>Cancel</Button>
          <Button color="error" variant="contained" disableElevation sx={dangerButton} disabled={busy || !confirmsName(typed, teamName)} onClick={remove} data-team-delete-confirm="">
            {busy ? 'Deleting…' : `Delete ${noun} and account`}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  )
}
DeleteTeam.propTypes = {
  org: PropTypes.shape({ name: PropTypes.string }), owner: PropTypes.bool.isRequired, implications: PropTypes.shape({}),
  noun: PropTypes.string.isRequired, people: PropTypes.string.isRequired,
}
DeleteTeam.defaultProps = { org: null, implications: null }

function TeamAI({ noun }) {
  const [settings, setSettings] = React.useState(null)
  const [error, setError] = React.useState('')
  React.useEffect(() => {
    let live = true
    Meteor.callAsync(CONSTANTS.methods.ai.get).then((s) => live && setSettings(s)).catch((err) => live && setError(err?.reason || 'The AI settings could not be read.'))
    return () => { live = false }
  }, [])
  let body
  if (error) body = <Alert severity="warning">{error}</Alert>
  else if (!settings) body = <Typography variant="body2" color="text.secondary">Reading the {noun}&apos;s AI…</Typography>
  else if (settings.hosted) {
    body = (
      <Typography variant="body2">
        On Slatebox Cloud, AI comes with Slatebox Pro credits and top-ups, and Slatebox Business adds a shared pool for the whole {noun}. There is nothing to connect here.
      </Typography>
    )
  } else if (!settings.team) {
    body = <Typography variant="body2">This server uses the AI its operator set up. Own AI providers are turned off, so the {noun} cannot connect its own.</Typography>
  } else {
    body = (
      <>
        <Typography variant="body2" color="text.secondary">
          Connections the {noun} adds here are used by every member who has not chosen AI of their own. A member&apos;s own choice wins, then the {noun}&apos;s, then this server&apos;s.
        </Typography>
        <Level settings={settings} level="team" title="Connections and choices" holder={settings.team} editable={settings.team.editable} onChange={setSettings} />
      </>
    )
  }
  return (
    <Card title={`${noun === 'classroom' ? 'Classroom' : 'Team'} AI`} icon={AutoAwesomeOutlined} data-testid="team-ai">
      {body}
      <Typography variant="body2"><Link component={RouterLink} to="/profile?tab=ai">See which AI each feature uses for you</Link></Typography>
    </Card>
  )
}
TeamAI.propTypes = { noun: PropTypes.string.isRequired }

export default function TeamSettings() {
  const t = useTranslator()
  const theme = useTheme()
  const wide = useMediaQuery(theme.breakpoints.up('md'))
  const [searchParams, setSearchParams] = useSearchParams()
  const [isTeamAdmin, setIsTeamAdmin] = React.useState(false)
  const [implications, setImplications] = React.useState(null)
  const user = useTracker(() => Meteor.user())
  const userId = user?._id
  const orgId = user?.orgId
  const owner = Boolean(user?.isOrgOwner)
  const org = useTracker(() => Organizations.findOne(), [])
  const education = Boolean(user?.isEducationCertified || org?.isEducationInstitution)
  const noun = education ? 'classroom' : 'team'
  const people = education ? 'students' : 'members'

  React.useEffect(() => {
    let live = true
    if (userId && orgId)
      AuthManager.userHasClaim(userId, [CONSTANTS.claims.admin._id]).then((yes) => live && setIsTeamAdmin(Boolean(yes)))
    return () => { live = false }
  }, [userId, orgId])

  // who and what is in the team: the people count, and whether it can be deleted
  React.useEffect(() => {
    let live = true
    if (orgId) Meteor.callAsync(CONSTANTS.methods.organizations.getCancellationImplications).then((x) => live && setImplications(x)).catch(() => {})
    return () => { live = false }
  }, [orgId])

  const metered = Meteor.settings.public.metered === true
  const payments = paymentsHere()
  const sections = teamSettingsSections({ inTeam: Boolean(orgId), admin: isTeamAdmin, owner, billing: metered || payments })
  const active = pickSection(sections, searchParams.get('section'))
  const open = (id) => setSearchParams(id === sections[0]?.id ? {} : { section: id }, { replace: true })
  const integrationsHere = enterpriseState(Meteor.settings).unlocked
  const memberCount = implications ? implications.otherUsers + 1 : null
  let role = 'Member'
  if (owner) role = 'Owner'
  else if (isTeamAdmin) role = 'Admin'
  const Team = noun === 'classroom' ? 'Classroom' : 'Team'

  // on a phone the list is a row that scrolls: keep the open section's pill in view
  const navRef = React.useRef(null)
  React.useEffect(() => {
    if (wide) return
    navRef.current?.querySelector('[aria-current="page"]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
  }, [wide, active, sections.length])

  const header = (
    <Box sx={{ mb: { xs: 2, md: 3 } }}>
      <Typography variant="h4" component="h1" sx={{ fontWeight: 750, fontSize: { xs: 26, sm: 32 } }}>
        {education ? t('teamSettings.educationHeader') : t('teamSettings.header')}
      </Typography>
      {org?.name && (
        <Typography variant="body1" color="text.secondary" sx={{ mt: 0.5 }}>
          Everything about <b>{org.name}</b> in one place: its name, people, plan, AI and data.
        </Typography>
      )}
    </Box>
  )

  if (user && !orgId) {
    return (
      <Box sx={{ maxWidth: 760, pt: { xs: 1, md: 3 }, pb: 6 }}>
        <Typography variant="h4" component="h1" sx={{ fontWeight: 750, fontSize: { xs: 26, sm: 32 }, mb: 2 }}>Team settings</Typography>
        <Box sx={card}>
          <Typography variant="body1" sx={{ mb: 1.5 }}>You are not in a team yet. Make one to share slates, a brand kit and a balance with the people you work with.</Typography>
          <Button component={RouterLink} to="/team" variant="contained" disableElevation>Create a team</Button>
        </Box>
      </Box>
    )
  }

  const nav = (
    <Box component="nav" ref={navRef} aria-label={`${Team} settings sections`} data-team-settings-nav=""
      sx={wide
        ? { position: 'sticky', top: 16, alignSelf: 'start', display: 'grid', gap: 0.25 }
        : { display: 'flex', gap: 1, overflowX: 'auto', pb: 1, mb: 2, mx: -1, px: 1, scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
      {sections.map((s) => {
        const Icon = ICONS[s.id]
        const current = s.id === active
        return (
          <Box key={s.id} component="a" href={`?section=${s.id}`} data-section={s.id} aria-current={current ? 'page' : undefined}
            onClick={(e) => { e.preventDefault(); open(s.id) }}
            sx={(th) => ({
              display: 'flex', alignItems: 'center', gap: 1.25, textDecoration: 'none', whiteSpace: 'nowrap', flexShrink: 0,
              color: current ? 'shell.selectedInk' : 'text.primary',
              ...(!current && s.id === 'danger' && dangerInk(th)),
              bgcolor: current ? 'shell.selected' : 'transparent',
              fontWeight: current ? 700 : 500, fontSize: 15,
              ...(wide
                ? { px: 1.5, py: 1, borderRadius: '10px' }
                : { px: 1.5, py: 0.75, borderRadius: 999, border: '1px solid', borderColor: current ? 'transparent' : 'divider', minHeight: 40 }),
              '&:hover': { bgcolor: current ? 'shell.selected' : 'action.hover' },
              '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
            })}>
            <Icon fontSize="small" aria-hidden />
            {s.label}
          </Box>
        )
      })}
    </Box>
  )

  let panel = null
  if (active === 'general') {
    panel = (
      <>
        <SectionHeader id="general" title="General" intro={`The ${noun}'s name and the basics.`} />
        <TeamName org={org} admin={isTeamAdmin} noun={noun} />
        <Card title={`About this ${noun}`}>
          <Box>
            <Fact label="Kind" value={education ? 'Classroom (education)' : 'Team'} />
            {org?.createdOn && <Fact label="Created" value={new Date(org.createdOn).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })} />}
            {memberCount !== null && <Fact label={people === 'students' ? 'People' : 'Members'} value={`${memberCount}`} />}
            <Fact label="Your role" value={role} />
          </Box>
        </Card>
      </>
    )
  } else if (active === 'members') {
    panel = (
      <>
        <SectionHeader id="members" title="Members & roles" intro={`Who is in the ${noun} and what each person may do.`} />
        <Card>
          <LinkRow to="/team" testId="link-team" title={`Manage ${noun}`}
            detail={`${memberCount !== null ? `${memberCount} ${memberCount === 1 ? 'person' : 'people'}. ` : ''}Invite people, choose each person's role and remove ${people}.`} />
          <LinkRow to="/team/slates" testId="link-team-slates" title={`${Team} slates`} detail={`Every slate the ${noun}'s ${people} made, in one list.`} />
        </Card>
      </>
    )
  } else if (active === 'billing') {
    panel = (
      <>
        <SectionHeader id="billing" title="Plan & billing" intro={payments ? 'Amounts come from Stripe at checkout: see the pricing page for today\'s prices.' : null} />
        {payments && (
          // BusinessPanel is shared with the team page: here it takes the same card as the sections around it
          <Box sx={(th) => ({ '& [data-business-panel]': card(th) })}><BusinessPanel /></Box>
        )}
        {metered && (
          <Card title={ownKeysAllowed(Meteor.settings) ? 'Team balance and keys' : 'Team balance'} icon={CreditCardOutlined}>
            <TeamBalance />
          </Card>
        )}
      </>
    )
  } else if (active === 'ai') {
    panel = (
      <>
        <SectionHeader id="ai" title="Agents & AI" intro={`The AI the ${noun} uses, and the outside agents ${people} bring onto slates.`} />
        <TeamAI noun={noun} />
        {integrationsHere && (
          <Card title="Outside agents and integrations" icon={GroupOutlined} data-testid="team-agents">
            <Typography variant="body2">
              Each slate&apos;s owner chooses who may bring outside agents onto it: its editors, only the owner, or no one. They change it from the slate&apos;s <b>+ Invite agent</b>.
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Agents and Google accounts are connected by each person, once, on Integrations. Connections shared by the whole {noun} are not available yet.
            </Typography>
            <LinkRow to="/integrations" testId="link-integrations" title="Integrations" detail="Your connected agents and Google account." />
          </Card>
        )}
      </>
    )
  } else if (active === 'branding') {
    panel = (
      <>
        <SectionHeader id="branding" title="Branding" intro={`How the ${noun}'s slates and presentations look.`} />
        <Card>
          <LinkRow to="/team/branding" testId="link-brand-kit" title="Brand kit"
            detail={`The style new slates start with, the ${noun}'s favicon and the colors of presentation mode.`} />
        </Card>
      </>
    )
  } else if (active === 'data') {
    panel = (
      <>
        <SectionHeader id="data" title="Data" intro={`Take everything the ${noun} owns with you.`} />
        <Box sx={card}><ExportEverything /></Box>
      </>
    )
  } else if (active === 'danger') {
    panel = (
      <>
        <SectionHeader id="danger" title="Danger zone" intro="Changes here cannot be undone." />
        <DeleteTeam org={org} owner={owner} implications={implications} noun={noun} people={people} />
      </>
    )
  }

  return (
    <Box sx={{ maxWidth: 1040, mx: { xs: -1, sm: 0 }, pt: { xs: 1, md: 3 }, pb: 6, minWidth: 0 }} data-team-settings="">
      {header}
      <Box sx={wide ? { display: 'grid', gridTemplateColumns: '220px minmax(0, 760px)', gap: 4 } : { minWidth: 0 }}>
        {nav}
        <Box sx={{ display: 'grid', gap: 2, alignContent: 'start', minWidth: 0 }} data-team-settings-panel={active || ''}
          role="region" aria-labelledby={active ? `team-settings-${active}` : undefined}>
          {panel}
        </Box>
      </Box>
    </Box>
  )
}
