// The header's button on a self-hosted install (owner, 2026-11-25): Upgrade, opening the panel
// with its two one-click choices (UpgradePanel). An administrator of this server acts; anyone else
// sees the same reasons and is told to ask their admin. Once enterprise code is unlocked, a small
// Enterprise chip takes its place (Renew in a license's grace days), still opening the panel for
// the move to Cloud. Nothing on Slatebox Cloud, for guests, or before the server says who is admin.
// Who sees what: imports/api/common/selfhost-options.mjs upgradeOffer (scripts/selfhost-options.test.mjs).
import React from 'react'
import { Meteor } from 'meteor/meteor'
import Button from '@mui/material/Button'
import ButtonBase from '@mui/material/ButtonBase'
import Box from '@mui/material/Box'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import VerifiedIcon from '@mui/icons-material/Verified'
import { upgradeOffer } from '../../../api/common/selfhost-options.mjs'
import useSelfhostStatus, { useEnterpriseGeneration } from './useSelfhostStatus'

const UpgradePanel = React.lazy(() => import('./UpgradePanel'))

export default function UpgradeButton() {
  useEnterpriseGeneration()
  const status = useSelfhostStatus()
  const [open, setOpen] = React.useState(false)
  // Opened from elsewhere (Admin tools › Enterprise features, or ?options=enterprise in the address).
  React.useEffect(() => {
    const openPanel = () => setOpen(true)
    window.addEventListener('slatebox:open-enterprise-options', openPanel)
    if (new URLSearchParams(window.location.search).get('options') === 'enterprise') setOpen(true)
    return () => window.removeEventListener('slatebox:open-enterprise-options', openPanel)
  }, [])
  const offer = upgradeOffer({ settings: Meteor.settings, signedIn: Boolean(status), serverAdmin: status ? status.serverAdmin === true : null, license: status?.license })
  if (offer.show === 'none') return null
  return <>
    {offer.show === 'offer' ? (
      <Button onClick={() => setOpen(true)} data-testid="header-offer" data-role={offer.role} aria-haspopup="dialog"
        startIcon={<AutoAwesomeIcon sx={{ fontSize: '18px !important' }} />}
        sx={{ bgcolor: '#f2cf87', color: '#193c2f', fontWeight: 750, textTransform: 'none', borderRadius: 999, px: 2, py: 0.5, flex: 'none',
          '&:hover': { bgcolor: '#f7dca4' }, '&.Mui-focusVisible': { boxShadow: '0 0 0 3px rgba(242,207,135,.55)' } }}>
        Upgrade
      </Button>
    ) : (
      <ButtonBase onClick={() => setOpen(true)} data-testid="header-enterprise" data-chip={offer.chip} aria-haspopup="dialog"
        aria-label={offer.chip === 'renew' ? 'Enterprise license ending: renew' : 'Enterprise features are on'}
        sx={{ borderRadius: 999, px: 1.25, py: 0.4, gap: 0.5, border: '1px solid rgba(242,207,135,.6)', color: '#f2cf87', fontSize: 13, fontWeight: 700, flex: 'none',
          '&.Mui-focusVisible': { boxShadow: '0 0 0 2px #f2cf87' } }}>
        <VerifiedIcon sx={{ fontSize: 16 }} />
        <Box component="span">{offer.chip === 'renew' ? 'Renew' : 'Enterprise'}</Box>
      </ButtonBase>
    )}
    {open && (
      <React.Suspense fallback={null}>
        <UpgradePanel open={open} onClose={() => setOpen(false)} status={status} role={offer.role} unlocked={offer.show === 'chip'} />
      </React.Suspense>
    )}
  </>
}
