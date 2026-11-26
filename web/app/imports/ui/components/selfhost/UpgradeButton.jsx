// The header's entry on a self-hosted install (owner, 2026-11-25), opening the panel with its two
// one-click choices (UpgradePanel):
//   - an administrator of this server: the gold Upgrade (Renew once a kept license has ended);
//   - anyone else: a quiet "Enterprise" link, since every action inside is theirs to ask for, not do;
//   - once enterprise code is unlocked: a small, readable Enterprise chip (Renew in a license's grace
//     days), still opening the panel for the move to Cloud.
// On a phone each collapses to an icon with its name for screen readers, so the header never
// overflows. Nothing on Slatebox Cloud, for guests, or before the server says who is admin.
// Who sees what: imports/api/common/selfhost-options.mjs upgradeOffer (scripts/selfhost-options.test.mjs).
import React from 'react'
import { Meteor } from 'meteor/meteor'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import IconButton from '@mui/material/IconButton'
import Box from '@mui/material/Box'
import useMediaQuery from '@mui/material/useMediaQuery'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import VerifiedIcon from '@mui/icons-material/Verified'
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { upgradeOffer } from '../../../api/common/selfhost-options.mjs'
import useSelfhostStatus, { useEnterpriseGeneration } from './useSelfhostStatus'

const UpgradePanel = React.lazy(() => import('./UpgradePanel'))
const GOLD = '#f2cf87'
const INK = '#193c2f'

// The chip reads at well over 4.5:1 on the header in both themes (ink on the offset tone; in its
// grace days, dark amber on pale amber).
const chipSx = (renew) => (theme) => {
  const dark = theme.palette.mode === 'dark'
  return {
    borderRadius: 999, gap: 0.5, fontSize: 13, fontWeight: 700, flex: 'none', border: '1px solid',
    ...(renew
      ? { bgcolor: dark ? 'rgba(242,207,135,.18)' : '#fdecc8', color: dark ? '#ffe0a4' : '#5a3d00', borderColor: dark ? '#a8853f' : '#c99a3c' }
      : { bgcolor: 'shell.offset', color: 'shell.ink', borderColor: 'shell.border' }),
    '&:hover': { filter: 'brightness(0.97)' },
    '&.Mui-focusVisible': { outline: `2px solid ${dark ? GOLD : INK}`, outlineOffset: 2 },
  }
}

export default function UpgradeButton() {
  useEnterpriseGeneration()
  const status = useSelfhostStatus()
  const [open, setOpen] = React.useState(false)
  const phone = useMediaQuery('(max-width:599px)')
  // Opened from elsewhere (Admin tools › Enterprise features, or ?options=enterprise in the address).
  React.useEffect(() => {
    const openPanel = () => setOpen(true)
    window.addEventListener('slatebox:open-enterprise-options', openPanel)
    if (new URLSearchParams(window.location.search).get('options') === 'enterprise') setOpen(true)
    return () => window.removeEventListener('slatebox:open-enterprise-options', openPanel)
  }, [])
  const offer = upgradeOffer({ settings: Meteor.settings, signedIn: Boolean(status), serverAdmin: status ? status.serverAdmin === true : null, license: status?.license })
  if (offer.show === 'none') return null
  const common = { onClick: () => setOpen(true), 'aria-haspopup': 'dialog', 'data-role': offer.role }
  let entry
  if (offer.show === 'chip') {
    const renew = offer.chip === 'renew'
    const label = renew ? 'Enterprise license ending: renew' : 'Enterprise features are on'
    entry = phone ? (
      <IconButton {...common} data-testid="header-enterprise" data-chip={offer.chip} aria-label={label} sx={chipSx(renew)}><VerifiedIcon sx={{ fontSize: 20 }} /></IconButton>
    ) : (
      <ButtonBase {...common} data-testid="header-enterprise" data-chip={offer.chip} aria-label={label} sx={(theme) => ({ ...chipSx(renew)(theme), px: 1.25, py: 0.5 })}>
        <VerifiedIcon sx={{ fontSize: 16 }} />
        <Box component="span">{renew ? 'Renew' : 'Enterprise'}</Box>
      </ButtonBase>
    )
  } else if (offer.role === 'admin') {
    const words = offer.ended ? 'Renew' : 'Upgrade'
    const gold = { bgcolor: GOLD, color: INK, flex: 'none', '&:hover': { bgcolor: '#f7dca4' }, '&.Mui-focusVisible': { boxShadow: `0 0 0 3px ${INK}55` } }
    entry = phone ? (
      <IconButton {...common} data-testid="header-offer" aria-label={offer.ended ? 'Renew enterprise features' : 'Upgrade'} sx={gold}><AutoAwesomeIcon sx={{ fontSize: 20 }} /></IconButton>
    ) : (
      <Button {...common} data-testid="header-offer" startIcon={<AutoAwesomeIcon sx={{ fontSize: '18px !important' }} />}
        sx={{ ...gold, fontWeight: 750, textTransform: 'none', borderRadius: 999, px: 2, py: 0.5 }}>
        {words}
      </Button>
    )
  } else {
    // A member cannot act: a quiet way in to what enterprise adds, never a sales pill.
    entry = phone ? (
      <IconButton {...common} data-testid="header-offer" aria-label="Enterprise features" sx={{ color: 'shell.secondaryInk', flex: 'none' }}><InfoOutlinedIcon /></IconButton>
    ) : (
      <Button {...common} data-testid="header-offer" startIcon={<InfoOutlinedIcon sx={{ fontSize: '18px !important' }} />}
        sx={{ color: 'shell.secondaryInk', fontWeight: 600, textTransform: 'none', flex: 'none', borderRadius: 999, px: 1.25 }}>
        Enterprise
      </Button>
    )
  }
  return <>
    {entry}
    {open && (
      <React.Suspense fallback={null}>
        <UpgradePanel open={open} onClose={() => setOpen(false)} status={status} role={offer.role} unlocked={offer.show === 'chip'} />
      </React.Suspense>
    )}
  </>
}
