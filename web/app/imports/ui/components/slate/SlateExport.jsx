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
import TextField from '@material-ui/core/TextField'
import OpenInNewIcon from '@material-ui/icons/OpenInNew'
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
      console.log('valid is', valid)
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
        dispatch({
          type: 'canvas',
          globalMessage: {
            visible: true,
            text: `Exporting to Google Docs...`,
            severity: 'info',
            autoHide: 10000,
          },
        })

        onExport('png', { base64: true }, async (base64) => {
          const details = await promisify(
            Meteor.call,
            CONSTANTS.methods.googleDocs.export,
            appToken,
            slate.options.id,
            base64
          )

          setLastDocUrl(
            `https://docs.google.com/document/d/${details.documentId}/edit`
          )

          // Messages.insert({
          //   timestamp: new Date().valueOf(),
          //   userId: Meteor.userId(),
          //   title: `Slate Exported To Google Docs`,
          //   text: `You've exported ${slate.options.name} to Google docs! <a href='https://docs.google.com/document/d/${details.documentId}/edit' target='_blank' style='color:#fff;font-size:14pt;'>Click here to view your slate.</a>`,
          //   read: false,
          //   type: CONSTANTS.messageTypes.system,
          //   priority: 10,
          // })

          dispatch({
            type: 'canvas',
            globalMessage: {
              visible: false,
            },
          })

          window.open(
            `https://docs.google.com/document/d/${details.documentId}/edit`,
            '_blank'
          )
        })
      }
    }
  }

  const onCode = async (code) => {
    console.log('got code', code)
    const token = await promisify(
      Meteor.call,
      CONSTANTS.methods.googleDocs.getToken,
      code
    )
    console.log('retrieved token', token)
    Cookies.set(CONSTANTS.googleDocsCookieToken, JSON.stringify(token))
    setToken(Cookies.get(CONSTANTS.googleDocsCookieToken))
    await exportGoogleDoc()
  }

  const onClose = () => console.log('closed!')

  const exportSVG = () => {
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
  }

  const exportPNG = () => {
    onExport('png')
  }

  SlateExport.propTypes = {
    onExport: PropTypes.func.isRequired,
  }

  return (
    <Grid container alignItems="flex-start" justify="space-between" spacing={2}>
      <Grid item xs={6}>
        <Button
          variant="outlined"
          color="secondary"
          fullWidth
          onClick={exportPNG}
        >
          PNG
        </Button>
      </Grid>
      <Grid item xs={6}>
        <Button
          variant="outlined"
          color="secondary"
          fullWidth
          onClick={exportSVG}
        >
          SVG
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
      <Grid item xs={10}>
        {storedToken ? (
          <Button
            variant="outlined"
            color="secondary"
            size="large"
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
              size="small"
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
