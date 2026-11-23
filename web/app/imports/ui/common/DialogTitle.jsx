import React from 'react'
import MuiDialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import CloseIcon from '@mui/icons-material/Close'

const DialogTitle = (props) => {
  const { children, onClose, ...other } = props

  return (
    <MuiDialogTitle
      disableTypography
      sx={{
        margin: 0,
        padding: (theme) => theme.spacing(2),
      }}
      {...other}
    >
      <Typography variant="h6" color="secondary">
        {children}
      </Typography>
      {onClose ? (
        <IconButton
          aria-label="close"
          onClick={onClose}
          sx={{
            position: 'absolute',
            right: (theme) => theme.spacing(1),
            top: (theme) => theme.spacing(1),
            color: (theme) => theme.palette.grey[500],
          }}
        >
          <CloseIcon />
        </IconButton>
      ) : null}
    </MuiDialogTitle>
  )
}

export default DialogTitle
