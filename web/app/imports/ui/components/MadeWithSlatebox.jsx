// The "Made with Slatebox" mark (imports/api/common/made-with.mjs): a small link in a bottom corner
// of a shared or public surface. The surface decides whether its viewer sees it (showMadeWith); this
// component asks the server once whether the mark is on here (madeWith.status: always on Slatebox
// Cloud, a self-hosted server's administrator may hide it) and draws it, clear of the content.
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import { useTheme } from '@mui/material/styles'
import CONSTANTS from '../../api/common/constants'
import { MADE_WITH_LABEL, MADE_WITH_TEXT, madeWithHref } from '../../api/common/made-with.mjs'

let asked = null
/** Whether this server shows the mark: asked once per page load (forget() after an admin change). */
export function madeWithEnabled() {
  if (!asked) {
    asked = Meteor.callAsync(CONSTANTS.methods.madeWith.status).then(
      (answer) => answer?.enabled !== false,
      () => { asked = null; return true },
    )
  }
  return asked
}
madeWithEnabled.forget = () => { asked = null }

export function useMadeWithEnabled() {
  const [enabled, setEnabled] = React.useState(null)
  React.useEffect(() => {
    let live = true
    madeWithEnabled().then((on) => { if (live) setEnabled(on) })
    return () => { live = false }
  }, [])
  return enabled
}

// Where the mark sits: a corner of its surface ('absolute' inside a positioned parent), or 'inline' in a page's flow.
const CORNERS = {
  'bottom-left': { left: { xs: 8, sm: 12 }, bottom: { xs: 8, sm: 12 } },
  'bottom-right': { right: { xs: 8, sm: 12 }, bottom: { xs: 8, sm: 12 } },
  // A presentation with controls: below 900px they can reach the corners, so the mark sits just above them there
  // (the top is the narrative's).
  'present': { right: { xs: 8, sm: 12 }, bottom: { xs: 72, md: 12 } },
}

export default function MadeWithSlatebox({ surface, show = true, placement = 'bottom-left', tone = null, zIndex = 5 }) {
  const enabled = useMadeWithEnabled()
  const theme = useTheme()
  if (!show || enabled !== true) return null
  const dark = (tone || theme.palette.mode) === 'dark'
  const inline = placement === 'inline'
  return (
    <Box
      component="a"
      href={madeWithHref(surface)}
      target="_blank"
      rel="noopener"
      aria-label={MADE_WITH_LABEL}
      data-made-with={surface}
      sx={{
        ...(inline ? { position: 'static', alignSelf: 'flex-start', mt: 3 } : { position: 'absolute', zIndex, ...CORNERS[placement] }),
        display: 'inline-flex', alignItems: 'center', gap: 0.75, maxWidth: 'calc(100% - 16px)',
        px: 1.25, py: 0.5, borderRadius: '999px', textDecoration: 'none', whiteSpace: 'nowrap',
        fontSize: 12, lineHeight: 1.4, fontWeight: 500, letterSpacing: 0.1,
        color: dark ? '#f4f1e8' : '#193c2f',
        bgcolor: dark ? 'rgba(18, 18, 18, 0.78)' : 'rgba(255, 254, 248, 0.92)',
        border: '1px solid', borderColor: dark ? 'rgba(255, 255, 255, 0.18)' : 'rgba(25, 60, 47, 0.18)',
        boxShadow: dark ? '0 2px 10px rgb(0 0 0 / 35%)' : '0 2px 10px rgb(25 53 41 / 12%)',
        backdropFilter: 'blur(6px)', opacity: 0.9, transition: 'opacity 120ms ease',
        '&:hover, &:focus-visible': { opacity: 1, textDecoration: 'underline' },
        '&:focus-visible': { outline: '2px solid', outlineColor: dark ? '#f2ce8b' : '#39604c', outlineOffset: 2 },
        '@media print': { display: 'none' },
      }}
    >
      <Box component="img" src="/images/sb_yellow_boxes.svg" alt="" aria-hidden="true" sx={{ width: 14, height: 14, flex: 'none' }} />
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{MADE_WITH_TEXT}</Box>
    </Box>
  )
}

MadeWithSlatebox.propTypes = {
  surface: PropTypes.oneOf(['share', 'embed', 'present', 'follow', 'library']).isRequired,
  show: PropTypes.bool,
  placement: PropTypes.oneOf(['bottom-left', 'bottom-right', 'present', 'inline']),
  tone: PropTypes.oneOf(['light', 'dark', null]),
  zIndex: PropTypes.number,
}
MadeWithSlatebox.defaultProps = { show: true, placement: 'bottom-left', tone: null, zIndex: 5 }
