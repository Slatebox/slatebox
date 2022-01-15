import React, { useEffect, useState } from 'react';
import { makeStyles } from '@material-ui/core/styles';
import SwipeableDrawer from '@material-ui/core/SwipeableDrawer';
import Accordion from '@material-ui/core/Accordion';
import AccordionSummary from '@material-ui/core/AccordionSummary';
import AccordionDetails from '@material-ui/core/AccordionDetails';
import Typography from '@material-ui/core/Typography';
import ExpandMoreIcon from '@material-ui/icons/ExpandMore';
import { useDispatch, useSelector } from 'react-redux'

import { SlateSettings } from '../components/slate/SlateSettings.jsx';
import { SlateColors } from '../components/slate/SlateColors.jsx';
import { SlateEffects } from './slate/SlateEffects.jsx';
import { SlateBackgrounds } from './slate/SlateBackgrounds.jsx';
import { SlateEmbed } from '../components/slate/SlateEmbed.jsx';
import { SlateExport } from '../components/slate/SlateExport.jsx';

import TextField from '@material-ui/core/TextField';
import Grid from '@material-ui/core/Grid';
import { SlateThemes } from './slate/SlateThemes.jsx';
import { GenerateNodeColors } from './slate/GenerateNodeColors.jsx';

const useStyles = makeStyles((theme) => ({
  accordion: {
    backgroundColor: theme.palette.primary.main,
    "& .MuiAccordionSummary-content": {
      color: theme.palette.secondary.main
    }
  },
  paper: {
    backgroundColor: theme.palette.primary.main,
    height: "100vh",
    width: "300px"
  },
  content: {
    margin: theme.spacing(3)
  },
  whiteText: {
    color: '#fff'
  },
  heading: {
    fontSize: theme.typography.pxToRem(15),
    color: theme.palette.primary.secondary
  }
}));

export const SlateDrawer = (props) => {
  const dispatch = useDispatch();
  const classes = useStyles();
  let expanded = useSelector(state => state.slateDrawerExpanded) || "settingsPanel";
  const slate = useSelector(state => state.slate);

  // console.log("got slate for drawer", slate);

  const handleChange = (panel) => (event, isExpanded) => {
    if (panel !== "settingsPanel" && Meteor.user().isAnonymous) {
      dispatch({
        type: "registration"
        , registrationOpen: true
        , registrationMessage: `Want to modify the slate? Registration takes but a moment.`
      });
    } else {
      dispatch({ type: "canvas", slateDrawerExpanded: panel });
    }
  };

  const handleClose = (e) => {
    props?.onDrawerClose();
  }

  return (
    <SwipeableDrawer
      anchor="right"
      open={props?.open || false}
      onClose={handleClose}
      onOpen={() => { }}
      disableBackdropTransition={true}
      disableDiscovery={false}
      disableSwipeToOpen={false}
      classes={{ paper: classes.paper }}
      ModalProps={{
        BackdropProps: {
          invisible: true
        }
      }}
    >
      <Accordion expanded={expanded === 'settingsPanel'} onChange={handleChange('settingsPanel')} classes={{ root: classes.accordion }}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon color="secondary" />}
          aria-controls="settingsPanelbh-content"
          id="settingsPanelbh-header"
          color="secondary"
        >
          <Typography className={classes.heading}>General Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <SlateSettings slate={slate} onChange={props.updateSlate} />
        </AccordionDetails>
      </Accordion>
      {!slate?.options?.eligibleForThemeCompilation &&
        <>
          <Accordion expanded={expanded === 'themePanel'} onChange={handleChange('themePanel')} classes={{ root: classes.accordion }}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon color="secondary" />}
              aria-controls="themePanelbh-content"
              id="themePanelbh-header"
              color="secondary"
            >
              <Typography className={classes.heading}>Themes</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <SlateThemes slate={props.slate} onChange={props.updateSlate} />
            </AccordionDetails>
          </Accordion>
        </>
      }
      <Accordion expanded={expanded === 'colorPanel'} onChange={handleChange('colorPanel')} classes={{ root: classes.accordion }}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon color="secondary" />}
          aria-controls="colorPanelbh-content"
          id="colorPanelbh-header"
          color="secondary"
        >
          <Typography className={classes.heading}>Slate Color</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <SlateColors slate={slate} onChange={props.updateSlate} />
        </AccordionDetails>
      </Accordion>
      <Accordion expanded={expanded === 'generateNodeColorsPanel'} onChange={handleChange('generateNodeColorsPanel')} classes={{ root: classes.accordion }}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon color="secondary" />}
          aria-controls="generateNodeColorsPanelbh-content"
          id="generateNodeColorsPanelbh-header"
          color="secondary"
        >
          <Typography className={classes.heading}>Generate Node Colors</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <GenerateNodeColors slate={props.slate} />
        </AccordionDetails>
      </Accordion>
      {!slate?.options?.eligibleForThemeCompilation &&
        <>
          <Accordion expanded={expanded === 'embed'} onChange={handleChange('embed')} classes={{ root: classes.accordion }}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon color="secondary" />}
              aria-controls="embedbh-content"
              id="embedbh-header"
              color="secondary"
            >
              <Typography className={classes.heading}>Embed</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <SlateEmbed slate={slate} getOrientation={props.getOrientation} />
            </AccordionDetails>
          </Accordion>
          <Accordion expanded={expanded === 'export'} onChange={handleChange('export')} classes={{ root: classes.accordion }}>
            <AccordionSummary
              expandIcon={<ExpandMoreIcon color="secondary" />}
              aria-controls="exportbh-content"
              id="exportbh-header"
              color="secondary"
            >
              <Typography className={classes.heading}>Export</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <SlateExport slate={slate} onExport={props.onExport} />
            </AccordionDetails>
          </Accordion>
        </>
      }
      <Accordion expanded={expanded === 'backgroundPanel'} onChange={handleChange('backgroundPanel')} classes={{ root: classes.accordion }}>
        <AccordionSummary
          expandIcon={<ExpandMoreIcon color="secondary" />}
          aria-controls="backgroundPanelbh-content"
          id="backgroundPanelbh-header"
        >
          <Typography className={classes.heading}>Backgrounds</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <SlateBackgrounds slate={slate} onChange={props.updateSlate} />
        </AccordionDetails>
      </Accordion>
    </SwipeableDrawer>
  )
}