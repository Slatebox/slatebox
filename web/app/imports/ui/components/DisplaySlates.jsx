/* eslint-disable no-underscore-dangle */
/* eslint-disable no-nested-ternary */
import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useTheme } from '@mui/material/styles'
import { useNavigate } from 'react-router-dom'
import Typography from '@mui/material/Typography'
import Container from '@mui/material/Container'
import ImageList from '@mui/material/ImageList'
import ImageListItem from '@mui/material/ImageListItem'
import { Alert, Paper } from '@mui/material'
import { useAtom, useSetAtom } from 'jotai'
import { Skeleton } from '@mui/material'
import Dialog from '@mui/material/Dialog'
import AppBar from '@mui/material/AppBar'
import IconButton from '@mui/material/IconButton'
import Checkbox from '@mui/material/Checkbox'
import CloseIcon from '@mui/icons-material/Close'
import FileCopyIcon from '@mui/icons-material/FileCopy'
import PublicIcon from '@mui/icons-material/Public'
import LockIcon from '@mui/icons-material/Lock'
import VpnLockIcon from '@mui/icons-material/VpnLock'
import FilterNoneIcon from '@mui/icons-material/FilterNone'
import BrushIcon from '@mui/icons-material/Brush'
import ClearIcon from '@mui/icons-material/Clear'
import SearchIcon from '@mui/icons-material/Search'
import Toolbar from '@mui/material/Toolbar'
import cloneDeep from 'lodash.clonedeep'
import Grid from '@mui/material/Grid2'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import useMediaQuery from '@mui/material/useMediaQuery'
import promisify from '../../api/client/promisify'
import CONSTANTS from '../../api/common/constants'
import getUserName from '../../api/common/getUserName'
import { useTranslator, getTranslation } from '../common/i18n'
import copySlate from '../../api/client/copySlate'
import RecentlyJoined from './RecentlyJoined'
import Title from './Title'
import SnapSlate from './SnapSlate'
import SlateMenu from './SlateMenu'
import confirmService from '../common/confirm'
import {
  globalMessage,
  slateFiltering,
  slateRererender,
  mainDrawerOpen,
  getSlateCheckmarks,
} from '../jotai/atoms'
import { Slates } from '../../api/common/models'
import { Box } from '@mui/material'

export default function DisplaySlates({
  sentSlateMinimumPerPage,
  type,
  userId,
  pinSlatePerPageCount,
  cols,
  cellHeight,
  showDescription,
}) {
  const history = useNavigate()
  const theme = useTheme()
  const t = useTranslator()
  const mdmq = useMediaQuery(theme.breakpoints.up('md'))
  const lgmq = useMediaQuery(theme.breakpoints.up('lg'))
  const xlmq = useMediaQuery(theme.breakpoints.up('xl'))

  if (!mdmq) {
    cols = 1 // eslint-disable-line no-param-reassign
    cellHeight = 220 // eslint-disable-line no-param-reassign
  }

  const [slateFilter, setSlateFilter] = useAtom(slateFiltering)
  const setMainDrawerOpen = useSetAtom(mainDrawerOpen)
  const [invokeRerender, setRerender] = useAtom(slateRererender)
  const [getSlateChecks, setSlateChecks] = useAtom(getSlateCheckmarks)
  const setGlobalMessage = useSetAtom(globalMessage)
  const [slates, setSlates] = React.useState([])
  const [loading, setLoading] = React.useState(false)
  const [isSelectAllToggled, setSelectAllToggled] = React.useState(false)
  const tags = []

  const [slatePreview, setSlatePreview] = React.useState({
    open: false,
    slate: null,
  })

  // reset to first page on first load
  useEffect(() => {
    setSlateFilter({
      ...slateFilter,
      slatePage: 1,
      filterString: null,
    })
    setRerender(Random.id())
  }, [
    sentSlateMinimumPerPage,
    type,
    userId,
    pinSlatePerPageCount,
    cols,
    cellHeight,
    showDescription,
  ])

  useEffect(() => {
    function getSlates() {
      setLoading(true)
      var slatePage = slateFilter.slatePage
      if (type != slateFilter.type) {
        slatePage = 1
      }
      Meteor.call(
        CONSTANTS.methods.slates.get,
        {
          skip: (slateFilter.slatePage - 1) * slateFilter.slateRecordsPerPage,
          limit: slateFilter.slateRecordsPerPage,
          type,
          filterString: slateFilter.filterString,
          private: slateFilter.privateOnly,
        },
        (err, nextSlates) => {
          if (nextSlates) {
            const allSlates = nextSlates.slates
            // console.log('got slates', allSlates)
            setSlates(allSlates)
            setSlateFilter({
              ...slateFilter,
              totalSlates: nextSlates.counts.total,
              type: type,
            })
            setLoading(false)
          } else {
            setSlates([])
            setSlateFilter({
              ...slateFilter,
              totalSlates: 0,
            })
            setLoading(false)
          }
        }
      )
    }
    if (Meteor.userId()) {
      getSlates()
    }
  }, [invokeRerender])

  // eslint-disable-next-line react/no-unstable-nested-components
  function UserName({ slateUserId }) {
    const [userName, setUserName] = React.useState('loading')
    useEffect(() => {
      const getData = async () => {
        const u = getUserName(slateUserId)
        setUserName(u)
      }
      getData()
    }, [])
    return <span>{userName}</span>
  }

  let sf = null
  const filterSlates = (val) => {
    clearTimeout(sf)
    sf = window.setTimeout(() => {
      setSlateFilter({
        ...slateFilter,
        filterString: val,
      })
      setRerender(Random.id())
    }, 500)
  }

  const onChangePage = (e, page) => {
    setSlateFilter({
      ...slateFilter,
      slatePage: page,
    })
    setRerender(Random.id())
  }

  const onChangePageSize = (e) => {
    setSlateFilter({
      ...slateFilter,
      slateRecordsPerPage: e.target.value,
      slatePage: 1,
    })
    setRerender(Random.id())
  }

  const onPrivateChanged = (blnPrivate) => {
    setSlateFilter({
      ...slateFilter,
      privateOnly: blnPrivate,
      slatePage: 1,
    })
    setRerender(Random.id())
  }

  const onToggleSelect = async () => {
    const isSelect = !isSelectAllToggled
    setSelectAllToggled(isSelect)
    if (isSelect) {
      setSlateChecks(
        slates.map((ss) => ({ slateId: ss.options.id, name: ss.options.name }))
      )
    } else {
      setSlateChecks([])
    }
  }

  const onDelete = async () => {
    if (getSlateChecks.length > 0) {
      const result = await confirmService.show({
        theme,
        title: `Delete ${getSlateChecks.length} slate(s)?`,
        message: `Are you sure you\'d like to delete the below slates? <br/><br/> ${getSlateChecks
          .map((s) => s.name)
          .join('<br/>')}`,
      })
      if (result) {
        try {
          setLoading(true)
          await Meteor.callAsync(CONSTANTS.methods.slates.remove, {
            slateIds: getSlateChecks.map((s) => s.slateId),
          })
          setLoading(false)
          setSlateChecks([])
          setRerender(Random.id())
        } catch (err) {
          setGlobalMessage({
            visible: true,
            text: `Error deleting: ${err.message}`,
            severity: 'error',
            autoHide: 60000,
          })
          setSlateChecks([])
        }
        setRerender(Random.id())
      }
    } else {
      setGlobalMessage({
        visible: true,
        text: `You haven't selected any slates to delete!`,
        severity: 'error',
        autoHide: 30000,
      })
    }
  }

  const handlePreviewClose = (e) => {
    setSlatePreview({ open: false, slate: null })
  }

  const copyPreviewSlate = async (e) => {
    const shareId = await copySlate(slatePreview.slate.shareId)
    history(`/canvas/${shareId}`)
    setSlatePreview({ open: false, slate: null })
  }

  const addSlateToChecked = async (slate, isChecked) => {
    let lastChecked = cloneDeep(getSlateChecks) || []
    if (isChecked) {
      lastChecked.push({ slateId: slate.options.id, name: slate.options.name })
    } else {
      lastChecked = lastChecked.filter((s) => s.slateId !== slate.options.id)
    }
    setSlateChecks(lastChecked)
  }

  const isSlateChecked = (slateId) =>
    getSlateChecks?.some((s) => s.slateId === slateId)

  let headerMessage = getTranslation('slates', 'mySlates')
  let subHeaderMessage = getTranslation('slates', 'mySlatesSubHeader')
  let noSlateMessage = getTranslation('slates', 'noSelfSlates')
  let slatePreviewMessage = getTranslation('slates', 'communitySlatePreview')
  let slatePreviewButtonText = getTranslation(
    'slates',
    'communitySlatePreviewButtonText'
  )

  switch (type) {
    case 'community': {
      headerMessage = getTranslation('slates', 'communitySlates')
      subHeaderMessage = getTranslation('slates', 'communitySlatesSubHeader')
      noSlateMessage = getTranslation('slates', 'noCommunitySlates')
      break
    }
    case 'team': {
      headerMessage = getTranslation('slates', 'teamSlates')
      subHeaderMessage = getTranslation('slates', 'teamSlatesSubHeader')
      noSlateMessage = getTranslation('slates', 'noTeamSlates')
      break
    }
    case 'templates': {
      headerMessage = getTranslation('slates', 'templates')
      subHeaderMessage = getTranslation('slates', 'templatesSubHeader')
      noSlateMessage = getTranslation('slates', 'noTemplates')
      slatePreviewMessage = getTranslation('slates', 'templateSlatePreview')
      slatePreviewButtonText = getTranslation(
        'slates',
        'templateSlatePreviewButtonText'
      )
      break
    }
    default:
      break
  }

  DisplaySlates.propTypes = {
    sentSlateMinimumPerPage: PropTypes.number,
    type: PropTypes.string.isRequired,
    userId: PropTypes.string,
    pinSlatePerPageCount: PropTypes.string,
    cols: PropTypes.number,
    cellHeight: PropTypes.number,
    showDescription: PropTypes.string,
  }

  const getSlateChips = (slate) => [
    {
      show: slate.options?.isTemplate,
      icon: <FilterNoneIcon />,
      label: 'Template',
    },
    {
      show: slate.options?.eligibleForThemeCompilation,
      icon: <BrushIcon />,
      label: 'Theme',
    },
    {
      show: slate.options?.isPublic,
      icon: <PublicIcon color="inherit" />,
      label: 'Public',
    },
    {
      show: slate.options?.isUnlisted,
      icon: <VpnLockIcon color="inherit" />,
      label: 'Unlisted',
    },
    {
      show: !slate.options?.isPublic && !slate.options?.isUnlisted,
      icon: <LockIcon />,
      label: 'Private',
    },
  ]

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 64px)',
      }}
    >
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          p: 1,
          borderBottom: '1px solid #adadad',
          // borderRadius: 2,
          // backgroundColor: theme.palette.background.default,
          // boxShadow: '0 0 10px rgba(0, 0, 0, 0.3)',
        }}
      >
        <Title
          showAdd={!(type === 'community' || type === 'templates')}
          showSearch
          searchOptions={tags.map((t) => t.tag)}
          onAdd={() => history('/new')}
          onSearchInputChange={filterSlates}
          onPrivateChanged={
            type === 'community' || type === 'templates'
              ? null
              : onPrivateChanged
          }
          onDelete={
            type === 'community' || type === 'templates' ? null : onDelete
          }
          onToggleSelect={
            type === 'community' || type === 'templates' ? null : onToggleSelect
          }
          isSelectAllToggled={isSelectAllToggled}
          slateMinimumPerPage={slateFilter.slateMinimumPerPage}
          recordsPerPage={slateFilter.slateRecordsPerPage}
          showPaging={slateFilter.totalSlates > slateFilter.slateMinimumPerPage}
          totalPages={Math.ceil(
            slateFilter.totalSlates / slateFilter.slateRecordsPerPage
          )}
          onChangePage={onChangePage}
          onChangePageSize={onChangePageSize}
          page={slateFilter.slatePage}
          pinSlatePerPageCount={pinSlatePerPageCount}
          headerMessage={headerMessage}
          subHeaderMessage={subHeaderMessage}
        />
      </Box>
      <Box sx={{ flexGrow: 1, overflowY: 'auto', padding: '10px' }}>
        {type === 'mine' && <RecentlyJoined />}
        {loading ? (
          <ImageList
            gap={10}
            cols={cols || (xlmq ? 4 : lgmq ? 3 : 2)}
            rowHeight={cellHeight ? parseInt(cellHeight, 10) : 250}
            sx={{
              width: 'auto',
              minHeight: '200px',
              height: 'auto',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {Array.from({ length: slateFilter.slateRecordsPerPage }).map(
              (element, key) => (
                <ImageListItem key={key}>
                  <Skeleton
                    variant="rect"
                    animation="wave"
                    width="100%"
                    height={cellHeight ? parseInt(cellHeight, 10) : 250}
                  />
                </ImageListItem>
              )
            )}
          </ImageList>
        ) : (
          <ImageList
            gap={10}
            cols={cols || (xlmq ? 4 : lgmq ? 3 : 2)}
            rowHeight={cellHeight ? parseInt(cellHeight, 10) : 250}
            sx={{
              width: 'auto',
              minHeight: '200px',
              height: 'auto',
              cursor: 'pointer',
              padding: 0,
            }}
          >
            {slateFilter.totalSlates === 0 && (
              <Alert severity="info">{noSlateMessage}</Alert>
            )}
            {slates.map((slate, i) => {
              const name = slate.options?.name || t('slates.defaultNewSlateName')
              function openSlate() {
                setMainDrawerOpen(false)
                if (type === 'community' || type === 'templates') {
                  setSlatePreview({ open: true, slate: cloneDeep(slate) })
                } else {
                  history(`/canvas/${slate.shareId}`)
                }
              }
              return (
                <Box component="li" key={slate.shareId} sx={{ minWidth: 0, listStyle: 'none', px: 0.75, pb: 1 }}>
                  <Box sx={{ position: 'relative', height: cellHeight || 210, overflow: 'hidden', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    <Box aria-hidden="true" inert="" sx={{ width: '100%', height: '100%' }}>
                      <SnapSlate slate={slate} allowDrag={false} allowZoom={false} disableCollab={type === 'community'} index={i} />
                    </Box>
                    <Box component="button" type="button" onClick={openSlate} aria-label={`Open ${name}`}
                      sx={{ position: 'absolute', inset: 0, border: 0, background: 'transparent', cursor: 'pointer',
                        '&:focus-visible': { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: -3 } }} />
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5, pt: 1 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography component="button" type="button" onClick={openSlate} title={name} noWrap
                        sx={{ display: 'block', maxWidth: '100%', p: 0, border: 0, background: 'none', color: 'text.primary', fontWeight: 650, cursor: 'pointer', textAlign: 'left' }}>
                        {name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {slate.options?.userNameOverride || <UserName slateUserId={slate.userId} />}
                      </Typography>
                    </Box>
                    <SlateMenu slate={slate} isTemplate={type === 'templates'} isCommunity={type === 'community'} isTeam={type === 'team'} />
                    {!['community', 'team', 'templates'].includes(type) && (
                      <Checkbox size="small" checked={isSlateChecked(slate.options?.id)} inputProps={{ 'aria-label': `Select ${name}` }}
                        onChange={e => addSlateToChecked(slate, e.target.checked)} />
                    )}
                  </Box>
                  {!showDescription && slate.options?.description && <Typography variant="body2">{slate.options.description}</Typography>}
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                    {getSlateChips(slate).filter(chip => chip.show).map(chip => (
                      <Chip key={chip.label} size="small" variant="outlined" label={chip.label} icon={chip.icon} />
                    ))}
                  </Box>
                </Box>
              )
            })}
          </ImageList>
        )}
      </Box>
      <Dialog fullScreen open={slatePreview?.open} onClose={handlePreviewClose}>
        <AppBar>
          <Toolbar>
            <Grid
              justifyContent="space-between"
              alignItems="center"
              spacing={1}
              container
            >
              <Grid size={1}>
                <IconButton
                  edge="start"
                  color="inherit"
                  onClick={handlePreviewClose}
                  aria-label="close"
                >
                  <CloseIcon />
                </IconButton>
              </Grid>
              <Grid size={3}>
                <Typography variant="h5">
                  {slatePreview?.slate?.options.name
                    ? slatePreview.slate.options.name
                    : 'Slate Preview'}
                </Typography>
              </Grid>
              <Grid size={8}>
                <Grid
                  container
                  justifyContent="flex-end"
                  alignItems="center"
                  spacing={2}
                >
                  {lgmq && (
                    <Grid>
                      <Typography variant="body2">
                        {slatePreviewMessage} &rarr;
                      </Typography>
                    </Grid>
                  )}
                  <Grid>
                    <Button
                      variant="outlined"
                      startIcon={<FileCopyIcon />}
                      onClick={copyPreviewSlate}
                    >
                      {slatePreviewButtonText}
                    </Button>
                  </Grid>
                </Grid>
              </Grid>
            </Grid>
          </Toolbar>
        </AppBar>
        <Container component="main" maxWidth="xl" style={{ height: '100%' }}>
          <SnapSlate
            slate={slatePreview?.slate}
            overrideContainer
            allowZoom
            allowDrag
            disableCollab={false}
          />
        </Container>
      </Dialog>
    </Box>
  )
}
