import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { makeStyles } from '@material-ui/core/styles'
import SwipeableDrawer from '@material-ui/core/SwipeableDrawer'
import Accordion from '@material-ui/core/Accordion'
import AccordionSummary from '@material-ui/core/AccordionSummary'
import AccordionDetails from '@material-ui/core/AccordionDetails'
import Typography from '@material-ui/core/Typography'
import ExpandMoreIcon from '@material-ui/icons/ExpandMore'
import { useDispatch, useSelector } from 'react-redux'
import SlateSettings from './slate/SlateSettings'
import SlateColors from './slate/SlateColors'
import SlateBackgrounds from './slate/SlateBackgrounds'
import SlateEmbed from './slate/SlateEmbed'
import SlateExport from './slate/SlateExport'
import SlateThemes from './slate/SlateThemes'
import GenerateNodeColors from './slate/GenerateNodeColors'
import slateProps from '../propTypes/slatePriops'

const useStyles = makeStyles((theme) => ({
  accordion: {
    backgroundColor: theme.palette.primary.main,
    '& .MuiAccordionSummary-content': {
      color: theme.palette.secondary.main,
    },
  },
  paper: {
    backgroundColor: theme.palette.primary.main,
    height: '100vh',
    width: '300px',
  },
  content: {
    margin: theme.spacing(3),
  },
  whiteText: {
    color: '#fff',
  },
  heading: {
    fontSize: theme.typography.pxToRem(15),
    color: theme.palette.primary.secondary,
  },
}))

export default function SlateDrawer({
  open,
  slate,
  getOrientation,
  updateSlate,
  onExport,
  onDrawerClose,
}) {
  const dispatch = useDispatch()
  const classes = useStyles()
  const expanded =
    useSelector((state) => state.slateDrawerExpanded) || 'settingsPanel'

  const handleChange = (panel) => () => {
    if (panel !== 'settingsPanel' && Meteor.user().isAnonymous) {
      dispatch({
        type: 'registration',
        registrationOpen: true,
        registrationMessage: `Want to modify the slate? Registration takes but a moment.`,
      })
    } else {
      dispatch({ type: 'canvas', slateDrawerExpanded: panel })
    }
  }

  const handleClose = () => {
    onDrawerClose()
  }

  return (
    <SwipeableDrawer
      anchor="right"
      open={open || false}
      onClose={handleClose}
      onOpen={() => {}}
      disableBackdropTransition
      disableDiscovery={false}
      disableSwipeToOpen={false}
      classes={{ paper: classes.paper }}
      ModalProps={{
        BackdropProps: {
          invisible: true,
        },
      }}
    >
      <Accordion
        expanded={expanded === 'settingsPanel'}
        onChange={handleChange('settingsPanel')}
        classes={{ root: classes.accordion }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon color="secondary" />}
          aria-controls="settingsPanelbh-content"
          id="settingsPanelbh-header"
          color="secondary"
        >
          <Typography className={classes.heading}>General Settings</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <SlateSettings slate={slate} onChange={updateSlate} />
        </AccordionDetails>
      </Accordion>
      {!slate?.options?.eligibleForThemeCompilation && (
        <Accordion
          expanded={expanded === 'themePanel'}
          onChange={handleChange('themePanel')}
          classes={{ root: classes.accordion }}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon color="secondary" />}
            aria-controls="themePanelbh-content"
            id="themePanelbh-header"
            color="secondary"
          >
            <Typography className={classes.heading}>Themes</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <SlateThemes slate={slate} onChange={updateSlate} />
          </AccordionDetails>
        </Accordion>
      )}
      <Accordion
        expanded={expanded === 'colorPanel'}
        onChange={handleChange('colorPanel')}
        classes={{ root: classes.accordion }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon color="secondary" />}
          aria-controls="colorPanelbh-content"
          id="colorPanelbh-header"
          color="secondary"
        >
          <Typography className={classes.heading}>Slate Color</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <SlateColors slate={slate} onChange={updateSlate} />
        </AccordionDetails>
      </Accordion>
      <Accordion
        expanded={expanded === 'generateNodeColorsPanel'}
        onChange={handleChange('generateNodeColorsPanel')}
        classes={{ root: classes.accordion }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon color="secondary" />}
          aria-controls="generateNodeColorsPanelbh-content"
          id="generateNodeColorsPanelbh-header"
          color="secondary"
        >
          <Typography className={classes.heading}>
            Generate Node Colors
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
          <GenerateNodeColors slate={slate} />
        </AccordionDetails>
      </Accordion>
      {!slate?.options?.eligibleForThemeCompilation && (
        <>
          <Accordion
            expanded={expanded === 'embed'}
            onChange={handleChange('embed')}
            classes={{ root: classes.accordion }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon color="secondary" />}
              aria-controls="embedbh-content"
              id="embedbh-header"
              color="secondary"
            >
              <Typography className={classes.heading}>Embed</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <SlateEmbed slate={slate} getOrientation={getOrientation} />
            </AccordionDetails>
          </Accordion>
          <Accordion
            expanded={expanded === 'export'}
            onChange={handleChange('export')}
            classes={{ root: classes.accordion }}
          >
            <AccordionSummary
              expandIcon={<ExpandMoreIcon color="secondary" />}
              aria-controls="exportbh-content"
              id="exportbh-header"
              color="secondary"
            >
              <Typography className={classes.heading}>Export</Typography>
            </AccordionSummary>
            <AccordionDetails>
              <SlateExport slate={slate} onExport={onExport} />
            </AccordionDetails>
          </Accordion>
        </>
      )}
      <Accordion
        expanded={expanded === 'backgroundPanel'}
        onChange={handleChange('backgroundPanel')}
        classes={{ root: classes.accordion }}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon color="secondary" />}
          aria-controls="backgroundPanelbh-content"
          id="backgroundPanelbh-header"
        >
          <Typography className={classes.heading}>Backgrounds</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <SlateBackgrounds slate={slate} onChange={updateSlate} />
        </AccordionDetails>
      </Accordion>
    </SwipeableDrawer>
  )
}

SlateDrawer.propTypes = {
  open: PropTypes.func.isRequired,
  slate: slateProps.isRequired,
  getOrientation: PropTypes.func.isRequired,
  updateSlate: PropTypes.func.isRequired,
  onExport: PropTypes.func.isRequired,
  onDrawerClose: PropTypes.func.isRequired,
}
