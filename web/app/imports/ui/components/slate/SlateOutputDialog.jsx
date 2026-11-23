import React from 'react'
import PropTypes from 'prop-types'
import { useAtom } from 'jotai'
import { Dialog, DialogContent, DialogTitle, IconButton, Tooltip } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import SlateExport from './SlateExport'
import SlateEmbed from './SlateEmbed'
import slateProps from '../../propTypes/slateProps'
import { slateOutputOpen } from '../../jotai/atoms'

const titles = { export: 'Export', embed: 'Embed' }

/** Export and Embed, opened from the slate menu (their only place; the slate settings hold neither). */
export default function SlateOutputDialog({ slate, getOrientation, onExport }) {
  const [open, setOpen] = useAtom(slateOutputOpen)
  const close = () => setOpen(null)
  return <Dialog open={Boolean(open)} onClose={close} fullWidth maxWidth="xs" aria-labelledby="sb-slate-output-title">
    <DialogTitle id="sb-slate-output-title" sx={{ pr: 6 }}>{titles[open]}</DialogTitle>
    <Tooltip title="Close"><IconButton aria-label="Close" onClick={close} sx={{ position: 'absolute', right: 8, top: 8 }}><CloseIcon /></IconButton></Tooltip>
    <DialogContent>
      {open === 'export' && <SlateExport slate={slate} onExport={onExport} />}
      {open === 'embed' && <SlateEmbed slate={slate} getOrientation={getOrientation} />}
    </DialogContent>
  </Dialog>
}

SlateOutputDialog.propTypes = {
  slate: slateProps,
  getOrientation: PropTypes.func.isRequired,
  onExport: PropTypes.func.isRequired,
}
