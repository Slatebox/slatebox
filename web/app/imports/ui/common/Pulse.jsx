import React from 'react'
import Box from '@mui/material/Box'

export default function Pulse({ children }) {
  return (
    <Box
      sx={{
        animation: 'pulse 2s linear infinite',
        '@keyframes pulse': {
          '0%': {
            boxShadow: '0 0 3px 0 #f2f2f2',
          },
          '70%': {
            boxShadow: '0 0 3px 3px #f2f2f2',
          },
          '100%': {
            boxShadow: '0 0 3px 0 #f2f2f2',
          },
        },
      }}
    >
      {children}
    </Box>
  )
}
