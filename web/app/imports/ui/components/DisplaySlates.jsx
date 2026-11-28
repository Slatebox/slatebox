/* eslint-disable no-underscore-dangle */
/* eslint-disable no-nested-ternary */
import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useTheme } from '@mui/material/styles'
import { useLocation, useNavigate } from 'react-router-dom'
import Typography from '@mui/material/Typography'
import ImageList from '@mui/material/ImageList'
import ImageListItem from '@mui/material/ImageListItem'
import { useAtom, useSetAtom } from 'jotai'
import { Skeleton } from '@mui/material'
import Checkbox from '@mui/material/Checkbox'
import PublicIcon from '@mui/icons-material/Public'
import LockIcon from '@mui/icons-material/Lock'
import VpnLockIcon from '@mui/icons-material/VpnLock'
import ClearIcon from '@mui/icons-material/Clear'
import SearchIcon from '@mui/icons-material/Search'
import cloneDeep from 'lodash.clonedeep'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import TextField from '@mui/material/TextField'
import useMediaQuery from '@mui/material/useMediaQuery'
import promisify from '../../api/client/promisify'
import CONSTANTS from '../../api/common/constants'
import getUserName from '../../api/common/getUserName'
import { useTranslator, getTranslation } from '../common/i18n'
import RecentlyJoined from './RecentlyJoined'
import ForYou from './personal/ForYou'
import EmptyState from './EmptyState'
import { emptySlatesCopy, slateListView, SLATES_FAILED_COPY } from '../common/emptySlates.mjs'
import usePhoneView from '../common/usePhoneView'
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
import { slatePathInProject } from './projects/projectsModel.mjs'
import { slateAuthorLabel } from './slateAuthorLabel.mjs'
import AppPage, { PAGE_SPACE } from '../common/AppPage'

export default function DisplaySlates({
  sentSlateMinimumPerPage,
  type,
  userId,
  pinSlatePerPageCount,
  cols,
  cellHeight,
  showDescription,
  // type 'project': the drive or folder to list (projectId), the drive's link key when it was opened
  // by its link, the project page's own title row (header), what an empty project offers (empty),
  // and whether this person may add slates there (canAdd; the page's own Add a slate does it).
  projectId = null,
  linkKey = null,
  projectRole = null,
  header = null,
  empty: projectEmpty = null,
}) {
  const history = useNavigate()
  const location = useLocation()
  const theme = useTheme()
  const t = useTranslator()
  const mdmq = useMediaQuery(theme.breakpoints.up('md'))
  // A phone opens and browses slates; it does not make them (phoneView.mjs).
  const phoneView = usePhoneView()
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
  // The last reply from slates.get (null until the first one): the empty state waits for a reply saying none.
  const [answer, setAnswer] = React.useState(null)
  const [isSelectAllToggled, setSelectAllToggled] = React.useState(false)
  // A new key clears the filter field when the empty state's Clear the filter is used.
  const [titleKey, setTitleKey] = React.useState(0)
  const tags = []

  // reset to first page on first load
  useEffect(() => {
    setSlateFilter({
      ...slateFilter,
      slatePage: 1,
      filterString: null,
    })
    setAnswer(null)
    setRerender(Random.id())
  }, [
    sentSlateMinimumPerPage,
    type,
    userId,
    pinSlatePerPageCount,
    cols,
    cellHeight,
    showDescription,
    projectId,
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
          private: type === 'project' ? false : slateFilter.privateOnly,
          ...(type === 'project' && { projectId, ...(linkKey && { linkKey }) }),
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
            setAnswer({ ok: true, total: nextSlates.counts.total })
            setLoading(false)
          } else {
            setSlates([])
            setSlateFilter({
              ...slateFilter,
              totalSlates: 0,
            })
            setAnswer({ ok: false })
            setLoading(false)
          }
        }
      )
    }
    if (Meteor.userId()) {
      getSlates()
    }
  }, [invokeRerender])

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

  const clearFilter = () => {
    setSlateFilter({ ...slateFilter, filterString: '', slatePage: 1 })
    setTitleKey((k) => k + 1)
    setRerender(Random.id())
  }
  const view = slateListView({ signedIn: Boolean(Meteor.userId()), loading, answer })
  const empty = emptySlatesCopy({ type, signedIn: Boolean(Meteor.userId()), filter: slateFilter.filterString,
    privateOnly: type === 'mine' && slateFilter.privateOnly, phone: phoneView })

  let headerMessage = getTranslation('slates', 'mySlates')
  let subHeaderMessage = getTranslation('slates', 'mySlatesSubHeader')

  switch (type) {
    case 'team': {
      headerMessage = getTranslation('slates', 'teamSlates')
      subHeaderMessage = getTranslation('slates', 'teamSlatesSubHeader')
      break
    }
    case 'project': {
      // The project page draws its own title (ProjectHeader): the row here keeps search and paging.
      headerMessage = ''
      subHeaderMessage = ''
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

  // The shared page layout (AppPage): the title row with search and paging stays put; the grid scrolls under it.
  return (
    <AppPage
      fill
      data-slates-page={type}
      header={(
        <Box
          data-slates-header=""
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: 1,
            pb: 2,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          {header}
          <Title
            key={titleKey}
            showAdd={!phoneView && type !== 'project'}
            showSearch
            searchOptions={tags.map((t) => t.tag)}
            // New, among slates already made: a blank slate (the first run is for Create slate before any).
            onAdd={() => history('/new?empty=1')}
            onSearchInputChange={filterSlates}
            onPrivateChanged={onPrivateChanged}
            onDelete={onDelete}
            onToggleSelect={onToggleSelect}
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
      )}
    >
      <Box sx={{ flexGrow: 1, overflowY: 'auto', pt: PAGE_SPACE.header, pb: 2 }}>
        {/* For you: ideas made for this person's work (server/personal); "See ideas made for you" after a talk asks afresh */}
        {type === 'mine' && <ForYou variant="page" fresh={location.state?.forYou === 'fresh'} />}
        {type === 'mine' && <RecentlyJoined />}
        {view === 'loading' ? (
          <ImageList
            gap={20}
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
        ) : view === 'error' ? (
          <Box role="alert" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 1, py: 6 }}>
            <Typography variant="body1" color="text.secondary">{SLATES_FAILED_COPY.line}</Typography>
            <Button size="small" onClick={() => setRerender(Random.id())}>{SLATES_FAILED_COPY.retry}</Button>
          </Box>
        ) : view === 'empty' && type === 'project' && projectEmpty && !slateFilter.filterString ? (
          projectEmpty
        ) : view === 'empty' ? (
          <EmptyState variant="empty" title={empty.title} body={empty.body} action={empty.action}
            secondary={empty.secondary} onClear={empty.clear ? clearFilter : undefined} />
        ) : (
          <ImageList
            gap={20}
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
            {slates.map((slate, i) => {
              const name = slate.options?.name || t('slates.defaultNewSlateName')
              // The slate's owner, never the viewer: a shared project lists other people's slates.
              const author = slate.options?.userNameOverride || slateAuthorLabel(slate, Meteor.userId(), getUserName)
              function openSlate() {
                setMainDrawerOpen(false)
                history(type === 'project' ? slatePathInProject(slate.shareId, linkKey) : `/canvas/${slate.shareId}`)
              }
              return (
                <Box component="li" key={slate.shareId} sx={{ minWidth: 0, listStyle: 'none', pb: 1 }}>
                  <Box sx={{ position: 'relative', height: cellHeight || 210, overflow: 'hidden', border: 1, borderColor: 'divider', borderRadius: 1 }}>
                    {/* The thumbnail is one picture, named after the slate; its parts say nothing and take no focus or clicks. */}
                    <Box role="img" aria-label={name} sx={{ width: '100%', height: '100%' }}>
                      <Box inert="" sx={{ width: '100%', height: '100%' }}>
                        <SnapSlate slate={slate} allowDrag={false} allowZoom={false} index={i} />
                      </Box>
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
                      <Typography variant="caption" color="text.secondary" noWrap component="p" title={author}>
                        {author}
                      </Typography>
                    </Box>
                    {/* A phone views slates: no Delete, privacy or selection on its cards (phoneView.mjs). */}
                    {!phoneView && <SlateMenu slate={slate} projectRole={projectRole} />}
                    {type === 'mine' && !phoneView && (
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
    </AppPage>
  )
}
