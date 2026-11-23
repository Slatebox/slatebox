import { Box, Container, Button, Paper } from '@mui/material'
import Typography from '@mui/material/Typography'
import React from 'react'
import { useNavigate } from 'react-router-dom'
import HomeIcon from '@mui/icons-material/Home'
import { useTheme } from '@mui/material/styles'

export default function NotFound() {
  const theme = useTheme()
  const navigate = useNavigate()

  return (
    <Container maxWidth="sm">
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          textAlign: 'center',
          py: 4,
        }}
      >
        <Paper
          elevation={3}
          sx={{
            p: 4,
            width: '100%',
            background: 'rgba(255, 255, 255, 0.1)',
            backdropFilter: 'blur(10px)',
            border: '1px solid rgba(255, 255, 255, 0.2)',
          }}
        >
          <Typography
            variant="h2"
            component="h1"
            sx={{
              color: '#fff',
              mb: 2,
              fontWeight: 'bold',
            }}
          >
            404
          </Typography>
          <Typography
            variant="h4"
            component="h2"
            sx={{
              color: '#fff',
              mb: 3,
            }}
          >
            Looks like this slate got erased
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: 'rgba(255, 255, 255, 0.7)',
              mb: 4,
            }}
          >
            We couldn't find the page you're looking for. Maybe it's been
            archived or moved to a different location.
          </Typography>
          <Button
            variant="contained"
            startIcon={<HomeIcon />}
            onClick={() => navigate('/')}
            sx={{
              backgroundColor: theme.palette.primary.main,
              '&:hover': {
                backgroundColor: theme.palette.primary.dark,
              },
            }}
          >
            Return Home
          </Button>
        </Paper>
      </Box>
    </Container>
  )
}
