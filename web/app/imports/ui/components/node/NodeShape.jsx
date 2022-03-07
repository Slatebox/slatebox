import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useDispatch, useSelector } from 'react-redux'
import { makeStyles } from '@material-ui/core/styles'
import Grid from '@material-ui/core/Grid'
import TextField from '@material-ui/core/TextField'
import Button from '@material-ui/core/Button'
import InputAdornment from '@material-ui/core/InputAdornment'
import IconButton from '@material-ui/core/IconButton'
import CircularProgress from '@material-ui/core/CircularProgress'
import SearchIcon from '@material-ui/icons/Search'
import SvgIcon from '@material-ui/core/SvgIcon'
import Typography from '@material-ui/core/Typography'
import InfiniteScroll from 'react-infinite-scroll-component'
import Translation from '../../common/Translation'
import { Slatebox } from 'slatebox'
import CONSTANTS from '../../../api/common/constants'
import promisify from '../../../api/client/promisify'
import defaultShapes from './defaultShapes'
import nodeProps from '../../propTypes/nodeProps'

const useStyles = makeStyles(() => ({
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

export default function NodeShape({ node, height, onChange }) {
  const classes = useStyles()
  const dispatch = useDispatch()

  const updateOptions = async (opts) => {
    // let s = Math.max(node.options.width, node.options.height) / opts.max;
    const vbbox = opts.width
      ? { width: opts.width, height: opts.height }
      : Slatebox.utils.getBBox({ path: opts.vectorPath }) // size of actual vector
    // console.log("width height before", node.options.width, node.options.height, vbbox.width, vbbox.height);
    // let path = Slatebox.utils._transformPath(opts.vectorPath, `s${node.options.width/vbbox.width},${node.options.height/vbbox.height}`);
    const rootWidth = node.options.hasResized ? node.options.width : 175
    const rootHeight = node.options.hasResized ? node.options.height : 100
    const sendWidth = rootWidth / vbbox.width
    const sendHeight = rootHeight / vbbox.height
    let ratio = Math.max(sendWidth, sendHeight)
    ratio = ratio > 10 ? 10 : ratio

    const path = await promisify(Meteor.call, CONSTANTS.methods.slates.scale, {
      path: opts.vectorPath,
      width: ratio,
      height: ratio,
    })
    // path = await promisify(Meteor.call, CONSTANTS.methods.slates.translate, { path: path, x: node.options.width * -1, y: node.options.height * -1 });
    // path = Slatebox.utils._transformPath(path, `t0,0`);

    // console.log("width height after", Slatebox.utils.getBBox({ path }));

    // if the opacity is 0, then set it to 1 because it was used here as a means to

    const pkg = {
      type: 'onNodeShapeChanged',
      data: {
        shape: path,
        width: vbbox.width * ratio,
        height: vbbox.height * ratio,
      },
    }

    if (node?.options?.opacity === 0) {
      onChange({
        type: 'onNodeColorChanged',
        data: { opacity: 1, color: node.options.backgroundColor },
      })
    }

    if (opts.isLine) {
      onChange({
        type: 'onNodeBorderPropertiesChanged',
        data: { id: node?.options?.id, prop: 'borderWidth', val: 3 },
      })
    }

    onChange(pkg)

    if (opts.vectorPath) {
      updatePath(opts.vectorPath)
    }
  }

  const shapeItems = useSelector((state) => state.shapeItems) || []
  const searchShapeVal = useSelector((state) => state.searchShapeVal) || ''
  const searchLimit = useSelector((state) => state.searchLimit) || 15
  let shapePage = useSelector((state) => state.shapePage)
  if (shapePage == null) shapePage = 0
  const hasMoreShapes = useSelector((state) => state.hasMoreShapes) || false

  const [path, updatePath] = React.useState(node?.options?.vectorPath)

  const searchNounProject = (e) => {
    async function getResults() {
      shapePage += 1
      const results = await promisify(
        Meteor.call,
        CONSTANTS.methods.nounProject.get,
        { limit: searchLimit, query: searchShapeVal, page: shapePage }
      )
      let allshapeItems = shapeItems
      if (results.data.length > 0) {
        const scaledPaths = results.data.map((d) => ({
          path: d.path,
          title: d.title,
          width: d.width,
          height: d.height,
        }))
        allshapeItems = allshapeItems.concat(scaledPaths).flat()
      }

      // store in global cache for return
      dispatch({
        type: 'nounproject',
        shapeItems: allshapeItems,
        shapePage,
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

  let bgColor = node?.options?.backgroundColor.split('-')
  // eslint-disable-next-line no-nested-ternary
  bgColor = bgColor ? (bgColor.length > 1 ? bgColor[1] : bgColor[0]) : '#fff'
  const slateBgStyle = {
    backgroundColor: node?.slate?.options?.containerStyle?.backgroundColor,
    border: node?.slate?.options?.containerStyle?.border,
    borderRadius: '3px',
  }

  const handleSearch = (e) => {
    dispatch({
      type: 'nounproject',
      shapePage: 0,
      searchShapeVal: e.target.value,
    })
  }

  const handleClear = (e) => {
    dispatch({
      type: 'nounproject',
      shapePage: 0,
      shapeItems: [],
      searchShapeVal: '',
    })
  }

  NodeShape.propTypes = {
    node: nodeProps.isRequired,
    onChange: PropTypes.func.isRequired,
    height: PropTypes.number.isRequired,
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
                      // eslint-disable-next-line no-nested-ternary
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
              const self = e.target
              setTimeout(() => {
                // eslint-disable-next-line no-multi-assign
                self.selectionStart = self.selectionEnd = 10000
              }, 0)
            }}
          />
        </Grid>
      </Grid>
      <Grid item xs={6}>
        <InfiniteScroll
          dataLength={shapeItems ? shapeItems.length : 0} // This is important field to render the next data
          next={searchNounProject}
          hasMore={hasMoreShapes}
          loader={
            <CircularProgress style={{ marginTop: '15px', color: '#fff' }} />
          }
          height={`${height - 45}px`}
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
                  <Button
                    style={{
                      color: '#fff',
                      border: '1px solid #fff',
                      padding: '5px',
                    }}
                    href="#"
                    onClick={handleClear}
                  >
                    <Translation>nodeDrawer.shapes.clearSearch</Translation>
                  </Button>
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
              shapeItems.map((s) => (
                <Grid item key={`${s.title}`}>
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
                        strokeWidth={s.path === path ? '2px' : ''}
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
