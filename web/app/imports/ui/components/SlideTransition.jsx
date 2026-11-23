import React from 'react'
import Slide from '@mui/material/Slide'

const Transition = React.forwardRef((props, ref) => (
  // eslint-disable-next-line react/jsx-props-no-spreading
  <Slide direction="up" ref={ref} {...props} />
))

export default Transition
