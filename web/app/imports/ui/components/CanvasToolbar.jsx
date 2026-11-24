import React, { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import CONSTANTS from '../../api/common/constants'
import { Box, Button, ButtonBase, ButtonGroup, Dialog, Divider, IconButton, InputBase, ListItemIcon, ListItemText,
  MenuItem, Popover, Snackbar, Tooltip, Typography, useMediaQuery, useTheme } from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import PlayArrow from '@mui/icons-material/PlayArrow'
import ArrowDropDown from '@mui/icons-material/ArrowDropDown'
import ExpandMore from '@mui/icons-material/ExpandMore'
import AutoAwesome from '@mui/icons-material/AutoAwesome'
import Lock from '@mui/icons-material/Lock'
import LinkIcon from '@mui/icons-material/Link'
import Public from '@mui/icons-material/Public'
import Edit from '@mui/icons-material/Edit'
import Sliders from '@mui/icons-material/Tune'
import Brush from '@mui/icons-material/Brush'
import History from '@mui/icons-material/History'
import Download from '@mui/icons-material/Download'
import Code from '@mui/icons-material/Code'
import AccountTree from '@mui/icons-material/AccountTree'
import ContentCopy from '@mui/icons-material/ContentCopy'
import Delete from '@mui/icons-material/Delete'
import CastIcon from '@mui/icons-material/Cast'
import GroupAdd from '@mui/icons-material/GroupAdd'
import Save from '@mui/icons-material/Save'
import Login from '@mui/icons-material/Login'
import HuddleUp from './HuddleUp'
import CreativeSlate from './CreativeSlate'
import AccountMenu, { Avatar, displayName, useSaveYourWork } from './AccountMenu'
import MessagesMenu, { useUnreadNotifications, unreadColor } from './MessagesMenu'
import HeaderMenu from './HeaderMenu'
import { useLivePresentation } from './presentations/useLivePresentation'
import { presentTarget } from './presentations/presentTarget.mjs'
import { CreativeStates } from '../../api/client/creativeSlateStates'
import copySlate from '../../api/client/copySlate'
import { Slates } from '../../api/common/models'
import { originCredit } from './library/libraryCopy.mjs'
import confirmService from '../common/confirm'
import { builderHeaderSlot, collaborationUsers, conversationArrival, conversationAvailable, conversationOpen, isPresentOpen, mermaidDialog } from '../jotai/atoms'
import { toggledConversation } from '../../api/common/conversation-toggle.mjs'
import { presentedBoards } from './presentations/workshopScenes.mjs'

// One entry per person (presentPeople), named as every viewer and their pointer name them.
const peerName = p => p.userName

// The header on a canvas. Left: the app's menu (≡), the logo (My Slates), and this slate's name, which
// opens the slate's own menu. Right: who is here, Huddle, Ask Slatebox, Present ▾ (or Follow
// presentation while someone else presents) and Share. Far right: notifications (or, for a guest,
// Save your work) and the account. Below 1000px it is one row — ≡, name, Present, Share, account —
// and the canvas page puts Ask Slatebox and Huddle in a bar under the canvas. On a builder slate, the build
// bar sits after the name (the whole of it from 1000px wide, one Builder button below that).
export default function CanvasToolbar({ slate, title, privacy, user, manage, busy, huddle, navOpen, onOpenNav, onSettings, onOutput, onHistory, onShare, onRename }) {
  const route = useLocation().pathname.match(/^\/canvas\/([a-zA-Z0-9]{1,40})\/?$/)?.[1]
  const navigate = useNavigate()
  const theme = useTheme()
  const narrow = useMediaQuery('(max-width:999.98px)')
  const [projection, setProjection] = useState(null)
  const setPresentOpen = useSetAtom(isPresentOpen)
  const [told, setTold] = useState('')
  const [slateMenu, setSlateMenu] = useState(null)
  const [presentMenu, setPresentMenu] = useState(null)
  const [peopleAnchor, setPeopleAnchor] = useState(null)
  const [renaming, setRenaming] = useState(false)
  const titleButton = useRef(null)
  const openMermaid = useSetAtom(mermaidDialog)
  const afterSlateMenu = useRef(null)
  const [askOpen, setAskOpen] = useAtom(conversationOpen)
  // Pressed as soon as it is in sight, even while the conversation is still on its way (conversation-toggle.mjs).
  const [askArrival, setAskArrival] = useAtom(conversationArrival)
  const canAsk = useAtomValue(conversationAvailable)
  const people = useAtomValue(collaborationUsers)
  const unread = useUnreadNotifications()
  const saveYourWork = useSaveYourWork()
  // A builder slate puts its status and its Save and Submit here (library/build/BuildBar.jsx), never over the canvas.
  const setBuilderSlot = useSetAtom(builderHeaderSlot)

  const onWorkshop = Boolean(route && slate?.creativeKind === 'workshop')
  // A workshop slate's saved workshop, as the canvas page has subscribed to it. The board records
  // decide, reactively: a board kept on this slate during this visit (slate.creativeKind changes
  // in place, which renders nothing) opens a live presentation with its lanes too. On a slate of
  // many boards, every board (board by board) does.
  const draft = useTracker(() => (route
    ? presentedBoards(CreativeStates.findOne(route, { fields: { model: 1 } }),
      CreativeStates.find({ shareId: route, boardId: { $ne: 'main' } }, { fields: { boardId: 1, model: 1 } }).fetch())
    : null), [route])
  const overlayKind = presentTarget(slate) === 'overlay'
  const live = useLivePresentation({ enabled: Boolean(route && slate && !overlayKind), shareId: route,
    title: title || slate?.options?.name, workshop: draft, mayLead: Boolean(manage) })

  const guest = Boolean(user?.isAnonymous)
  const owner = Boolean(user && user._id === slate?.userId)
  // A slate opened from the library credits its author, as its licence asks (libraryOrigin, kept on every copy).
  const credit = useTracker(() => originCredit(slate?.options?.id ? Slates.findOne({ _id: slate.options.id }, { fields: { libraryOrigin: 1 } })?.libraryOrigin : null), [slate?.options?.id])
  const visibility = privacy.isPrivate ? 'Private' : privacy.isUnlisted ? 'Unlisted' : privacy.isPublic ? 'Public' : ''
  const name = title || 'Untitled slate'
  const others = people.length
  const presence = others ? `${others} other${others > 1 ? 's' : ''} here` : visibility

  // Present opens the presenter on every slate drawn on the canvas; a board drawn by its own
  // renderer shows its own read-only view.
  function startPresentation() {
    if (presentTarget(slate) === 'overlay') setProjection(slate)
    else setPresentOpen(true)
  }

  // A presentation's link (/canvas/<id>?present=1, from presentations.create) opens the slate and
  // presents it, once the slate is drawn: as Present does, for someone who may edit it.
  const [search, setSearch] = useSearchParams()
  const presentAsked = search.get('present') === '1'
  useEffect(() => {
    if (!presentAsked || !slate || !manage) return
    const rest = new URLSearchParams(search)
    rest.delete('present')
    setSearch(rest, { replace: true })
    startPresentation()
  }, [presentAsked, Boolean(slate), manage])

  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setTold('Link copied') }
    catch { setTold('Copy the link from the address bar') }
  }

  async function makeCopy() {
    try {
      // The server makes the copy from the stored slate (slates.copy); no browser writes slates.
      const shareId = await copySlate(slate.shareId, { name: `${name} (copy)`.slice(0, 200) })
      navigate(`/canvas/${shareId}`)
    } catch { setTold('This slate could not be copied. Try again.') }
  }

  async function deleteSlate() {
    const sure = await confirmService.show({
      theme, title: `Delete ${name}?`,
      message: 'The slate and its notes are removed for everyone it is shared with. This cannot be undone.',
      actionItems: [{ key: 'delete', label: 'Delete slate', return: true }, { key: 'keep', label: 'Keep it', return: false }],
    })
    if (!sure) return
    try {
      await Meteor.callAsync(CONSTANTS.methods.slates.remove, { slateIds: [slate.options?.id ?? slate._id] })
      navigate('/')
    } catch (err) { setTold(`The slate could not be deleted: ${err.reason || err.message}`) }
  }

  // Enter saves, Escape keeps the old name, and leaving the field saves. Each ends the edit once.
  const renameDone = useRef(false)
  const startRename = () => { renameDone.current = false; setRenaming(true) }
  const cancelRename = () => {
    if (renameDone.current) return
    renameDone.current = true
    setRenaming(false)
    requestAnimationFrame(() => titleButton.current?.focus())
  }
  const commitRename = value => {
    if (renameDone.current) return
    renameDone.current = true
    setRenaming(false)
    const next = value.trim()
    if (next && next !== title) onRename(next)
    requestAnimationFrame(() => titleButton.current?.focus())
  }

  const closeSlateMenu = () => setSlateMenu(null)
  const slateItems = [
    manage && { key: 'rename', label: 'Rename', icon: <Edit />, run: () => { afterSlateMenu.current = startRename } },
    manage && { key: 'settings', label: 'Slate settings', icon: <Sliders />, run: () => onSettings('settingsPanel'), disabled: busy },
    manage && { key: 'colors', label: 'Colors', icon: <Brush />, run: () => onSettings('colorPanel'), disabled: busy },
    manage && !onWorkshop && { key: 'history', label: 'Version history', icon: <History />, run: onHistory, disabled: busy },
    'divider',
    { key: 'link', label: 'Copy link', icon: <LinkIcon />, run: copyLink },
    // Where it came from, on a phone too (the header shows it beside the name on a wide screen).
    credit && { key: 'origin', label: credit.text, hint: 'Open it in the library', icon: <ContentCopy />, run: () => navigate(credit.href) },
    // Mermaid: any slate as Mermaid text, and Mermaid drawn as notes. A guest and a reader use it too: the text is
    // theirs to copy; only opening a diagram as a slate of its own asks for an account (MermaidDialog).
    { key: 'mermaid', label: 'Mermaid', hint: manage ? 'Export or import a diagram' : 'Copy this slate as a diagram', icon: <AccountTree />, run: () => openMermaid('export') },
    manage && { key: 'export', label: 'Export', icon: <Download />, run: () => onOutput('export') },
    manage && { key: 'embed', label: 'Embed', icon: <Code />, run: () => onOutput('embed') },
    'divider',
    // A copy goes into your own account: for people who can edit this slate, or anyone on a public one.
    // A read-only link is for looking; it does not hand over the owner's slate.
    user && (manage || privacy.isPublic) && !overlayKind && { key: 'copy', label: 'Make a copy', icon: <ContentCopy />, run: makeCopy },
    owner && manage && { key: 'delete', label: 'Delete slate…', icon: <Delete />, run: deleteSlate, danger: true },
  ].filter(Boolean).filter((item, i, list) => item !== 'divider' || (i > 0 && list[i - 1] !== 'divider' && i < list.length - 1))

  const presentItems = [
    { key: 'here', label: 'Present on this screen', icon: <PlayArrow />, run: startPresentation },
    live.canStart && { key: 'everyone', label: 'Present to everyone here',
      hint: 'Everyone on this slate follows your presentation', icon: <CastIcon />, run: live.start, disabled: live.disabled },
  ].filter(Boolean)

  const menuItem = (item, close) => <MenuItem key={item.key} disabled={item.disabled} onClick={() => { close(); item.run() }}
    sx={item.danger ? { color: 'error.main' } : undefined}>
    <ListItemIcon sx={{ color: 'inherit', '& svg': { fontSize: 20 } }}>{item.icon}</ListItemIcon>
    <ListItemText primary={item.label} secondary={item.hint} secondaryTypographyProps={{ variant: 'caption' }} />
  </MenuItem>

  const peerList = <>
    {[{ key: 'you', you: true }, ...people].map(p => <Box component="li" key={p.key}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: .75 }}>
      <Avatar name={p.you ? displayName(user) : peerName(p)} colour={p.color} size={28} />
      <span>{p.you ? 'You' : peerName(p)}</span>
    </Box>)}
  </>

  const slateLabel = <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0, alignItems: 'flex-start' }}>
    <strong title={name}>{name}</strong>
    {narrow && presence && <small className="sb-board-presence">{presence}</small>}
  </Box>

  const presentButton = live.live
    ? <Button className="sb-follow" variant="outlined" color="inherit" onClick={live.follow} disabled={live.disabled}
        aria-label="Follow presentation" startIcon={<Box component="span" aria-hidden="true" className="sb-live-dot" />}>
        <span className="sb-follow-long">Follow presentation</span><span className="sb-follow-short" aria-hidden="true">Follow</span>
      </Button>
    : narrow
      ? <Button variant="outlined" color="inherit" disabled={!slate}
          aria-haspopup={presentItems.length > 1 ? 'menu' : undefined}
          onClick={e => presentItems.length > 1 ? setPresentMenu(e.currentTarget) : startPresentation()}>Present</Button>
      : <ButtonGroup variant="outlined" color="inherit" className="sb-present">
          <Button className="sb-present-main" startIcon={<PlayArrow />} onClick={startPresentation} disabled={!slate} aria-label="Present"><span className="sb-btn-text">Present</span></Button>
          {presentItems.length > 1 && <Button size="small" aria-label="Presentation options" aria-haspopup="menu"
            aria-expanded={Boolean(presentMenu)} onClick={e => setPresentMenu(e.currentTarget)}><ArrowDropDown /></Button>}
        </ButtonGroup>

  const shell = theme.palette.shell
  const tokens = { '--sb-surface': shell.surface, '--sb-border': shell.border, '--sb-offset': shell.offset,
    '--sb-ink2': shell.secondaryInk, '--sb-selected': shell.selected, '--sb-selected-ink': shell.selectedInk }
  return <div className={'sb-board-toolbar' + (narrow ? ' sb-board-toolbar-narrow' : '')} style={tokens}>
    <Tooltip title="Menu">
      <IconButton color="inherit" onClick={onOpenNav} className="sb-board-nav" aria-haspopup="dialog" aria-expanded={Boolean(navOpen)}
        aria-label={narrow && unread && !guest ? `Open menu, ${unread} unread notification${unread > 1 ? 's' : ''}` : 'Open menu'}>
        <MenuIcon />
        {narrow && unread > 0 && !guest && <Box component="span" aria-hidden="true" className="sb-unread-dot" sx={{ bgcolor: unreadColor }} />}
      </IconButton>
    </Tooltip>
    <Tooltip title="My slates">
      <Link className="sb-board-brand" to={user ? '/' : '/start'} aria-label="My slates"><img src="/brand/slatebox.svg" alt="" /></Link>
    </Tooltip>
    <div className="sb-board-name">
      {renaming
        ? <InputBase autoFocus defaultValue={title} className="sb-board-rename"
            inputProps={{ 'aria-label': 'Slate name', maxLength: slate?.workshopTitled ? 120 : 200 }}
            onFocus={e => e.target.select()}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(e.currentTarget.value) }
              if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename() }
            }}
            onBlur={e => commitRename(e.currentTarget.value)} />
        : <ButtonBase ref={titleButton} className="sb-board-title" aria-label={`${name}${narrow && presence ? `, ${presence}` : ''}, slate menu`} aria-haspopup="menu"
            aria-expanded={Boolean(slateMenu)} onClick={e => setSlateMenu(e.currentTarget)} disabled={!slate}>
            {slateLabel}<ExpandMore fontSize="small" aria-hidden="true" />
          </ButtonBase>}
      {!narrow && visibility && (owner
        ? <ButtonBase className="sb-board-privacy" onClick={onShare} aria-label={`${visibility}. Change who can see this slate`}>
            {privacy.isPublic ? <Public /> : <Lock />}{visibility}</ButtonBase>
        : <span className="sb-board-privacy">{privacy.isPublic ? <Public /> : <Lock />}{visibility}</span>)}
      {!narrow && credit && <Box component={Link} to={credit.href} data-library-credit="" title={credit.text}
        sx={{ ml: 1, minWidth: 0, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, color: 'var(--sb-ink2)', textDecoration: 'underline', textUnderlineOffset: '0.15em' }}>
        {credit.text}</Box>}
    </div>
    <div ref={setBuilderSlot} className="sb-board-builder" />

    {!narrow && others > 0 && <ButtonBase className="sb-board-peers" aria-haspopup="dialog" aria-expanded={Boolean(peopleAnchor)}
      aria-label={`People on this slate: you and ${others} other${others > 1 ? 's' : ''}`} onClick={e => setPeopleAnchor(e.currentTarget)}>
      {people.slice(0, 3).map(p => <Avatar key={p.key} name={peerName(p)} colour={p.color} size={28} />)}
      {others > 3 && <span className="sb-board-more">+{others - 3}</span>}
    </ButtonBase>}
    <Popover open={Boolean(peopleAnchor)} anchorEl={peopleAnchor} onClose={() => setPeopleAnchor(null)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} transformOrigin={{ vertical: 'top', horizontal: 'center' }}
      slotProps={{ paper: { role: 'dialog', 'aria-label': 'On this slate', sx: { width: 280, mt: 1, p: 2, pb: 1 } } }}>
      <Typography variant="overline" component="h2" sx={{ fontWeight: 700, lineHeight: 1.5 }}>On this slate</Typography>
      <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 0 }}>{peerList}</Box>
      {owner && <><Divider sx={{ my: 1 }} />
        <Button fullWidth color="inherit" startIcon={<GroupAdd />} sx={{ justifyContent: 'flex-start' }}
          onClick={() => { setPeopleAnchor(null); onShare() }}>Invite people</Button></>}
    </Popover>

    {!narrow && slate && huddle !== 'disabled' && <HuddleUp />}
    {!narrow && canAsk && <Button className="sb-ask" data-conversation-toggle color="inherit" variant="outlined" aria-pressed={Boolean(askOpen)}
      startIcon={<AutoAwesome />} aria-label="Ask Slatebox" onClick={() => { setAskOpen(toggledConversation({ open: askOpen, arrival: askArrival, now: performance.now() })); setAskArrival(null) }}><span className="sb-btn-text">Ask Slatebox</span></Button>}
    {presentButton}
    {owner && <Button className="sb-board-share" variant="contained" color="primary" disableElevation onClick={onShare}>Share</Button>}
    {!narrow && !owner && slate && (privacy.isPublic || privacy.isUnlisted) &&
      <Button color="inherit" variant="outlined" startIcon={<LinkIcon />} onClick={copyLink}>Copy link</Button>}
    {!narrow && <span className="sb-board-divider" aria-hidden="true" />}
    {!narrow && user && !guest && <MessagesMenu />}
    {!narrow && guest && <Button className="sb-save-work" variant="outlined" color="inherit" startIcon={<Save />} onClick={saveYourWork}
      aria-label="Save your work"><span className="sb-save-long">Save your work</span><span className="sb-save-short" aria-hidden="true">Save</span></Button>}
    {!user && <Button color="inherit" variant="outlined" startIcon={narrow ? undefined : <Login />} onClick={() => navigate('/login')}>Sign in</Button>}
    <AccountMenu sheet={narrow} />

    <HeaderMenu label="Slate" sheet={narrow} anchorEl={slateMenu} open={Boolean(slateMenu)} onClose={closeSlateMenu} width={240}
      onExited={() => { const next = afterSlateMenu.current; afterSlateMenu.current = null; next?.() }}
      heading={narrow ? <Box sx={{ pb: .5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
          <Typography component="h2" sx={{ fontWeight: 800, fontSize: 18 }}>{name}</Typography>
          {visibility && <span className="sb-board-privacy">{privacy.isPublic ? <Public /> : <Lock />}{visibility}</span>}
        </Box>
        <Typography variant="body2" sx={{ color: 'shell.secondaryInk', mt: .5 }}>
          On this slate: {['you', ...people.map(peerName)].join(', ')}</Typography>
      </Box> : null}>
      {slateItems.map((item, i) => item === 'divider' ? <Divider key={'d' + i} /> : menuItem(item, closeSlateMenu))}
    </HeaderMenu>
    <HeaderMenu label="Present" sheet={narrow} anchorEl={presentMenu} open={Boolean(presentMenu)} onClose={() => setPresentMenu(null)}
      align="right" width={290} heading={narrow ? <Typography component="h2" sx={{ fontWeight: 800, fontSize: 18 }}>Present</Typography> : null}>
      {presentItems.map(item => menuItem(item, () => setPresentMenu(null)))}
    </HeaderMenu>

    {live.view}
    <Snackbar open={Boolean(told)} autoHideDuration={4000} onClose={() => setTold('')} message={told}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }} ContentProps={{ role: 'status' }} />
    {projection && <Dialog fullScreen open onClose={() => setProjection(null)} slotProps={{ paper: { 'aria-label': 'Slate presentation' } }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', p: 1 }}><Button onClick={() => setProjection(null)}>Exit presentation</Button></Box>
      <CreativeSlate shareId={projection.shareId} readOnly onExitPresentation={() => setProjection(null)} />
    </Dialog>}
  </div>
}
