// The slate's export panel: Mermaid, PNG and SVG downloads (and cloud links where the host has an
// image store). Google Drive and Docs are the Google integration's (enterprise code, free): the
// slate.export.google slot, empty where enterprise code does not run.
import React from 'react'
import { Meteor } from 'meteor/meteor'
import PropTypes from 'prop-types'
import Grid from '@mui/material/Grid2'
import Button from '@mui/material/Button/Button'
import { useAtomValue, useAtom, useSetAtom } from 'jotai'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import FileCopyIcon from '@mui/icons-material/FileCopy'
import CONSTANTS from '../../../api/common/constants'
import { currentSlate, globalMessage, mermaidDialog, slateOutputOpen } from '../../jotai/atoms'
import EnterpriseSlot from '../../common/EnterpriseSlot'

// A cloud link stores the image in the hosted service's S3 bucket. A
// self-hosted instance offers it only when its operator configured one.
const cloudLinks = Meteor.settings.public.env !== 'selfhost' || Meteor.settings.public.cloudLinks === true

export default function SlateExport({ onExport }) {
  const slate = useAtomValue(currentSlate)
  const [message, setMessage] = useAtom(globalMessage)
  const openMermaid = useSetAtom(mermaidDialog)
  const setSlateOutput = useSetAtom(slateOutputOpen)
  function msg(msg, line2) {
    setMessage({
      visible: true,
      text: msg,
      line2,
      severity: 'info',
      autoHide: 5000,
    })
  }

  SlateExport.propTypes = {
    onExport: PropTypes.func.isRequired,
  }

  const handlePngSelection = async (index) => {
    switch (index) {
      case 1: {
        msg(`Retrieving Slate PNG cloud link...one moment.`)
        onExport('png', { base64: true }, async (base64) => {
          const urlDetails = await Meteor.callAsync(
            CONSTANTS.methods.utils.getCloudLink,
            slate.options.id,
            base64
          )
          navigator.clipboard.writeText(urlDetails.slateImageUrl)
          msg(
            `Slatebox cloud link copied to clipboard!`,
            urlDetails.slateImageUrl
          )
        })
        break
      }
      case 0:
      default: {
        // The picture comes back as a data URL; save it under the slate's name.
        onExport('png', {}, (dataUrl) => {
          if (typeof dataUrl !== 'string' || !dataUrl) return
          const dl = document.createElement('a')
          dl.href = dataUrl
          dl.download = `${(slate?.options.name || 'slate')
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase()}_${slate?.shareId}.png`
          dl.click()
        })
        break
      }
    }
  }

  const handleSvgSelection = async (index) => {
    switch (index) {
      case 1: {
        msg(`Retrieving Slate SVG cloud...one moment.`)
        onExport('svg', {}, async (opts) => {
          const urlDetails = await Meteor.callAsync(
            CONSTANTS.methods.utils.getCloudLink,
            slate.options.id,
            opts.svg,
            true
          )
          navigator.clipboard.writeText(urlDetails.slateImageUrl)
          msg(
            `Slatebox cloud link copied to clipboard!`,
            urlDetails.slateImageUrl
          )
        })
        break
      }
      case 0:
      default: {
        onExport('svg', {}, (opts) => {
          const svgBlob = new Blob([opts.svg], {
            type: 'image/svg+xml;charset=utf-8',
          })
          const svgUrl = URL.createObjectURL(svgBlob)
          const dl = document.createElement('a')
          dl.href = svgUrl
          dl.download = `${(slate?.options.name || 'slate')
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase()}_${slate?.shareId}.svg`
          dl.click()
        })
        break
      }
    }
  }

  return (
    <Grid
      container
      alignItems="flex-start"
      justifyContent="space-between"
      spacing={2}
    >
      <Grid size={12}>
        <Button
          variant="contained"
          color="secondary"
          fullWidth
          onClick={() => {
            setSlateOutput(null)
            openMermaid('export')
          }}
        >
          Mermaid: export or import
        </Button>
      </Grid>
      {cloudLinks && <Grid size={2}>
        <Tooltip title="Copy PNG Slatebox Cloud Link">
          <IconButton
            aria-label="copy png slatebox cloud link"
            onClick={() => {
              handlePngSelection(1)
            }}
            id="sbCreatePNGCloudLink"
            edge="end"
          >
            <FileCopyIcon />
          </IconButton>
        </Tooltip>
      </Grid>}
      <Grid size={cloudLinks ? 10 : 12}>
        <Button
          variant="outlined"
          color="secondary"
          fullWidth
          onClick={(e) => handlePngSelection(0)}
        >
          Download PNG
        </Button>
      </Grid>
      {cloudLinks && <Grid size={2}>
        <Tooltip title="Copy SVG Slatebox Cloud Link">
          <IconButton
            aria-label="copy svg slatebox cloud link"
            onClick={() => {
              handleSvgSelection(1)
            }}
            edge="end"
          >
            <FileCopyIcon />
          </IconButton>
        </Tooltip>
      </Grid>}
      <Grid size={cloudLinks ? 10 : 12}>
        <Button
          variant="outlined"
          color="secondary"
          fullWidth
          onClick={(e) => handleSvgSelection(0)}
        >
          Download SVG
        </Button>
      </Grid>
      <EnterpriseSlot name="slate.export.google" onExport={onExport} />
    </Grid>
  )
}
