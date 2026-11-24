import React from 'react'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import Button from '@mui/material/Button'

/**
 * "Move anyway?" (owner, 2026-11-23): a drop the board's rules refuse, offered with the rule's sentence. Move anyway
 * moves the card, marked on it with who and when (Undo puts it back); Cancel leaves it where it was. Escape cancels.
 * `ask`: { card, lane, reason } (the engine's WorkshopOverrideAsk).
 */
export default function MoveAnywayDialog({ ask, onAnswer }) {
  return <Dialog open={Boolean(ask)} onClose={() => onAnswer(false)} aria-labelledby="move-anyway-title" aria-describedby="move-anyway-rule" data-move-anyway-dialog="">
    <DialogTitle id="move-anyway-title">Move {ask?.card || 'the card'} to {ask?.lane} anyway?</DialogTitle>
    <DialogContent>
      <DialogContentText id="move-anyway-rule">{ask?.reason}</DialogContentText>
      <DialogContentText variant="body2" sx={{ mt: 1 }}>The card will show who moved it and when. Undo puts it back.</DialogContentText>
    </DialogContent>
    <DialogActions>
      <Button onClick={() => onAnswer(false)}>Cancel</Button>
      <Button variant="contained" onClick={() => onAnswer(true)} autoFocus>Move anyway</Button>
    </DialogActions>
  </Dialog>
}
