/* eslint-disable no-underscore-dangle */
import React from 'react'
import PropTypes from 'prop-types'
import { Random } from 'meteor/random'
import { Meteor } from 'meteor/meteor'
import { useTheme } from '@mui/material/styles'
import { useNavigate } from 'react-router-dom'
import Typography from '@mui/material/Typography'
import IconButton from '@mui/material/IconButton'
import { Button, ButtonGroup } from '@mui/material'
import FileCopyIcon from '@mui/icons-material/FileCopy'
import DeleteIcon from '@mui/icons-material/Delete'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import LockOpenIcon from '@mui/icons-material/LockOpen'
import LockIcon from '@mui/icons-material/Lock'
import { useAtom } from 'jotai'
import MoreVertIcon from '@mui/icons-material/MoreVert'
import MenuItem from '@mui/material/MenuItem'
import Menu from '@mui/material/Menu'
import ListItemIcon from '@mui/material/ListItemIcon'
import Popper from '@mui/material/Popper'
import Grow from '@mui/material/Grow'
import Paper from '@mui/material/Paper'
import ClickAwayListener from '@mui/material/ClickAwayListener'
import MenuList from '@mui/material/MenuList'
import confirmService from '../common/confirm'
import copySlate from '../../api/client/copySlate'
import CONSTANTS from '../../api/common/constants'
import AuthManager from '../../api/common/AuthManager'

import slateProps from '../propTypes/slateProps'

import {
  globalMessage,
  slateRererender,
} from '../jotai/atoms'

export default function SlateMenu({ slate, isTemplate, isCommunity }) {
  const history = useNavigate()
  const theme = useTheme()
  const anchorRef = React.useRef(null)
  const [rerender, setRerender] = useAtom(slateRererender)
  const [message, setMessage] = useAtom(globalMessage)
  const [templateSubMenuOpen, setTemplateSubMenuOpen] = React.useState(false)

  async function copy(blnTemplateFromTemplate) {
    const shareId = await copySlate(slate.shareId, { keepTemplate: !isTemplate, fromTemplate: blnTemplateFromTemplate })
    // causes rerender:
    setRerender(Random.id())
    if (isCommunity || isTemplate) {
      history(`/canvas/${shareId}`)
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

  function handleTemplateFromTemplateSubMenu(e) {
    e.stopPropagation()
    setTemplateSubMenuOpen((prevOpen) => !prevOpen)
  }

  function handleSlateSubMenuClose() {
    setTemplateSubMenuOpen(false)
  }

  return (
    <div>
      {isTemplate ? (
        <>
          <ButtonGroup
            variant="contained"
            color="secondary"
            ref={anchorRef}
            aria-label="split button"
          >
            <Button
              onClick={(e) => {
                e.stopPropagation()
                copy()
              }}
            >
              Use
            </Button>
            <Button
              color="secondary"
              aria-controls={
                templateSubMenuOpen
                  ? 'create-template-from-template'
                  : undefined
              }
              aria-expanded={templateSubMenuOpen ? 'true' : undefined}
              aria-haspopup="menu"
              onClick={handleTemplateFromTemplateSubMenu}
            >
              <ArrowDropDownIcon />
            </Button>
          </ButtonGroup>
          <Popper
            open={templateSubMenuOpen}
            anchorEl={anchorRef.current}
            role={undefined}
            transition
            disablePortal
            placement="bottom-start"
          >
            {({ TransitionProps, placement }) => (
              <Grow
                {...TransitionProps}
                style={{
                  transformOrigin:
                    placement === 'bottom' ? 'center top' : 'center bottom',
                }}
              >
                <Paper>
                  <ClickAwayListener onClickAway={handleSlateSubMenuClose}>
                    <MenuList id="create-template-from-template">
                      <MenuItem
                        onClick={(e) => {
                          e.stopPropagation()
                          copy(true)
                          handleSlateSubMenuClose()
                        }}
                      >
                        As Template
                      </MenuItem>
                    </MenuList>
                  </ClickAwayListener>
                </Paper>
              </Grow>
            )}
          </Popper>
        </>
      ) : (
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
            <MenuItem
              onClick={(e) => {
                hideSlateMenu(e)
                copy()
              }}
            >
              <ListItemIcon>
                <FileCopyIcon />
              </ListItemIcon>
              <Typography>{isTemplate ? <>Use template</> : <>Make a copy</>}</Typography>
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
                  <ListItemIcon>
                    <DeleteIcon />
                  </ListItemIcon>
                  <Typography>Delete</Typography>
                </MenuItem>
              )}
            {!isCommunity &&
              !isTemplate &&
              Meteor.userId() === slate.userId && (
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
      )}
    </div>
  )
}

SlateMenu.propTypes = {
  slate: slateProps.isRequired,
  isTemplate: PropTypes.bool.isRequired,
  isCommunity: PropTypes.bool.isRequired,
}
