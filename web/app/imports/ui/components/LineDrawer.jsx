import React from 'react'
import PropTypes from 'prop-types'
import { makeStyles } from '@material-ui/core/styles'
import SwipeableDrawer from '@material-ui/core/SwipeableDrawer'
import Tabs from '@material-ui/core/Tabs'
import Tab from '@material-ui/core/Tab'
import LineProperties from './line/LineProperties'
import LineEffect from './node/LineEffect'
import nodeProps from '../propTypes/nodeProps'
import associationProps from '../propTypes/associationProps'

const useStyles = makeStyles((theme) => ({
  paper: {
    backgroundColor: theme.palette.primary.main,
    height: '250px',
  },
  content: {
    margin: theme.spacing(1),
  },
  whiteText: {
    color: '#fff',
  },
}))

export default function LineDrawer({
  closeDrawer,
  open,
  node,
  association,
  updateLine,
}) {
  const classes = useStyles()

  // console.log('line props ', props?.line);

  const [value, setValue] = React.useState(0)
  const switchTabs = (event, newValue) => {
    setValue(newValue)
  }

  function tabProps(index) {
    return {
      id: `scrollable-auto-tab-${index}`,
      'aria-controls': `scrollable-auto-tabpanel-${index}`,
    }
  }

  // eslint-disable-next-line react/no-unstable-nested-components
  function TabPanel(props) {
    const { children, value, index, ...other } = props

    return (
      <div
        role="tabpanel"
        hidden={value !== index}
        id={`scrollable-auto-tabpanel-${index}`}
        aria-labelledby={`scrollable-auto-tab-${index}`}
        className={classes.content}
        {...other}
      >
        {value === index && <div>{children}</div>}
      </div>
    )
  }

  LineDrawer.propTypes = {
    closeDrawer: PropTypes.bool.isRequired,
    open: PropTypes.bool.isRequired,
    node: nodeProps.isRequired,
    association: associationProps.isRequired,
    updateLine: PropTypes.func.isRequired,
  }

  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={() => {
        closeDrawer()
      }}
      onOpen={() => {}}
      disableBackdropTransition={true}
      disableDiscovery={true}
      disableSwipeToOpen={true}
      classes={{ paper: classes.paper }}
      ModalProps={{
        BackdropProps: {
          invisible: true,
          style: { zIndex: -99 },
        },
      }}
    >
      <Tabs
        value={value}
        onChange={switchTabs}
        indicatorColor="secondary"
        textColor="secondary"
        aria-label="Line Properties"
        centered
      >
        <Tab
          label="Settings"
          {...tabProps(0)}
          classes={{ textColorSecondary: classes.whiteText }}
        />
        <Tab
          label="Effects"
          {...tabProps(1)}
          classes={{ textColorSecondary: classes.whiteText }}
        />
      </Tabs>
      <TabPanel value={value} index={0}>
        <LineProperties
          node={node}
          association={association}
          onChange={updateLine}
        />
      </TabPanel>
      <TabPanel value={value} index={1}>
        <LineEffect
          node={node}
          association={association}
          onChange={updateLine}
        />
      </TabPanel>
    </SwipeableDrawer>
  )
}
