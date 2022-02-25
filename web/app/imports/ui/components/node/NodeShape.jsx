import React, { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { makeStyles, withStyles } from '@material-ui/core/styles'
import { useTheme } from '@material-ui/core/styles'
import useMediaQuery from '@material-ui/core/useMediaQuery'
import Paper from '@material-ui/core/Paper'
import Grid from '@material-ui/core/Grid'
import GridList from '@material-ui/core/GridList'
import GridListTile from '@material-ui/core/GridListTile'
import TextField from '@material-ui/core/TextField'
import Link from '@material-ui/core/Link'
import InputAdornment from '@material-ui/core/InputAdornment'
import IconButton from '@material-ui/core/IconButton'
import CircularProgress from '@material-ui/core/CircularProgress'
import SearchIcon from '@material-ui/icons/Search'
import SvgIcon from '@material-ui/core/SvgIcon'
import Typography from '@material-ui/core/Typography'
import Box from '@material-ui/core/Box'

import { Translation } from '../../common/Translation.jsx'

import Button from '@material-ui/core/Button'
import ButtonGroup from '@material-ui/core/ButtonGroup'

import { Slatebox } from '../../../api/client/slatebox'
import { CONSTANTS } from '/imports/api/common/constants.js'
import { promisify } from '/imports/api/client/promisify.js'
import { defaultShapes } from './defaultShapes.js'

import InfiniteScroll from 'react-infinite-scroll-component'

const useStyles = makeStyles((theme) => ({
  shape: {
    cursor: 'pointer',
  },
  notchedOutline: {},
  focused: {},
  inputRoot: {
    '& .MuiFormLabel-root': {
      color: '#fff',
    },
    '& fieldset': {
      border: '1px solid #fff',
    },
    '& .MuiOutlinedInput-notchedOutline-focused': {
      borderColor: '#fff',
    },
    '& input': {
      color: '#fff',
    },
  },
  input2Root: {
    '&:hover $notchedOutline': {
      borderColor: '#ccc',
    },
    '&$focused $notchedOutline': {
      borderColor: 'white',
    },
    '& $notchedOutline': {
      borderColor: 'white',
    },
    '& input': {
      color: '#fff',
    },
  },
  shapeItemselect: {
    cursor: 'pointer',
    transition: 'transform .2s',
    '&:hover': {
      transform: 'scale(1.1)',
    },
  },
  txtSearch: {
    backgroundColor: '#fff',
    color: '#fff',
  },
}))

export const NodeShape = (props) => {
  const classes = useStyles()
  const dispatch = useDispatch()

  // useEffect(() => {
  //   shapePage = 0;
  //   previousVal = "";
  // }, []);

  const updateOptions = async (opts) => {
    //let s = Math.max(props.node.options.width, props.node.options.height) / opts.max;
    let vbbox = opts.width
      ? { width: opts.width, height: opts.height }
      : Slatebox.utils.getBBox({ path: opts.vectorPath }) //size of actual vector
    //console.log("width height before", props.node.options.width, props.node.options.height, vbbox.width, vbbox.height);
    //let path = Slatebox.Utils.lowLevelTransformPath(opts.vectorPath, `s${props.node.options.width/vbbox.width},${props.node.options.height/vbbox.height}`);
    let rootWidth = props.node.options.hasResized
      ? props.node.options.width
      : 175
    let rootHeight = props.node.options.hasResized
      ? props.node.options.height
      : 100
    let sendWidth = rootWidth / vbbox.width
    let sendHeight = rootHeight / vbbox.height
    let ratio = Math.max(sendWidth, sendHeight)
    ratio = ratio > 10 ? 10 : ratio

    let path = await promisify(Meteor.call, CONSTANTS.methods.slates.scale, {
      path: opts.vectorPath,
      width: ratio,
      height: ratio,
    })
    //path = await promisify(Meteor.call, CONSTANTS.methods.slates.translate, { path: path, x: props.node.options.width * -1, y: props.node.options.height * -1 });
    //path = Slatebox.Utils.lowLevelTransformPath(path, `t0,0`);

    //console.log("width height after", Slatebox.utils.getBBox({ path }));

    //if the opacity is 0, then set it to 1 because it was used here as a means to

    const pkg = {
      type: 'onNodeShapeChanged',
      data: {
        shape: path,
        width: vbbox.width * ratio,
        height: vbbox.height * ratio,
      },
    }

    if (props?.node?.options?.opacity === 0) {
      props.onChange({
        type: 'onNodeColorChanged',
        data: { opacity: 1, color: props.node.options.backgroundColor },
      })
    }

    if (opts.isLine) {
      props.onChange({
        type: 'onNodeBorderPropertiesChanged',
        data: { id: props?.node?.options?.id, prop: 'borderWidth', val: 3 },
      })
    }

    props.onChange(pkg)

    if (opts.vectorPath) {
      updatePath(opts.vectorPath)
    }
  }

  let shapeItems = useSelector((state) => state.shapeItems) || []
  let searchShapeVal = useSelector((state) => state.searchShapeVal) || ''
  let searchLimit = useSelector((state) => state.searchLimit) || 15
  let shapePage = useSelector((state) => state.shapePage)
  if (shapePage == null) shapePage = 0
  let hasMoreShapes = useSelector((state) => state.hasMoreShapes) || false

  const [path, updatePath] = React.useState(props.node?.options?.vectorPath)
  // const [shapeItems, setshapeItems] = React.useState([]);
  // const [searchShapeVal, setSearch] = React.useState('');
  // const [searchLimit, setLimit] = React.useState(10);
  // //const [shapePage, setshapePage] = React.useState(0);
  // const [hasMoreShapes, setMore] = React.useState(false);

  // {
  //   type: "nounproject",
  //   {
  //     path,
  //     shapeItems,
  //     searchShapeVal,
  //     searchLimit,
  //     shapePage,
  //     hasMoreShapes
  //   }
  // }

  const searchNounProject = (e) => {
    async function getResults() {
      shapePage++
      let results = await promisify(
        Meteor.call,
        CONSTANTS.methods.nounProject.get,
        { limit: searchLimit, query: searchShapeVal, page: shapePage }
      )
      let allshapeItems = shapeItems
      if (results.data.length > 0) {
        const scaledPaths = results.data.map((d) => {
          return {
            path: d.path,
            title: d.title,
            width: d.width,
            height: d.height,
          }
        })
        allshapeItems = allshapeItems.concat(scaledPaths).flat()
      }

      //store in global cache for return
      dispatch({
        type: 'nounproject',
        shapeItems: allshapeItems,
        shapePage: shapePage,
        hasMoreShapes: results.hasMoreData,
      })
    }

    if (Meteor.user().isAnonymous) {
      dispatch({
        type: 'registration',
        registrationOpen: true,
        registrationMessage: `Want to search custom shapes? It takes a second to register.`,
      })
    } else {
      getResults()
    }
  }

  let bgColor = props?.node?.options?.backgroundColor.split('-')
  bgColor = bgColor ? (bgColor.length > 1 ? bgColor[1] : bgColor[0]) : '#fff'
  const slateBgStyle = {
    backgroundColor:
      props?.node?.slate?.options?.containerStyle?.backgroundColor,
    border: props?.node?.slate?.options?.containerStyle?.border,
    borderRadius: '3px',
  }

  const handleSearch = (e) => {
    dispatch({
      type: 'nounproject',
      shapePage: 0,
      searchShapeVal: e.target.value,
    })
    //setSearch(e.target.value);
  }

  const handleClear = (e) => {
    dispatch({
      type: 'nounproject',
      shapePage: 0,
      shapeItems: [],
      searchShapeVal: '',
    })
  }

  return (
    <Grid container alignItems="flex-start" justify="center" spacing={1}>
      <Grid item xs={4}>
        <Grid
          container
          alignItems="flex-start"
          justify="flex-start"
          spacing={1}
          style={{ maxHeight: '175px', overflow: 'scroll' }}
        >
          {defaultShapes.map((s) => (
            <Grid item key={`${s.key}`}>
              <IconButton
                aria-label={s.title}
                style={slateBgStyle}
                className={classes.shapeItemselect}
                onClick={() =>
                  updateOptions({
                    vectorPath: s.path,
                    width: s.width,
                    height: s.height,
                    isLine: s.key === 'line',
                  })
                }
              >
                <SvgIcon
                  htmlColor={bgColor}
                  style={{ fontSize: 33 }}
                  className={classes.shape}
                >
                  <path
                    strokeWidth={
                      s.path === path ? '2px' : s.key === 'line' ? '1px' : ''
                    }
                    stroke={
                      s.path === path || s.key === 'line' ? '#000' : 'none'
                    }
                    d={s.path}
                  />
                </SvgIcon>
              </IconButton>
            </Grid>
          ))}
        </Grid>
      </Grid>
      <Grid item xs={2}>
        <Grid
          container
          alignItems="center"
          justify="flex-end"
          style={{ height: '140px' }}
        >
          <TextField
            label={
              <Translation>
                nodeDrawer.shapes.searchInputPlaceholder
              </Translation>
            }
            value={searchShapeVal}
            variant="outlined"
            onChange={handleSearch}
            onKeyPress={(ev) => {
              if (ev.key === 'Enter') {
                searchNounProject()
                ev.preventDefault()
              }
            }}
            className={classes.inputRoot}
            InputProps={{
              endAdornment: (
                <InputAdornment>
                  <IconButton>
                    <SearchIcon
                      style={{ color: '#fff' }}
                      onClick={searchNounProject}
                    />
                  </IconButton>
                </InputAdornment>
              ),
            }}
            InputLabelProps={{
              style: { color: '#fff' },
            }}
            autoFocus
            onFocus={(e) => {
              let self = e.target
              setTimeout(function () {
                self.selectionStart = self.selectionEnd = 10000
              }, 0)
            }}
          />
        </Grid>
      </Grid>
      <Grid item xs={6}>
        <InfiniteScroll
          dataLength={shapeItems ? shapeItems.length : 0} //This is important field to render the next data
          next={searchNounProject}
          hasMore={hasMoreShapes}
          loader={
            <CircularProgress style={{ marginTop: '15px', color: '#fff' }} />
          }
          height={`${props.height - 45}px`}
          endMessage={
            searchShapeVal !== '' &&
            (shapePage > 0 || shapeItems.length > 0) ? (
              <Grid container spacing={3} alignItems="center" justify="center">
                <Grid item xs={6}>
                  <Typography
                    variant="body2"
                    style={{ marginTop: '15px', color: '#fff' }}
                  >
                    <Translation>nodeDrawer.shapes.searchFinished</Translation>
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Link
                    style={{
                      color: '#fff',
                      border: '1px solid #fff',
                      padding: '5px',
                    }}
                    href="#"
                    onClick={handleClear}
                  >
                    <Translation>nodeDrawer.shapes.clearSearch</Translation>
                  </Link>
                </Grid>
              </Grid>
            ) : (
              <Grid
                container
                alignItems="center"
                justify="flex-start"
                style={{ height: '180px' }}
              >
                <Typography variant="body2" style={{ color: '#fff' }}>
                  &larr; <Translation>nodeDrawer.shapes.searchInfo</Translation>
                </Typography>
              </Grid>
            )
          }
        >
          <Grid
            container
            alignItems="flex-start"
            justify="flex-start"
            spacing={3}
          >
            {shapeItems &&
              shapeItems.map((s, i) => (
                <Grid item key={`${s.title}_${i}`}>
                  <IconButton
                    aria-label={s.title}
                    style={slateBgStyle}
                    className={classes.shapeItemselect}
                    onClick={() =>
                      updateOptions({
                        vectorPath: s.path,
                        width: s.width,
                        height: s.height,
                      })
                    }
                  >
                    <SvgIcon
                      htmlColor={bgColor}
                      style={{ fontSize: 100 }}
                      viewBox="0 0 100 100"
                      className={`${classes.iconHover} ${classes.shape}`}
                    >
                      <path
                        stroke-width={s.path === path ? '2px' : ''}
                        stroke={s.path === path ? '#000' : 'none'}
                        d={s.path}
                      />
                    </SvgIcon>
                  </IconButton>
                </Grid>
              ))}
          </Grid>
        </InfiniteScroll>
      </Grid>
    </Grid>
  )
}
