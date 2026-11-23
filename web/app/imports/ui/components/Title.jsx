import React from 'react'
import PropTypes from 'prop-types'
import Grid from '@mui/material/Grid2'
import Typography from '@mui/material/Typography'
import TextField from '@mui/material/TextField'
import Pagination from '@mui/material/Pagination'
import Select from '@mui/material/Select'
import MenuItem from '@mui/material/MenuItem'
import FormControl from '@mui/material/FormControl'
import InputLabel from '@mui/material/InputLabel'
import { useAtomValue, useAtom } from 'jotai'
import {
  Button,
  ButtonGroup,
  ClickAwayListener,
  Grow,
  MenuList,
  Paper,
  Popper,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { ToggleButton } from '@mui/material'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import { useNavigate } from 'react-router-dom'
import Box from '@mui/material/Box'
import { getSlateCheckmarks } from '../jotai/atoms'
import AddIcon from '@mui/icons-material/Add'
import SearchIcon from '@mui/icons-material/Search'
import ClearIcon from '@mui/icons-material/Clear'
import IconButton from '@mui/material/IconButton'
import InputAdornment from '@mui/material/InputAdornment'

export default function Title({
  showAdd,
  headerMessage,
  subHeaderMessage,
  showPaging,
  totalPages,
  page,
  onChangePage,
  pinSlatePerPageCount,
  slateMinimumPerPage,
  recordsPerPage,
  onPrivateChanged,
  onDelete,
  onSearchInputChange,
  onAdd,
  open,
  showSearch,
  onChangePageSize,
  onToggleSelect,
  isSelectAllToggled,
}) {
  const history = useNavigate()
  const [inputValue, setInputValue] = React.useState('')
  const theme = useTheme()
  const mdmq = useMediaQuery(theme.breakpoints.up('md'))
  const [showPrivateOnly, setPrivateOnly] = React.useState(false)
  const anchorRef = React.useRef(null)
  const [slateSubMenuOpen, setSlateSubMenuOpen] = React.useState(false)
  const [getSlateChecks, setSlateChecks] = useAtom(getSlateCheckmarks)

  const handleSlateSubMenuToggle = () => {
    setSlateSubMenuOpen((prevOpen) => !prevOpen)
  }

  const handleSlateSubMenuClose = (event) => {
    if (anchorRef.current && anchorRef.current.contains(event.target)) {
      return
    }
    setSlateSubMenuOpen(false)
  }

  return (
    <Box
      sx={{
        '& .search': {
          flexGrow: 1,
        },
        '& .formControl': {
          margin: (theme) => theme.spacing(1),
          minWidth: 90,
        },
        // Add this new style for consistent height
        '& .MuiTextField-root, & .MuiButtonGroup-root': {
          height: '40px',
        },
      }}
    >
      <Grid
        container
        spacing={1}
        alignItems="center"
        justifyContent="space-evenly"
      >
        {/* Below md the header is one row: the title takes what is left (and ellipsizes), + New keeps its own width. */}
        <Grid size={{ xs: 'grow', md: showAdd ? 3 : 5 }} sx={{ minWidth: 0 }}>
          <Grid container alignItems="center" justifyContent="flex-start" sx={{ minWidth: 0 }}>
            <Grid sx={{ minWidth: 0, maxWidth: '100%' }}>
              <Typography variant="h5" component="h1" noWrap sx={{ fontWeight: 700, letterSpacing: '-.01em' }}>{headerMessage || ''}</Typography>
            </Grid>
            {subHeaderMessage?.trim() && (
              <Grid size={12}>
                <Typography variant="body2" color="textSecondary">
                  {subHeaderMessage}
                </Typography>
              </Grid>
            )}
            {showPaging && (
              <Grid size={12}>
                <Pagination
                  siblingCount={1}
                  boundaryCount={1}
                  color="secondary"
                  count={totalPages}
                  page={page}
                  onChange={onChangePage}
                  size="small"
                />
              </Grid>
            )}
          </Grid>
        </Grid>
        {showPaging && !pinSlatePerPageCount && mdmq && (
          <Grid size={1}>
            <FormControl className="formControl">
              <InputLabel id="rpp" sx={{ color: 'text.secondary' }}>
                Per page
              </InputLabel>
              <Select
                labelId="rpp"
                id="rpp-select"
                variant="standard"
                value={recordsPerPage}
                onChange={onChangePageSize}
              >
                <MenuItem value={slateMinimumPerPage}>
                  {slateMinimumPerPage}
                </MenuItem>
                <MenuItem value={8}>8</MenuItem>
                <MenuItem value={12}>12</MenuItem>
                <MenuItem value={24}>24</MenuItem>
                <MenuItem value={50}>50</MenuItem>
              </Select>
            </FormControl>
          </Grid>
        )}

        {mdmq && (
          <Grid size={3}>
            {getSlateChecks.length > -1 && onToggleSelect && (
              <Button
                value="selectAll"
                size="small"
                variant="outlined"
                color="secondary"
                selected={showPrivateOnly}
                style={{
                  marginRight: '10px',
                }}
                onClick={onToggleSelect}
              >
                {isSelectAllToggled ? 'Deselect' : 'Select'} All
              </Button>
            )}
            {onDelete && mdmq && getSlateChecks.length > 0 && (
              <Button
                value="delete"
                size="small"
                variant="outlined"
                color="error"
                selected={showPrivateOnly}
                style={{
                  marginRight: '10px',
                  // marginTop: '15px',
                  color: theme.palette.error.main,
                }}
                onClick={onDelete}
              >
                Delete
              </Button>
            )}
            {onPrivateChanged && mdmq && (
              <ToggleButton
                size="small"
                value="private"
                selected={showPrivateOnly}
                style={{ padding: '4px' }}
                onChange={() => {
                  if (onPrivateChanged) onPrivateChanged(!showPrivateOnly)
                  setPrivateOnly(!showPrivateOnly)
                }}
              >
                Private
              </ToggleButton>
            )}
          </Grid>
        )}

        {mdmq && (
        <Grid size={showPaging ? 3 : 4}>
          {showSearch && (
            <TextField
              variant="outlined"
              fullWidth
              className="search"
              id="search-text"
              label="Filter"
              value={inputValue}
              size="small"
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end" sx={{ mr: -1 }}>
                      {inputValue && (
                        <IconButton size="small" aria-label="Clear the filter" onClick={() => {
                          setInputValue('')
                          if (onSearchInputChange) onSearchInputChange('')
                        }}><ClearIcon fontSize="small" /></IconButton>
                      )}
                      <IconButton size="small" aria-label="Search" onClick={() => {
                        if (onSearchInputChange) onSearchInputChange(inputValue)
                      }}><SearchIcon fontSize="small" /></IconButton>
                    </InputAdornment>
                  ),
                },
              }}
              onKeyDown={(ev) => {
                if (ev.key === 'Enter') {
                  if (onSearchInputChange) onSearchInputChange(inputValue)
                  ev.preventDefault()
                }
              }}
              onChange={(e) => {
                setInputValue(e.target.value)
              }}
            />
          )}
        </Grid>
        )}
        {showAdd && (
          <Grid size={{ xs: 'auto', md: 2 }} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              variant="contained"
              onClick={onAdd}
              startIcon={<AddIcon />}
              sx={{ mb: '3px' }}
            >
              New
            </Button>
          </Grid>
        )}
      </Grid>
    </Box>
  )
}

Title.propTypes = {
  showAdd: PropTypes.bool.isRequired,
  showPaging: PropTypes.bool.isRequired,
  onChangePage: PropTypes.func,
  onPrivateChanged: PropTypes.func,
  onDelete: PropTypes.func,
  open: PropTypes.bool,
  onSearchInputChange: PropTypes.func.isRequired,
  showSearch: PropTypes.bool.isRequired,
  isSelectAllToggled: PropTypes.bool.isRequired,
  headerMessage: PropTypes.string,
  subHeaderMessage: PropTypes.string,
  onAdd: PropTypes.func,
  onChangePageSize: PropTypes.func,
  onToggleSelect: PropTypes.func,
  pinSlatePerPageCount: PropTypes.string,
  slateMinimumPerPage: PropTypes.number,
  recordsPerPage: PropTypes.number,
  totalPages: PropTypes.number,
  page: PropTypes.number,
}
