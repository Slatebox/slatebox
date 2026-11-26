import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import AppPage from '../common/AppPage'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import Chip from '@mui/material/Chip'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import InputAdornment from '@mui/material/InputAdornment'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Button from '@mui/material/Button'
import Alert from '@mui/material/Alert'
import SearchIcon from '@mui/icons-material/Search'
import libraryApi from '../../api/client/library'
import LibraryCard from '../components/library/gallery/LibraryCard'
import ForYou from '../components/personal/ForYou'
import { CATEGORY_CHIPS, countLine, galleryQuery, KIND_TABS, listInput, readGalleryQuery, SORTS } from '../components/library/gallery/galleryCopy.mjs'

/**
 * The shared library (library spec §7.1), open to everyone, signed in or not: the smart components, slates and
 * presentations people have published, and the ones Slatebox ships. Filter by kind and category, search, sort by new
 * or most used; each card's picture is the item drawn by the one renderer. The filters live in the URL, so a filtered
 * list can be shared and Back returns to it.
 */
export default function Library() {
  const location = useLocation()
  const navigate = useNavigate()
  const filters = readGalleryQuery(location.search)
  const [query, setQuery] = useState(filters.q)
  const [stats, setStats] = useState(null)
  const [list, setList] = useState({ items: [], total: null, next: undefined })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const asked = useRef(0)

  // The tab says Library while it is open, and gets its title back when the person leaves (a slate sets none of its own).
  useEffect(() => {
    const before = document.title
    document.title = 'Library · Slatebox'
    return () => { document.title = before }
  }, [])
  useEffect(() => { libraryApi.stats().then(setStats, () => setStats(null)) }, [])

  const setFilters = useCallback((change) => {
    navigate({ search: galleryQuery({ ...readGalleryQuery(location.search), ...change }) }, { replace: true })
  }, [location.search, navigate])

  const key = galleryQuery(filters)
  useEffect(() => {
    const ask = ++asked.current
    setLoading(true)
    setError(null)
    libraryApi.list(listInput(filters)).then((answer) => {
      if (ask !== asked.current) return
      setList({ items: answer.items, total: answer.total, next: answer.next })
    }, (err) => {
      if (ask !== asked.current) return
      setError(err?.reason || 'The library could not be loaded. Try again in a moment.')
    }).finally(() => { if (ask === asked.current) setLoading(false) })
  }, [key])

  // Search as the person types, a moment after they stop.
  useEffect(() => {
    if (query === filters.q) return undefined
    const timer = setTimeout(() => setFilters({ q: query }), 350)
    return () => clearTimeout(timer)
  }, [query])

  const more = async () => {
    setLoading(true)
    try {
      const answer = await libraryApi.list(listInput(filters, list.next))
      setList(current => ({ items: [...current.items, ...answer.items], total: answer.total, next: answer.next }))
    } catch (err) {
      setError(err?.reason || 'More could not be loaded.')
    } finally { setLoading(false) }
  }

  return (
    <AppPage
      title="Library"
      subtitle={<>
        <Box component="span" sx={{ display: 'block', maxWidth: 720 }}>
          Smart components, slates and presentations anyone can use. Open a copy to make it yours, or add a component to one of your slates. Everything here is free.
        </Box>
        {stats && <Typography variant="body2" color="text.primary" sx={{ mt: 1 }} data-library-count-line>{countLine(stats)}</Typography>}
      </>}
      actions={<Button component={RouterLink} to="/new#build=new" variant="outlined" sx={{ flexShrink: 0 }}>Build your own component</Button>}
    >
      <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 2 }}>
        <Tabs value={filters.kind ?? 'all'} onChange={(_e, value) => setFilters({ kind: value === 'all' ? null : value })} variant="scrollable" allowScrollButtonsMobile aria-label="Kind">
          {KIND_TABS.map(tab => <Tab key={tab.label} value={tab.id ?? 'all'} label={tab.label} />)}
        </Tabs>
      </Box>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2.5, alignItems: { md: 'center' } }}>
        <Stack direction="row" spacing={1} role="group" aria-label="Category" sx={{ flexWrap: 'wrap', rowGap: 1, flex: 1 }}>
          {CATEGORY_CHIPS.map(chip => (
            <Chip
              key={chip.label}
              label={chip.label}
              clickable
              color={filters.category === chip.id ? 'primary' : 'default'}
              variant={filters.category === chip.id ? 'filled' : 'outlined'}
              aria-pressed={filters.category === chip.id}
              onClick={() => setFilters({ category: chip.id })}
            />
          ))}
        </Stack>
        <TextField
          size="small"
          placeholder="Search the library"
          value={query}
          onChange={e => setQuery(e.target.value)}
          inputProps={{ 'aria-label': 'Search the library', maxLength: 100 }}
          InputProps={{ startAdornment: <InputAdornment position="start"><SearchIcon fontSize="small" /></InputAdornment> }}
          sx={{ width: { xs: '100%', md: 260 } }}
        />
        <ToggleButtonGroup size="small" exclusive value={filters.sort} onChange={(_e, value) => value && setFilters({ sort: value })} aria-label="Sort">
          {SORTS.map(sort => <ToggleButton key={sort.id} value={sort.id}>{sort.label}</ToggleButton>)}
        </ToggleButtonGroup>
      </Stack>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {list.total === 0 && !loading && !error && (
        <Box sx={{ py: 6, textAlign: 'center' }} data-library-empty>
          <Typography variant="h6">Nothing here yet</Typography>
          <Typography color="text.secondary" sx={{ mb: 2 }}>
            {filters.q ? `Nothing matches “${filters.q}”.` : 'Nothing has been published in this part of the library yet.'}
          </Typography>
          <Button onClick={() => { setQuery(''); navigate({ search: '' }, { replace: true }) }}>Show everything</Button>
        </Box>
      )}

      {/* For you: the first group, when Slatebox has ideas made for this person (signed in; none while searching, and only
          under All or Smart components: its ideas are components and pages) */}
      {!filters.q && (!filters.kind || filters.kind === 'component') && <ForYou variant="library" />}

      <Box
        component="section"
        aria-label="Library items"
        aria-busy={loading}
        sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' } }}
      >
        {list.items.map(item => <LibraryCard key={item.id} item={item} />)}
      </Box>

      {list.next && (
        <Box sx={{ textAlign: 'center', mt: 3 }}>
          <Button variant="outlined" onClick={more} disabled={loading}>Show more</Button>
        </Box>
      )}
    </AppPage>
  )
}
