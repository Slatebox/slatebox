/* eslint-disable no-plusplus */
/* eslint-disable no-underscore-dangle */
/* eslint-disable react/jsx-props-no-spreading */
import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useAtom, useSetAtom } from 'jotai'
import { useTheme } from '@mui/material/styles'
import Grid from '@mui/material/Grid2'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import InputAdornment from '@mui/material/InputAdornment'
import IconButton from '@mui/material/IconButton'
import Box from '@mui/material/Box'
import Checkbox from '@mui/material/Checkbox'
import CircularProgress from '@mui/material/CircularProgress'
import SearchIcon from '@mui/icons-material/Search'
import DeleteIcon from '@mui/icons-material/Delete'
import SvgIcon from '@mui/material/SvgIcon'
import AddIcon from '@mui/icons-material/Add'
import Typography from '@mui/material/Typography'
import Tooltip from '@mui/material/Tooltip'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogActions from '@mui/material/DialogActions'
import Fade from '@mui/material/Fade'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import Autocomplete, { createFilterOptions } from '@mui/material/Autocomplete'
import { Slatebox } from 'slateboxjs'
import cloneDeep from 'lodash.clonedeep'
import { useTranslator } from '../../common/i18n'
import confirmService from '../../common/confirm'
import CONSTANTS from '../../../api/common/constants'
import defaultShapes from './defaultShapes'
import nodeProps from '../../propTypes/nodeProps'

import { IconPacks } from '../../../api/common/models'

import {
  globalMessage,
  nodeShapeDetails,
  registrationDetails,
  getSVGCheckmarks,
} from '../../jotai/atoms'

export default function NodeShape({
  node,
  height,
  onChange,
  iconDiscoveryMode = false,
  contrastColor,
  sendSlateBgColor = '#000',
  sendNodeBgColor = '#333',
  shapeSearchLimit = 15,
  isMU = false,
}) {
  const theme = useTheme()
  const t = useTranslator()
  const shapeScroll = React.useRef(null)

  const updateOptions = async (opts) => {
    // let s = Math.max(node.options.width, node.options.height) / opts.max;
    const vbbox = opts.width
      ? { width: opts.width, height: opts.height }
      : Slatebox.utils.getBBox({ path: opts.vectorPath }) // size of actual vector
    // console.log("width height before", node.options.width, node.options.height, vbbox.width, vbbox.height);
    // let path = Slatebox.utils._transformPath(opts.vectorPath, `s${node.options.width/vbbox.width},${node.options.height/vbbox.height}`);
    const rootWidth = node?.options.hasResized ? node.options.width : 175
    const rootHeight = node?.options.hasResized ? node.options.height : 100
    const sendWidth = rootWidth / vbbox.width
    const sendHeight = rootHeight / vbbox.height
    let ratio = Math.max(sendWidth, sendHeight)
    ratio = ratio > 10 ? 10 : ratio

    const path = await Meteor.callAsync(CONSTANTS.methods.slates.scale, {
      path: opts.vectorPath,
      width: ratio,
      height: ratio,
    })
    // path = await Meteor.callAsync(CONSTANTS.methods.slates.translate, { path: path, x: node.options.width * -1, y: node.options.height * -1 });
    // path = Slatebox.utils._transformPath(path, `t0,0`);

    // console.log("width height after", Slatebox.utils.getBBox({ path }));

    // if the opacity is 0, then set it to 1 because it was used here as a means to

    const pkg = {
      type: 'onNodeShapeChanged',
      data: {
        shape: path,
        hint: opts.hint,
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

  const [getRegistrationDetails, setRegistrationDetails] =
    useAtom(registrationDetails)
  const [getNodeShapeDetails, setNodeShapeDetails] = useAtom(nodeShapeDetails)

  const [getSVGChecks, setSVGChecks] = useAtom(getSVGCheckmarks)
  const setGlobalMessage = useSetAtom(globalMessage)

  // set the currentIconPackId to whatever is selected
  const [currentIconPackId, updateCurrentIconPackId] = React.useState(null)

  // is the dialoge open?
  const [iconPackOpen, toggleIconPackOpen] = React.useState(false)

  // these two are for the dialog only
  const [iconPackName, setIconPackName] = React.useState('')
  const [iconPackVisibility, setIconPackVisibility] = React.useState(
    isMU ? 'public' : 'private'
  )

  const iconPacks = useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.iconPacks)
    return IconPacks.find().fetch()
  })

  const handleIconPackClose = () => {
    setIconPackName('')
    toggleIconPackOpen(false)
  }

  const changeIconPackName = (event) => {
    event.preventDefault()
    setIconPackName(event.target.value)
  }

  async function updateOrCreateIconPack(isNew) {
    const allIconIds = getSVGChecks.map((s) => s.id)
    const icons = getNodeShapeDetails.shapeItems.filter(
      (ns) =>
        allIconIds.includes(ns.id) ||
        getNodeShapeDetails.iconPackIconIds.includes(ns.id)
    )
    const ip = {
      _id: isNew ? null : currentIconPackId,
      visibility: iconPackVisibility,
      icons,
    }
    if (iconPackName && iconPackName !== '') {
      ip.name = iconPackName
    }
    await Meteor.callAsync(CONSTANTS.methods.iconPacks.update, ip)
    setGlobalMessage({
      visible: true,
      isSnackBar: true,
      text: `Successfully ${
        currentIconPackId ? 'updated' : 'created'
      } the ${iconPackName} icon pack with ${getSVGChecks.length} icons!`,
      severity: 'info',
      autoHide: 10000,
    })
    return { icons }
  }

  const addIconPack = async (event) => {
    event.preventDefault()
    updateCurrentIconPackId(null)
    const createPack = await updateOrCreateIconPack(true)
    setIconPackName('')
    toggleIconPackOpen(false)
    setSVGChecks([])
    // store in global cache for return
    setNodeShapeDetails({
      ...getNodeShapeDetails,
      iconPackIconIds: [],
      searchShapeVal: '',
    })
    return createPack
  }

  // const shapeItems = useSelector((state) => state.shapeItems) || []
  // const searchShapeVal = useSelector((state) => state.searchShapeVal) || ''
  // const searchLimit = useSelector((state) => state.searchLimit) || 15
  // let shapePage = useSelector((state) => state.shapePage)
  // if (shapePage == null) shapePage = 0
  // const hasMoreShapes = useSelector((state) => state.hasMoreShapes) || false

  const [path, updatePath] = React.useState(node?.options?.vectorPath)

  const searchNounProject = (disableIconPackSearch) => {
    async function getResults() {
      const copy = cloneDeep(getNodeShapeDetails)
      setNodeShapeDetails({
        ...copy,
        isLoading: true,
      })
      copy.shapePage++
      const results = await Meteor.callAsync(
        CONSTANTS.methods.nounProject.get,
        {
          limit: copy.searchLimit,
          query: copy.searchShapeVal,
          page: copy.shapePage,
          disableIconPackSearch,
        }
      )
      let allshapeItems = copy.shapeItems || []
      if (results.data.length > 0) {
        const scaledPaths = results.data.map((d) => ({
          id: d.id,
          path: d.path,
          title: d.title,
          width: d.width,
          height: d.height,
        }))
        allshapeItems = allshapeItems.concat(scaledPaths).flat()
        if (
          currentIconPackId &&
          getNodeShapeDetails.iconPackIconIds.length > 0
        ) {
          allshapeItems = allshapeItems.filter(
            (i) => !getNodeShapeDetails.iconPackIconIds.includes(i.id)
          )
        }
      }

      // store in global cache for return
      setNodeShapeDetails({
        ...copy,
        isLoading: false,
        searchLimit: shapeSearchLimit || 15,
        shapeItems: allshapeItems,
        hasMoreShapes: results.hasMoreData,
      })
    }

    if (Meteor.user()?.isAnonymous) {
      setRegistrationDetails({
        type: 'registration',
        registrationOpen: true,
        registrationMessage: `Want to search custom shapes? It takes a second to register.`,
      })
    } else {
      getResults()
    }
  }

  let bgColor =
    node?.options?.backgroundColor.split('-') ||
    (sendNodeBgColor ? [sendNodeBgColor] : null)
  // eslint-disable-next-line no-nested-ternary
  bgColor = bgColor
    ? bgColor.length > 1
      ? bgColor[1]
      : bgColor[0]
    : iconDiscoveryMode
      ? '#000'
      : '#fff'
  const borderColor = contrastColor
  const slateBgStyle = {
    backgroundColor:
      sendSlateBgColor || node?.slate?.options?.containerStyle?.backgroundColor,
    border: '1px solid #000',
    borderRadius: '0px',
  }

  const slateDefaultIconBgStyle = {
    ...slateBgStyle,
    height: '50px',
    width: '50px',
  }

  const handleSearch = (e) => {
    setNodeShapeDetails({
      ...getNodeShapeDetails,
      shapePage: 0,
      searchLimit: shapeSearchLimit || 15,
      searchShapeVal: e.target.value,
    })
  }

  const handleClear = (e) => {
    updateCurrentIconPackId(null)
    setSVGChecks([])
    setNodeShapeDetails({
      ...getNodeShapeDetails,
      hasMoreShapes: false,
      iconPackIconIds: [],
      shapePage: 0,
      shapeItems: [],
      searchShapeVal: '',
    })
  }

  const addSVGToChecked = async (id, isChecked) => {
    let lastChecked = cloneDeep(getSVGChecks) || []
    if (isChecked) {
      lastChecked.push({ id })
    } else {
      lastChecked = lastChecked.filter((s) => s.id !== id)
    }
    setSVGChecks(lastChecked)
  }

  const removeIconFromPack = async (id, forceAll) => {
    const copy = cloneDeep(getNodeShapeDetails)
    let removeIcon = true
    if (
      forceAll ||
      (copy.iconPackIconIds.length === 1 &&
        copy.iconPackIconIds.find((i) => i === id))
    ) {
      removeIcon = await confirmService.show({
        theme,
        title: `Delete the ${iconPackName} icon pack?`,
        message: `${
          forceAll ? '' : "You're removing the last icon in the pack."
        } This will automatically delete the entire icon pack. Continue?`,
      })
    }

    if (removeIcon) {
      copy.shapeItems = copy.shapeItems.filter((s) =>
        forceAll ? copy.iconPackIconIds.includes(s.id) : s.id !== id
      )
      copy.iconPackIconIds = forceAll
        ? []
        : copy.iconPackIconIds.filter((i) => i !== id)
      if (forceAll || copy.shapeItems.length === 0) {
        // no icons left in this icon pack, so reset all
        await Meteor.callAsync(
          CONSTANTS.methods.iconPacks.delete,
          currentIconPackId
        )
      } else {
        await Meteor.callAsync(
          CONSTANTS.methods.iconPacks.removeIcon,
          currentIconPackId,
          id
        )
      }
    }

    setNodeShapeDetails({
      ...copy,
      hasMoreShapes: false,
      shapePage: 1,
    })

    return removeIcon
  }

  const addIconsToExistingPack = async () => {
    const createPack = await updateOrCreateIconPack()
    setNodeShapeDetails({
      ...getNodeShapeDetails,
      iconPackIconIds: createPack.icons.map((ix) => ix.id),
    })
    setSVGChecks([])
    return createPack
  }

  const isSVGChecked = (id) => getSVGChecks.some((s) => s.id === id)

  const createIconPackFilter = createFilterOptions()

  NodeShape.propTypes = {
    node: nodeProps,
    onChange: PropTypes.func,
    height: PropTypes.number.isRequired,
    iconDiscoveryMode: PropTypes.bool,
    contrastColor: PropTypes.string,
    sendSlateBgColor: PropTypes.string,
    sendNodeBgColor: PropTypes.string,
    shapeSearchLimit: PropTypes.number,
    isMU: PropTypes.bool,
  }

  return (
    <Box
      sx={{
        '& .shape': {
          cursor: 'pointer',
        },
        '& .inputRoot': {
          '& .MuiFormLabel-root': {
            color: contrastColor || '',
          },
          '& fieldset': {
            border: `1px solid ${contrastColor || ''}`,
          },
          '& .MuiOutlinedInput-notchedOutline-focused': {
            borderColor: contrastColor || '',
          },
          '& input': {
            color: contrastColor || '',
          },
          width: '100%',
        },
        '& .input2Root': {
          '&:hover .notchedOutline': {
            borderColor: '#ccc',
          },
          '&.focused .notchedOutline': {
            borderColor: 'white',
          },
          '& .notchedOutline': {
            borderColor: 'white',
          },
          '& input': {
            color: '',
          },
        },
        '& .shapeItemselect': {
          cursor: 'pointer',
          transition: 'transform .2s',
          '&:hover': {
            transform: 'scale(1.1)',
          },
        },
        '& .txtSearch': {
          backgroundColor: '',
          color: '',
        },
        '& .autoCompleteContrast': {
          '& .MuiAutocomplete-input': {
            color: contrastColor,
          },
        },
      }}
    >
      <Grid
        container
        alignItems="flex-start"
        justifyContent="center"
        spacing={1}
        sx={{ height: '100%', marginTop: '5px' }}
      >
        {!iconDiscoveryMode && (
          <Grid size={4}>
            <Grid
              container
              alignItems="flex-start"
              justifyContent="flex-start"
              spacing={1}
              style={{ maxHeight: '175px', overflow: 'hidden' }}
            >
              {defaultShapes.map((s) => (
                <Grid key={`${s.key}`}>
                  <IconButton
                    aria-label={s.title}
                    style={slateDefaultIconBgStyle}
                    className="shapeItemselect"
                    onClick={() =>
                      updateOptions({
                        vectorPath: s.path,
                        hint: s.name,
                        width: s.width,
                        height: s.height,
                        isLine: s.key === 'line',
                      })
                    }
                  >
                    <SvgIcon
                      htmlColor={bgColor}
                      style={{ fontSize: 33 }}
                      className="shape"
                    >
                      <path
                        strokeWidth={
                          // eslint-disable-next-line no-nested-ternary
                          s.path === path
                            ? '2px'
                            : s.key === 'line'
                              ? '1px'
                              : ''
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
        )}
        <Grid size={iconDiscoveryMode ? 12 : 2} sx={{ position: 'relative' }}>
          <TextField
            label={t('nodeDrawer.shapes.searchInputPlaceholder')}
            value={getNodeShapeDetails.searchShapeVal}
            variant="outlined"
            onChange={handleSearch}
            onKeyDown={(ev) => {
              if (ev.key === 'Enter') {
                searchNounProject()
                ev.preventDefault()
              }
            }}
            className="inputRoot"
            slotProps={{
              input: {
                style: { color: contrastColor },
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      onClick={(e) => {
                        searchNounProject()
                      }}
                    >
                      <SearchIcon style={{ color: contrastColor }} />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
            autoFocus
            onFocus={(e) => {
              const self = e.target
              setTimeout(() => {
                self.selectionStart = self.selectionEnd = 10000
              }, 0)
            }}
          />
        </Grid>
        <Grid
          size={iconDiscoveryMode ? 12 : 6}
          sx={{
            height: iconDiscoveryMode ? 'calc(100vh - 250px)' : '200px',
            overflow: 'scroll',
            '& .MuiGrid-container': {
              margin: 0,
              padding: 2,
              display: 'grid',
              gridTemplateColumns: iconDiscoveryMode
                ? 'repeat(4, 1fr)'
                : 'auto',
              gap: 2,
            },
            '& .MuiGrid-item': {
              padding: 0,
              display: 'flex',
              justifyContent: 'center',
              backgroundColor: 'rgba(255, 255, 255, 0.03)',
              borderRadius: 1,
              transition: 'background-color 0.2s',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
              },
            },
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <Grid container alignItems="flex-start" justifyContent="flex-start">
            {getNodeShapeDetails?.shapeItems &&
              getNodeShapeDetails?.shapeItems.map((s) => (
                <Grid key={`${s.id}`}>
                  <Box
                    sx={{
                      display: 'flex',
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'flex-start',
                      width: '100%',
                      padding: 1,
                      gap: 0.5,
                    }}
                  >
                    {iconDiscoveryMode && isMU && (
                      <Box>
                        {(!currentIconPackId ||
                          (currentIconPackId &&
                            getNodeShapeDetails?.iconPackOwner ===
                              Meteor.userId() &&
                            !getNodeShapeDetails?.iconPackIconIds.includes(
                              s.id
                            ))) && (
                          <Tooltip title="Add to icon pack...">
                            <Checkbox
                              edge="start"
                              checked={isSVGChecked(s.id)}
                              onClick={(e) => {
                                addSVGToChecked(s.id, e.target.checked)
                                e.stopPropagation()
                              }}
                              sx={{
                                padding: '8px',
                                color: 'secondary.main',
                                '&.Mui-checked': {
                                  color: 'secondary.main',
                                },
                              }}
                              tabIndex={-1}
                              disableRipple
                            />
                          </Tooltip>
                        )}
                        {currentIconPackId &&
                          getNodeShapeDetails?.iconPackOwner ===
                            Meteor.userId() &&
                          getNodeShapeDetails?.iconPackIconIds.includes(
                            s.id
                          ) && (
                            <IconButton
                              aria-label="delete-icon"
                              style={{
                                color: theme.palette.secondary.main,
                                backgroundColor: 'transparent',
                                padding: '4px',
                              }}
                              className="shapeItemselect"
                              disableRipple
                              onClick={() => removeIconFromPack(s.id)}
                            >
                              <DeleteIcon />
                            </IconButton>
                          )}
                      </Box>
                    )}
                    <Tooltip title="Add to slate">
                      <IconButton
                        aria-label={s.title}
                        style={slateBgStyle}
                        className="shapeItemselect"
                        sx={{
                          width: '85px',
                          height: '85px',
                          padding: '2px',
                        }}
                        onClick={() =>
                          updateOptions({
                            vectorPath: s.path,
                            hint: 'custom',
                            width: s.width,
                            height: s.height,
                          })
                        }
                      >
                        <SvgIcon
                          htmlColor={bgColor}
                          style={{ fontSize: 60 }}
                          viewBox="0 0 100 100"
                          className={`iconHover shape`}
                        >
                          <path
                            strokeWidth={s.path === path ? '2px' : ''}
                            stroke={s.path === path ? '#000' : 'none'}
                            d={s.path}
                          />
                        </SvgIcon>
                      </IconButton>
                    </Tooltip>
                  </Box>
                </Grid>
              ))}
            {getNodeShapeDetails?.hasMoreShapes &&
            !getNodeShapeDetails?.isLoading ? (
              <Grid sx={{ gridColumn: 'span 4' }}>
                <IconButton
                  aria-label="load more"
                  color="secondary"
                  variant="contained"
                  onClick={() => searchNounProject(true)}
                >
                  <AddIcon
                    style={{ fontSize: 60 }}
                    className={`iconHover shape`}
                  />
                </IconButton>
              </Grid>
            ) : (
              <Grid
                sx={{
                  gridColumn: 'span 4',
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  minHeight: 100,
                  color: 'text.secondary',
                  fontStyle: 'italic',
                }}
              >
                {!getNodeShapeDetails?.hasMoreShapes ? (
                  <>{t('nodeDrawer.shapes.searchFinished')}</>
                ) : (
                  <CircularProgress
                    style={{ marginTop: '15px', color: '#fff' }}
                  />
                )}
              </Grid>
            )}
          </Grid>
        </Grid>
        {iconDiscoveryMode && isMU && (
          <>
            <Grid
              size={
                currentIconPackId &&
                getNodeShapeDetails.iconPackOwner === Meteor.userId()
                  ? 8
                  : 12
              }
            >
              {getSVGChecks?.length > 0 && (
                <Fade in>
                  <Box
                    sx={{
                      mb: 2,
                      p: 1.5,
                      borderRadius: 1,
                      backgroundColor: 'rgba(255,255,255,0.05)',
                      border: '1px solid',
                      borderColor: 'secondary.main',
                    }}
                  >
                    <Typography variant="body2" color="secondary.main">
                      <b>{getSVGChecks.length} icons selected</b> - Type a name
                      below to create a new icon pack
                    </Typography>
                  </Box>
                </Fade>
              )}
              <Autocomplete
                id="slate-icon-packs"
                className="autoCompleteContrast"
                selectOnFocus
                clearOnBlur
                handleHomeEndKeys
                value={
                  currentIconPackId &&
                  iconPacks.find((ip) => ip._id === currentIconPackId)
                    ? iconPacks.find((ip) => ip._id === currentIconPackId).name
                    : null
                }
                options={iconPacks}
                onChange={async (event, iconPack) => {
                  if (typeof iconPack === 'string' || iconPack?.inputValue) {
                    // new icon pack so bring up dialog
                    setIconPackName(
                      typeof iconPack === 'string' ? iconPack : iconPack.name
                    )
                    toggleIconPackOpen(true)
                  } else if (iconPack?._id) {
                    let getIconPack = iconPacks.find(
                      (t) => t._id === iconPack._id
                    )
                    updateCurrentIconPackId(getIconPack._id)
                    const { icons } = getIconPack
                    if (!icons || icons.length === 0) {
                      setNodeShapeDetails({
                        ...getNodeShapeDetails,
                        isLoading: true,
                      })
                      getIconPack = await Meteor.callAsync(
                        CONSTANTS.methods.iconPacks.get,
                        { iconPackId: getIconPack._id }
                      )
                    }
                    setNodeShapeDetails({
                      ...getNodeShapeDetails,
                      isLoading: false,
                      searchShapeVal: '',
                      hasMoreShapes: false,
                      shapePage: 1,
                      shapeItems: getIconPack.icons,
                      iconPackIconIds: getIconPack.icons.map((ix) => ix.id),
                      iconPackOwner: getIconPack.userId,
                    })
                    setSVGChecks([])
                  }
                }}
                filterOptions={(options, params) => {
                  const filtered = createIconPackFilter(options, params)
                  if (params.inputValue !== '') {
                    if (getSVGChecks?.length > 0) {
                      filtered.push({
                        name: params.inputValue,
                        inputValue: `Add "${params.inputValue}"`,
                      })
                    }
                  }
                  return filtered
                }}
                renderOption={(props, option) => (
                  <li {...props}>{option.inputValue || option.name}</li>
                )}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    label="Create or Load Icon Packs..."
                    variant="outlined"
                  />
                )}
                getOptionLabel={(option) => {
                  // e.g value selected with enter, right from the input
                  if (typeof option === 'string') {
                    return option
                  }
                  if (option.inputValue) {
                    return option.inputValue
                  }
                  return option.name
                }}
              />

              <Dialog
                open={iconPackOpen}
                onClose={handleIconPackClose}
                aria-labelledby="svg-pack-title"
              >
                <DialogTitle id="svg-pack-title">
                  <Typography color="secondary" variant="h6">
                    Add A New Icon Pack
                  </Typography>
                </DialogTitle>
                <DialogContent>
                  <DialogContentText>
                    Want to create a new icon pack that includes the{' '}
                    {getSVGChecks?.length} checked icons?
                  </DialogContentText>
                  <Box mt={3} p={1}>
                    <TextField
                      autoFocus
                      fullWidth
                      variant="outlined"
                      id="name"
                      value={iconPackName}
                      onChange={changeIconPackName}
                      label="Icon Pack Name"
                      type="text"
                    />
                  </Box>
                  <Box p={1}>
                    <Select
                      labelId="icon-pack-access-level"
                      id="icon-pack-access-level"
                      variant="outlined"
                      value={iconPackVisibility}
                      onChange={(e) => {
                        setIconPackVisibility(e.target.value)
                      }}
                      label="Visibility"
                      fullWidth
                    >
                      {isMU && <MenuItem value="public">Public</MenuItem>}
                      <MenuItem value="private">Private</MenuItem>
                      {Meteor.user() && Meteor.user().orgId && (
                        <MenuItem value="org">Organization</MenuItem>
                      )}
                    </Select>
                  </Box>
                </DialogContent>
                <DialogActions>
                  <Button onClick={handleIconPackClose} color="secondary">
                    Cancel
                  </Button>
                  <Button color="secondary" onClick={addIconPack}>
                    Add
                  </Button>
                </DialogActions>
              </Dialog>
            </Grid>
            {currentIconPackId &&
              getNodeShapeDetails.iconPackOwner === Meteor.userId() && (
                <Grid size={getSVGChecks.length === 0 ? 4 : 1}>
                  <IconButton
                    color="secondary"
                    sx={{ height: '50px', color: contrastColor }}
                    onClick={async (e) => {
                      if (await removeIconFromPack(null, true)) {
                        handleClear()
                      }
                    }}
                  >
                    <DeleteIcon />
                  </IconButton>
                </Grid>
              )}
            {currentIconPackId &&
              getNodeShapeDetails.iconPackOwner === Meteor.userId() &&
              getSVGChecks.length > 0 && (
                <Grid size={3}>
                  <Button
                    variant="contained"
                    color="secondary"
                    fullWidth
                    sx={{ height: '50px', backgroundColor: contrastColor }}
                    onClick={addIconsToExistingPack}
                  >
                    Add {getSVGChecks.length} Icons
                  </Button>
                </Grid>
              )}
          </>
        )}
      </Grid>
    </Box>
  )
}
