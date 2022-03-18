import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useDispatch, useSelector } from 'react-redux'
import Grid from '@material-ui/core/Grid'
import TextField from '@material-ui/core/TextField'
import Switch from '@material-ui/core/Switch'
import Typography from '@material-ui/core/Typography/Typography'
import { Tooltip } from '@material-ui/core'
import IconButton from '@material-ui/core/IconButton'
import FileCopyIcon from '@material-ui/icons/FileCopy'
import promisify from '../../../api/client/promisify'
import CONSTANTS from '../../../api/common/constants'
import slateProps from '../../propTypes/slatePriops'

export default function SlateEmbed({ slate, getOrientation }) {
  const dispatch = useDispatch()
  const lastEmbedSize = useSelector((state) => state.lastEmbedSize) || 600
  const lastEmbedTemplate = useSelector((state) => state.lastEmbedTemplate)
  const isIFrame = useSelector((state) => state.isIFrame) || true

  const handleSize = (e) => {
    dispatch({ type: 'embed', lastEmbedSize: e.target.value })
  }

  const setIFrame = (e) => {
    dispatch({ type: 'embed', isIFrame: e.target.checked })
  }

  async function load() {
    const embedOpts = {
      slateId: slate?.shareId,
      orient: getOrientation(),
      size: lastEmbedSize,
    }
    const template = await promisify(
      Meteor.call,
      CONSTANTS.methods.slates.getEmbedCode,
      embedOpts
    )
    dispatch({ type: 'embed', lastEmbedTemplate: template })
  }

  useEffect(() => {
    load()
  }, [lastEmbedSize, slate?.slateId])

  function copyEmbeddableCode() {
    navigator.clipboard.writeText(
      isIFrame ? lastEmbedTemplate?.iframe_share : lastEmbedTemplate?.non_share
    )
    dispatch({
      type: 'canvas',
      globalMessage: {
        visible: true,
        isSnackBar: true,
        text: `Embeddable code copied to clipboard!`,
        severity: 'info',
        autoHide: 10000,
      },
    })
  }

  SlateEmbed.propTypes = {
    slate: slateProps.isRequired,
    getOrientation: PropTypes.func.isRequired,
  }

  return (
    <Grid container alignItems="center" justify="center" spacing={4}>
      <Grid item xs={12}>
        Embed this slate on your own site. This will respect your current slate
        sharing settings.
      </Grid>
      {/* <Grid item xs={4}>
        <TextField
          label="Size"
          size="small"
          variant="outlined"
          onChange={handleSize}
          value={lastEmbedSize}
          fullWidth
        />
      </Grid>
      <Grid item xs={8}>
        <Grid container alignItems="center" justify="center" spacing={4}>
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
      <Grid item xs={2}>
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
      <Grid item xs={10}>
        <TextField
          multiline
          rows={2}
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
          InputLabelProps={{
            style: { color: '#fff' },
          }}
        />
      </Grid>
    </Grid>
  )
}
