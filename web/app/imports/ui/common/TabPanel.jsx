import { createTheme } from '@mui/material/styles'
import PropTypes from 'prop-types'
import React from 'react'

const theme = createTheme()

export default function TabPanel({ children, value, index, ...other }) {
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`scrollable-auto-tabpanel-${index}`}
      aria-labelledby={`scrollable-auto-tab-${index}`}
      className={theme.spacing(1)}
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...other}
    >
      {value === index && <div>{children}</div>}
    </div>
  )
}

TabPanel.propTypes = {
  children: PropTypes.node.isRequired,
  value: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  index: PropTypes.oneOfType([PropTypes.number, PropTypes.string]).isRequired,
  other: PropTypes.node,
}
