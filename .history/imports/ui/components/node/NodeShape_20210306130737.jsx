import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux'
import { makeStyles, withStyles } from '@material-ui/core/styles';
import { useTheme } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import Paper from '@material-ui/core/Paper';
import Grid from '@material-ui/core/Grid';
import SVGIcon from '@material-ui/core/SVGIcon';
import GridList from '@material-ui/core/GridList';
import GridListTile from '@material-ui/core/GridListTile';
import TextField from '@material-ui/core/TextField';
import Link from '@material-ui/core/Link';
import InputAdornment from '@material-ui/core/InputAdornment';
import IconButton from '@material-ui/core/IconButton';
import CircularProgress from '@material-ui/core/CircularProgress';
import SearchIcon from '@material-ui/icons/Search';
import Typography from '@material-ui/core/Typography';
import Box from '@material-ui/core/Box';

import { Translation } from "../../common/Translation.jsx";

import Button from '@material-ui/core/Button';
import ButtonGroup from '@material-ui/core/ButtonGroup';

import { Slatebox } from 'slatebox';
import { CONSTANTS } from '/imports/api/common/constants.js';
import { promisify } from '/imports/api/client/promisify.js';
import { defaultShapes } from './defaultShapes.js';

import SvgIcon from '@material-ui/core/SVGIcon';
import InfiniteScroll from 'react-infinite-scroll-component';

const useStyles = makeStyles((theme) => ({
  shape: {
    cursor: "pointer"
  },
  notchedOutline: {
  },
  focused: {
  },
  inputRoot: {
    "& .MuiFormLabel-root": {
      color: "#fff"
    },
    "& fieldset": {
      border: "1px solid #fff"
    },
    "& .MuiOutlinedInput-notchedOutline-focused": {
      borderColor: "#fff"
    },
    "& input": {
      color: "#fff"
    }
  },
  input2Root: {
    '&:hover $notchedOutline': {
      borderColor: '#ccc'
    },
    '&$focused $notchedOutline': {
      borderColor: 'white'
    },
    '& $notchedOutline': {
      borderColor: 'white'
    },
    '& input': {
      color: '#fff',
    }
  },
  shapeItemselect: {
    cursor: "pointer",
    transition: "transform .2s",
    "&:hover": {
      transform: "scale(1.1)"
    }
  },
  txtSearch: {
    backgroundColor: "#fff"
    , color: "#fff"
  }
}));

export const NodeShape = (props) => {

  const classes = useStyles();
  const dispatch = useDispatch();
  let previousVal = null;

  // useEffect(() => {
  //   page = 0;
  //   previousVal = "";
  // }, []);

  const updateOptions = (opts) => {

    //let s = Math.max(props.node.options.width, props.node.options.height) / opts.max;
    let path = Slatebox.utils._transformPath(opts.vectorPath, `s${props.node.options.width/opts.max},${props.node.options.height/opts.max}`);

    //console.log("scaled path ", s, path);

    var pkg = {
      type: 'onNodeShapeChanged'
      , data: {
        shape: path
      }
    };

    props.onChange(pkg);

    if (opts.vectorPath) {
      updatePath(opts.vectorPath);
    }

  }

  let shapeItems = useSelector(state => state.shapeItems) || [];
  let searchShapeVal = useSelector(state => state.searchShapeVal) || '';
  let searchLimit = useSelector(state => state.searchLimit) || 10;
  let page = useSelector(state => state.page) || 0;
  let hasMore = useSelector(state => state.hasMore) || false;

  console.log("got searchShapeVal ", searchShapeVal);

  const [path, updatePath] = React.useState(props.node?.options?.vectorPath);
  // const [shapeItems, setshapeItems] = React.useState([]);
  // const [searchShapeVal, setSearch] = React.useState('');
  // const [searchLimit, setLimit] = React.useState(10);
  // //const [page, setPage] = React.useState(0);
  // const [hasMore, setMore] = React.useState(false);

  // {
  //   type: "nounproject",
  //   {
  //     path,
  //     shapeItems,
  //     searchShapeVal,
  //     searchLimit,
  //     page,
  //     hasMore
  //   }
  // }

  const searchNounProject = (e) => {
    async function getResults() {
      page++;
      console.log("noun project ", searchLimit, page, searchShapeVal);
      let results = await promisify(Meteor.call, CONSTANTS.methods.nounProject.get, { limit: searchLimit, query: searchShapeVal, page: page });
      console.log("got results ", results);
      let allshapeItems = shapeItems;
      if (results.data.length > 0) {
        console.log("raw results ", JSON.stringify(results.data, null, 2));
        const scaledPaths = results.data.map((d) => {
          return { path: d.path, title: d.title };
        });
        allshapeItems = allshapeItems.concat(scaledPaths).flat();
      }

      //store in global cache for return
      dispatch({
        type: "nounproject"
        , shapeItems: allshapeItems
        , page: page
        , hasMore: results.hasMoreData
      });
    }
    getResults();
  }

  let bgColor = props?.node?.options?.backgroundColor.split('-');
  bgColor = bgColor ? bgColor.length > 1 ? bgColor[1] : bgColor[0] : "#fff";
  const slateBgStyle = { backgroundColor: props?.node?.slate?.options?.containerStyle?.backgroundColor, border: props?.node?.slate?.options?.containerStyle?.border, borderRadius: "3px" };

  const handleSearch = (e) => {
    dispatch({
      type: "nounproject"
      , page: 0
      , searchShapeVal: e.target.value
    });
    //setSearch(e.target.value);
  }

  const handleClear = (e) => {
    dispatch({
      type: "nounproject"
      , page: 0
      , shapeItems: []
      , searchShapeVal: ''
    })
  }

  return (
    <Grid container alignItems="flex-start" justify="center" spacing={4}>
      <Grid item xs={4}>
        <Typography variant="h6" style={{ color: "#fff" }}><Translation>nodeDrawer.shapes.basicShapes</Translation></Typography>
        <Grid container alignItems="flex-start" justify="flex-start" spacing={1} style={{ maxHeight: "250px", overflow: "scroll" }}>
          {defaultShapes.map((s) => (
            <Grid item key={`${s.key}`}>
              <IconButton aria-label={s.title} style={slateBgStyle} className={classes.shapeItemselect}>
                <SvgIcon htmlColor={bgColor} style={{ fontSize: 36 }} className={classes.shape} onClick={() => updateOptions({ vectorPath: s.path, max: 36 })}>
                  <path stroke-width={(s.path === path) ? "2px" : ""} stroke={(s.path === path) ? "#000" : "none"} d={s.path} />
                </SvgIcon>
              </IconButton>
            </Grid>
          ))}
        </Grid>
      </Grid>
      <Grid item xs={2}>
        <Grid container alignItems="center" justify="flex-end" style={{ height: "250px" }}>
          <TextField
            label={<Translation>nodeDrawer.shapes.searchInputPlaceholder</Translation>}
            value={searchShapeVal}
            variant='outlined'
            onChange={handleSearch}
            onKeyPress={(ev) => {
              if (ev.key === 'Enter') {
                searchNounProject();
                ev.preventDefault();
              }
            }}
            className={classes.inputRoot}
            InputProps={{
              endAdornment: (
                <InputAdornment>
                  <IconButton>
                    <SearchIcon style={{ color: "#fff" }} onClick={searchNounProject} />
                  </IconButton>
                </InputAdornment>
              )
            }}
          />
        </Grid>
      </Grid>
      <Grid item xs={6}>
        <Typography variant="h6" style={{ color: "#fff" }}>
          {(page > 0 || shapeItems.length > 0) ? <Translation>nodeDrawer.shapes.customShapes</Translation> : <span>&nbsp;</span>}
        </Typography>
        <InfiniteScroll
          dataLength={shapeItems ? shapeItems.length : 0} //This is important field to render the next data
          next={searchNounProject}
          hasMore={hasMore}
          loader={<CircularProgress style={{ marginTop: '15px', color: "#fff" }} />}
          height={250}
          endMessage={
            (searchShapeVal !== '' && (page > 0 || shapeItems.length > 0)) ?
              <Grid container spacing={3} alignItems="center" justify="center">
                <Grid item xs={6}>
                  <Typography variant="body2" style={{ marginTop: '15px', color: "#fff" }}>
                    <Translation>nodeDrawer.shapes.searchFinished</Translation>
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Link style={{ color: "#fff", border: '1px solid #fff', padding: '5px' }} href="#" onClick={handleClear}><Translation>nodeDrawer.shapes.clearSearch</Translation></Link>
                </Grid>
              </Grid>
              :
              <Grid container alignItems="center" justify="flex-start" style={{ height: "235px" }}>
                <Typography variant="body2" style={{ color: "#fff" }}>
                  &larr; <Translation>nodeDrawer.shapes.searchInfo</Translation>
                </Typography>
              </Grid>
          }
        >
          <Grid container alignItems="flex-start" justify="flex-start" spacing={3}>
            {shapeItems && shapeItems.map((s, i) => (
              <Grid item key={`${s.title}_${i}`}>
                <IconButton aria-label={s.title} style={slateBgStyle} className={classes.shapeItemselect}>
                  <SvgIcon htmlColor={bgColor} style={{ fontSize: 100 }} viewBox="0 0 100 100" className={`${classes.iconHover} ${classes.shape}`} onClick={() => updateOptions({ vectorPath: s.path, max: 90 })}>
                    <path stroke-width={(s.path === path) ? "2px" : ""} stroke={(s.path === path) ? "#000" : "none"} d={s.path} />
                  </SvgIcon>
                </IconButton>
              </Grid>
            ))}
          </Grid>

        </InfiniteScroll>
      </Grid>
    </Grid>
  );
}