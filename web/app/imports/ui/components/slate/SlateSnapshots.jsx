import Container from '@material-ui/core/Container';
import { Meteor } from 'meteor/meteor';
import { Random } from 'meteor/random';
import { useDispatch, useSelector } from 'react-redux'
import { useHistory } from "react-router-dom";
import React, { useEffect } from 'react';
import MuiDialogTitle from '@material-ui/core/DialogTitle';
import { CONSTANTS } from '/imports/api/common/constants.js';
import { promisify } from '../../../api/client/promisify.js';
import CloseIcon from '@material-ui/icons/Close';
import GridList from '@material-ui/core/GridList';
import GridListTileBar from '@material-ui/core/GridListTileBar';
import GridListTile from '@material-ui/core/GridListTile';
import { withStyles, makeStyles } from '@material-ui/core/styles';
import Grid from '@material-ui/core/Grid';
import Typography from '@material-ui/core/Typography';
import Button from '@material-ui/core/Button';
import Box from '@material-ui/core/Box';
import { Slatebox } from '../../../api/client/slatebox';
import IconButton from '@material-ui/core/IconButton';
import DialogContent from '@material-ui/core/DialogContent';
import Dialog from '@material-ui/core/Dialog';
import cloneDeep from 'lodash.clonedeep';
import CircularProgress from '@material-ui/core/CircularProgress';
import Skeleton from '@material-ui/lab/Skeleton';
import { SnapSlate } from '../SnapSlate.jsx';

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
});

const useStyles = makeStyles((theme) => ({
  gridList: {
    width: 'auto',
    minHeight: "600px",
    height: 'auto',
    cursor: "pointer",
    padding: 0
  },
  gridListTile: {
    cursor: "pointer",
    "& svg": {
      cursor: "pointer"
    }
  },
  snapSlate: {
    width: "inherit", 
    height: "inherit", 
    padding: "0 important",
    transition: "all 500ms",
    "&:hover": {
      transform: "scale(1.2)"
    }
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
  }
}));

export const SlateSnapshots = (props) => {

  const classes = useStyles();
  const history = useHistory();
  const snapsPerPage = 4;
  const [isLoading, setLoading] = React.useState(true);
  const [snapshots, setSnapshots] = React.useState([]);
  const [totalSnaps, setTotalSnaps] = React.useState(0);
  const [snapPage, setSnapPage] = React.useState(0);

  async function get() {
    if (props.open) {
      const getSnaps = await promisify(Meteor.call, CONSTANTS.methods.slates.getSnapshots, { slateId: props.slate?.options.id, skip: snapPage * snapsPerPage, limit: snapsPerPage  });
      setTotalSnaps(getSnaps.count);
      // let existing = cloneDeep(snapshots);
      let allSnaps = getSnaps.snaps; // [...existing, ...getSnaps.snaps];
      setLoading(false);
      setSnapshots(allSnaps);
    } else {
      setSnapshots([]);
    }
  }

  useEffect(() => {
    setLoading(true);
  }, [props.open]);

  useEffect(() => {
    window.requestAnimationFrame(() => {
      get();
    });    
  }, [snapPage, props.open]);

  const SlateSnap = (props) => {
    let id = Random.id();
    useEffect(() => {
      const events = {
        onCanvasClicked: function() {
          props.onSlateClicked && props.onSlateClicked();
        }
      };
      const ss = new Slatebox.slate({
        container: `snap_${id}`
        , viewPort: { allowDrag: false, useInertiaScrolling: false }
        , allowDrag: false
        , name: ``
        , description: ``
        , showbirdsEye: false
        , showLocks: false
        , showMultiSelect: false
        , showUndoRedo: false
        , showZoom: false
        , showAddNodes: false
        , collaboration: {
          allow: false
        }
      }, events).init();
      ss.loadJSON(props.snap);
      window.requestAnimationFrame(() => {
        ss.controller.scaleToFitAndCenter();
      });
    }, []);
    return ( 
      <Box id={`snap_${id}`} className={classes.snapSlate}></Box>
    );
  };

  function closeSlateSnapshots() {
    setLoading(true);
    setSnapshots([]);
    setSnapPage(0);
    props.onDialogClosed();
  }

  const DialogTitle = withStyles(styles)((props) => {
    const { children, classes, onClose, ...other } = props;
    return (
      <MuiDialogTitle disableTypography className={classes.root} {...other}>
        <Typography variant="h6" color="secondary">{props.title}</Typography>
        <Typography variant="body2">{props.description}</Typography>
        {onClose ? (
          <IconButton aria-label="close" className={classes.closeButton} onClick={onClose}>
            <CloseIcon />
          </IconButton>
        ) : null}
      </MuiDialogTitle>
    );
  });

  return (
    <Dialog maxWidth="md" 
      fullWidth={true} 
      onClose={closeSlateSnapshots} 
      aria-labelledby="slate-snapshot-dialog" 
      open={props.open} 
      PaperProps={{
        style: {
          opacity: '0.93'
        },
      }}>
      <DialogContent style={{minHeight: "300px"}}>
        <DialogTitle id="slate-snapshot-title" onClose={closeSlateSnapshots} title="Slate Snapshots" 
          description="Click a snapshot below to revert the slate to that version. Warning: you will lose any differences between your current slate and the snapshot.">
        </DialogTitle>
        <Container component="main" style={{margin: "10px"}}>
          {!isLoading && snapshots.length === 0 ? 
            <Box p={2} m={2}>
              No Snapshots Available
            </Box>
          :
            <>
              {isLoading ? 
                <GridList spacing={10} cols={2} cellHeight={300}>
                  {Array.from({ length: snapsPerPage }).map((i, ind) => {
                    <GridListTile className={classes.gridListTile} key={ind}>
                      <Skeleton variant="rect" animation="wave" width="100%" height="100%" />
                    </GridListTile>
                  })}
                </GridList>
              :
                <GridList spacing={10} cols={2} cellHeight={300}>
                  {snapshots.map((snap, ind) => (
                    <GridListTile className={classes.gridListTile} key={ind}>
                      <SlateSnap disableCollab={true} snap={snap.snapshot} onSlateClicked={(e) => { props.applySnapshot(snap.snapshot); }} />
                      <GridListTileBar
                        style={{height: "40px"}}
                        title={<Typography variant="h6">{new Date(snap.created).toLocaleString()}</Typography>}
                      />
                    </GridListTile>
                  ))}
                </GridList>
              }
            </>
          }
          <Grid container justify="space-between" style={{marginTop: "20px" }}>
            <Grid item>
              {!isLoading && snapPage > 0 &&
                <Button color="secondary" fullWidth variant="outlined" onClick={(e) => { setSnapPage(snapPage - 1); }}>
                  Previous
                </Button>
              }
            </Grid>
            <Grid item>
              {!isLoading && (snapPage + 1) * snapsPerPage < totalSnaps &&
                <Button color="secondary" fullWidth variant="outlined" onClick={(e) => { setSnapPage(snapPage + 1); }}>
                  Next
                </Button>
              } 
            </Grid>
          </Grid>              
        </Container>
      </DialogContent>
    </Dialog>
  );
}