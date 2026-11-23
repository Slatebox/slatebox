import React from 'react'
import { Box, Drawer, MenuList, Popover } from '@mui/material'

// A header menu: a dropdown on a wide screen, a sheet from the bottom of the screen below 1000px.
// Both are the same `menu` with the same items, so keyboard and screen readers get one behaviour.
// `heading` is shown above the items (a name, who is here). It sits outside the menu's list, so the
// list holds only items: the first item takes the keyboard when the menu opens and the arrows move on.
// `onExited` runs once the menu has closed and given focus back, for an item that moves focus itself.
export default function HeaderMenu({ label, anchorEl, open, onClose, onExited, sheet, heading, children, width = 240, align = 'left' }) {
  // Tab leaves a menu, as it does a MUI Menu: close it and let focus go back to its button.
  const onKeyDown = (event) => { if (event.key === 'Tab') { event.preventDefault(); onClose?.(event, 'tabKeyDown') } }
  const list = <MenuList aria-label={label} autoFocusItem={open} variant="menu" onKeyDown={onKeyDown}
    sx={sheet ? { '& .MuiMenuItem-root': { minHeight: 48 } } : { py: .5 }}>{children}</MenuList>
  if (sheet) {
    return <Drawer anchor="bottom" open={open} onClose={onClose} SlideProps={{ onExited }}
      slotProps={{ paper: { role: 'dialog', 'aria-modal': true, 'aria-label': label, sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, pb: 'max(12px, env(safe-area-inset-bottom))',
        bgcolor: 'shell.surface', color: 'shell.ink', maxHeight: '85dvh' } } }}>
      <Box aria-hidden="true" sx={{ width: 40, height: 4, borderRadius: 2, bgcolor: 'shell.border', mx: 'auto', mt: 1.25, mb: .5 }} />
      {heading && <Box sx={{ px: 2, pt: 1 }}>{heading}</Box>}
      {list}
    </Drawer>
  }
  return <Popover anchorEl={anchorEl} open={open} onClose={onClose} TransitionProps={{ onExited }}
    anchorOrigin={{ vertical: 'bottom', horizontal: align }} transformOrigin={{ vertical: 'top', horizontal: align }}
    slotProps={{ paper: { sx: { minWidth: width, mt: .75 } } }}>
    {heading && <Box sx={{ px: 2, pt: 1.5, pb: 1, borderBottom: 1, borderColor: 'divider' }}>{heading}</Box>}
    {list}
  </Popover>
}
