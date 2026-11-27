/* eslint-disable no-underscore-dangle */
import React from 'react'
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { useTheme } from '@mui/material/styles'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import FileCopyIcon from '@mui/icons-material/FileCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import LockIcon from '@mui/icons-material/Lock'
import { useAtom } from 'jotai'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import MenuItem from '@mui/material/MenuItem'
import Menu from '@mui/material/Menu'
import ListItemIcon from '@mui/material/ListItemIcon'
import confirmService from '../common/confirm'
import copySlate from '../../api/client/copySlate'
import CONSTANTS from '../../api/common/constants'
import AuthManager from '../../api/common/AuthManager'

import slateProps from '../propTypes/slateProps'
import usePhoneView from '../common/usePhoneView'

import {
  globalMessage,
  slateRererender,
} from '../jotai/atoms'

// The menu on a slate in your own lists (My slates, Team slates): make a copy, delete it, make it public or private.
export default function SlateMenu({ slate }) {
  const theme = useTheme()
  const [, setRerender] = useAtom(slateRererender)
  const [, setMessage] = useAtom(globalMessage)
  // A copy is a new slate: not made on a phone (phoneView.mjs).
  const phoneView = usePhoneView()

  async function copy() {
    await copySlate(slate.shareId)
    // causes rerender:
    setRerender(Random.id())
  }

  async function deleteSlate() {
    const result = await confirmService.show({
      theme,
      title: `Delete ${slate.options.name}`,
      message: 'Are you sure?',
    })
    if (result) {
      try {
        await Meteor.callAsync(CONSTANTS.methods.slates.remove, {
          slateIds: [slate._id],
        })
        setRerender(Random.id())
      } catch (err) {
        setMessage({
          visible: true,
          text: `Error deleting: ${err.message}`,
          severity: 'error',
          autoHide: 60000,
        })
      }
    }
  }

  // Visibility changes through sharing, the same server function the Share dialog uses. The
  // link keeps the permission the owner chose for it; a slate with no link yet gets a view link.
  async function changeSlatePrivacy() {
    const grants = await Meteor.callAsync(CONSTANTS.methods.slateAccess.get, { id: slate._id })
    const link = grants.find((grant) => !grant.userId && ['public', 'unlisted'].includes(grant.type))
    await Meteor.callAsync(CONSTANTS.methods.slateAccess.configureLink, {
      slateId: slate._id,
      type: slate.options.isPublic ? 'private' : 'public',
      permission: link?.slateAccessPermissionId ?? 'READ',
    })
    setRerender(Random.id())
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
      <>
          <IconButton
            aria-controls="slate-menu"
            aria-haspopup="true"
            aria-label={`Options for ${slate.options?.name || 'slate'}`}
            size="small"
            sx={{ color: 'text.secondary' }}
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
            {!phoneView && (
              <MenuItem
                onClick={(e) => {
                  hideSlateMenu(e)
                  copy()
                }}
              >
                <ListItemIcon>
                  <FileCopyIcon />
                </ListItemIcon>
                <Typography>Make a copy</Typography>
              </MenuItem>
            )}
            {(Meteor.userId() === slate.userId ||
                AuthManager.userHasClaim(Meteor.userId(), [
                  CONSTANTS.claims.admin._id,
                ])) && (
                <MenuItem
                  onClick={async (e) => {
                    hideSlateMenu(e)
                    deleteSlate()
                  }}
                >
                  <ListItemIcon>
                    <DeleteIcon />
                  </ListItemIcon>
                  <Typography>Delete</Typography>
                </MenuItem>
              )}
            {Meteor.userId() === slate.userId && (
                <MenuItem
                  onClick={async (e) => {
                    hideSlateMenu(e)
                    changeSlatePrivacy()
                  }}
                >
                  <ListItemIcon>
                    {slate.options.isPublic ? <LockOpenIcon /> : <LockIcon />}
                  </ListItemIcon>
                  <Typography>
                    {slate.options.isPublic ? 'Make private' : 'Make public'}
                  </Typography>
                </MenuItem>
              )}
          </Menu>
        </>
    </div>
  )
}

SlateMenu.propTypes = {
  slate: slateProps.isRequired,
}
