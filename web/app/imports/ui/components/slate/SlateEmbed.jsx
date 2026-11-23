import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useAtom } from 'jotai'
import Grid from '@mui/material/Grid2'
import TextField from '@mui/material/TextField'
import Switch from '@mui/material/Switch'
import Typography from '@mui/material/Typography/Typography'
import { Tooltip } from '@mui/material'
import IconButton from '@mui/material/IconButton'
import FileCopyIcon from '@mui/icons-material/FileCopy'
import promisify from '../../../api/client/promisify'
import CONSTANTS from '../../../api/common/constants'
import slateProps from '../../propTypes/slateProps'

import {
  globalMessage,
  slateEmbedIsIFrame,
  slateEmbedSize,
  slateLastEmbedTemplate,
} from '../../jotai/atoms'

export default function SlateEmbed({ slate, getOrientation }) {
  const [message, setMessage] = useAtom(globalMessage)
  const [lastEmbedSize, setLastEmbedSize] = useAtom(slateEmbedSize)
  const [lastEmbedTemplate, setLastEmbedTemplate] = useAtom(
    slateLastEmbedTemplate
  )
  const [isIFrame, setIsIFrame] = useAtom(slateEmbedIsIFrame)

  const handleSize = (e) => {
    setLastEmbedSize(e.target.value)
  }

  const setIFrame = (e) => {
    setIsIFrame(e.target.checked)
  }

  async function load() {
    const embedOpts = {
      slateId: slate?.shareId,
      orient: getOrientation(),
      size: lastEmbedSize,
    }
    const template = await Meteor.callAsync(
      CONSTANTS.methods.slates.getEmbedCode,
      embedOpts
    )
    setLastEmbedTemplate(template)
  }

  useEffect(() => {
    load()
  }, [lastEmbedSize, slate?.slateId])

  function copyEmbeddableCode() {
    navigator.clipboard.writeText(
      isIFrame ? lastEmbedTemplate?.iframe_share : lastEmbedTemplate?.non_share
    )
    setMessage({
      visible: true,
      isSnackBar: true,
      text: `Embeddable code copied to clipboard!`,
      severity: 'info',
      autoHide: 10000,
    })
  }

  SlateEmbed.propTypes = {
    slate: slateProps,
    getOrientation: PropTypes.func.isRequired,
  }

  return (
    <Grid container alignItems="center" justifyContent="center" spacing={4}>
      <Grid size={12}>
        Publish a presentation of this slate to show a read-only snapshot on your site.
        Unpublishing the presentation removes it from the embed.
      </Grid>
      {/* <Grid size={4}>
        <TextField
          label="Size"
          size="small"
          variant="outlined"
          onChange={handleSize}
          value={lastEmbedSize}
          fullWidth
        />
      </Grid>
      <Grid size={8}>
        <Grid container alignItems="center" justifyContent="center" spacing={4}>
          <Typography>iFrame</Typography>
          <Tooltip
            title="iFrame embed code may be more compatible. If you're having trouble embedding, try this."
            placement="top"
            aria-label="searchForCustomShape"
          >
            <Switch onChange={setIFrame} value={isIFrame} />
          </Tooltip>
        </Grid>
      </Grid> */}
      <Grid size={2}>
        <Tooltip title="Copy embeddable code to clipboard">
          <IconButton
            aria-label="copy embeddable code"
            onClick={() => {
              copyEmbeddableCode()
            }}
            edge="end"
          >
            <FileCopyIcon />
          </IconButton>
        </Tooltip>
      </Grid>
      <Grid size={10}>
        <TextField
          multiline
          maxRows={2}
          value={
            isIFrame
              ? lastEmbedTemplate?.iframe_share
              : lastEmbedTemplate?.non_share
          }
          variant="outlined"
          fullWidth
          autoFocus
          onFocus={(e) => {
            const self = e.target
            setTimeout(() => {
              // eslint-disable-next-line no-multi-assign
              self.selectionStart = self.selectionEnd = 10000
            }, 0)
          }}
          slotProps={{
            inputLabel: {
              style: { color: '#fff' },
            },
          }}
        />
      </Grid>
    </Grid>
  )
}
