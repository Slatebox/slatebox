import React, { useEffect } from 'react'
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

//global models
import { Slates } from '/imports/api/common/models.js'

import { CONSTANTS } from '/imports/api/common/constants.js'
import { copySlate } from '/imports/api/client/copySlate.js'
import { useDispatch, useSelector } from 'react-redux'
import confirmService from '/imports/ui/common/confirm'
import AuthManager from '../../api/common/AuthManager.js'
import { Organizations, SlateAccess } from '../../api/common/models.js'
import MoreVertIcon from '@material-ui/icons/MoreVert'
import MenuItem from '@material-ui/core/MenuItem'
import Menu from '@material-ui/core/Menu'
import ListItemIcon from '@material-ui/core/ListItemIcon'

import { promisify } from '../../api/client/promisify.js'

export const SlateMenu = (props) => {
  const history = useHistory()
  const dispatch = useDispatch()
  const theme = useTheme()

  async function copy() {
    const shareId = await copySlate(props.slate, !props.isTemplate)
    //causes rerender:
    dispatch({ type: 'displayslates', invokeRerender: Random.id() })
    if (props.isCommunity || props.isTemplate) {
      history.push(`/canvas/${shareId}`)
    }
  }

  async function deleteSlate() {
    console.log('slateid', props.slate._id)
    const result = await confirmService.show({
      theme: theme,
      title: `Delete ${props.slate.options.name}`,
      message: 'Are you sure?',
    })
    if (result) {
      try {
        await promisify(Meteor.call, CONSTANTS.methods.slates.remove, {
          slateId: props.slate._id,
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
      const curPublic = !props.slate.options.isPublic
      let isPublic = curPublic
      let isPrivate = curPublic === false
      let isUnlisted = false
      Slates.update(
        { _id: props.slate._id },
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
      props.slate.options.isPublic
    ) {
      const nonPublics = await promisify(
        Meteor.call,
        CONSTANTS.methods.slates.getNonPublic
      )
      if (nonPublics.length >= CONSTANTS.privateSlateLimit) {
        //past the limit, so show payment options OR registration depending on user state
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
    <>
      {props.isTemplate ? (
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
                {props.isTemplate ? <>Use</> : <>Copy</>} Slate
              </Typography>
            </MenuItem>
            {!props.isCommunity &&
              !props.isTemplate &&
              (Meteor.userId() === props.slate.userId ||
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
            {!props.isCommunity &&
              !props.isTemplate &&
              Meteor.userId() === props.slate.userId && (
                <MenuItem
                  onClick={async (e) => {
                    hideSlateMenu(e)
                    changeSlatePrivacy()
                  }}
                >
                  <ListItemIcon style={{ marginRight: '-25px' }}>
                    {props.slate.options.isPublic ? (
                      <LockOpenIcon />
                    ) : (
                      <LockIcon />
                    )}
                  </ListItemIcon>
                  <Typography variant="inherit">
                    {props.slate.options.isPublic
                      ? 'Make private'
                      : 'Make public'}
                  </Typography>
                </MenuItem>
              )}
          </Menu>
        </>
      )}
    </>
  )
}
