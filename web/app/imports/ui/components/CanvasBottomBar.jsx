import React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import { toggledConversation } from '../../api/common/conversation-toggle.mjs'
import { Box, Button } from '@mui/material'
import AutoAwesome from '@mui/icons-material/AutoAwesome'
import ExpandLess from '@mui/icons-material/ExpandLess'
import ExpandMore from '@mui/icons-material/ExpandMore'
import HuddleUp from './HuddleUp'
import { conversationArrival, conversationMinimised, conversationOpen } from '../jotai/atoms'

// Below 1000px wide: the slate's tools in a bar under the canvas (and under "Ask Slatebox" while it
// is open), so nothing is drawn over the canvas and the header keeps one row. On a phone `add` is
// the tool dock folded into "+ Add", first in the bar.
export default function CanvasBottomBar({ conversation, huddle, add = null }) {
  const [isOpen, setOpen] = useAtom(conversationOpen)
  // Minimised while a note is carried (sheet-drag.mjs), it is out of sight: the button opens it again.
  const minimised = useAtomValue(conversationMinimised)
  const open = isOpen && !minimised
  // Pressed as soon as it is in sight, even while the conversation is still on its way.
  const [arrival, setArrival] = useAtom(conversationArrival)
  const toggle = () => { setOpen(toggledConversation({ open, arrival, now: performance.now() })); setArrival(null) }
  return <Box component="section" className="sb-canvas-bar" aria-label="Slate tools"
    sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flex: 'none',
      minHeight: 56, px: 1.5, pb: 'env(safe-area-inset-bottom)', boxSizing: 'border-box',
      bgcolor: 'shell.surface', color: 'shell.ink', borderTop: 1, borderColor: 'shell.border', zIndex: 1200,
      '& [data-conversation-toggle]': { whiteSpace: 'nowrap' },
      // With "+ Add" first, a narrow phone has no room for three labelled controls: Ask Slatebox
      // keeps its words on one line without its sparkle, and the Huddle pill shows its icon and
      // switch (the switch is still named "Huddle").
      ...(add && { '@media (max-width:420px)': {
        '& [data-conversation-toggle] .MuiButton-startIcon': { display: 'none' },
        '& [data-conversation-toggle]': { whiteSpace: 'nowrap', fontSize: 15, px: 1 },
        '& .sb-huddle-bar label > span:not([class])': { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' },
      } }) }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      {add}
      {conversation && <Button color="inherit" data-conversation-toggle aria-pressed={Boolean(open)} onClick={toggle}
        startIcon={<AutoAwesome />} endIcon={open ? <ExpandMore /> : <ExpandLess />}
        sx={{ fontWeight: 700, textTransform: 'none', fontSize: 16, minHeight: 44 }}>Ask Slatebox</Button>}
    </Box>
    {huddle && <HuddleUp variant="bar" />}
  </Box>
}
