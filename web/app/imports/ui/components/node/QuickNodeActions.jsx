/* eslint-disable react/jsx-boolean-value */
/* eslint-disable new-cap */
/* eslint-disable no-underscore-dangle */
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Grid from '@mui/material/Grid2'
import Tooltip from '@mui/material/Tooltip'
import SvgIcon from '@mui/material/SvgIcon'
import SpeedDial from '@mui/material/SpeedDial'
import SpeedDialIcon from '@mui/material/SpeedDialIcon'
import SpeedDialAction from '@mui/material/SpeedDialAction'
import chunk from 'lodash.chunk'
import Button from '@mui/material/Button'
import ButtonGroup from '@mui/material/ButtonGroup'
import Typography from '@mui/material/Typography'
import defaultShapes from './defaultShapes'
import slateProps from '../../propTypes/slateProps'
import addNote, { noteBase } from './addNote'
import { loadBoardsRows } from '../library/libraryBus'
import ShapeMaker from '../shapes/ShapeMaker'

// The dock's Boards and starters row: its own chunk, fetched when the dock first draws.
const BoardsDock = React.lazy(() => loadBoardsRows().then((m) => ({ default: m.BoardsDock })))

// The open dock's own background (always dark), and its ink: the dark colour scheme's tokens, whatever the mode.
const DOCK = '#112c44'
const dockInk = (theme) => (theme.colorSchemes?.dark ?? theme).palette

export default function QuickNodeActions({
  commentAccessOnly,
  slate,
  onNodeCreated,
  selectedNotes,
  onShapeNotes,
}) {

  const [actionMenuOpen, setActionMenuOpen] = React.useState(false)
  const [actionMenuPinned, setActionMenuPinned] = React.useState(false)
  // Custom Shape opens the shape maker: describe a shape, or reuse one from your library.
  const [shapeMakerOpen, setShapeMakerOpen] = React.useState(false)
  const [shapeTargets, setShapeTargets] = React.useState([])

  // A new note takes after the slate's last note of its own, never after a note a workshop draws there.
  const ownNotes = (slate?.nodes?.allNodes ?? []).filter(
    (n) => !slate.v2?.governanceOf?.(n.v2)
  )

  const baseOpts = noteBase(ownNotes)

  // A press somewhere else (Got it on the cookie notice, a canvas click) a moment ago: the dock does
  // not open because that notice went away from over it with the pointer still resting there.
  const lastPressAt = React.useRef(0)
  React.useEffect(() => {
    const pressed = (event) => { if (!event.target?.closest?.('.sb-add-dock')) lastPressAt.current = performance.now() }
    window.addEventListener('pointerdown', pressed, true)
    return () => window.removeEventListener('pointerdown', pressed, true)
  }, [])
  // Hover opens the dock only when the pointer came to it: never when something that lay over it went
  // away (the browser then reports the resting pointer as entering it, without moving), so a fresh
  // slate, a copy from the library or a slate full of notes opens with the dock closed.
  const handleActionMenuOpen = (event, reason) => {
    const hover = reason === 'mouseEnter' || event?.type === 'pointermove' || event?.type === 'mouseenter'
    if (hover) {
      const native = event?.nativeEvent ?? event
      const still = !native?.movementX && !native?.movementY
      if (still || performance.now() - lastPressAt.current < 800) return
    }
    setActionMenuOpen(true)
  }

  const handleActionMenuClose = () => {
    if (!actionMenuPinned) {
      setActionMenuOpen(false)
    }
  }

  // The zoom pill sits under the open dock, where it can be neither read nor reached: it steps aside until the dock closes.
  React.useEffect(() => {
    const root = document.documentElement
    if (actionMenuOpen && !commentAccessOnly) root.setAttribute('data-sb-add-open', '')
    else root.removeAttribute('data-sb-add-open')
    return () => root.removeAttribute('data-sb-add-open')
  }, [actionMenuOpen, commentAccessOnly])

  const createNode = (shape) => addNote(slate, shape)

  const addNode = (shape) => {
    if (shape.key === 'searchCustom') {
      setShapeTargets(selectedNotes?.() ?? [])
      setShapeMakerOpen(true)
      setActionMenuPinned(false)
      setActionMenuOpen(false)
      return
    }
    const node = createNode(shape)

    // The new note is selected; its style bar is where it is styled.
    onNodeCreated(node, shape)
    setActionMenuOpen(false)
    setActionMenuPinned(false)
  }

  let customActions = [
    {
      key: 'searchCustom',
      text: 'Custom Shape',
      type: 'button',
    },
    {
      key: 'addText',
      text: 'Add Text',
      type: 'button',
    },
  ]

  if (Meteor.user()?.orgId) {
    customActions.push({
      key: 'comment',
      text: 'Comment',
      type: 'button',
    })
  }

  if (commentAccessOnly) {
    customActions = [
      {
        key: 'comment',
        text: 'Add Comment',
        type: 'button',
      },
    ]
  }

  // Define the reusable styles
  const speedDialActionStyles = {
    cursor: 'pointer',
    '&:hover': {
      backgroundColor: 'transparent',
    },
  }

  const fabSlotProps = {
    fab: {
      sx: {
        backgroundColor: 'transparent',
        '&:hover': {
          backgroundColor: 'transparent',
        },
      },
    },
  }

  const actionPaths = chunk(defaultShapes, 10).map((ds, i) => ({
    row: i,
    shapes: ds,
  }))
  // The open dock is a dark panel in the light and the dark mode alike, so its words and edges take the dark mode's
  // ink (theme tokens). Solid, not see-through: an opacity on the panel dimmed every word in it, and let what is
  // under it show through as ghosts.
  let actionMenuStyle = actionMenuOpen
    ? {
        backgroundColor: DOCK,
        borderBottomRightRadius: '30px',
        borderTopLeftRadius: '10px',
        width: '420px',
      }
    : {}

  if (commentAccessOnly) {
    actionMenuStyle = { marginRight: '-50px' }
  }

  // eslint-disable-next-line react/no-unstable-nested-components
  function MappedShapes(row) {
    return (
      <Grid container justifyContent="space-between" spacing={0}>
        {row.shapes.map((shape) => (
          <Grid key={shape.key} size={1}>
            <Tooltip title={shape.name} placement="top" aria-label={shape.key}>
              <SvgIcon
                sx={{ color: baseOpts.backgroundColor, fontSize: 42 }}
                onClick={() => {
                  addNode(shape)
                }}
              >
                <path strokeWidth="1px" stroke={shape.iconFill ? '#8a7a2a' : '#efefef'} d={shape.path}
                  {...(shape.iconFill && { fill: shape.iconFill, style: { filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.45))' } })} />
              </SvgIcon>
            </Tooltip>
          </Grid>
        ))}
      </Grid>
    )
  }

  QuickNodeActions.propTypes = {
    slate: slateProps,
    commentAccessOnly: PropTypes.bool,
    onNodeCreated: PropTypes.func.isRequired,
    selectedNotes: PropTypes.func,
    onShapeNotes: PropTypes.func,
  }

  // A shape picked in the shape maker: a new note in that shape, selected for its text.
  const addCustomShape = (shape) => {
    if (shapeTargets.length && onShapeNotes) {
      onShapeNotes(shapeTargets, shape)
      return
    }
    const node = createNode({ key: 'customShape', path: shape.d, ...shape })
    onNodeCreated(node, { key: 'customShape' })
  }

  return (
    <div>
      <ShapeMaker
        open={shapeMakerOpen}
        onClose={() => setShapeMakerOpen(false)}
        onApply={addCustomShape}
        target={shapeTargets.length || 'new'}
        fill={shapeTargets[0]?.options?.backgroundColor ?? baseOpts.backgroundColor}
        stroke={baseOpts.borderColor || '#333'}
      />
      <SpeedDial
        className="sb-add-dock"
        ariaLabel={
          commentAccessOnly
            ? 'Slatebox - comment'
            : 'Slatebox - quickly add a node'
        }
        sx={(theme) => ({
          position: 'fixed',
          // Kept in the canvas's own corner: clear of the "Ask Slatebox" panel beside it and of
          // the phone's bottom bar under it (the canvas page sets these two distances).
          bottom: `calc(var(--sb-canvas-bottom, 0px) + ${theme.spacing(1)})`,
          right: `calc(var(--sb-canvas-right, 0px) + ${theme.spacing(1)})`,
          alignItems: 'flex-end',
          '& .MuiSpeedDialAction-fab': {
            backgroundColor: 'transparent',
            // The "Boards and starters" words: the dark mode's text ink, on the dark dock.
            color: dockInk(theme).text.primary,
            cursor: 'pointer',
            '&:hover': {
              backgroundColor: 'transparent',
            },
            '& .MuiSvgIcon-root': {
              transition: 'transform .1s',
              '&:hover': {
                transform: 'scale(1.1)',
              },
            },
          },
          '& .MuiSpeedDial-fab': {
            opacity: commentAccessOnly ? 0 : 1,
          },
          '& .MuiFab-root': {
            boxShadow: 'none',
          },
          '& .MuiFab-sizeSmall': {
            width: '400px',
            height: '50px',
          },
          '& .MuiSpeedDial-actions': {
            paddingBottom: '24px',
          },
        })}
        slotProps={{
          fab: {
            sx: {
              backgroundColor: 'transparent',
              '&:hover': {
                backgroundColor: 'transparent',
                transform: 'none',
                boxShadow: 'none',
              },
            },
            disableRipple: true,
          },
        }}
        FabProps={{
          // Dismissing a notice can reveal the button under the pointer.
          // Firefox then sends movement inside it without a new mouseenter.
          onPointerMove: (event) => {
            if (!actionMenuOpen && event.buttons === 0 && event.pointerType !== 'touch') {
              handleActionMenuOpen(event, 'mouseEnter')
            }
          },
        }}
        hidden={false}
        icon={<SpeedDialIcon />}
        onClose={handleActionMenuClose}
        onOpen={handleActionMenuOpen}
        open={commentAccessOnly ? true : actionMenuOpen}
        style={actionMenuStyle}
        direction="up"
      >
        {!commentAccessOnly &&
          actionPaths.map((action) => (
            <SpeedDialAction
              key={action.row}
              tooltipTitle=""
              // eslint-disable-next-line react/jsx-props-no-spreading
              icon={
                <MappedShapes
                  sx={{ backgroundColor: 'transparent' }}
                  {...action}
                />
              }
              sx={speedDialActionStyles}
              slotProps={{ fab: fabSlotProps }}
            />
          ))}
        <SpeedDialAction
          key="buttons"
          tooltipTitle=""
          icon={
            <ButtonGroup variant="text" aria-label="split button">
              {customActions.map((c) => (
                <Button
                  key={c.key}
                  size="small"
                  disableRipple={true}
                  sx={(theme) => {
                    const ink = dockInk(theme)
                    // On the dark dock: the dark mode's text ink and edge (light words, a 3:1 outline).
                    return {
                      height: '30px',
                      color: ink.text.primary,
                      backgroundColor: 'transparent',
                      borderColor: `${ink.thematic.borderColor} !important`,
                      '&:hover': {
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        borderColor: `${ink.text.primary} !important`,
                      },
                    }
                  }}
                  variant={c.text ? 'outlined' : ''}
                  size="small"
                  onClick={() => {
                    addNode(c)
                  }}
                >
                  <Typography variant="caption">{c.text}</Typography>
                </Button>
              ))}
            </ButtonGroup>
          }
          // Real buttons in a group, not a button holding buttons: this action's own Fab is drawn as a plain group.
          slotProps={{ fab: { component: 'div', role: 'group', tabIndex: -1, 'aria-label': 'Add a note', disableRipple: true, disableFocusRipple: true,
            sx: { backgroundColor: 'transparent', boxShadow: 'none', cursor: 'default', '&:hover': { backgroundColor: 'transparent' } } } }}
        />
        {/* The top row: boards and starters from the library (it opens in Ask Slatebox). */}
        {!commentAccessOnly && (
          <SpeedDialAction
            key="boards"
            tooltipTitle=""
            icon={<React.Suspense fallback={null}><BoardsDock onDone={handleActionMenuClose} dark /></React.Suspense>}
            sx={speedDialActionStyles}
            // A group of real buttons, not a button holding buttons: the action's own Fab is drawn as a plain group.
            slotProps={{ fab: { component: 'div', role: 'group', tabIndex: -1, 'aria-label': 'Boards and starters', disableRipple: true, disableFocusRipple: true,
              sx: { backgroundColor: 'transparent', boxShadow: 'none', width: 'auto', borderRadius: 1, cursor: 'default', '&:hover': { backgroundColor: 'transparent' } } } }}
          />
        )}
      </SpeedDial>
    </div>
  )
}
