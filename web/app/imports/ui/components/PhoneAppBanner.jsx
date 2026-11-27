// On a phone, once per device until dismissed: slates are for viewing here, and the app (or a
// computer) is where they are made and changed. The store buttons come from settings.public.mobile;
// until the app is listed the banner says it is coming soon (phoneView.mjs phoneBanner).
import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useLocation } from 'react-router-dom'
import { useAtomValue } from 'jotai'
import { Alert, Box, Button, Typography } from '@mui/material'
import usePhoneView from '../common/usePhoneView'
import { dismissPhoneBanner, phoneBanner } from '../common/phoneView.mjs'
import { isSlateEmbedded } from '../jotai/atoms'

const storage = () => { try { return window.localStorage } catch { return null } }

// A presentation, an embedded slate or a page inside another site's frame shows the slate alone.
function embeddedView({ pathname, search }) {
  if (pathname.startsWith('/present/')) return true
  if (/^\/canvas\/[^/]+\/[^/]+\/[^/]+/.test(pathname)) return true
  if (new URLSearchParams(search).get('isEmbedded') === 'true') return true
  try { return window.self !== window.top } catch { return true }
}

// While it shows, --sb-phone-banner holds the room it takes, so a page's own top (main.css [data-app-page]) starts
// below it. The canvas lies under it: the slate pans clear of it, and it can be dismissed.
function useRoomFor(ref, shown) {
  React.useLayoutEffect(() => {
    const root = document.documentElement.style
    const el = ref.current
    if (!shown || !el) { root.removeProperty('--sb-phone-banner'); return undefined }
    const place = () => root.setProperty('--sb-phone-banner', `${Math.ceil(el.getBoundingClientRect().height) + 8}px`)
    place()
    const watch = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place)
    watch?.observe(el)
    return () => { watch?.disconnect(); root.removeProperty('--sb-phone-banner') }
  }, [shown])
}

export default function PhoneAppBanner() {
  const phoneView = usePhoneView()
  const location = useLocation()
  const embedded = useAtomValue(isSlateEmbedded)
  const [closed, setClosed] = React.useState(false)
  const banner = React.useMemo(() => phoneBanner({ settings: Meteor.settings, storage: storage() }), [])
  const shown = Boolean(phoneView && !closed && banner && !embedded && !embeddedView(location))
  const ref = React.useRef(null)
  useRoomFor(ref, shown)
  if (!shown) return null
  const dismiss = () => { dismissPhoneBanner(storage()); setClosed(true) }
  return (
    <Alert ref={ref} data-testid="phone-app-banner" role="region" aria-label="Slatebox app" severity="info" icon={false}
      onClose={dismiss} closeText="Dismiss"
      sx={{
        position: 'fixed', zIndex: 1150, top: 'calc(64px + env(safe-area-inset-top))', left: 8, right: 8,
        py: 0.25, px: 1.5, borderRadius: 2, boxShadow: 3, alignItems: 'center',
        '& .MuiAlert-message': { py: 0.75, minWidth: 0 }, '& .MuiAlert-action': { pt: 0, mr: -0.5 },
      }}>
      <Typography component="p" sx={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.3 }}>{banner.text}</Typography>
      <Typography component="p" sx={{ fontSize: 12.5, lineHeight: 1.3 }}>
        {banner.soonLine ? `${banner.editLine} ${banner.soonLine}` : banner.editLine}
      </Typography>
      {banner.stores.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 0.75 }}>
          {banner.stores.map((store) => (
            <Button key={store.href} href={store.href} target="_blank" rel="noopener" size="small" variant="contained"
              disableElevation sx={{ borderRadius: 4, textTransform: 'none' }}>
              {store.label}
            </Button>
          ))}
        </Box>
      )}
    </Alert>
  )
}
