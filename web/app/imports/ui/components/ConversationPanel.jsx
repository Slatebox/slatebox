import React, { useEffect, useId, useLayoutEffect, useRef } from 'react'
import { Box, Button, IconButton, Paper, TextField, Tooltip, Typography, useMediaQuery } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { newestTop } from '../common/newestTurn.mjs'
import { useSetAtom } from 'jotai'
import { conversationArrival, conversationIntroSlot } from '../jotai/atoms'
import { arrivalShown } from '../../api/common/conversation-toggle.mjs'

// A short screen: a phone held sideways.
const short = '@media (max-height:500px)'

// A page that reloads to show what was kept asks the message box to take focus when it is back.
const focusKey = 'slatebox:conversation-focus'
export function focusMessageAfterReload(shareId) {
  try { sessionStorage.setItem(focusKey, shareId) } catch { /* Focus is a convenience. */ }
}
function takeFocusAfterReload(shareId) {
  try {
    if (sessionStorage.getItem(focusKey) !== shareId) return false
    sessionStorage.removeItem(focusKey)
    return true
  } catch { return false }
}

/**
 * "Ask Slatebox", the one conversation a slate has: beside the canvas from 1000px wide, under it
 * below that. The header's "Ask Slatebox" toggle (the bottom bar's on a narrow screen) and this ×
 * both close it. The conversation scrolls; the message box (`composer`) stays at the foot of the
 * panel whatever the conversation holds.
 *
 * `anchor`: a conversation ('bottom') sits on the message box and grows up from it, as chat does,
 * and keeps its newest turn in sight (a reply taller than the area opens at the question it answers:
 * common/newestTurn.mjs). What is read from the top (the empty slate's first turn, the
 * library) is anchored at the 'top' and opens there, never scrolled to its foot.
 *
 * The same panel holds other talks with the agent away from a slate (the interview in Profile ›
 * About you): `title` names it, `inline` lays it in the page's column instead of beside a canvas,
 * and `returnFocus` is the control × gives focus back to (the one that opened it). `headingLevel`
 * puts its name under the page's own heading (h3 inside a section); inline, the name can take focus
 * (data-conversation-title), so the talk can be announced the moment it opens.
 */
export default function ConversationPanel({ onClose, children, composer, anchor = 'bottom', title = 'Ask Slatebox', inline = false, returnFocus = '[data-conversation-toggle]', headingLevel = 'h2' }) {
  const history = useRef(null)
  const grown = useRef(0)
  // In sight: a conversation the slate opened by itself is here now (its button closes it after a moment).
  const setArrival = useSetAtom(conversationArrival)
  // A builder slate's first words (BuildBar) are drawn here, under the heading, rather than over the canvas.
  const setIntroSlot = useSetAtom(conversationIntroSlot)
  useLayoutEffect(() => { setArrival(arrival => arrivalShown(arrival, performance.now())) }, [])
  // The newest of the conversation is at its foot, just above the message box: keep it in sight
  // as the conversation grows (and leave alone someone reading further up while nothing is added).
  useLayoutEffect(() => {
    const el = history.current
    if (!el) return
    if (anchor !== 'bottom') {
      // Read from the top: opened (or switched to) at its top; the next conversation scrolls afresh.
      if (grown.current !== -1) el.scrollTop = 0
      grown.current = -1
      return
    }
    if (el.scrollHeight === grown.current) return
    grown.current = el.scrollHeight
    el.scrollTop = newestTop(el) ?? el.scrollHeight
  })
  const wide = '@media (min-width:1000px)'
  // Closed with ×: focus goes back to the "Ask Slatebox" button that opens it (the header's, or the
  // bar's on a narrow screen), not to the page.
  const close = () => {
    onClose()
    requestAnimationFrame(() => document.querySelector(returnFocus)?.focus())
  }
  // In a page's column: as wide as the column, a bordered card of its own height, under nothing.
  const placed = inline ? {zIndex:'auto',width:'100%',height:'min(70dvh, 640px)',maxHeight:'none',border:1,borderColor:'divider',borderRadius:2,[wide]:{width:'100%'}} : {}
  return <Paper component="aside" square={!inline} elevation={inline ? 0 : 3} aria-label={title} sx={{position:'relative',zIndex:1200,flexShrink:0,boxSizing:'border-box',
    display:'flex',flexDirection:'column',minHeight:0,width:'auto',borderTop:1,borderColor:'divider',
    // Under the canvas, it leaves the canvas at least 130px (after the header, the bar under it and an
    // unanswered cookie notice), so what a preview draws can be seen before it is kept; but it keeps
    // 130px itself, for the reason and Keep and Discard.
    maxHeight:'min(57dvh, max(130px, calc(100dvh - 250px - var(--sb-cookie-room, 0px))))',
    // Held sideways, it takes all of that, and the conversation gets what the message box leaves.
    '@media (max-height:500px) and (max-width:999.98px)':{height:'min(57dvh, max(130px, calc(100dvh - 250px - var(--sb-cookie-room, 0px))))'},
    [wide]:{width:344,maxHeight:'none',borderTop:0},...placed}}>
    <Box sx={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:1,flex:'none',px:2.5,pt:1.5,pb:.5,[wide]:{pt:2.5},[short]:{pt:.5,pb:0}}}>
      <Typography component={headingLevel} variant="h6" tabIndex={inline ? -1 : undefined} data-conversation-title={inline ? '' : undefined} sx={inline ? {outline:'none'} : undefined}>{title}</Typography>
      <Tooltip title="Close"><IconButton aria-label="Close conversation" onClick={close} sx={{mr:-1}}><CloseIcon /></IconButton></Tooltip>
    </Box>
    <Box ref={setIntroSlot} data-conversation-intro="" sx={{flex:'none',px:2.5,'&:empty':{display:'none'}}} />
    {/* On a short screen the message box and its Keep and Discard come first; the conversation has what is left. */}
    {/* A column, so a short conversation can sit at its foot (an auto top margin, which never hides what overflows). */}
    <Box ref={history} data-conversation-history={anchor} sx={{flex:'1 1 auto',minHeight:0,overflowY:'auto',overscrollBehavior:'contain',px:2.5,
      display:'flex',flexDirection:'column',[short]:{flexBasis:0}}}>
      <Box sx={{ mt: anchor === 'bottom' ? 'auto' : 0, flex: 'none', minWidth: 0 }}>{children}</Box>
    </Box>
    {composer && <Box sx={{flex:'none',borderTop:1,borderColor:'divider',px:2.5,pt:1.5,pb:'max(12px, env(safe-area-inset-bottom))',[wide]:{pb:2},
      // On a short screen (a phone held sideways) the message box scrolls rather than push the panel past its height.
      [short]:{flex:'0 1 auto',minHeight:0,overflowY:'auto',pt:1,pb:'max(8px, env(safe-area-inset-bottom))'}}}>{composer}</Box>}
  </Paper>
}

/**
 * The message box and what goes with it. While the conversation cannot take a message (a
 * preview waits for Keep or Discard, a preview is being prepared, a change is being saved) the
 * box stays where it is, disabled, with the reason beside it and the way out (`hold.actions`).
 * When that ends the box is enabled and takes focus again.
 */
export function ConversationComposer({ shareId, inputRef, value, onChange, onSubmit, hold, canSubmit, submitLabel = 'Preview changes',
  placeholder, helperText, maxLength, prompt, starters, error, extra }) {
  const reasonId = useId()
  const isShort = useMediaQuery(short.slice('@media '.length))
  const actions = useRef(null)
  const reasonRef = useRef(null)
  const held = Boolean(hold)
  const wasHeld = useRef(held)
  // Whether keyboard focus is in the message form. A control removed while focused (Cancel, when
  // the preview arrives) fires no blur, so this still says where the person was.
  const focusInForm = useRef(false)
  // What holds the box changes too (preparing, then a preview to keep, then saving, or a preview
  // the drawing has moved on from); each time, its controls change under the person's focus.
  const holdReason = hold?.reason ?? null
  useEffect(() => {
    const was = wasHeld.current
    wasHeld.current = held
    if (!held) {
      if (was) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
      return undefined
    }
    // The box is off. Someone whose focus was in the message form, on the box or on a control that
    // has just gone or been turned off, lands on the way out instead of on nothing (with no way out
    // to press yet, on the reason). Focus anywhere else is left where it is.
    const frame = requestAnimationFrame(() => {
      const el = document.activeElement
      const lost = !el || el === document.body || !el.isConnected || el.disabled || el === inputRef.current
      if (!focusInForm.current || !lost) return
      const target = actions.current?.querySelector('button:not([disabled])') ?? reasonRef.current
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [held, holdReason, inputRef])
  useEffect(() => {
    if (shareId && takeFocusAfterReload(shareId)) requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }))
  }, [shareId, inputRef])
  // Sent while the conversation is still getting ready (checking what this account can do, the board
  // still saving): it goes as soon as it is ready, never dropped with its words left in the box.
  // Typing again first takes it back; the next Enter sends what is there then.
  const waiting = useRef(false)
  useEffect(() => {
    if (!waiting.current || held || !canSubmit) return
    waiting.current = false
    onSubmit()
  }, [canSubmit, held])
  const submit = event => {
    event.preventDefault()
    if (held) return
    if (canSubmit) onSubmit()
    else if (value?.trim()) waiting.current = true
  }
  return <Box component="form" aria-label="Message Slatebox" onSubmit={submit}
    onFocus={() => { focusInForm.current = true }}
    onBlur={event => {
      // Focus lost because its control was turned off or taken away is not the person leaving.
      if (event.relatedTarget === null && (event.target.disabled || !event.target.isConnected)) return
      if (!event.currentTarget.contains(event.relatedTarget)) focusInForm.current = false
    }}>
    {held ? <Box ref={actions} sx={{display:'flex',flexWrap:'wrap',alignItems:'center',columnGap:1,rowGap:.5,mb:1}}>
      <Typography id={reasonId} ref={reasonRef} tabIndex={-1} role="status" variant="body2" sx={{flex:'1 1 100%',fontWeight:600,outline:'none'}}>{hold.reason}</Typography>
      {hold.actions}
    </Box> : <Box sx={{[short]:{display:'none'}}}>
      {prompt && <Typography variant="body2" sx={{fontWeight:600}}>{prompt}</Typography>}
      {starters}
    </Box>}
    {/* 12px between what sits above the box ("Add to this slate", the selected object) and the box,
        whose label rises about 8px above it (boards S1). */}
    {extra && <Box data-composer-extra sx={{ mb: 1.5 }}>{extra}</Box>}
    <TextField inputRef={inputRef} label="Message Slatebox" multiline minRows={isShort ? 1 : 2} maxRows={6} fullWidth size="small" value={value}
      // On a short screen the box is left out while it is off, so the reason and Keep and Discard fit.
      sx={held ? {[short]:{display:'none'}} : undefined}
      disabled={held} placeholder={placeholder} helperText={held ? undefined : helperText}
      // The label always sits on the outline: a multiline box's label otherwise lies over its placeholder or its text.
      slotProps={{ htmlInput: { maxLength, 'aria-describedby': held ? reasonId : undefined }, inputLabel: { shrink: true } }}
      onChange={event => { waiting.current = false; onChange(event.target.value) }}
      onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.target.form?.requestSubmit() } }} />
    {error && <Typography role="alert" color="error" variant="body2" sx={{mt:.5}}>{error}</Typography>}
    {!held && <Box sx={{display:'flex',justifyContent:'flex-end',mt:.5}}>
      <Button type="submit" variant="contained" size="small" disabled={!canSubmit}>{submitLabel}</Button>
    </Box>}
  </Box>
}
