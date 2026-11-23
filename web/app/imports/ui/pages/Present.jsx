import React from 'react'
import Container from '@mui/material/Container'
import { useParams } from 'react-router-dom'
import Box from '@mui/material/Box'
import CssBaseline from '@mui/material/CssBaseline'
import { createTheme, ThemeProvider } from '@mui/material/styles'
import NotFound from './NotFound'
import PresentPublishedSlate from '../components/PresentPublishedSlate'

const palette = {
  primary: {
    main: '#121212',
  },
  error: {
    main: '#FF4C21',
  },
  secondary: {
    main: '#B76C0D',
  },
  info: {
    main: '#3265aa',
  },
  warning: {
    main: '#FFC021',
  },
  success: {
    main: '#1EE770',
  },
  mode: 'dark',
  background: {
    paper: '#121212',
  },
  grey: {
    800: '#000000',
    900: '#000000',
  },
}

const theme = createTheme({
  palette,
  components: {
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundImage: 'none !important',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundImage: 'none !important',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none !important',
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        switchBase: {
          '&.Mui-checked': {
            color: palette.secondary.main,
            '& + .MuiSwitch-track': {
              backgroundColor: palette.secondary.main,
            },
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        containedSecondary: {
          '&.presentButton': {
            '&:hover': {
              background: 'linear-gradient(45deg, #FFA500 30%, #FF8C00 90%)',
              boxShadow: '0 6px 12px 4px rgba(255, 140, 0, .6)',
              transform: 'translateY(-2px)',
            },
          },
        },
      },
    },
  },
})

export default function Present() {
  const { slateShareId } = useParams()

  if (!slateShareId) {
    return <NotFound />
  }

  return (
    <Box
      sx={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        position: 'fixed',
        width: '100%',
        top: 0,
        left: 0,
      }}
    >
      <CssBaseline />
      <ThemeProvider theme={theme}>
        <Container
          maxWidth={false}
          // Full bleed: a presentation's own canvas reaches every edge of the screen.
          disableGutters
          component="main"
          id="presentMain"
          sx={{
            width: '100%',
            height: '100vh',
            minHeight: '100vh',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <PresentPublishedSlate slateShareId={slateShareId} />
        </Container>
      </ThemeProvider>
    </Box>
  )
}
