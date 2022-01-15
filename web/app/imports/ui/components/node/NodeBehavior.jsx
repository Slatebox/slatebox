import React, { useEffect, useState } from 'react';
import { useTheme, withStyles } from '@material-ui/core/styles';
import cloneDeep from "lodash.clonedeep";
import useMediaQuery from '@material-ui/core/useMediaQuery';
import Dialog from '@material-ui/core/Dialog';
import CloseIcon from '@material-ui/icons/Close';
import List from '@material-ui/core/List';
import ListItem from '@material-ui/core/ListItem';
import ListItemIcon from '@material-ui/core/ListItemIcon';
import Checkbox from '@material-ui/core/Checkbox';
import ListItemText from '@material-ui/core/ListItemText';
import Slider from '@material-ui/core/Slider';
import Box from '@material-ui/core/Box';
import Typography from '@material-ui/core/Typography';
import Grid from '@material-ui/core/Grid';
import IconButton from '@material-ui/core/IconButton';
import MuiDialogTitle from '@material-ui/core/DialogTitle';
import Tabs from '@material-ui/core/Tabs';
import Tab from '@material-ui/core/Tab';
import { TabPanel } from '../../common/TabPanel';
import defaultBehaviors from '../../components/node/defaultBehaviors.js';
import DialogContent from '@material-ui/core/DialogContent';
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup';
import ToggleButton from '@material-ui/lab/ToggleButton';
import Tooltip from '@material-ui/core/Tooltip';

const styles = (theme) => ({
  root: {
    margin: 0,
    padding: theme.spacing(2),
  },
  closeButton: {
    position: 'absolute',
    right: theme.spacing(1),
    top: theme.spacing(1),
    color: theme.palette.grey[500],
  },
});

export const NodeBehavior = (props) => {

  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.up('md'));
  const [preset, setPreset] = React.useState(null);
  let behaviors = defaultBehaviors(props);

  function handlePreset(val) {
    let behs = [];
    Object.keys(behaviors).forEach(b => {
      if (behaviors[b].default === true || behaviors[b].default === false) {
        switch (val) {
          case "disabled": {
            if (behaviors[b].unsetForDisabled) {
              behs.push({ name: b, val: false });
            } else {
              behs.push({ name: b, val: true });
            }
            break;
          }
          case "defaults": {
            if (behaviors[b].default) {
              behs.push({ name: b, val: true });
            } else {
              behs.push({ name: b, val: false });
            }
            break;
          }
        }
      }
    });
    console.log('behavior set is ', behs);
    behs.forEach(b => {
      changeNodeBehavior(b.name, b.val);
    });
    setPreset(val);
  }

  function getBehavior(changedBehavior, changedVal) {
    // to pass into the useState, this must be a let not a const
    let bState = { node: {}, relationships: {}, menu: {} };
    let dBehavior = true;
    Object.keys(behaviors).forEach(b => {
      if (b === changedBehavior) {
        bState[behaviors[b].category][b] = changedVal;
      } else {
        bState[behaviors[b].category][b] = props?.node?.options[b];
      }
      if (dBehavior) {
        dBehavior = bState[behaviors[b].category][b] === behaviors[b].default;
      }
    });
    return { bState, dBehavior };
  }

  const { bState, dBehavior } = getBehavior();
  const [behaviorMap, setBehaviorMap] = React.useState(cloneDeep(bState));
  //const [defaultBehavior, setDefaultBehavior] = React.useState(dBehavior);

  // send the default behavior back only at the onset
  useEffect(() => {
    props.onDefaultBehaviorChanged(dBehavior);
  }, []);

  function closeBehaviorDialog() {
    props.onDialogClosed();
  }

  function changeNodeBehavior(b, optVal) {
    let cur = optVal || !props?.node.options[b];
    const pkg = {
      type: "onNodeBehaviorChanged",
      data: {
        behaviorChanges: [{
          name: b,
          value: cur
        }]
      }
    };
    props.onChange(pkg);
    const { bState, dBehavior } = getBehavior(b, cur);
    setBehaviorMap(cloneDeep(bState));
    props.onDefaultBehaviorChanged(dBehavior);
    if (tabValue === 2) {
      // 2 is equal to the menu tab
      props.onTabVisibilityChanged(b, cur);
    }
  }

  const DialogTitle = withStyles(styles)((props) => {
    const { children, classes, onClose, ...other } = props;
    return (
      <MuiDialogTitle disableTypography className={classes.root} {...other}>
        <Grid justify="space-around" container>
          <Typography variant="h6" color="secondary">{children}</Typography>
          <Tooltip title="Node Presets: Reset to default, or set all options so node is disabled">
            <ToggleButtonGroup
              value={preset}
              exclusive
              onChange={(e, val) => { if (val) { handlePreset(val); } } }
              aria-label="Behavior Presets"
            >
                <ToggleButton size="small" value="defaults" aria-label="Defaults">
                  Default
                </ToggleButton>
                <ToggleButton size="small" value="disabled" aria-label="Disable">
                  Disabled
                </ToggleButton>
            </ToggleButtonGroup>
          </Tooltip>
        </Grid>
        {onClose ? (
          <IconButton aria-label="close" className={classes.closeButton} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        ) : null}
      </MuiDialogTitle>
    );
  });

  const [tabValue, setTabValue] = React.useState(0);
  const changeTab = (event, newValue) => {
    setTabValue(newValue);
  };

  function TabContent(props) {
    console.log("using type", props.type);
    return (<Grid spacing={1} container>
        {Object.keys(behaviorMap[props.type]).map((b, index) => (
          <Grid key={index} item xs={behaviors[b].col}>
            {b !== "spaceBetweenNodesWhenAdding" ?
              <List>
                <ListItem disabled={behaviors[b].disabled} role={undefined} dense button onClick={(e) => { setPreset(null); changeNodeBehavior(b); }}>
                  <ListItemIcon>
                    <Checkbox
                      edge="start"
                      checked={behaviorMap[props.type][b]}
                      tabIndex={-1}
                      disableRipple
                      inputProps={{ 'aria-labelledby': `label-${index}` }}
                    />
                  </ListItemIcon>
                  <ListItemText primary={behaviors[b].title} secondary={behaviors[b].description} />
                </ListItem>
              </List>
              :
              <Box ml={3} mr={2}>
                <Typography variant="subtitle2" color="textSecondary">{behaviors[b].description}</Typography>
                <Slider
                  value={behaviorMap[props.type][b]}
                  color="secondary"
                  disabled={behaviors[b].disabled}
                  aria-labelledby="spaceBetweenNodesWhenAdding-slider"
                  valueLabelDisplay="auto"
                  step={10}
                  marks
                  min={10}
                  max={500}
                  onChange={(e, newVal) => { setPreset(null); changeNodeBehavior(b, newVal); }}
                />
              </Box>
            }
          </Grid>
        ))}
      </Grid>)
  }

  return (
    <Dialog 
      maxWidth="md" 
      fullWidth={true}
      onClose={closeBehaviorDialog} 
      aria-labelledby="node-custom-behavior-dialog" 
      open={props.open}
      PaperProps={{
        style: {
          opacity: '0.93'
        },
      }}>
      <DialogContent style={{minHeight: "605px"}}>
        <DialogTitle id="custom-node-behavior" onClose={closeBehaviorDialog}>
          Custom Behavior
        </DialogTitle>
        <Tabs
          value={tabValue}
          onChange={changeTab}
          indicatorColor="secondary"
          textColor="secondary"
        >
          <Tab label="Node" />
          <Tab label="Relationships" />
          <Tab label="Menu" />
        </Tabs>
        <TabPanel value={tabValue} index={0}>
          <TabContent type="node"/>
        </TabPanel>
        <TabPanel value={tabValue} index={1}>
          <TabContent type="relationships"/>
        </TabPanel>
        <TabPanel value={tabValue} index={2}>
          <TabContent type="menu"/>
        </TabPanel>
      </DialogContent>
    </Dialog>
  );
}