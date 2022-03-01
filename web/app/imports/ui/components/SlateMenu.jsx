/* eslint-disable no-underscore-dangle */
import React from 'react'
import PropTypes from 'prop-types'
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { useTheme } from '@material-ui/core/styles'
import { useHistory } from 'react-router-dom'
import Typography from '@material-ui/core/Typography'
import IconButton from '@material-ui/core/IconButton'
import Button from '@material-ui/core/Button'
import FileCopyIcon from '@material-ui/icons/FileCopy'
import DeleteIcon from '@material-ui/icons/Delete'
import LockOpenIcon from '@material-ui/icons/LockOpen'
import LockIcon from '@material-ui/icons/Lock'
import { useDispatch } from 'react-redux'
import MoreVertIcon from '@material-ui/icons/MoreVert'
import MenuItem from '@material-ui/core/MenuItem'
import Menu from '@material-ui/core/Menu'
import ListItemIcon from '@material-ui/core/ListItemIcon'
import { Slates, Organizations } from '../../api/common/models'
import confirmService from '../common/confirm'
import copySlate from '../../api/client/copySlate'
import CONSTANTS from '../../api/common/constants'
import AuthManager from '../../api/common/AuthManager'

import promisify from '../../api/client/promisify'
import slateProps from '../propTypes/slatePriops'

export default function SlateMenu({ slate, isTemplate, isCommunity }) {
  const history = useHistory()
  const dispatch = useDispatch()
  const theme = useTheme()

  async function copy() {
    const shareId = await copySlate(slate, !isTemplate)
    // causes rerender:
    dispatch({ type: 'displayslates', invokeRerender: Random.id() })
    if (isCommunity || isTemplate) {
      history.push(`/canvas/${shareId}`)
    }
  }

  async function deleteSlate() {
    const result = await confirmService.show({
      theme,
      title: `Delete ${slate.options.name}`,
      message: 'Are you sure?',
    })
    if (result) {
      try {
        await promisify(Meteor.call, CONSTANTS.methods.slates.remove, {
          slateId: slate._id,
        })
        dispatch({ type: 'displayslates', invokeRerender: Random.id() })
      } catch (err) {
        dispatch({
          type: 'canvas',
          globalMessage: {
            visible: true,
            text: `Error deleting: ${err.message}`,
            severity: 'error',
            autoHide: 60000,
          },
        })
      }
    }
  }

  async function changeSlatePrivacy() {
    function enact() {
      const curPublic = !slate.options.isPublic
      const isPublic = curPublic
      const isPrivate = curPublic === false
      const isUnlisted = false
      Slates.update(
        { _id: slate._id },
        {
          $set: {
            'options.isPublic': isPublic,
            'options.isPrivate': isPrivate,
            'options.isUnlisted': isUnlisted,
          },
        }
      )
      dispatch({ type: 'displayslates', invokeRerender: Random.id() })
    }
    if (
      ((!Meteor.user().orgId &&
        !['solo_monthly', 'solo_yearly'].includes(Meteor.user().planType)) ||
        Organizations.findOne()?.planType === 'free') &&
      slate.options.isPublic
    ) {
      const nonPublics = await promisify(
        Meteor.call,
        CONSTANTS.methods.slates.getNonPublic
      )
      if (nonPublics.length >= CONSTANTS.privateSlateLimit) {
        // past the limit, so show payment options OR registration depending on user state
        if (Meteor.user().isAnonymous) {
          dispatch({
            type: 'registration',
            registrationOpen: true,
            registrationMessage: `You've already set 3 slates as private or unlisted. The next step is to register your account so you can upgrade for unlimited private slates!`,
          })
        } else {
          dispatch({
            type: 'payment',
            paymentOpen: true,
            paymentMessage: `Upgrade to have more than ${
              CONSTANTS.privateSlateLimit
            } private or unlisted slates. (Current private or unlisted slates: ${nonPublics
              .map((p) => p.name)
              .join(', ')}.)`,
            paymentFocus: `more than ${CONSTANTS.privateSlateLimit} private slates`,
            paymentEmphasis: `Upgrade below.`,
          })
        }
      } else {
        enact()
      }
    } else {
      enact()
    }
  }

  const [slateAnchorEl, setSlateAnchorEl] = React.useState(null)

  function showSlateMenu(e) {
    e.stopPropagation()
    setSlateAnchorEl(e.currentTarget)
  }

  function hideSlateMenu(e) {
    e.stopPropagation()
    e.preventDefault()
    setSlateAnchorEl(null)
  }

  return (
    <div>
      {isTemplate ? (
        <Button
          variant="contained"
          color="secondary"
          style={{ minWidth: '160px' }}
          onClick={(e) => {
            e.stopPropagation()
            copy()
          }}
        >
          Use Template
        </Button>
      ) : (
        <>
          <IconButton
            aria-controls="slate-menu"
            aria-haspopup="true"
            color="inherit"
            onClick={(e) => {
              showSlateMenu(e)
            }}
          >
            <MoreVertIcon />
          </IconButton>
          <Menu
            id="slate-menu"
            anchorEl={slateAnchorEl}
            keepMounted
            open={Boolean(slateAnchorEl)}
            onClose={(e) => {
              hideSlateMenu(e)
            }}
          >
            <MenuItem
              onClick={(e) => {
                hideSlateMenu(e)
                copy()
              }}
            >
              <ListItemIcon style={{ marginRight: '-25px' }}>
                <FileCopyIcon />
              </ListItemIcon>
              <Typography variant="inherit">
                {isTemplate ? <>Use</> : <>Copy</>} Slate
              </Typography>
            </MenuItem>
            {!isCommunity &&
              !isTemplate &&
              (Meteor.userId() === slate.userId ||
                AuthManager.userHasClaim(Meteor.userId(), [
                  CONSTANTS.claims.admin._id,
                ])) && (
                <MenuItem
                  onClick={async (e) => {
                    hideSlateMenu(e)
                    deleteSlate()
                  }}
                >
                  <ListItemIcon style={{ marginRight: '-25px' }}>
                    <DeleteIcon />
                  </ListItemIcon>
                  <Typography variant="inherit">Delete</Typography>
                </MenuItem>
              )}
            {!isCommunity && !isTemplate && Meteor.userId() === slate.userId && (
              <MenuItem
                onClick={async (e) => {
                  hideSlateMenu(e)
                  changeSlatePrivacy()
                }}
              >
                <ListItemIcon style={{ marginRight: '-25px' }}>
                  {slate.options.isPublic ? <LockOpenIcon /> : <LockIcon />}
                </ListItemIcon>
                <Typography variant="inherit">
                  {slate.options.isPublic ? 'Make private' : 'Make public'}
                </Typography>
              </MenuItem>
            )}
          </Menu>
        </>
      )}
    </div>
  )
}

SlateMenu.propTypes = {
  slate: slateProps.isRequired,
  isTemplate: PropTypes.bool.isRequired,
  isCommunity: PropTypes.bool.isRequired,
}
