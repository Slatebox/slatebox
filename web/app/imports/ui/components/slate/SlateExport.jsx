/* eslint-disable camelcase */
import React, { useEffect, useRef } from 'react'
import { Meteor } from 'meteor/meteor'
import PropTypes from 'prop-types'
import Grid from '@material-ui/core/Grid'
import Button from '@material-ui/core/Button/Button'
import { useSelector, useDispatch } from 'react-redux'
import Cookies from 'js-cookie'
import OauthPopup from 'react-oauth-popup'
import Tooltip from '@material-ui/core/Tooltip'
import IconButton from '@material-ui/core/IconButton'
import OpenInNewIcon from '@material-ui/icons/OpenInNew'
import FileCopyIcon from '@material-ui/icons/FileCopy'
import CONSTANTS from '../../../api/common/constants'
import promisify from '../../../api/client/promisify'
import { Messages } from '../../../api/common/models'

export default function SlateExport({ onExport }) {
  const slate = useSelector((state) => state.slate)
  const dispatch = useDispatch()
  const [oauthUrl, setUrl] = React.useState(null)
  const [lastDocUrl, setLastDocUrl] = React.useState(
    slate.options.lastSavedGoogleDocUrl
  )
  const [storedToken, setToken] = React.useState(
    Cookies.get(CONSTANTS.googleDocsCookieToken)
  )

  function msg(msg, line2) {
    dispatch({
      type: 'canvas',
      globalMessage: {
        visible: true,
        text: msg,
        line2,
        severity: 'info',
        autoHide: 5000,
      },
    })
  }

  useEffect(() => {
    async function getUrl() {
      const url = await promisify(
        Meteor.call,
        CONSTANTS.methods.googleDocs.createAuthUrl
      )
      setUrl(url)
    }
    getUrl()
  }, [])

  async function exportGoogleDoc() {
    let appToken = Cookies.get(CONSTANTS.googleDocsCookieToken)
    if (appToken) {
      appToken = JSON.parse(appToken)
      const valid = await (
        await fetch(
          `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${appToken.tokens.access_token}`
        )
      ).json()
      if (valid.error) {
        // global message errror
        Cookies.remove(CONSTANTS.googleDocsCookieToken)
        setToken(null)
        dispatch({
          type: 'canvas',
          globalMessage: {
            visible: true,
            text: `Your Google authentication has expired. Please click the 'Authenticate And Export To Google Docs' button to re-authenticate and export the slate!`,
            severity: 'error',
            autoHide: 10000,
          },
        })
      } else {
        msg(`Exporting to Google Docs...`)

        onExport('png', { base64: true }, async (base64) => {
          const details = await promisify(
            Meteor.call,
            CONSTANTS.methods.googleDocs.export,
            appToken,
            slate.options.id,
            base64
          )

          const gDocUrl = `https://docs.google.com/document/d/${details.documentId}/edit`

          setLastDocUrl(gDocUrl)

          // Messages.insert({
          //   timestamp: new Date().valueOf(),
          //   userId: Meteor.userId(),
          //   title: `Slate Exported To Google Docs`,
          //   text: `You've exported ${slate.options.name} to Google docs! <a href='https://docs.google.com/document/d/${details.documentId}/edit' target='_blank' style='color:#fff;font-size:14pt;'>Click here to view your slate.</a>`,
          //   read: false,
          //   type: CONSTANTS.messageTypes.system,
          //   priority: 10,
          // })

          msg(`Export Complete! Google Doc link copied to clipboard.`, gDocUrl)

          navigator.clipboard.writeText(gDocUrl)

          window.open(gDocUrl, '_blank')
        })
      }
    }
  }

  const onCode = async (code) => {
    const token = await promisify(
      Meteor.call,
      CONSTANTS.methods.googleDocs.getToken,
      code
    )
    Cookies.set(CONSTANTS.googleDocsCookieToken, JSON.stringify(token))
    setToken(Cookies.get(CONSTANTS.googleDocsCookieToken))
    await exportGoogleDoc()
  }

  const onClose = () => {}

  SlateExport.propTypes = {
    onExport: PropTypes.func.isRequired,
  }

  const handlePngSelection = async (index) => {
    switch (index) {
      case 1: {
        msg(`Retrieving Slate PNG cloud link...one moment.`)
        onExport('png', { base64: true }, async (base64) => {
          const url = await promisify(
            Meteor.call,
            CONSTANTS.methods.utils.getCloudLink,
            slate.options.id,
            base64
          )
          navigator.clipboard.writeText(url)
          msg(`Slatebox cloud link copied to clipboard!`, url)
        })
        break
      }
      case 0:
      default: {
        onExport('png')
        break
      }
    }
  }

  const handleSvgSelection = async (index) => {
    switch (index) {
      case 1: {
        msg(`Retrieving Slate SVG cloud...one moment.`)
        onExport('svg', {}, async (opts) => {
          const url = await promisify(
            Meteor.call,
            CONSTANTS.methods.utils.getCloudLink,
            slate.options.id,
            opts.svg,
            true
          )
          navigator.clipboard.writeText(url)
          msg(`Slatebox cloud link copied to clipboard!`, url)
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
    <Grid container alignItems="flex-start" justify="space-between" spacing={2}>
      <Grid item xs={2}>
        <Tooltip title="Copy PNG Slatebox Cloud Link">
          <IconButton
            aria-label="copy png slatebox cloud link"
            onClick={() => {
              handlePngSelection(1)
            }}
            edge="end"
          >
            <FileCopyIcon />
          </IconButton>
        </Tooltip>
      </Grid>
      <Grid item xs={10}>
        <Button
          variant="outlined"
          fullWidth
          onClick={(e) => handlePngSelection(0)}
        >
          Download PNG
        </Button>
      </Grid>
      <Grid item xs={2}>
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
      </Grid>
      <Grid item xs={10}>
        <Button
          variant="outlined"
          fullWidth
          onClick={(e) => handleSvgSelection(0)}
        >
          Download SVG
        </Button>
      </Grid>
      {lastDocUrl && (
        <Grid item xs={2}>
          <Tooltip title="Open last exported Google Doc">
            <IconButton
              aria-label="open google doc url"
              href={lastDocUrl}
              target="_blank"
              edge="end"
            >
              <OpenInNewIcon />
            </IconButton>
          </Tooltip>
        </Grid>
      )}
      <Grid item xs={lastDocUrl ? 10 : 12}>
        {storedToken ? (
          <Button
            variant="outlined"
            fullWidth
            onClick={(e) => {
              exportGoogleDoc()
            }}
          >
            Export To Google Docs
          </Button>
        ) : (
          <OauthPopup
            title="Save Slate to Google docs"
            url={oauthUrl}
            onCode={onCode}
            onClose={onClose}
          >
            <Button
              variant="outlined"
              id="btnGoogle"
              color="secondary"
              fullWidth
            >
              Authenticate And Export To Google Docs
            </Button>
          </OauthPopup>
        )}
      </Grid>
    </Grid>
  )
}
