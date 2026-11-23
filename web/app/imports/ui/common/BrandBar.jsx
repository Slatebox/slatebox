import React from 'react'
import { Box, Button } from '@mui/material'
import { useColorScheme } from '@mui/material/styles'

export default function BrandBar() {
  const { mode, systemMode, setMode } = useColorScheme()
  const dark = (mode === 'system' ? systemMode : mode) === 'dark'
  return (
    <Box component="header" sx={{ width: '100%', display: 'flex', alignItems: 'center',
      justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider',
      px: { xs: 2.5, md: 6 }, py: 1.5, bgcolor: 'background.paper' }}>
      <Box component="a" href="https://slatebox.com/" sx={{ display: 'inline-flex', gap: 1,
        alignItems: 'center', color: 'text.primary', textDecoration: 'none', fontSize: 23,
        fontWeight: 800, letterSpacing: '-.055em' }}>
        <img src="/brand/slatebox.svg" width="31" height="31" alt="" />Slatebox
      </Box>
      <Button variant="outlined" size="small" onClick={() => setMode(dark ? 'light' : 'dark')}>
        {dark ? 'Light mode' : 'Dark mode'}
      </Button>
    </Box>
  )
}
