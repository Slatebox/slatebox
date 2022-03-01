import Container from '@material-ui/core/Container'
import { makeStyles } from '@material-ui/core/styles'
import Typography from '@material-ui/core/Typography'
import React from 'react'

const useStyles = makeStyles((theme) => ({
  paper: {
    marginTop: theme.spacing(8),
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
  },
}))

export default function NotFound() {
  const classes = useStyles()

  return (
    <Container component="main" maxWidth="md">
      <div className={classes.paper}>
        <Typography variant="h4" style={{ color: '#fff' }}>
          Oops...page not found
        </Typography>
      </div>
    </Container>
  )
}
