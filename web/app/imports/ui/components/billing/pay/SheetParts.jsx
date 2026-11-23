import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import IconButton from '@mui/material/IconButton'
import Skeleton from '@mui/material/Skeleton'
import Typography from '@mui/material/Typography'
import CloseIcon from '@mui/icons-material/Close'
import { SPACE } from '../../../common/AccountLayout'
import ContactLinkText from '../ContactLinkText'

// The pay sheet's layout parts (mock-sheet.html): header, a body that scrolls, and a footer that
// stays put (sticky on a phone, so Pay never scrolls out of reach). One rhythm with the account
// pages (AccountLayout SPACE).

const offset = theme => (theme.palette.mode === 'dark' ? '#2c4338' : '#edf0e5')
const selected = theme => (theme.palette.mode === 'dark' ? '#3c5344' : '#dce9ce')
export const sheetTone = { offset, selected }

// read by screen readers, not drawn
export const visuallyHidden = { border: 0, clip: 'rect(0 0 0 0)', height: '1px', margin: '-1px', overflow: 'hidden', padding: 0, position: 'absolute', whiteSpace: 'nowrap', width: '1px' }

export function SheetHeader({ eyebrow, title, titleId, onClose, closable }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: SPACE.tight, px: { xs: 2, sm: 3 }, pt: { xs: 1.5, sm: 3 } }}>
      <Box sx={{ minWidth: 0 }}>
        {eyebrow && <Typography component="div" sx={{ fontSize: 12, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'text.secondary' }}>{eyebrow}</Typography>}
        <Typography component="h2" id={titleId} tabIndex={-1} sx={{ mt: SPACE.hair, fontSize: { xs: 20, sm: 22 }, lineHeight: 1.25, fontWeight: 700, outline: 'none' }}>{title}</Typography>
      </Box>
      <IconButton aria-label="Close" onClick={onClose} disabled={!closable} sx={{ mt: -0.75, mr: -1, color: 'text.secondary' }}><CloseIcon /></IconButton>
    </Box>
  )
}
SheetHeader.propTypes = { eyebrow: PropTypes.node, title: PropTypes.node.isRequired, titleId: PropTypes.string.isRequired, onClose: PropTypes.func.isRequired, closable: PropTypes.bool.isRequired }
SheetHeader.defaultProps = { eyebrow: null }

export function SheetBody({ children }) {
  return <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', px: { xs: 2, sm: 3 }, pt: { xs: 1.5, sm: 2 }, pb: 1 }}>{children}</Box>
}
SheetBody.propTypes = { children: PropTypes.node }
SheetBody.defaultProps = { children: null }

export function SheetFooter({ children }) {
  return (
    <Box sx={theme => ({
      flex: 'none', px: { xs: 2, sm: 3 }, pt: 1.5, pb: { xs: 'calc(16px + env(safe-area-inset-bottom))', sm: 3 },
      borderTop: `1px solid ${theme.palette.divider}`, bgcolor: 'background.paper',
      [theme.breakpoints.down('sm')]: { position: 'sticky', bottom: 0, boxShadow: '0 -8px 16px -12px rgba(16,32,24,.35)' },
    })}
    >
      {children}
    </Box>
  )
}
SheetFooter.propTypes = { children: PropTypes.node }
SheetFooter.defaultProps = { children: null }

export function PayButton({ label, busy, busyLabel, disabled, onClick, buttonRef }) {
  return (
    <Button
      ref={buttonRef}
      fullWidth
      variant="contained"
      disabled={disabled || busy}
      onClick={onClick}
      aria-busy={busy || undefined}
      sx={{ height: 48, fontSize: 16, fontWeight: 700, '&.Mui-disabled': busy ? { bgcolor: 'primary.main', color: 'primary.contrastText', opacity: 0.8 } : {} }}
      data-pay-button=""
    >
      {busy ? <><CircularProgress size={16} color="inherit" sx={{ mr: 1 }} aria-hidden />{busyLabel}</> : label}
    </Button>
  )
}
PayButton.propTypes = { label: PropTypes.string.isRequired, busy: PropTypes.bool, busyLabel: PropTypes.string, disabled: PropTypes.bool, onClick: PropTypes.func.isRequired, buttonRef: PropTypes.oneOfType([PropTypes.func, PropTypes.object]) }
PayButton.defaultProps = { busy: false, busyLabel: 'Paying…', disabled: false, buttonRef: null }

export function Fine({ children }) {
  return <Typography component="p" sx={{ fontSize: 12.5, color: 'text.secondary', mt: 1.25, mb: 0, textAlign: 'center' }}>{children}</Typography>
}
Fine.propTypes = { children: PropTypes.node }
Fine.defaultProps = { children: null }

/** Totals: rows of { label, value, muted }, then the bold "Today" row. */
export function Totals({ rows, today, loading }) {
  return (
    <Box sx={theme => ({ borderTop: `1px solid ${theme.palette.divider}`, mt: 0.75, pt: 1.5, fontSize: 14, display: 'grid', gap: 0.5 })} data-pay-totals="">
      {rows.map(r => (
        <Box key={r.key || r.label} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, color: r.muted ? 'text.secondary' : 'text.primary' }}>
          <span>{r.label}</span>
          <span>{loading && !r.value ? <Skeleton width={48} /> : r.value}</span>
        </Box>
      ))}
      {today !== undefined && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, fontSize: 16, mt: 0.5 }}>
          <span>Today</span>
          <span>{loading || !today ? <Skeleton width={56} /> : today}</span>
        </Box>
      )}
    </Box>
  )
}
Totals.propTypes = { rows: PropTypes.arrayOf(PropTypes.shape({ key: PropTypes.string, label: PropTypes.node, value: PropTypes.node, muted: PropTypes.bool })).isRequired, today: PropTypes.node, loading: PropTypes.bool }
Totals.defaultProps = { today: undefined, loading: false }

/** The payment fields while a session is being made. */
export function FieldSkeleton() {
  return (
    <Box aria-hidden sx={theme => ({ borderTop: `1px solid ${theme.palette.divider}`, pt: 2 })}>
      <Skeleton variant="rounded" height={44} sx={{ mb: 1.25, borderRadius: '10px' }} />
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.25 }}>
        <Skeleton variant="rounded" height={44} sx={{ borderRadius: '10px' }} />
        <Skeleton variant="rounded" height={44} sx={{ borderRadius: '10px' }} />
      </Box>
    </Box>
  )
}

/** The error above the card field (role=alert). */
export function PayAlert({ children, alertRef }) {
  return (
    <Box
      ref={alertRef}
      role="alert"
      tabIndex={-1}
      sx={theme => ({
        display: 'flex', gap: 1.25, borderRadius: '10px', px: 1.5, py: 1.25, my: 1.5, fontSize: 13.5, outline: 'none',
        bgcolor: theme.palette.mode === 'dark' ? '#4a2a25' : '#fbebe7', color: theme.palette.mode === 'dark' ? '#ffb4a8' : '#a1352b',
      })}
      data-pay-error=""
    >
      <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" style={{ flex: 'none', marginTop: 1 }}>
        <circle cx="9" cy="9" r="8" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 5v5M9 12.6v.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
      <span>{typeof children === 'string' ? <ContactLinkText text={children} /> : children}</span>
    </Box>
  )
}
PayAlert.propTypes = { children: PropTypes.node, alertRef: PropTypes.oneOfType([PropTypes.func, PropTypes.object]) }
PayAlert.defaultProps = { children: null, alertRef: null }

/** "or pay by card" */
export function OrLine({ children }) {
  return (
    <Box sx={theme => ({ display: 'flex', alignItems: 'center', gap: 1.25, color: 'text.secondary', fontSize: 12, my: 1.5, '&:before, &:after': { content: '""', flex: 1, height: '1px', bgcolor: theme.palette.divider } })}>
      {children}
    </Box>
  )
}
OrLine.propTypes = { children: PropTypes.node }
OrLine.defaultProps = { children: null }

/** A row with a green check, like "What Pro brings". */
export function CheckList({ rows }) {
  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, mb: 2, p: 0, display: 'grid', gap: 0.75, fontSize: 14 }}>
      {rows.map(r => (
        <Box component="li" key={r.text} sx={{ display: 'flex', gap: 1.25 }}>
          <Box component="span" aria-hidden sx={theme => ({ flex: 'none', width: 18, height: 18, mt: '2px', borderRadius: '50%', bgcolor: selected(theme), display: 'grid', placeItems: 'center', color: theme.palette.mode === 'dark' ? '#f2ce8b' : '#254b3b' })}>
            <svg viewBox="0 0 18 18" width="18" height="18"><path d="M5 9.5l2.6 2.5L13 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </Box>
          <span>{r.text}</span>
        </Box>
      ))}
    </Box>
  )
}
CheckList.propTypes = { rows: PropTypes.arrayOf(PropTypes.shape({ text: PropTypes.string })).isRequired }
