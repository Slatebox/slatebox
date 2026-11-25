import React, { useEffect, useRef } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Box, IconButton, Paper, Tooltip } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import Accordion from '@mui/material/Accordion'
import AccordionSummary from '@mui/material/AccordionSummary'
import AccordionDetails from '@mui/material/AccordionDetails'
import Typography from '@mui/material/Typography'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import { useAtom } from 'jotai'
import SlateSettings from './slate/SlateSettings'
import SlateColors from './slate/SlateColors'
import SlateBackgrounds from './slate/SlateBackgrounds'
import SlateStyle from './slate/SlateStyle'
import GenerateNodeColors from './slate/GenerateNodeColors'
import slateProps from '../propTypes/slateProps'
import {
  whichSlatePanelIsExpanded,
  registrationDetails,
  isSlateDrawerOpen,
} from '../jotai/atoms'
import SlateLayout from './slate/SlateLayout'

/**
 * The slate's settings: a panel beside the canvas under the header (under it on a narrow screen),
 * in the same place as Ask Slatebox and never open with it (the canvas page closes one when the
 * other opens). It takes its room from the canvas, as Ask Slatebox does, so it covers none of the
 * canvas's controls. It holds no Export or Embed; those open from the slate menu. Its × and Escape
 * close it, and the keyboard goes back to the slate menu.
 */
export default function SlateDrawer({
  slate,
  updateSlate,
}) {
  // const expanded =
  //   useSelector((state) => state.whichSlatePanelIsExpanded) || 'settingsPanel'
  const [slateDrawerIsOpen, setSlateDrawerOpen] = useAtom(isSlateDrawerOpen)
  // Generated colours and automatic layout restyle or move every note on a slate. On a
  // workshop slate the lanes and cards are the workshop's drawing, so these are not offered there.
  const onWorkshop = slate?.creativeKind === 'workshop'
  const [expandedPanel, setExpanded] = useAtom(whichSlatePanelIsExpanded)
  const [getRegistrationDetails, setRegistrationDetails] =
    useAtom(registrationDetails)
  
  const handleChange = (panel) => () => {
    if (panel !== 'settingsPanel' && Meteor.user().isAnonymous) {
      setRegistrationDetails({
        type: 'registration',
        registrationOpen: true,
        registrationMessage: `Save your work to use colors, exports and sharing controls.`,
      })
    } else {
      setExpanded(panel)
    }
  }

  const panel = useRef(null)
  const wide = '@media (min-width:1000px)'
  const handleClose = () => {
    setSlateDrawerOpen(false)
    requestAnimationFrame(() => document.querySelector('.sb-board-title')?.focus())
  }
  // Opened: the keyboard goes to it.
  useEffect(() => {
    if (slateDrawerIsOpen) requestAnimationFrame(() => panel.current?.focus())
  }, [slateDrawerIsOpen])

  return (
    slateDrawerIsOpen ? <Paper
      component="aside"
      square
      elevation={3}
      ref={panel}
      tabIndex={-1}
      role="complementary"
      aria-label="Slate settings"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); handleClose() } }}
      sx={{
        position: 'relative',
        zIndex: 1200,
        flexShrink: 0,
        boxSizing: 'border-box',
        overflowY: 'auto',
        outline: 'none',
        borderTop: 1,
        borderColor: 'divider',
        // Under a narrow canvas it leaves the canvas at least 130px, as Ask Slatebox does.
        maxHeight: 'min(57dvh, max(130px, calc(100dvh - 250px - var(--sb-cookie-room, 0px))))',
        [wide]: { width: 300, maxHeight: 'none', borderTop: 0 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, pt: 1.5, pb: 1 }}>
        <Typography component="h2" variant="h6">Slate settings</Typography>
        <Tooltip title="Close"><IconButton aria-label="Close slate settings" onClick={handleClose} sx={{ mr: -1 }}><CloseIcon /></IconButton></Tooltip>
      </Box>
      <Accordion
        expanded={expandedPanel === 'settingsPanel'}
        onChange={handleChange('settingsPanel')}
      >
        <AccordionSummary
          expandIcon={<ExpandMoreIcon color="secondary" />}
          aria-controls="settingsPanelbh-content"
          id="settingsPanelbh-header"
        >
          <Typography
            sx={{ fontSize: (theme) => theme.typography.pxToRem(15) }}
          >
            General Settings
          </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ margin: (theme) => theme.spacing(1) }}>
          <SlateSettings slate={slate} onChange={updateSlate} />
        </AccordionDetails>
      </Accordion>
      <Accordion
        expanded={expandedPanel === 'colorPanel'}
        onChange={handleChange('colorPanel')}
      >
        <AccordionSummary
        expandIcon={<ExpandMoreIcon color="secondary" />}
        aria-controls="colorPanelbh-content"
        id="colorPanelbh-header"
        >
        <Typography
          sx={{ fontSize: (theme) => theme.typography.pxToRem(15) }}
        >
          Slate style
        </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ margin: (theme) => theme.spacing(1) }}>
        {/* The slate's style (it replaces the old themes), with custom colors and backgrounds under it. */}
        <SlateStyle>
          <SlateColors slate={slate} onChange={updateSlate} />
          {Meteor.settings.public.pixabayAPIKey && <SlateBackgrounds slate={slate} onChange={updateSlate} />}
        </SlateStyle>
        </AccordionDetails>
      </Accordion>
      {!onWorkshop && (
      <Accordion
        expanded={expandedPanel === 'generateNodeColorsPanel'}
        onChange={handleChange('generateNodeColorsPanel')}
      >
        <AccordionSummary
        expandIcon={<ExpandMoreIcon color="secondary" />}
        aria-controls="generateNodeColorsPanelbh-content"
        id="generateNodeColorsPanelbh-header"
        >
        <Typography
          sx={{ fontSize: (theme) => theme.typography.pxToRem(15) }}
        >
          Generate Node Colors
        </Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ margin: (theme) => theme.spacing(1) }}>
        <GenerateNodeColors slate={slate} />
        </AccordionDetails>
      </Accordion>
      )}
      {!onWorkshop && (
        <Accordion
          expanded={expandedPanel === 'layoutPanel'}
          onChange={handleChange('layoutPanel')}
        >
          <AccordionSummary
            expandIcon={<ExpandMoreIcon color="secondary" />}
            aria-controls="layoutPanel-content"
            id="layoutPanel-header"
          >
            <Typography
              sx={{ fontSize: (theme) => theme.typography.pxToRem(15) }}
            >
              Layout
            </Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ margin: (theme) => theme.spacing(1) }}>
            <SlateLayout slate={slate} onChange={updateSlate} />
          </AccordionDetails>
        </Accordion>
      )}
      {/* Background images (Pixabay, the instance's own key) are under the slate style's Custom colors. */}
    </Paper> : null
  )
}

SlateDrawer.propTypes = {
  slate: slateProps,
  updateSlate: PropTypes.func.isRequired,
}
