import React, { useEffect } from 'react';
import { Meteor } from 'meteor/meteor';
import clsx from 'clsx';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import { useHistory } from "react-router-dom";
import Typography from '@material-ui/core/Typography';
import Container from '@material-ui/core/Container';
import Box from '@material-ui/core/Box';
import GridList from '@material-ui/core/GridList';
import GridListTile from '@material-ui/core/GridListTile';
import GridListTileBar from '@material-ui/core/GridListTileBar';
import Alert from '@material-ui/lab/Alert';

import { Translation } from "../common/Translation.jsx";

import { copySlate } from '/imports/api/client/copySlate.js';

// //component
import { SnapSlate } from '/imports/ui/components/SnapSlate';
import { Title } from '/imports/ui/components/Title';

//global models
import { getUserName } from '/imports/api/common/getUserName.js';

import { CONSTANTS } from '/imports/api/common/constants.js';
import { useDispatch, useSelector } from 'react-redux';
import { promisify } from '/imports/api/client/promisify.js';
import CircularProgress from '@material-ui/core/CircularProgress';
import { SlateMenu } from './SlateMenu.jsx';
import Skeleton from '@material-ui/lab/Skeleton';
import Dialog from '@material-ui/core/Dialog';
import AppBar from '@material-ui/core/AppBar';
import IconButton from '@material-ui/core/IconButton';
import CloseIcon from '@material-ui/icons/Close';
import FileCopyIcon from '@material-ui/icons/FileCopy';
import PublicIcon from '@material-ui/icons/Public';
import LockIcon from '@material-ui/icons/Lock';
import VpnLockIcon from '@material-ui/icons/VpnLock';
import FilterNoneIcon from '@material-ui/icons/FilterNone';
import BrushIcon from '@material-ui/icons/Brush';
import Toolbar from '@material-ui/core/Toolbar';
import Slide from '@material-ui/core/Slide';
import { cloneDeep } from 'lodash';
import Grid from '@material-ui/core/Grid';
import Button from '@material-ui/core/Button';
import { Chip, useMediaQuery } from '@material-ui/core';

const useStyles = makeStyles((theme) => ({
  gridList: {
    width: 'auto',
    minHeight: "200px",
    height: 'auto',
    cursor: "pointer",
    padding: 0
  },
  gridListTile: {
    cursor: "pointer",
    "& svg": {
      cursor: "pointer"
    },
    // transition: "transform 0.2s",
    "&:hover": {
      // transform: "scale(0.99)",
      border: "1px solid #fff"
    }
  }
}));

export const DisplaySlates = (props) => {

  const classes = useStyles(props);
  const history = useHistory();
  const dispatch = useDispatch();
  const theme = useTheme();
  const slatePage = useSelector(state => state.slatePage) || 1;
  const slateRecordsPerPage = useSelector(state => state.slateRecordsPerPage) || props.pinSlatePerPageCount ? props.slateMinimumPerPage : 12;
  const slateMinimumPerPage = useSelector(state => state.slateMinimumPerPage) || props.slateMinimumPerPage || 4;
  const filterString = useSelector(state => state.filterString) || null;
  const privateOnly = useSelector(state => state.privateOnly) || false;
  const totalSlates = useSelector(state => state.totalSlates) || 0;
  const invokeRerender = useSelector(state => state.invokeRerender) || null;
  const fixedHeightPaper = clsx(classes.paper, classes.fixedHeight);
  const lgmq = useMediaQuery(theme.breakpoints.up('lg'));
  const [slates, setSlates] = React.useState([]);
  const [loading, setLoading] = React.useState(false);
  let tags = [];

  const [slatePreview, setSlatePreview] = React.useState({
    open: false,
    slate: null
  });

  //reset to first page on first load
  useEffect(() => {
    dispatch({ type: "displayslates", slatePage: 1 });
    dispatch({ type: "displayslates", filterString: null });
  }, [props]);

  useEffect(() => {
    function getSlates() {
      setLoading(true);
      Meteor.call(CONSTANTS.methods.slates.get, { skip: (slatePage - 1) * slateRecordsPerPage, limit: slateRecordsPerPage, type: props.type, filterString: filterString, private: privateOnly }, (err, nextSlates) => {
        if (nextSlates) {
          let allSlates = nextSlates.slates;
          setSlates(allSlates);
          dispatch({ type: "displayslates", totalSlates: nextSlates.counts.total });
          setLoading(false);
        } else {
          setSlates([]);
          dispatch({ type: "displayslates", totalSlates: 0 });
          setLoading(false);
        }
      });
    }
    if (Meteor.userId()) {
      getSlates();
    }
  }, [slatePage, slateRecordsPerPage, totalSlates, filterString, invokeRerender, privateOnly, props]);

  const UserName = (props) => {
    const [userName, setUserName] = React.useState("loading");
    useEffect(() => {
      const getData = async () => {
        const u = getUserName(props.userId);
        setUserName(u);
      }
      getData();
    }, []);
    return <span>{userName}</span>
  }

  let sf = null;
  const filterSlates = (val) => {
    clearTimeout(sf);
    sf = window.setTimeout(() => {
      dispatch({ type: "displayslates", filterString: val });
    }, 500);
  };

  const createSlate = async (e) => {
    let shareId = await promisify(Meteor.call, CONSTANTS.methods.slates.generateShareId);
    history.push(`/canvas/${shareId}`);
  };

  const onChangePage = (e, page) => {
    //console.log("paging details ", page);
    dispatch({ type: "displayslates", slatePage: page });
  };

  const onChangePageSize = (e) => {
    console.log("changed page", e.target.value);
    dispatch({ type: "displayslates", slateRecordsPerPage: e.target.value, slatePage: 1 });
  };

  const onPrivateChanged = (blnPrivate) => {
    console.log("changed private", blnPrivate);
    dispatch({ type: "displayslates", privateOnly: blnPrivate, slatePage: 1 });
  };

  const handlePreviewClose = (e) => {
    setSlatePreview({ open: false, slate: null })
  };

  const copyPreviewSlate = async (e) => {
    const shareId = await copySlate(slatePreview.slate);
    history.push(`/canvas/${shareId}`);
    setSlatePreview({ open: false, slate: null });
  };

  let headerMessage = <Translation>slates.mySlates</Translation>;
  let subHeaderMessage = <Translation>slates.mySlatesSubHeader</Translation>;
  let noSlateMessage = <Translation>slates.noSelfSlates</Translation>;
  let slatePreviewMessage = <Translation>slates.communitySlatePreview</Translation>;
  let slatePreviewButtonText = <Translation>slates.communitySlatePreviewButtonText</Translation>;
  switch (props.type) {
    case "community": {
      headerMessage = <Translation>slates.communitySlates</Translation>;
      subHeaderMessage = <Translation>slates.communitySlatesSubHeader</Translation>;
      noSlateMessage = <Translation>slates.noCommunitySlates</Translation>;
      break;
    }
    case "team": {
      headerMessage = <Translation>slates.teamSlates</Translation>;
      subHeaderMessage = <Translation>slates.teamSlatesSubHeader</Translation>;
      noSlateMessage =  <Translation>slates.noTeamSlates</Translation>;
      break;
    }
    case "templates": {
      headerMessage = <Translation>slates.templates</Translation>;
      subHeaderMessage = <Translation>slates.templatesSubHeader</Translation>;
      noSlateMessage = <Translation>slates.noTemplates</Translation>
      slatePreviewMessage = <Translation>slates.templateSlatePreview</Translation>;
      slatePreviewButtonText = <Translation>slates.templateSlatePreviewButtonText</Translation>;
    }
  }

  return (
    <Container component="main" maxWidth="xl" style={{margin: "10px"}}>
      <Title showAdd={props.type === "community" || props.type === "templates" ? false : true}
        showSearch={true}
        searchOptions={tags.map(t => t.tag)}
        onAdd={createSlate}
        onSearchInputChange={filterSlates}
        onPrivateChanged={props.type === "community" || props.type === "templates" ? null : onPrivateChanged}
        slateMinimumPerPage={slateMinimumPerPage}
        recordsPerPage={slateRecordsPerPage}
        showPaging={totalSlates > slateMinimumPerPage}
        totalPages={Math.ceil(totalSlates / slateRecordsPerPage)}
        onChangePage={onChangePage}
        onChangePageSize={onChangePageSize}
        page={slatePage}
        pinSlatePerPageCount={props.pinSlatePerPageCount}
        headerMessage={headerMessage}
        subHeaderMessage={subHeaderMessage}>
      </Title>
      {loading ?
        <GridList spacing={10} cols={props.cols || 4} cellHeight={props.cellHeight ? parseInt(props.cellHeight, 10) : 250}>
          {Array.from({ length: slateRecordsPerPage }).map((key) => (
            <GridListTile key={key}>
              <Skeleton variant="rect" animation="wave" width="100%" height={props.cellHeight ? parseInt(props.cellHeight, 10) : 250} />
            </GridListTile>
          ))}
        </GridList> 
      :
      <GridList spacing={10} cols={props.cols || 4} cellHeight={props.cellHeight ? parseInt(props.cellHeight, 10) : 250}>
        {totalSlates === 0 &&
          <Alert severity="info">
            {noSlateMessage}
          </Alert>
        }
        {slates.map((slate) => (
          <GridListTile className={classes.gridListTile} key={slate.shareId} onClick={(e) => {
            dispatch({ type: "canvas", mainDrawerOpen: false });
            if (props.type !== "community" && props.type !== "templates") {
              history.push(`/canvas/${slate.shareId}`);
            } else {
              //show full screen of slate
              const previewSlate = cloneDeep(slate);
              setSlatePreview({ open: true, slate: previewSlate });
            }
          }}>
            <SnapSlate slate={slate} disableCollab={props.type === "community"} />
            <GridListTileBar
              style={{ height: props.showDescription ? "100px" : "60px" }}
              title={
                <Grid container justify="space-between" spacing={1}>
                  <Grid item xs={12}>
                    <Typography>
                      {slate.options ? slate.options.name : <Translation>slates.defaultNewSlateName</Translation>} by {slate.options?.userNameOverride ? `${slate.options.userNameOverride}` : <UserName userId={slate.userId}/>}
                    </Typography>
                  </Grid>
                  { props.showDescription && 
                     <Grid item xs={12}>
                      <Typography variant="body2">{slate.options?.description}</Typography>
                   </Grid>
                  }
                  { props.type !== "templates" &&
                    <>
                      { slate.options?.isTemplate &&
                        <Grid item>
                          <Chip size="small" icon={<FilterNoneIcon/>} color="secondary" label="template" />
                        </Grid>
                      }
                      { slate.options?.eligibleForThemeCompilation &&
                        <Grid item>
                          <Chip size="small" icon={<BrushIcon/>} color="secondary" label="theme" />
                        </Grid>
                      }
                      <Grid item>
                        { slate.options?.isPublic ? <Chip size="small" icon={<PublicIcon />} label="public" /> : slate.options?.isUnlisted ? <Chip size="small"  icon={<VpnLockIcon />} label="unlisted" /> : <Chip size="small"  icon={<LockIcon/>}  color="secondary" label="private" /> }
                      </Grid>
                    </>
                  }
                </Grid>
                }
              actionIcon={<SlateMenu slate={slate} isTemplate={props.type === "templates"} isCommunity={props.type === "community"} isTeam={props.type === "team"} />}
            />
          </GridListTile>
        ))}
      </GridList>
      }
      <Dialog fullScreen open={slatePreview?.open} onClose={handlePreviewClose}>
        <AppBar>
          <Toolbar>
            <Grid
              justify="space-between" 
              alignItems="center"
              spacing={1}
              container>
              <Grid item xs={1}>
                <IconButton edge="start" color="inherit" onClick={handlePreviewClose} aria-label="close">
                  <CloseIcon />
                </IconButton>
              </Grid>
              <Grid item xs={3}>
                <Typography variant="h5">
                  {slatePreview?.slate?.options.name ? slatePreview.slate.options.name : "Slate Preview"}
                </Typography>
              </Grid>
              <Grid item xs={8}>
                <Grid container justify="flex-end" alignItems="center" spacing={2}>
                  {lgmq &&
                    <Grid item>
                      <Typography variant="body2">
                        {slatePreviewMessage} &rarr;
                      </Typography>
                    </Grid>
                  }
                  <Grid item>
                    <Button variant="outlined" startIcon={<FileCopyIcon />} onClick={copyPreviewSlate} >
                      {slatePreviewButtonText}
                    </Button>
                  </Grid>
                </Grid>
              </Grid>
            </Grid>
          </Toolbar>
        </AppBar>
        <Container component="main" maxWidth="xl" style={{height: "100%" }}>
          <SnapSlate slate={slatePreview?.slate} overrideContainer={true} allowZoom={true} allowDrag={true} />
        </Container>
      </Dialog>
    </Container >
  );
}