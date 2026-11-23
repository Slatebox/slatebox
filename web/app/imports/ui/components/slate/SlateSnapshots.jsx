/* eslint-disable no-underscore-dangle */
/* eslint-disable new-cap */
import Container from '@mui/material/Container'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import React, { useEffect } from 'react'
import MuiDialogTitle from '@mui/material/DialogTitle'
import CloseIcon from '@mui/icons-material/Close'
import ImageList from '@mui/material/ImageList'
import ImageListItemBar from '@mui/material/ImageListItemBar'
import ImageListItem from '@mui/material/ImageListItem'
import Grid from '@mui/material/Grid2'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import Box from '@mui/material/Box'
import IconButton from '@mui/material/IconButton'
import DialogContent from '@mui/material/DialogContent'
import Dialog from '@mui/material/Dialog'
import { Skeleton } from '@mui/material'
import { Slatebox } from 'slateboxjs'
import CONSTANTS from '../../../api/common/constants'
import slateProps from '../../propTypes/slateProps'

export default function SlateSnapshots({
  open,
  slate,
  onDialogClosed,
  applySnapshot,
}) {
  const snapsPerPage = 4
  const [isLoading, setLoading] = React.useState(true)
  const [snapshots, setSnapshots] = React.useState([])
  const [totalSnaps, setTotalSnaps] = React.useState(0)
  const [snapPage, setSnapPage] = React.useState(0)

  async function get() {
    if (open) {
      const getSnaps = await Meteor.callAsync(
        CONSTANTS.methods.slates.getSnapshots,
        {
          slateId: slate?.options.id,
          skip: snapPage * snapsPerPage,
          limit: snapsPerPage,
        }
      )
      setTotalSnaps(getSnaps.count)
      // let existing = cloneDeep(snapshots);
      const allSnaps = getSnaps.snaps // [...existing, ...getSnaps.snaps];
      setLoading(false)
      setSnapshots(allSnaps)
    } else {
      setSnapshots([])
    }
  }

  useEffect(() => {
    setLoading(true)
  }, [open])

  useEffect(() => {
    window.requestAnimationFrame(() => {
      get()
    })
  }, [snapPage, open])

  // eslint-disable-next-line react/no-unstable-nested-components
  function SlateSnap({ slateSnapshot, onSlateClicked }) {
    const id = Random.id()
    useEffect(() => {
      async function create() {
        const events = {
          onCanvasClicked() {
            if (onSlateClicked) onSlateClicked()
          },
        }
        const ss = await new Slatebox.slate(
          {
            container: `snap_${id}`,
            viewPort: { allowDrag: false, useInertiaScrolling: false },
            allowDrag: false,
            name: ``,
            description: ``,
            showbirdsEye: false,
            showLocks: false,
            showMultiSelect: false,
            showUndoRedo: false,
            showZoom: false,
            showAddNodes: false,
            allowCollaboration: false,
          },
          events
        ).init()
        ss.loadJSON(slateSnapshot)
        window.requestAnimationFrame(() => {
          ss.controller.scaleToFitAndCenter()
        })
      }
      create()
    }, [])
    return (
      <Box
        id={`snap_${id}`}
        sx={{
          height: 'inherit',
          width: 'inherit',
          cursor: 'pointer',
          transition: 'all 200ms',
          '&:hover': {
            transform: 'scale(1.3)',
          },
        }}
      />
    )
  }

  SlateSnap.propTypes = {
    slateSnapshot: PropTypes.node.isRequired,
    onSlateClicked: PropTypes.func.isRequired,
  }

  const closeSlateSnapshots = () => {
    setLoading(true)
    setSnapshots([])
    setSnapPage(0)
    onDialogClosed()
  }

  const DialogTitle = (props) => {
    const { children, classes, onClose, title, description, ...other } = props
    return (
      // eslint-disable-next-line react/jsx-props-no-spreading
      <Grid container>
        <Grid size={11}>
          <MuiDialogTitle {...other}>
            <Typography variant="h6" color="secondary">
              {title}
            </Typography>
            <Typography variant="body2">{description}</Typography>
          </MuiDialogTitle>
        </Grid>
        <Grid size={1}>
          {onClose ? (
            <IconButton
              aria-label="close"
              className="closeButton"
              onClick={onClose}
            >
              <CloseIcon />
            </IconButton>
          ) : null}
        </Grid>
      </Grid>
    )
  }

  SlateSnapshots.propTypes = {
    open: PropTypes.bool.isRequired,
    slate: slateProps,
    onDialogClosed: PropTypes.func.isRequired,
    applySnapshot: PropTypes.func.isRequired,
  }

  return (
    <Dialog
      maxWidth="lg"
      fullWidth
      onClose={closeSlateSnapshots}
      aria-labelledby="slate-snapshot-dialog"
      open={open}
      PaperProps={{
        sx: {
          opacity: '0.93',
        },
      }}
    >
      <DialogContent sx={{ minHeight: '300px', overflow: 'hidden' }}>
        <DialogTitle
          id="slate-snapshot-title"
          onClose={closeSlateSnapshots}
          title="Slate Snapshots"
          description="Click a snapshot below to revert the slate to that version. Warning: you will lose any differences between your current slate and the snapshot."
        />
        <Container component="main" sx={{ margin: '5px' }}>
          {!isLoading && snapshots.length === 0 ? (
            <Box p={2} m={2}>
              No Snapshots Available
            </Box>
          ) : (
            <div>
              {isLoading ? (
                <ImageList gap={5} cols={2} rowHeight={300}>
                  {Array.from({ length: snapsPerPage }).map((i, ind) => {
                    ;<ImageListItem key={ind}>
                      <Skeleton
                        variant="rect"
                        animation="wave"
                        width="100%"
                        height="100%"
                      />
                    </ImageListItem>
                  })}
                </ImageList>
              ) : (
                <ImageList gap={5} cols={2} rowHeight={300}>
                  {snapshots.map((ssnap) => (
                    <ImageListItem
                      key={ssnap._id}
                      sx={{ cursor: 'pointer', overflow: 'hidden' }}
                    >
                      <SlateSnap
                        slateSnapshot={ssnap.snapshot}
                        onSlateClicked={() => {
                          applySnapshot(ssnap.snapshot)
                        }}
                      />
                      <ImageListItemBar
                        sx={{ height: '40px' }}
                        title={
                          <Typography variant="body2">
                            {new Date(ssnap?.created).toLocaleString()}
                          </Typography>
                        }
                      />
                    </ImageListItem>
                  ))}
                </ImageList>
              )}
            </div>
          )}
          <Grid
            container
            justifyContent="space-between"
            sx={{ marginTop: '20px' }}
          >
            <Grid>
              {!isLoading && snapPage > 0 && (
                <Button
                  color="secondary"
                  fullWidth
                  variant="outlined"
                  onClick={() => {
                    setSnapPage(snapPage - 1)
                  }}
                >
                  Previous
                </Button>
              )}
            </Grid>
            <Grid>
              {!isLoading && (snapPage + 1) * snapsPerPage < totalSnaps && (
                <Button
                  color="secondary"
                  fullWidth
                  variant="outlined"
                  onClick={(e) => {
                    setSnapPage(snapPage + 1)
                  }}
                >
                  Next
                </Button>
              )}
            </Grid>
          </Grid>
        </Container>
      </DialogContent>
    </Dialog>
  )
}
