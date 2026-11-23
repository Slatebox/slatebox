/* eslint-disable camelcase */
import React, { useEffect, useRef } from 'react'
import { Meteor } from 'meteor/meteor'
import PropTypes from 'prop-types'
import Grid from '@mui/material/Grid2'
import Button from '@mui/material/Button/Button'
import { useAtomValue, useAtom, useSetAtom } from 'jotai'
import Cookies from 'js-cookie'
import OauthPopup from 'react-oauth-popup'
import Tooltip from '@mui/material/Tooltip'
import IconButton from '@mui/material/IconButton'
import OpenInNewIcon from '@mui/icons-material/OpenInNew'
import FileCopyIcon from '@mui/icons-material/FileCopy'
import CONSTANTS from '../../../api/common/constants'
import promisify from '../../../api/client/promisify'
import { Messages } from '../../../api/common/models'
import { currentSlate, globalMessage, mermaidDialog, slateOutputOpen } from '../../jotai/atoms'

export default function SlateExport({ onExport }) {
  const slate = useAtomValue(currentSlate)
  const [message, setMessage] = useAtom(globalMessage)
  const openMermaid = useSetAtom(mermaidDialog)
  const setSlateOutput = useSetAtom(slateOutputOpen)
  const [oauthUrl, setUrl] = React.useState(null)
  const [lastDocUrl, setLastDocUrl] = React.useState(
    slate?.options?.lastSavedGoogleDocUrl
  )
  const [storedToken, setToken] = React.useState(
    Cookies.get(CONSTANTS.googleDocsCookieToken)
  )

  function msg(msg, line2) {
    setMessage({
      visible: true,
      text: msg,
      line2,
      severity: 'info',
      autoHide: 5000,
    })
  }

  const hasSlate = Boolean(slate)
  useEffect(() => {
    if (!hasSlate) {
      setUrl(null)
      return
    }
    let active = true
    Meteor.callAsync(CONSTANTS.methods.googleDocs.createAuthUrl)
      .then(url => { if (active) setUrl(url) })
      .catch(() => { if (active) setUrl(null) })
    return () => { active = false }
  }, [hasSlate])

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
        setMessage({
          visible: true,
          text: `Your Google authentication has expired. Please click the 'Authenticate And Export To Google Docs' button to re-authenticate and export the slate!`,
          severity: 'error',
          autoHide: 10000,
        })
      } else {
        msg(`Exporting to Google Docs...`)

        onExport('png', { base64: true }, async (base64) => {
          const details = await Meteor.callAsync(
            CONSTANTS.methods.googleDocs.export,
            appToken,
            slate.options.id,
            base64
          )

          const gDocUrl = `https://docs.google.com/document/d/${details.documentId}/edit`

          setLastDocUrl(gDocUrl)

          // await Messages.insertAsync({
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
    const token = await Meteor.callAsync(
      CONSTANTS.methods.googleDocs.getToken,
      code
    )
    if (!token) {
      msg('Google Docs authorization could not be completed.')
      return
    }
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
      <Grid size={2}>
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
      </Grid>
      <Grid size={10}>
        <Button
          variant="outlined"
          color="secondary"
          fullWidth
          onClick={(e) => handlePngSelection(0)}
        >
          Download PNG
        </Button>
      </Grid>
      <Grid size={2}>
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
      <Grid size={10}>
        <Button
          variant="outlined"
          color="secondary"
          fullWidth
          onClick={(e) => handleSvgSelection(0)}
        >
          Download SVG
        </Button>
      </Grid>
      {lastDocUrl && (
        <Grid size={2}>
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
      {oauthUrl && <Grid size={lastDocUrl ? 10 : 12}>
        {storedToken ? (
          <Button
            variant="outlined"
            fullWidth
            color="secondary"
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
      </Grid>}
    </Grid>
  )
}
