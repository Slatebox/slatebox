import React from 'react'
import { useTheme } from '@mui/material/styles'
import Paper from '@mui/material/Paper'
import SBRoutes from '../SBRoutes'
import Register from '../common/Register'
import VideoHelpGuides from '../common/VideoHelpGuides'

function MainPaper({ isOnCanvas, embeddedSlate, loadedUser }) {
  const theme = useTheme()
  return (
    <Paper
      component="main"
      sx={{
        flexGrow: 1,
        p: isOnCanvas || embeddedSlate ? 0 : 3,
        height: isOnCanvas || embeddedSlate ? '100vh' : 'calc(100vh - 64px)',
        marginTop: embeddedSlate ? '0px' : '64px',
        borderRadius: 0,
        overflow: isOnCanvas ? 'hidden' : 'auto',
        position: 'relative',
        background: theme.palette.shell.background,
      }}
    >
      <SBRoutes />
      <Register user={loadedUser} />
      <VideoHelpGuides />
    </Paper>
  )
}

export default MainPaper
