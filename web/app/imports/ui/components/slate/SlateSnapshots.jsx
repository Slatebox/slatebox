/* eslint-disable no-underscore-dangle */
/* eslint-disable new-cap */
import Container from '@material-ui/core/Container'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import React, { useEffect } from 'react'
import MuiDialogTitle from '@material-ui/core/DialogTitle'
import CloseIcon from '@material-ui/icons/Close'
import GridList from '@material-ui/core/GridList'
import GridListTileBar from '@material-ui/core/GridListTileBar'
import GridListTile from '@material-ui/core/GridListTile'
import { withStyles, makeStyles } from '@material-ui/core/styles'
import Grid from '@material-ui/core/Grid'
import Typography from '@material-ui/core/Typography'
import Button from '@material-ui/core/Button'
import Box from '@material-ui/core/Box'
import IconButton from '@material-ui/core/IconButton'
import DialogContent from '@material-ui/core/DialogContent'
import Dialog from '@material-ui/core/Dialog'
import Skeleton from '@material-ui/lab/Skeleton'
import CONSTANTS from '../../../api/common/constants'
import { Slatebox } from 'slatebox'
import promisify from '../../../api/client/promisify'
import slateProps from '../../propTypes/slatePriops'

const styles = (theme) => ({
  root: {
    margin: 0,
    padding: theme.spacing(2),
  },
  closeButton: {
    position: 'absolute',
    right: theme.spacing(1),
    top: theme.spacing(1),
    color: theme.palette.grey[500],
  },
})

const useStyles = makeStyles((theme) => ({
  gridList: {
    width: 'auto',
    minHeight: '600px',
    height: 'auto',
    cursor: 'pointer',
    padding: 0,
  },
  gridListTile: {
    cursor: 'pointer',
    '& svg': {
      cursor: 'pointer',
    },
  },
  snapSlate: {
    width: 'inherit',
    height: 'inherit',
    padding: '0 important',
    transition: 'all 500ms',
    '&:hover': {
      transform: 'scale(1.2)',
    },
  },
  root: {
    margin: 0,
    padding: theme.spacing(2),
  },
  closeButton: {
    position: 'absolute',
    right: theme.spacing(1),
    top: theme.spacing(1),
    color: theme.palette.grey[500],
  },
}))

export default function SlateSnapshots({
  open,
  slate,
  onDialogClosed,
  applySnapshot,
}) {
  const classes = useStyles()
  const snapsPerPage = 4
  const [isLoading, setLoading] = React.useState(true)
  const [snapshots, setSnapshots] = React.useState([])
  const [totalSnaps, setTotalSnaps] = React.useState(0)
  const [snapPage, setSnapPage] = React.useState(0)

  async function get() {
    if (open) {
      const getSnaps = await promisify(
        Meteor.call,
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
      const events = {
        onCanvasClicked() {
          if (onSlateClicked) onSlateClicked()
        },
      }
      const ss = new Slatebox.slate(
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
          collaboration: {
            allow: false,
          },
        },
        events
      ).init()
      ss.loadJSON(slateSnapshot)
      window.requestAnimationFrame(() => {
        ss.controller.scaleToFitAndCenter()
      })
    }, [])
    return <Box id={`snap_${id}`} className={classes.snapSlate} />
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

  const DialogTitle = withStyles(styles)((props) => {
    const { children, classes, onClose, title, description, ...other } = props
    return (
      // eslint-disable-next-line react/jsx-props-no-spreading
      <MuiDialogTitle disableTypography className={classes.root} {...other}>
        <Typography variant="h6" color="secondary">
          {title}
        </Typography>
        <Typography variant="body2">{description}</Typography>
        {onClose ? (
          <IconButton
            aria-label="close"
            className={classes.closeButton}
            onClick={onClose}
          >
            <CloseIcon />
          </IconButton>
        ) : null}
      </MuiDialogTitle>
    )
  })

  SlateSnapshots.propTypes = {
    open: PropTypes.bool.isRequired,
    slate: slateProps.isRequired,
    onDialogClosed: PropTypes.func.isRequired,
    applySnapshot: PropTypes.func.isRequired,
  }

  return (
    <Dialog
      maxWidth="md"
      fullWidth
      onClose={closeSlateSnapshots}
      aria-labelledby="slate-snapshot-dialog"
      open={open}
      PaperProps={{
        style: {
          opacity: '0.93',
        },
      }}
    >
      <DialogContent style={{ minHeight: '300px' }}>
        <DialogTitle
          id="slate-snapshot-title"
          onClose={closeSlateSnapshots}
          title="Slate Snapshots"
          description="Click a snapshot below to revert the slate to that version. Warning: you will lose any differences between your current slate and the snapshot."
        />
        <Container component="main" style={{ margin: '10px' }}>
          {!isLoading && snapshots.length === 0 ? (
            <Box p={2} m={2}>
              No Snapshots Available
            </Box>
          ) : (
            <div>
              {isLoading ? (
                <GridList spacing={10} cols={2} cellHeight={300}>
                  {Array.from({ length: snapsPerPage }).map((i, ind) => {
                    ;<GridListTile className={classes.gridListTile} key={ind}>
                      <Skeleton
                        variant="rect"
                        animation="wave"
                        width="100%"
                        height="100%"
                      />
                    </GridListTile>
                  })}
                </GridList>
              ) : (
                <GridList spacing={10} cols={2} cellHeight={300}>
                  {snapshots.map((ssnap) => (
                    <GridListTile
                      className={classes.gridListTile}
                      key={ssnap._id}
                    >
                      <SlateSnap
                        slateSnapshot={ssnap.snapshot}
                        onSlateClicked={() => {
                          applySnapshot(ssnap.snapshot)
                        }}
                      />
                      <GridListTileBar
                        style={{ height: '40px' }}
                        title={
                          <Typography variant="h6">
                            {new Date(ssnap?.created).toLocaleString()}
                          </Typography>
                        }
                      />
                    </GridListTile>
                  ))}
                </GridList>
              )}
            </div>
          )}
          <Grid container justify="space-between" style={{ marginTop: '20px' }}>
            <Grid item>
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
            <Grid item>
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
