// One page layout for every page in the app (owner, 2026-11-25: "the same spacing layout for every
// page"). My slates, Team slates, the library, Integrations, Manage team, Team settings, the brand
// kit, Profile, the admin pages and the rest all sit in AppPage, so the title and the content start
// on the same left edge and run to the same right edge on every page, at every width.
//
// The edges: the main area (MainPaper) pads 24px on every side; AppPage adds PAGE_GUTTER (8px) more,
// so a page's content starts 32px in from the navigation and stops 32px before the window's right
// edge, at 1440px and on a 390px phone alike. That is where the slates pages always put their title.
// The page uses the full width that leaves: no centered column, no side gutters of its own.
//
// The title row (AppPageHeader): the h1 and a line under it on the left, the page's main actions on
// the right (under the title on a phone), then PAGE_SPACE.header (24px) to the content. A page whose
// title row needs more (a back link above the title, a count line) passes `eyebrow` or children; a
// page whose header is drawn by a component further down (Manage team, Integrations) renders
// AppPageHeader there, inside AppPage.
//
// `maxWidth` is for a page that is one long form or one column of reading and nothing else, where
// lines past ~760px stop being readable. No page uses it today: forms keep their own fields narrow
// (Profile's fields are 480px wide) while the page itself stays full width. Do not use it to make a
// page look like a centered card; the page still starts on the same left edge (it is never centered).
//
// `fill`: the page is exactly as tall as the main area, and the part under the title row scrolls on
// its own (the slates pages, whose title row with search and paging stays put while the grid scrolls).
import React from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'

// theme units of 8px
export const PAGE_GUTTER = 1 // 8px, on top of the main area's 24px: 32px in all
export const PAGE_SPACE = {
  header: 3, // 24px: the title row to the content
  section: 3, // 24px: between a page's blocks (cards, sections)
  bottom: 6, // 48px: room under the last block
}

export function AppPageHeader({ title, subtitle, eyebrow, actions, titleId, children, sx, ...props }) {
  return (
    <Box
      component="header"
      data-app-page-header=""
      sx={{
        display: 'flex', alignItems: { xs: 'flex-start', sm: 'flex-end' }, gap: 2, flexWrap: 'wrap',
        mb: PAGE_SPACE.header, minWidth: 0, ...sx,
      }}
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...props}
    >
      <Box sx={{ flex: '1 1 320px', minWidth: 0 }}>
        {eyebrow}
        <Typography variant="h4" component="h1" id={titleId} data-app-page-title=""
          sx={{ fontWeight: 750, fontSize: { xs: 26, sm: 32 }, lineHeight: 1.15, letterSpacing: '-.01em', overflowWrap: 'anywhere' }}>
          {title}
        </Typography>
        {subtitle && <Typography component="div" color="text.secondary" sx={{ mt: 0.5 }}>{subtitle}</Typography>}
        {children}
      </Box>
      {actions && (
        <Box data-app-page-actions="" sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap', minWidth: 0 }}>{actions}</Box>
      )}
    </Box>
  )
}

AppPageHeader.propTypes = {
  title: PropTypes.node.isRequired,
  subtitle: PropTypes.node,
  eyebrow: PropTypes.node,
  actions: PropTypes.node,
  titleId: PropTypes.string,
  children: PropTypes.node,
  sx: PropTypes.shape({}),
}

AppPageHeader.defaultProps = { subtitle: null, eyebrow: null, actions: null, titleId: undefined, children: null, sx: {} }

export default function AppPage({ title, subtitle, eyebrow, actions, titleId, header, maxWidth, fill, children, sx, ...props }) {
  let top = header
  if (top === undefined && title) top = <AppPageHeader {...{ title, subtitle, eyebrow, actions, titleId }} />
  return (
    <Box
      data-app-page=""
      sx={{
        boxSizing: 'border-box', width: '100%', minWidth: 0, px: PAGE_GUTTER, pt: PAGE_GUTTER,
        ...(maxWidth ? { maxWidth } : {}),
        ...(fill
          ? { height: '100%', display: 'flex', flexDirection: 'column', pb: 0 }
          : { pb: PAGE_SPACE.bottom }),
        ...sx,
      }}
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...props}
    >
      {top}
      {children}
    </Box>
  )
}

AppPage.propTypes = {
  title: PropTypes.node,
  subtitle: PropTypes.node,
  eyebrow: PropTypes.node,
  actions: PropTypes.node,
  titleId: PropTypes.string,
  // a title row drawn by the page itself (the slates pages' search and paging bar); null for none
  header: PropTypes.node,
  maxWidth: PropTypes.number,
  fill: PropTypes.bool,
  children: PropTypes.node,
  sx: PropTypes.shape({}),
}

AppPage.defaultProps = {
  title: null, subtitle: null, eyebrow: null, actions: null, titleId: undefined, header: undefined,
  maxWidth: undefined, fill: false, children: null, sx: {},
}
