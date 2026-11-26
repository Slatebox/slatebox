import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Tabs from '@mui/material/Tabs'
import Typography from '@mui/material/Typography'

// The parts of the account pages (Profile and its tabs, My library, Library review, the admin
// cards): tabs, panels and sections with one left edge. The page itself is AppPage
// (common/AppPage.jsx), the one page layout every page in the app uses. AccountPage below is only
// for the stand-alone pages outside the app's frame (Connect an app, Sign in a device), which
// show one short request in a reading column. Spacing comes from one small scale, in
// theme units of 8px: 0.5 = 4px, 1 = 8px, 1.5 = 12px, 2 = 16px, 3 = 24px, 4 = 32px, 6 = 48px.
export const SPACE = {
  hair: 0.5, // 4px: a label and its own detail
  tight: 1, // 8px: a heading and its first line
  text: 1.5, // 12px: lines, fields and buttons inside a section
  group: 2, // 16px: copy and the buttons under it
  block: 3, // 24px: title to tabs; tab to tab; buttons to the fine print under them
  section: 4, // 32px: tabs to content; section to section
  page: 6, // 48px: the page's own top and side margin on a wide screen
}
// The same scale by a lower-case name, for components whose source keeps clear of capitals
// (the welcome is checked for all-caps words: scripts/first-minute.test.mjs).
export const space = SPACE

// a section's heading on a page of sections (the start page's Yours, Made for you and its jobs): one look for all of them
export const SECTION_HEADING = Object.freeze({ fontWeight: 800, fontSize: { xs: 20, sm: 24 }, letterSpacing: '-.02em', lineHeight: 1.25 })
export const sectionHeading = SECTION_HEADING

// commands and code to copy: monospace, so flags such as --no-install read as typed
export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace'

// the column: readable lines on a wide screen (the stand-alone pages and the admin cards)
export const COLUMN_WIDTH = 760

export function AccountPage({ title, children }) {
  return (
    <Box
      sx={{
        // The main area already pads 24px, so the column starts under the Slatebox logo; on a
        // phone it gives 8px back for a 16px gutter.
        maxWidth: COLUMN_WIDTH,
        mx: { xs: -SPACE.tight, sm: 0 },
        pt: { xs: SPACE.tight, md: SPACE.block },
        pb: SPACE.page,
        minWidth: 0,
      }}
    >
      {title && (
        <Typography component="h1" variant="h5" sx={{ mb: SPACE.block }}>
          {title}
        </Typography>
      )}
      {children}
    </Box>
  )
}

AccountPage.propTypes = {
  title: PropTypes.node,
  children: PropTypes.node,
}

AccountPage.defaultProps = { title: null, children: null }

// The page's tabs: each tab is as wide as its label, SPACE.block apart, so the first label and
// its underline both start on the column's edge (no negative margin to clip at 390px). A
// hairline closes the row, and on a phone the row scrolls instead of widening the page.
export function AccountTabs({ children, ...props }) {
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: SPACE.section, minWidth: 0 }}>
      <Tabs
        variant="scrollable"
        scrollButtons={false}
        indicatorColor="primary"
        textColor="primary"
        sx={{
          minHeight: 44,
          '& .MuiTabs-flexContainer': { gap: SPACE.block },
          '& .MuiTab-root': { minHeight: 44, minWidth: 0, px: 0 },
        }}
        // eslint-disable-next-line react/jsx-props-no-spreading
        {...props}
      >
        {children}
      </Tabs>
    </Box>
  )
}

AccountTabs.propTypes = {
  children: PropTypes.node,
}

AccountTabs.defaultProps = { children: null }

// A tab's content: sections stacked with one rhythm and a hairline between them. Anything
// before the first section (an alert, an intro line) sits SPACE.block above it with no rule;
// everything after the first section, section or not, starts with the rule, so an alert or a
// line of copy between sections never breaks the rhythm.
export function AccountPanel({ children, sx }) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: SPACE.block,
        minWidth: 0,
        '& > section ~ *': {
          borderTop: 1,
          borderColor: 'divider',
          pt: SPACE.section,
          mt: SPACE.tight,
        },
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}

AccountPanel.propTypes = {
  children: PropTypes.node,
  sx: PropTypes.shape({}),
}

AccountPanel.defaultProps = { children: null, sx: {} }

// A section: a heading, its body (lines SPACE.text apart), then its actions and fine print.
// Text: body copy is plain Typography (body1, text.primary); notes, conditions and small print
// are FinePrint (body2, text.secondary). Buttons in AccountActions are medium: the section's
// main action contained, the others outlined. Small text buttons are only for controls on a
// row of a list (Remove, Change, Test connection).
export function AccountSection({ title, children, sx, ...props }) {
  return (
    <Box
      component="section"
      // long inline code (addresses, ids) breaks anywhere instead of running past a phone's edge
      sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.text, minWidth: 0, '& code': { overflowWrap: 'anywhere' }, ...sx }}
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...props}
    >
      {title && (
        <Typography component="h2" variant="h6" sx={{ lineHeight: 1.3, mb: -SPACE.hair }}>
          {title}
        </Typography>
      )}
      {children}
    </Box>
  )
}

AccountSection.propTypes = {
  title: PropTypes.node,
  children: PropTypes.node,
  sx: PropTypes.shape({}),
}

AccountSection.defaultProps = { title: null, children: null, sx: {} }

// A row of buttons: room above it, room between them, wraps on a phone.
export function AccountActions({ children, sx }) {
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: SPACE.text, pt: SPACE.hair, ...sx }}>
      {children}
    </Box>
  )
}

AccountActions.propTypes = {
  children: PropTypes.node,
  sx: PropTypes.shape({}),
}

AccountActions.defaultProps = { children: null, sx: {} }

// The small print that belongs to a section (what Pro includes, notes under a field). Under a
// row of buttons it takes sx={{ mt: SPACE.text }}: the section's 12px gap plus 12px = 24px.
export function FinePrint({ children, sx, ...props }) {
  return (
    // eslint-disable-next-line react/jsx-props-no-spreading
    <Typography variant="body2" color="text.secondary" sx={sx} {...props}>
      {children}
    </Typography>
  )
}

FinePrint.propTypes = {
  children: PropTypes.node,
  sx: PropTypes.shape({}),
}

FinePrint.defaultProps = { children: null, sx: {} }

// Detail grouped with the copy above it: a quiet tinted panel.
export function AccountNote({ children, sx, ...props }) {
  return (
    <Box
      sx={{
        bgcolor: 'action.hover',
        borderRadius: 1,
        px: SPACE.group,
        py: SPACE.text,
        ...sx,
      }}
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...props}
    >
      {children}
    </Box>
  )
}

AccountNote.propTypes = {
  children: PropTypes.node,
  sx: PropTypes.shape({}),
}

AccountNote.defaultProps = { children: null, sx: {} }

// A danger-zone Alert: its button sits on the right on a wide screen and under the warning on a
// phone, instead of squeezing the warning into a narrow strip.
export const dangerZone = {
  flexWrap: { xs: 'wrap', sm: 'nowrap' },
  '& .MuiAlert-message': { flex: '1 1 0', minWidth: 0 },
  '& .MuiAlert-action .MuiButton-root': { whiteSpace: 'nowrap' },
  '& .MuiAlert-action': {
    width: { xs: '100%', sm: 'auto' },
    m: 0,
    ml: { sm: 'auto' },
    // under the warning on a phone, lined up with its text (past the 22px icon and its 12px gap)
    pl: { xs: '34px', sm: SPACE.group },
    pt: { xs: SPACE.tight, sm: 0 },
    pb: { xs: SPACE.tight, sm: 0 },
    alignItems: 'center',
  },
}
