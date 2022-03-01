/* eslint-disable react/jsx-props-no-spreading */
import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { makeStyles } from '@material-ui/core/styles'
import SwipeableDrawer from '@material-ui/core/SwipeableDrawer'
import Tabs from '@material-ui/core/Tabs'
import Tab from '@material-ui/core/Tab'
import LockIcon from '@material-ui/icons/Lock'
import LockOpenIcon from '@material-ui/icons/LockOpen'
import DynamicFeedIcon from '@material-ui/icons/DynamicFeed'
import FlipToBackIcon from '@material-ui/icons/FlipToBack'
import FlipToFrontIcon from '@material-ui/icons/FlipToFront'
import SettingsIcon from '@material-ui/icons/Settings'
import Tooltip from '@material-ui/core/Tooltip'
import Paper from '@material-ui/core/Paper'
import { useDispatch, useSelector } from 'react-redux'
import cloneDeep from 'lodash.clonedeep'
import Badge from '@material-ui/core/Badge'
import NodeBehavior from './node/NodeBehavior'
import TabPanel from '../common/TabPanel'
import NodeEffect from './node/NodeEffect'
import NodeImage from './node/NodeImage'
import NodeShape from './node/NodeShape'
import NodeText from './node/NodeText'
import NodeColor from './node/NodeColor'
import ApplyNodeSettings from './node/ApplyNodeSettings'
import useResize from '../common/useResize'
import slateProps from '../propTypes/slatePriops'
import nodeProps from '../propTypes/nodeProps'

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
  iconTab: {
    minWidth: 50,
    width: 50,
  },
}))

export default function NodeDrawer({
  node,
  slate,
  updateNode,
  open,
  closeDrawer,
}) {
  const dispatch = useDispatch()
  const classes = useStyles()
  const [isLocked, updateLock] = React.useState(node?.options?.isLocked)
  const { height, enableResize } = useResize(250)
  const drawerTab = useSelector((state) => state.drawerTab) || 0
  const [behaviorDialogOpen, setBehaviorDialogOpen] = React.useState(false)
  const [defaultBehavior, setDefaultBehavior] = React.useState(true)
  const [tabVisibilityMap, setTabVisibilityMap] = React.useState({})

  // node settings
  const [applyNodeSettingsOpen, setApplyNodeSettingsOpen] =
    React.useState(false)

  slate?.keyboard.unbindGlobal()

  useEffect(() => {
    setTabVisibilityMap({
      showColorTab: node?.options.showColorTab,
      showTextTab: node?.options.showTextTab,
      showShapeTab: node?.options.showShapeTab,
      showImageTab: node?.options.showImageTab,
      showEffectTab: node?.options.showEffectTab,
    })
  }, [node, slate, updateNode, open, closeDrawer])

  const toggleNodeLock = () => {
    const blnLock = !isLocked
    updateLock(blnLock)
    const pkg = {
      type: blnLock ? 'onNodeLocked' : 'onNodeUnlocked',
      data: {},
    }
    updateNode(pkg)
  }

  const adjustNode = (toBack) => {
    const pkg = {
      type: toBack ? 'onNodeToBack' : 'onNodeToFront',
      data: {},
    }
    updateNode(pkg)
  }

  const switchTabs = (event, newValue) => {
    if (newValue >= 5) {
      switch (newValue) {
        case 5: {
          // node lock
          toggleNodeLock()
          break
        }
        case 6:
        case 7: {
          adjustNode(newValue === 6)
          break
        }
        case 8: {
          setApplyNodeSettingsOpen(true)
          break
        }
        case 9: {
          setBehaviorDialogOpen(true)
          break
        }
        default:
          break
      }
      event?.stopPropagation()
    } else {
      dispatch({ type: 'nodedrawer', drawerTab: newValue })
      // setValue(newValue);
    }
  }

  function tabProps(index) {
    return {
      id: `scrollable-auto-tab-${index}`,
      'aria-controls': `scrollable-auto-tabpanel-${index}`,
    }
  }

  const changeTabVisibility = (prop, blnVisible) => {
    const tvm = cloneDeep(tabVisibilityMap)
    tvm[prop] = blnVisible
    setTabVisibilityMap(tvm)
  }

  const contentTabs = ['Text', 'Color', 'Shape', 'Image', 'Effects']

  function getTabStyle(name) {
    const n = name === 'Effects' ? 'Effect' : name
    const prop = `show${n}Tab`
    return tabVisibilityMap[prop] ? {} : { visibility: 'hidden' }
  }

  NodeDrawer.propTypes = {
    node: nodeProps.isRequired,
    slate: slateProps.isRequired,
    updateNode: PropTypes.func.isRequired,
    open: PropTypes.bool.isRequired,
    closeDrawer: PropTypes.func.isRequired,
  }

  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={() => {
        closeDrawer()
        slate.keyboard.bindGlobal()
      }}
      onOpen={() => {}}
      disableBackdropTransition
      disableDiscovery
      disableSwipeToOpen
      classes={{ paper: classes.paper }}
      PaperProps={{ style: { height } }}
      ModalProps={{
        BackdropProps: {
          invisible: true,
        },
      }}
    >
      <Tabs
        value={drawerTab}
        onChange={switchTabs}
        indicatorColor="secondary"
        textColor="secondary"
        aria-label="Node Properties"
        centered
      >
        {contentTabs.map((t, index) => (
          <Tab
            key={t}
            label={t}
            style={getTabStyle(t)}
            {...tabProps(index)}
            classes={{ textColorSecondary: classes.whiteText }}
          />
        ))}
        <Tab
          {...tabProps(5)}
          classes={{ root: classes.iconTab }}
          icon={
            <Tooltip title={isLocked ? 'Unlock' : 'Lock'} placement="top">
              {isLocked ? <LockOpenIcon /> : <LockIcon />}
            </Tooltip>
          }
        />
        <Tab
          {...tabProps(6)}
          classes={{ root: classes.iconTab }}
          icon={
            <Tooltip title="To Back" placement="top">
              <FlipToBackIcon />
            </Tooltip>
          }
        />
        <Tab
          {...tabProps(7)}
          classes={{ root: classes.iconTab }}
          icon={
            <Tooltip title="To Front" placement="top">
              <FlipToFrontIcon />
            </Tooltip>
          }
        />
        <Tab
          {...tabProps(8)}
          classes={{ root: classes.iconTab }}
          icon={
            <Tooltip title="Apply styles to other nodes" placement="top">
              <DynamicFeedIcon />
            </Tooltip>
          }
        />
        {slate?.options?.basedOnTemplate == null && (
          <Tab
            {...tabProps(9)}
            classes={{ root: classes.iconTab }}
            icon={
              <Tooltip title="Custom Behavior" placement="top">
                {!defaultBehavior ? (
                  <Badge variant="dot" color="secondary">
                    <SettingsIcon />
                  </Badge>
                ) : (
                  <SettingsIcon />
                )}
              </Tooltip>
            }
          />
        )}
      </Tabs>
      {tabVisibilityMap.showTextTab && (
        <TabPanel value={drawerTab} index={0}>
          <NodeText node={node} onChange={updateNode} />
        </TabPanel>
      )}
      {tabVisibilityMap.showColorTab && (
        <TabPanel value={drawerTab} index={1}>
          <NodeColor node={node} onChange={updateNode} />
        </TabPanel>
      )}
      {tabVisibilityMap.showShapeTab && (
        <TabPanel value={drawerTab} index={2}>
          <NodeShape node={node} height={height} onChange={updateNode} />
        </TabPanel>
      )}
      {tabVisibilityMap.showImageTab && (
        <TabPanel value={drawerTab} index={3}>
          <NodeImage node={node} height={height} onChange={updateNode} />
        </TabPanel>
      )}
      {tabVisibilityMap.showEffectTab && (
        <TabPanel value={drawerTab} index={4}>
          <NodeEffect node={node} onChange={updateNode} />
        </TabPanel>
      )}
      <ApplyNodeSettings
        node={node}
        open={applyNodeSettingsOpen}
        onDialogClosed={() => {
          setApplyNodeSettingsOpen(false)
        }}
      />
      {slate?.options?.basedOnTemplate == null && (
        <NodeBehavior
          node={node}
          onChange={updateNode}
          onTabVisibilityChanged={changeTabVisibility}
          onDialogClosed={() => {
            setBehaviorDialogOpen(false)
          }}
          open={behaviorDialogOpen}
          onDefaultBehaviorChanged={(blnDefault) => {
            setDefaultBehavior(blnDefault)
          }}
        />
      )}
      <Paper
        style={{
          position: 'fixed',
          borderBottom: '2px solid #333',
          borderRight: '2px solid #333',
          borderLeft: '2px solid #333',
          backgroundColor: '#fff',
          width: '50px',
          height: '7px',
          left: '50%',
          transform: 'translateX(-50%)',
          cursor: 'row-resize',
          userSelect: 'none',
        }}
        onMouseDown={enableResize}
      />
    </SwipeableDrawer>
  )
}
