import React, { useEffect, useRef } from 'react'
import Dialog from '@mui/material/Dialog'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'

/**
 * The presenter's frame: the whole screen. It asks the browser for full screen (the Fullscreen
 * API, on the page so the presenter's own menus stay visible) and, where that is refused (an
 * embed without permission, a browser that says no), it still fills the viewport. Escape exits,
 * and so does the Exit button. Leaving the browser's full screen (its own Escape) exits too,
 * unless `keepOutOfFullScreen`: a live presentation is not ended for everyone because this one
 * screen left full screen; it stays open in the page until it is ended or left.
 * `escapeExits` false: Escape does not exit (ending a live presentation for everyone takes its
 * button, not a second press of the key that left full screen).
 */
export default function PresenterFrame({ open, label = 'Presentation', title, status, exitLabel = 'Exit presentation', onExit,
  keepOutOfFullScreen = false, escapeExits = true, background, error, immersive = false, children }) {
  const exit = useRef(onExit)
  exit.current = onExit
  useEffect(() => {
    if (!open) return undefined
    let entered = false
    let done = false
    const root = document.documentElement
    if (root.requestFullscreen && !document.fullscreenElement) {
      root.requestFullscreen({ navigationUI: 'hide' }).then(() => {
        entered = true
        // Closed before the browser granted it: leave the full screen this frame asked for.
        if (done && document.fullscreenElement === root) document.exitFullscreen().catch(() => {})
      }, () => {})
    }
    // The browser's own way out of full screen (Escape, its button) ends the presentation too.
    const changed = () => {
      if (entered && !document.fullscreenElement && !done && !keepOutOfFullScreen) { done = true; exit.current?.() }
    }
    document.addEventListener('fullscreenchange', changed)
    return () => {
      done = true
      document.removeEventListener('fullscreenchange', changed)
      // Only the full screen this frame entered is left; one the page was already in stays.
      if (entered && document.fullscreenElement === root) document.exitFullscreen().catch(() => {})
    }
  }, [open, keepOutOfFullScreen])

  return <Dialog fullScreen open={Boolean(open)} disableEscapeKeyDown={!escapeExits} onClose={() => onExit?.()}
    slotProps={{ paper: { 'aria-label': label, sx: { background: background || 'background.default', display: 'flex', flexDirection: 'column' } } }}>
    {/* A styled deck is full bleed: the bar floats over its corner (the slate's name stays for a
        screen reader), so the deck's own colour fills the screen. */}
    <Box component="header" className={`sb-presenter-bar${immersive ? ' sb-presenter-bar-immersive' : ''}`} sx={immersive ? {
      position: 'absolute', top: { xs: 8, sm: 12 }, right: { xs: 8, sm: 12 }, zIndex: 20, display: 'flex', alignItems: 'center', gap: 1,
      pl: status ? 1.5 : 0.5, pr: 0.5, minHeight: 36, borderRadius: '999px', bgcolor: 'rgba(0,0,0,.42)', color: '#fff', backdropFilter: 'blur(10px)',
    } : { display: 'flex', alignItems: 'center', gap: 1, px: { xs: 1, sm: 2 }, minHeight: 48,
      bgcolor: 'shell.main', color: '#fff', flex: '0 0 auto', minWidth: 0 }}>
      {/* On a phone the status (which viewpoint) wins over the slate's name. */}
      <Typography component="h2" noWrap sx={immersive ? { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' } : { fontWeight: 700, fontSize: 16, minWidth: 0, flex: '0 1 auto',
        display: status ? { xs: 'none', sm: 'block' } : 'block' }}>{title}</Typography>
      {status && <Typography role="status" noWrap variant="body2" sx={{ opacity: .85, minWidth: 0, flex: '1 1 auto' }}>{status}</Typography>}
      {!immersive && <Box sx={{ flex: status ? '0 0 auto' : '1 1 auto' }} />}
      <Button color="inherit" size="small" aria-label={exitLabel} startIcon={<CloseIcon />} onClick={() => onExit?.()}
        sx={{ flex: '0 0 auto', minWidth: 0, borderRadius: immersive ? '999px' : undefined, '& .MuiButton-startIcon': { mr: immersive ? 0 : { xs: 0, sm: 1 } } }}>
        <Box component="span" sx={{ display: immersive ? 'none' : { xs: status ? 'none' : 'inline', sm: 'inline' } }}>{exitLabel}</Box>
      </Button>
    </Box>
    {error && <Typography role="alert" variant="body2" sx={{ px: 2, py: .5, bgcolor: 'error.main', color: 'error.contrastText' }}>{error}</Typography>}
    <Box component="main" sx={{ position: 'relative', flex: '1 1 auto', minHeight: 0, overflow: 'hidden' }}>
      {children}
    </Box>
  </Dialog>
}
