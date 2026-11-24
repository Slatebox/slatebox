import React, { useCallback, useEffect, useState } from 'react'
import Box from '@mui/material/Box'

// The cookie notice: "Cookies keep you signed in." with Got it. Owner report (2026-11-23): on phones the bar could stay
// over the foot of the screen after Got it was tapped. Three things make it go for good, on every phone:
// - Got it answers on the finger's lift (touchend, which also stops the tap from landing on whatever lies under the bar
//   once it is gone: no ghost tap on a board control) as well as on a click (a mouse, a keyboard, a screen reader);
// - the answer is kept twice, in the cookie the earlier notice used (CookieConsent=true, so nobody who answered is
//   asked again) and in localStorage, so a browser that drops one (an in-app browser, a strict privacy mode) still
//   remembers it; another tab hears it and lets its notice go too;
// - gone, it is out of the page, so the room the canvas pages keep for it at their foot (main.css
//   body:has(.sb-cookie)) is given back at once.
// It lies above the canvas and its bar, under every sheet, menu and dialog (they come from the foot of a phone too),
// so it never covers a control.

import { answerCookieNotice, cookieNoticeAnswered, COOKIE_NOTICE_KEY as KEY } from '../../api/common/cookie-notice.mjs'

export default function CookieNotice({ sx }) {
  const [answered, setAnswered] = useState(() => typeof document === 'undefined' || cookieNoticeAnswered())
  useEffect(() => {
    if (answered) return undefined
    // Answered in another tab: this one lets its notice go too.
    const heard = event => { if (event.key === KEY && event.newValue === 'answered') setAnswered(true) }
    window.addEventListener('storage', heard)
    return () => window.removeEventListener('storage', heard)
  }, [answered])
  const answer = useCallback(() => {
    answerCookieNotice()
    setAnswered(true)
  }, [])
  if (answered) return null
  // A press on the notice is the notice's own: the canvas under it never starts a pan or a selection from it.
  const own = event => event.stopPropagation()
  return (
    <Box className="CookieConsent sb-cookie" role="region" aria-label="Cookie notice" data-cookie-notice="" sx={sx}
      onPointerDown={own} onTouchStart={own} onMouseDown={own}>
      <p className="sb-cookie-text">Cookies keep you signed in.</p>
      <button id="rcc-confirm-button" type="button"
        onClick={event => { own(event); answer() }}
        onTouchEnd={event => { own(event); if (event.cancelable) event.preventDefault(); answer() }}>
        Got it
      </button>
    </Box>
  )
}
