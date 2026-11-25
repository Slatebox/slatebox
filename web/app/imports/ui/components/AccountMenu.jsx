import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useNavigate } from 'react-router-dom'
import { useSetAtom } from 'jotai'
import { Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider, ListItemIcon,
  ListItemText, MenuItem, Tooltip, Typography } from '@mui/material'
import { useColorScheme } from '@mui/material/styles'
import AccountCircle from '@mui/icons-material/AccountCircle'
import Brightness4 from '@mui/icons-material/Brightness4'
import Logout from '@mui/icons-material/Logout'
import Login from '@mui/icons-material/Login'
import Save from '@mui/icons-material/Save'
import Savings from '@mui/icons-material/Savings'
import AdminPanelSettings from '@mui/icons-material/AdminPanelSettings'
import HeaderMenu from './HeaderMenu'
import useServerAdmin from '../common/useServerAdmin'
import { adminLinksFor } from '../../api/common/server-admin.mjs'
import { signOut as signOutAndLeave } from '../../api/client/signOut'
import { registrationDetails, mainDrawerOpen } from '../jotai/atoms'

// Only a server with a meter (Slatebox Cloud) has credits, a balance and Slatebox Pro to show.
const metered = () => Meteor.settings.public.metered === true

// A person's whole name for the account menu (the shorter app-wide form is cut at 10 characters).
export const displayName = (u) => {
  if (!u || u.isAnonymous) return 'Guest'
  const full = [u.profile?.firstName, u.profile?.lastName].filter(Boolean).join(' ').trim()
  return full || u.emails?.[0]?.address?.split('@')[0] || 'Guest'
}

export const initials = (name) => (name || 'Guest').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'G'

// `colour`, a person's own (the colour of their pointer on the canvas), rings the circle.
export function Avatar({ name, size = 32, faded, colour }) {
  return <Box component="span" aria-hidden="true" sx={{ display: 'grid', placeItems: 'center', width: size, height: size, borderRadius: '50%',
    bgcolor: '#c8dcb8', color: '#1d3326', fontWeight: 800, fontSize: size * .4, letterSpacing: '.02em', flex: 'none', opacity: faded ? .9 : 1,
    ...(colour && { boxShadow: `inset 0 0 0 2px ${colour}` }) }}>
    {initials(name)}</Box>
}

// Open the registration dialog: a guest keeps the slates they made by creating an account.
export function useSaveYourWork() {
  const setRegistrationDetails = useSetAtom(registrationDetails)
  return () => setRegistrationDetails({
    type: 'registration',
    registrationOpen: true,
    registrationMessage: 'Save your work: create an account to keep your slates.',
  })
}

// The Dark mode item's switch, drawn only: the item itself is the checkbox, so there is no second control inside it.
function SwitchLook({ on }) {
  return <Box component="span" aria-hidden="true" sx={{ ml: 1, width: 30, height: 16, borderRadius: 8, flex: 'none', position: 'relative',
    bgcolor: on ? 'secondary.main' : 'action.disabled', transition: 'background-color .15s' }}>
    <Box component="span" sx={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 12, height: 12, borderRadius: '50%',
      bgcolor: '#fff', transition: 'left .15s' }} />
  </Box>
}

// You, at the far right of the header: an initials avatar and its menu. A guest's menu saves their
// work and has no Sign out, which would leave their slates behind. Signing in to another account
// leaves them behind too, so a guest is told so first and offered to save their work instead.
export default function AccountMenu({ sheet = false }) {
  const navigate = useNavigate()
  const [anchorEl, setAnchorEl] = React.useState(null)
  const [leaving, setLeaving] = React.useState(false)
  const setMainDrawerOpen = useSetAtom(mainDrawerOpen)
  const saveYourWork = useSaveYourWork()
  const { mode, systemMode, setMode } = useColorScheme()
  // An administrator of this server (the server answers; it checks again on every admin page)
  const admin = useServerAdmin()
  const [adminHome] = adminLinksFor(admin)
  const { user, name, email } = useTracker(() => {
    const u = Meteor.user()
    return { user: u, name: displayName(u), email: u && !u.isAnonymous ? u.emails?.[0]?.address : null }
  })
  if (!user) return null
  const guest = Boolean(user.isAnonymous)
  const dark = (mode === 'system' ? systemMode : mode) === 'dark'
  const close = () => setAnchorEl(null)
  const go = (action) => () => { close(); action() }
  // Signing out always ends on the sign-in page: no guest, no new slate (imports/api/common/sign-out.mjs).
  const signOut = () => { setMainDrawerOpen(false); signOutAndLeave() }

  return <>
    <Tooltip title={guest ? 'Your account (guest)' : 'Your account'}>
      <ButtonBase aria-label={`Account, ${name}`} aria-haspopup="menu" aria-expanded={Boolean(anchorEl)}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{ borderRadius: '50%', p: '4px', flex: 'none', '&.Mui-focusVisible, &[aria-expanded="true"]': { boxShadow: '0 0 0 2px #f2cf87' } }}>
        <Avatar name={name} />
      </ButtonBase>
    </Tooltip>
    <HeaderMenu label="Account" sheet={sheet} anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={close} align="right" width={280}
      heading={<><Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Avatar name={name} size={36} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontWeight: 700 }} noWrap>{name}</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }} noWrap component="p">{guest ? 'Not signed in' : email}</Typography>
        </Box>
      </Box>
      {guest && <Typography variant="caption" component="p" sx={{ mt: 1, color: 'text.secondary', maxWidth: 248 }}>
        Save your work to keep your slates in an account.</Typography>}
      </>}>
      {guest && <MenuItem onClick={go(saveYourWork)} sx={{ mx: 1, borderRadius: 1, bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 700,
        '&:hover, &.Mui-focusVisible': { bgcolor: 'primary.dark' } }}>
        <ListItemIcon sx={{ color: 'inherit' }}><Save fontSize="small" /></ListItemIcon>
        <ListItemText disableTypography>Save your work: create an account</ListItemText>
      </MenuItem>}
      {guest && <MenuItem onClick={go(() => setLeaving(true))}>
        <ListItemIcon><Login fontSize="small" /></ListItemIcon><ListItemText>Sign in</ListItemText>
      </MenuItem>}
      {!guest && <MenuItem onClick={go(() => navigate('/profile'))}>
        <ListItemIcon><AccountCircle fontSize="small" /></ListItemIcon><ListItemText>Profile</ListItemText>
      </MenuItem>}
      {!guest && metered() && <MenuItem onClick={go(() => navigate('/profile?tab=credits'))}>
        <ListItemIcon><Savings fontSize="small" /></ListItemIcon><ListItemText>Credits</ListItemText>
      </MenuItem>}
      {!guest && adminHome && <MenuItem onClick={go(() => navigate(adminHome.to))} data-account-admin="">
        <ListItemIcon><AdminPanelSettings fontSize="small" /></ListItemIcon><ListItemText>Admin</ListItemText>
      </MenuItem>}
      <Divider />
      <MenuItem role="menuitemcheckbox" aria-checked={dark} onClick={() => setMode(dark ? 'light' : 'dark')}>
        <ListItemIcon><Brightness4 fontSize="small" /></ListItemIcon>
        <ListItemText>Dark mode</ListItemText>
        <SwitchLook on={dark} />
      </MenuItem>
      {!guest && <Divider />}
      {!guest && <MenuItem onClick={go(signOut)}>
        <ListItemIcon><Logout fontSize="small" /></ListItemIcon><ListItemText>Sign out</ListItemText>
      </MenuItem>}
    </HeaderMenu>
    <Dialog open={leaving} onClose={() => setLeaving(false)} aria-labelledby="sb-guest-leave-title" aria-describedby="sb-guest-leave-text">
      <DialogTitle id="sb-guest-leave-title">Sign in to another account?</DialogTitle>
      <DialogContent>
        <DialogContentText id="sb-guest-leave-text">
          The slates you made as a guest stay with this guest. Once you sign in to another account you cannot open them.
          To keep them, save your work first: it makes this guest an account of its own.
        </DialogContentText>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, pb: 2 }}>
        <Button onClick={() => setLeaving(false)}>Cancel</Button>
        <Button onClick={() => { setLeaving(false); navigate('/login') }}>Sign in anyway</Button>
        <Button autoFocus variant="contained" disableElevation onClick={() => { setLeaving(false); saveYourWork() }}>Save your work first</Button>
      </DialogActions>
    </Dialog>
  </>
}
