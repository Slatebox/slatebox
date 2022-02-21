import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor'
import { makeStyles } from '@material-ui/core/styles';
import SwipeableDrawer from '@material-ui/core/SwipeableDrawer';
import Tabs from '@material-ui/core/Tabs';
import Tab from '@material-ui/core/Tab';

import { NodeColor } from './node/NodeColor.jsx';
import { NodeText } from './node/NodeText.jsx';
import { NodeShape } from './node/NodeShape.jsx';
import { NodeImage } from './node/NodeImage.jsx';
import { NodeEffect } from './node/NodeEffect.jsx';

import LockIcon from '@material-ui/icons/Lock';
import LockOpenIcon from '@material-ui/icons/LockOpen';
import DynamicFeedIcon from '@material-ui/icons/DynamicFeed';
import FlipToBackIcon from '@material-ui/icons/FlipToBack';
import FlipToFrontIcon from '@material-ui/icons/FlipToFront';
import SettingsIcon from '@material-ui/icons/Settings';
import Tooltip from '@material-ui/core/Tooltip';
import { useDispatch, useSelector } from 'react-redux';
import { useTracker } from 'meteor/react-meteor-data';
import cloneDeep from 'lodash.clonedeep';
import Badge from '@material-ui/core/Badge';
import { NodeBehavior } from './node/NodeBehavior.jsx';
import { TabPanel } from '../common/TabPanel.jsx';
import Button from '@material-ui/core/Button';
import { ApplyNodeSettings } from './node/ApplyNodeSettings.jsx';
import useResize from '../common/useResize.js';


const useStyles = makeStyles((theme) => ({
  paper: {
    backgroundColor: theme.palette.primary.main,
    height: "250px"
  },
  content: {
    margin: theme.spacing(1)
  },
  whiteText: {
    color: '#fff'
  },
  iconTab: {
    minWidth: 50,
    width: 50,
  }
}));

export const NodeDrawer = (props) => {

  const dispatch = useDispatch();
  const classes = useStyles();
  const [isLocked, updateLock] = React.useState(props?.node?.options?.isLocked);
  const { height, enableResize } = useResize(225);
  // console.log('drawer props ', props?.node?.options);
  const slate = useSelector(state => state.slate);
  const drawerTab = useSelector(state => state.drawerTab) || 0;
  // console.log("opening node drawer ", drawerTab);
  const [behaviorDialogOpen, setBehaviorDialogOpen] = React.useState(false);
  const [defaultBehavior, setDefaultBehavior] = React.useState(true);
  const [tabVisibilityMap, setTabVisibilityMap] = React.useState({});

  // node settings
  const [applyNodeSettingsOpen, setApplyNodeSettingsOpen] = React.useState(false);

  props?.slate?.keyboard.unbindGlobal();

  useEffect(() => {
    setTabVisibilityMap({
      showColorTab: props?.node?.options.showColorTab, 
      showTextTab: props?.node?.options.showTextTab, 
      showShapeTab: props?.node?.options.showShapeTab, 
      showImageTab: props?.node?.options.showImageTab, 
      showEffectTab: props?.node?.options.showEffectTab
    });
  }, [props]);
  
  const switchTabs = (event, newValue) => {
    if (newValue >= 5) {
      switch (newValue) {
        case 5: {
          //node lock
          toggleNodeLock();
          break;
        }
        case 6:
        case 7: {
          adjustNode(newValue === 6);
          break;
        }
        case 8: {
          setApplyNodeSettingsOpen(true);
          break;
        }
        case 9: {
          setBehaviorDialogOpen(true);
          break;
        }
      }
      event?.stopPropagation();
    } else {
      dispatch({ type: "nodedrawer", drawerTab: newValue });
      //setValue(newValue);
    }
  };

  const toggleNodeLock = (e) => {
    let blnLock = !isLocked;
    updateLock(blnLock);
    const pkg = {
      type: blnLock ? "onNodeLocked" : "onNodeUnlocked",
      data: {}
    };
    props.updateNode(pkg);
    //onClick={() => updateOptions({ vectorPath: s.path, width: s.width, height: s.height })}
  };

  const adjustNode = (toBack) => {
    const pkg = {
      type: toBack ? "onNodeToBack" : "onNodeToFront",
      data: {}
    };
    props.updateNode(pkg);
  }

  function tabProps(index) {
    return {
      id: `scrollable-auto-tab-${index}`,
      'aria-controls': `scrollable-auto-tabpanel-${index}`,
    };
  }

  function changeTabVisibility(prop, blnVisible) {
    const tvm = cloneDeep(tabVisibilityMap);
    tvm[prop] = blnVisible;
    setTabVisibilityMap(tvm);
  }

  let contentTabs = ["Text", "Color","Shape", "Image", "Effects"]; 
  // let ix = 0;
  // ["Color", "Text", "Shape", "Image", "Effects"].forEach(name => {
  //   const nx = name === "Effects" ? "Effect" : name;
  //   let prop = `show${nx}Tab`;
  //   console.log('checking visibility ', name, prop, tabVisibilityMap[prop]);
  //   if (tabVisibilityMap[prop]) {
  //     contentTabs.push({ name, index: ix });
  //     ix++;
  //   }
  // });

  // function isTabHidden(name) {
  //   const n = name === "Effects" ? "Effect" : name;
  //   let prop = `show${n}Tab`;
  //   console.log('checking visibility ', name, prop, tabVisibilityMap[prop]);
  //   return tabVisibilityMap[prop];
  // }

  function getTabStyle(name) {
    const n = name === "Effects" ? "Effect" : name;
    let prop = `show${n}Tab`;
    return tabVisibilityMap[prop] ? {} : { visibility: "hidden" };
  }

  const dtab = drawerTab == null ? 0 : drawerTab;

  return (
    <SwipeableDrawer
      anchor="bottom"
      open={props.open}
      onClose={() => {
        props?.closeDrawer();
        props?.slate.keyboard.bindGlobal();
      }}
      onOpen={() => { }}
      disableBackdropTransition={true}
      disableDiscovery={true}
      disableSwipeToOpen={true}
      classes={{ paper: classes.paper }}
      PaperProps={{ style: { height } }}
      ModalProps={{
        BackdropProps: {
          invisible: true
        }
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
          <Tab key={index} label={t} style={getTabStyle(t)} {...tabProps(index)} classes={{ textColorSecondary: classes.whiteText }} />
        ))}
        <Tab {...tabProps(5)} classes={{ root: classes.iconTab }} icon={<Tooltip title={isLocked ? "Unlock" : "Lock"} placement="top">
          {isLocked ?
            <LockOpenIcon />
            :
            <LockIcon />
          }
        </Tooltip>} />
        <Tab {...tabProps(6)} classes={{ root: classes.iconTab }} icon={<Tooltip title="To Back" placement="top"><FlipToBackIcon /></Tooltip>} />
        <Tab {...tabProps(7)} classes={{ root: classes.iconTab }} icon={<Tooltip title="To Front" placement="top"><FlipToFrontIcon /></Tooltip>} />
        <Tab {...tabProps(8)} classes={{ root: classes.iconTab }} icon={
          <Tooltip title="Apply styles to other nodes" placement="top">
            <DynamicFeedIcon />
          </Tooltip>
        } />
        {slate?.options?.basedOnTemplate == null &&
          <Tab {...tabProps(9)} classes={{ root: classes.iconTab }} icon={
            <Tooltip title="Custom Behavior" placement="top">
              {!defaultBehavior ? <Badge variant="dot" color="secondary"><SettingsIcon /></Badge> : <SettingsIcon />}
            </Tooltip>
          } />
        }
      </Tabs>
      {tabVisibilityMap.showTextTab &&
        <TabPanel value={drawerTab} index={0}>
          <NodeText node={props.node} onChange={props.updateNode} />
        </TabPanel>
      }
      {tabVisibilityMap.showColorTab &&
        <TabPanel value={drawerTab} index={1}>
          <NodeColor node={props.node} onChange={props.updateNode} />
        </TabPanel>
      }
      {tabVisibilityMap.showShapeTab &&
        <TabPanel value={drawerTab} index={2}>
          <NodeShape node={props.node} height={height} onChange={props.updateNode} />
        </TabPanel>
      }
      {tabVisibilityMap.showImageTab &&
        <TabPanel value={drawerTab} index={3}>
          <NodeImage node={props.node} height={height} onChange={props.updateNode} />
        </TabPanel>
      }
      {tabVisibilityMap.showEffectTab &&
        <TabPanel value={drawerTab} index={4}>
          <NodeEffect node={props.node} onChange={props.updateNode} />
        </TabPanel>
      }
      <ApplyNodeSettings node={props.node} onDialogClosed={() => { setApplyNodeSettingsOpen(false); }} open={applyNodeSettingsOpen} />
      {slate?.options?.basedOnTemplate == null &&
        <NodeBehavior node={props.node} onChange={props.updateNode} onTabVisibilityChanged={changeTabVisibility} onDialogClosed={() => { setBehaviorDialogOpen(false); }} open={behaviorDialogOpen} onDefaultBehaviorChanged={(blnDefault) => { setDefaultBehavior(blnDefault) }} />
      }
      <div
        style={{ 
          position: "fixed",
          borderBottom: "2px solid #333",
          borderRight: "2px solid #333",
          borderLeft: "2px solid #333",
          backgroundColor: "#fff",
          width: '50px',
          height: "7px",
          left: "50%",
          transform: "translateX(-50%)",
          cursor: "row-resize",
          userSelect: "none"
        }}
        onMouseDown={enableResize}
      />
    </SwipeableDrawer>
  )
}