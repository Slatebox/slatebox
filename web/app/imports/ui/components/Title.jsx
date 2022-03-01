import React from 'react'
import PropTypes from 'prop-types'
import Grid from '@material-ui/core/Grid'
import { makeStyles } from '@material-ui/core/styles'
import Typography from '@material-ui/core/Typography'
import TextField from '@material-ui/core/TextField'
import Pagination from '@material-ui/lab/Pagination'
import Select from '@material-ui/core/Select'
import MenuItem from '@material-ui/core/MenuItem'
import FormControl from '@material-ui/core/FormControl'
import InputLabel from '@material-ui/core/InputLabel'
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
} from '@material-ui/core'
import { ToggleButton } from '@material-ui/lab'
import ArrowDropDownIcon from '@material-ui/icons/ArrowDropDown'
import { useHistory } from 'react-router-dom'

const useStyles = makeStyles((theme) => ({
  search: {
    flexGrow: 1,
  },
  formControl: {
    margin: theme.spacing(1),
    minWidth: 90,
  },
}))

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
  onSearchInputChange,
  onAdd,
  open,
  showSearch,
  onChangePageSize,
}) {
  const classes = useStyles()
  const history = useHistory()
  const [inputValue, setInputValue] = React.useState('')
  const theme = useTheme()
  const mdmq = useMediaQuery(theme.breakpoints.up('md'))
  const [showPrivateOnly, setPrivateOnly] = React.useState(false)
  const anchorRef = React.useRef(null)
  const [slateSubMenuOpen, setSlateSubMenuOpen] = React.useState(false)

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
    <Grid container spacing={1} alignItems="center" justify="space-evenly">
      <Grid item xs={showAdd ? 4 : 6}>
        <Grid container alignItems="center" justify="flex-start">
          <Grid item>
            <Typography variant="h5" color="secondary">
              {headerMessage}
            </Typography>
          </Grid>
          <Grid item style={{ marginLeft: '50px', color: '#ccc' }}>
            <Typography variant="body2">{subHeaderMessage}</Typography>
          </Grid>
          {showPaging && (
            <Grid item xs={12}>
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
        <Grid item xs={1}>
          <FormControl className={classes.formControl}>
            <InputLabel id="rpp" style={{ color: '#fff' }}>
              # per page
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
      {onPrivateChanged && mdmq && (
        <Grid item xs={1}>
          <ToggleButton
            size="small"
            value="private"
            selected={showPrivateOnly}
            style={{ marginTop: '15px' }}
            onChange={() => {
              if (onPrivateChanged) onPrivateChanged(!showPrivateOnly)
              setPrivateOnly(!showPrivateOnly)
            }}
          >
            Private
          </ToggleButton>
        </Grid>
      )}
      <Grid item xs={showPaging ? 4 : 5}>
        {showSearch && mdmq && (
          <TextField
            variant="outlined"
            fullWidth
            className={classes.search}
            id="search-text"
            label="Filter"
            value={inputValue}
            InputLabelProps={{
              style: { color: '#fff' },
            }}
            onKeyPress={(ev) => {
              if (ev.key === 'Enter') {
                if (onSearchInputChange) onSearchInputChange(inputValue)
                ev.preventDefault()
              }
            }}
            onChange={(e) => {
              setInputValue(e.target.value)
            }}
            InputProps={{
              endAdornment: (
                <>
                  <Button
                    size="small"
                    onClick={() => {
                      setInputValue(inputValue)
                      if (onSearchInputChange) onSearchInputChange(inputValue)
                    }}
                  >
                    go
                  </Button>
                  {inputValue && (
                    <Button
                      size="small"
                      onClick={() => {
                        setInputValue('')
                        if (onSearchInputChange) onSearchInputChange('')
                      }}
                    >
                      clear
                    </Button>
                  )}
                </>
              ),
            }}
          />
        )}
      </Grid>
      {showAdd && (
        <Grid item xs={2}>
          <ButtonGroup
            variant="outlined"
            color="secondary"
            ref={anchorRef}
            aria-label="split button"
          >
            <Button onClick={onAdd}>New Slate</Button>
            <Button
              color="secondary"
              aria-controls={open ? 'create-slate-menu' : undefined}
              aria-expanded={open ? 'true' : undefined}
              aria-label="select merge strategy"
              aria-haspopup="menu"
              onClick={handleSlateSubMenuToggle}
            >
              <ArrowDropDownIcon />
            </Button>
          </ButtonGroup>
          <Popper
            style={{ zIndex: 9999 }}
            open={slateSubMenuOpen}
            anchorEl={anchorRef.current}
            role={undefined}
            transition
            disablePortal
          >
            {({ TransitionProps, placement }) => (
              <Grow
                {...TransitionProps}
                style={{
                  transformOrigin:
                    placement === 'bottom' ? 'center top' : 'center bottom',
                }}
              >
                <Paper
                  style={{
                    backgroundColor: '#fff',
                    color: theme.palette.secondary.main,
                  }}
                >
                  <ClickAwayListener onClickAway={handleSlateSubMenuClose}>
                    <MenuList id="create-slate-menu">
                      <MenuItem
                        color="secondary"
                        onClick={() => history.push('/templates')}
                      >
                        Browse Templates
                      </MenuItem>
                    </MenuList>
                  </ClickAwayListener>
                </Paper>
              </Grow>
            )}
          </Popper>
        </Grid>
      )}
    </Grid>
  )
}

Title.propTypes = {
  showAdd: PropTypes.bool.isRequired,
  showPaging: PropTypes.bool.isRequired,
  onChangePage: PropTypes.bool.isRequired,
  onPrivateChanged: PropTypes.bool.isRequired,
  open: PropTypes.bool.isRequired,
  onSearchInputChange: PropTypes.bool.isRequired,
  showSearch: PropTypes.bool.isRequired,
  headerMessage: PropTypes.string.isRequired,
  subHeaderMessage: PropTypes.string.isRequired,
  onAdd: PropTypes.func.isRequired,
  onChangePageSize: PropTypes.func.isRequired,
  pinSlatePerPageCount: PropTypes.number.isRequired,
  slateMinimumPerPage: PropTypes.number.isRequired,
  recordsPerPage: PropTypes.number.isRequired,
  totalPages: PropTypes.number.isRequired,
  page: PropTypes.number.isRequired,
}
