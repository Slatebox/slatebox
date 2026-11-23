/* eslint-disable no-underscore-dangle */
/* eslint-disable no-nested-ternary */
import React, { useEffect } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useTheme } from '@mui/material/styles'
import { useNavigate } from 'react-router-dom'
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
import EmptyState from './EmptyState'
import { emptySlatesCopy, slateListView, SLATES_FAILED_COPY } from '../common/emptySlates.mjs'
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
    privateOnly: type === 'mine' && slateFilter.privateOnly })

  let headerMessage = getTranslation('slates', 'mySlates')
  let subHeaderMessage = getTranslation('slates', 'mySlatesSubHeader')

  switch (type) {
    case 'team': {
      headerMessage = getTranslation('slates', 'teamSlates')
      subHeaderMessage = getTranslation('slates', 'teamSlatesSubHeader')
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
          borderBottom: 1,
          borderColor: 'divider',
          // borderRadius: 2,
          // backgroundColor: theme.palette.background.default,
          // boxShadow: '0 0 10px rgba(0, 0, 0, 0.3)',
        }}
      >
        <Title
          key={titleKey}
          showAdd
          showSearch
          searchOptions={tags.map((t) => t.tag)}
          onAdd={() => history('/new')}
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
      <Box sx={{ flexGrow: 1, overflowY: 'auto', padding: '10px' }}>
        {type === 'mine' && <RecentlyJoined />}
        {view === 'loading' ? (
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
        ) : view === 'error' ? (
          <Box role="alert" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 1, py: 6 }}>
            <Typography variant="body1" color="text.secondary">{SLATES_FAILED_COPY.line}</Typography>
            <Button size="small" onClick={() => setRerender(Random.id())}>{SLATES_FAILED_COPY.retry}</Button>
          </Box>
        ) : view === 'empty' ? (
          <EmptyState variant="empty" title={empty.title} body={empty.body} action={empty.action}
            secondary={empty.secondary} onClear={empty.clear ? clearFilter : undefined} />
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
            {slates.map((slate, i) => {
              const name = slate.options?.name || t('slates.defaultNewSlateName')
              function openSlate() {
                setMainDrawerOpen(false)
                history(`/canvas/${slate.shareId}`)
              }
              return (
                <Box component="li" key={slate.shareId} sx={{ minWidth: 0, listStyle: 'none', px: 0.75, pb: 1 }}>
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
                      <Typography variant="caption" color="text.secondary">
                        {slate.options?.userNameOverride || <UserName slateUserId={slate.userId} />}
                      </Typography>
                    </Box>
                    <SlateMenu slate={slate} />
                    {type !== 'team' && (
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
    </Box>
  )
}
