import { makeStyles } from '@material-ui/core/styles'
import PropTypes from 'prop-types'
import React from 'react'

const useStyles = makeStyles((theme) => ({
  content: {
    margin: theme.spacing(1),
  },
}))

export default function TabPanel({ children, value, index, ...other }) {
  const classes = useStyles()
  return (
    <div
      role="tabpanel"
      hidden={value !== index}
      id={`scrollable-auto-tabpanel-${index}`}
      aria-labelledby={`scrollable-auto-tab-${index}`}
      className={classes.content}
      // eslint-disable-next-line react/jsx-props-no-spreading
      {...other}
    >
      {value === index && <div>{children}</div>}
    </div>
  )
}

TabPanel.propTypes = {
  children: PropTypes.node.isRequired,
  value: PropTypes.number.isRequired,
  index: PropTypes.number.isRequired,
  other: PropTypes.node,
}

TabPanel.defaultProps = {
  other: null,
}
