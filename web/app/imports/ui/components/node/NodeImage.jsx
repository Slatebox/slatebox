import React from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useDispatch, useSelector } from 'react-redux'
import { makeStyles } from '@material-ui/core/styles'
import Button from '@material-ui/core/Button'
import Grid from '@material-ui/core/Grid'
import GridList from '@material-ui/core/GridList'
import GridListTile from '@material-ui/core/GridListTile'
import GridListTileBar from '@material-ui/core/GridListTileBar'
import TextField from '@material-ui/core/TextField'
import Typography from '@material-ui/core/Typography'
import SearchIcon from '@material-ui/icons/Search'
import InputAdornment from '@material-ui/core/InputAdornment'
import IconButton from '@material-ui/core/IconButton'
import MenuItem from '@material-ui/core/MenuItem'
import FormControl from '@material-ui/core/FormControl'
import Select from '@material-ui/core/Select'
import InputLabel from '@material-ui/core/InputLabel'
import CircularProgress from '@material-ui/core/CircularProgress'
import Brightness1Icon from '@material-ui/icons/Brightness1'
import InfiniteScroll from 'react-infinite-scroll-component'
import Translation from '../../common/Translation'
import { Organizations } from '../../../api/common/models'

const useStyles = makeStyles((theme) => ({
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
  txtSearch: {
    backgroundColor: '#fff',
    color: '#fff',
  },
  formControl: {
    margin: theme.spacing(0.6),
    minWidth: 180,
    padding: 2,
    '& .MuiSelect-root': {
      minHeight: 30,
    },
  },
  selectEmpty: {
    marginTop: theme.spacing(2),
  },
  imageItemselect: {
    cursor: 'pointer',
    transition: 'transform .2s',
    '&:hover': {
      border: '1px solid blue',
      transform: 'scale(1.1)',
    },
  },
}))

export default function NodeImage({ height, onChange }) {
  const classes = useStyles()
  const dispatch = useDispatch()

  // data.queries.nextimagePage?[0] =

  // count: 10
  // cx: "3ba8a3199f8e2eb8c"
  // inputEncoding: "utf8"
  // outputEncoding: "utf8"
  // safe: "off"
  // searchTerms: "dog"
  // searchType: "image"
  // startIndex: 11
  // title: "Google Custom Search - dog"
  // totalResults: "9190000000"

  // data.url.template
  // https://www.googleapis.com/customsearch/v1?q={searchTerms}&num={count?}&start={startIndex?}&lr={language?}&safe={safe?}&cx={cx?}&sort={sort?}&filter={filter?}&gl={gl?}&cr={cr?}&googlehost={googleHost?}&c2coff={disableCnTwTranslation?}&hq={hq?}&hl={hl?}&siteSearch={siteSearch?}&siteSearchFilter={siteSearchFilter?}&exactTerms={exactTerms?}&excludeTerms={excludeTerms?}&linkSite={linkSite?}&orTerms={orTerms?}&relatedSite={relatedSite?}&dateRestrict={dateRestrict?}&lowRange={lowRange?}&highRange={highRange?}&searchType={searchType}&fileType={fileType?}&rights={rights?}&imgSize={imgSize?}&imgType={imgType?}&imgColorType={imgColorType?}&imgDominantColor={imgDominantColor?}&alt=json

  const imageSearchVal = useSelector((state) => state.imageSearchVal) || ''
  const currentSeachVal = useSelector((state) => state.currentSeachVal)
  const isLoading = useSelector((state) => state.isLoading)
  const hasMoreImages = useSelector((state) => state.hasMoreImages)
  const imageItems = useSelector((state) => state.imageItems) || []
  const limit = useSelector((state) => state.limit) || 10 // max allowed by google
  const imagePage = useSelector((state) => state.imagePage) || -1
  const selectedImage = useSelector((state) => state.selectedImage)

  const imgSize = useSelector((state) => state.imgSize) || 'all'
  const imgDominantColor =
    useSelector((state) => state.imgDominantColor) || 'all'
  const imgColorType = useSelector((state) => state.imgColorType) || 'all'
  const imgType = useSelector((state) => state.imgType) || 'all'

  const handleSearch = (e) => {
    async function search() {
      if (Meteor.user().isAnonymous) {
        dispatch({
          type: 'registration',
          registrationOpen: true,
          registrationMessage: `Want to search images? It just takes a second to register.`,
          paymentWillBeRequested: true,
        })
        return
      }

      let p = imagePage
      let i = imageItems
      if (imageSearchVal !== currentSeachVal) {
        // clear
        dispatch({
          type: 'googleimages',
          imagePage: 0,
          currentSeachVal: imageSearchVal,
          isLoading: true,
          selectedImage: '',
          imageItems: [],
        })
        p = 0
        i = []
        sessionStorage.setItem(`sb_${imageSearchVal}`, '0')
      }
      p += 1

      const filter = []
      if (imgSize && imgSize !== 'all') filter.push(`&imgSize=${imgSize}`)
      if (imgType && imgType !== 'all') filter.push(`&imgType=${imgType}`)
      if (imgDominantColor && imgDominantColor !== 'all')
        filter.push(`&imgDominantColor=${imgDominantColor}`)
      if (imgColorType && imgColorType !== 'all')
        filter.push(`&imgColorType=${imgColorType}`)
      const imgFilter = filter.join('')
      const url = `https://customsearch.googleapis.com/customsearch/v1?cx=${
        Meteor.settings.public.googleImageSearchEngineKey
      }&num=${limit}&safe=ACTIVE&searchType=image&key=${
        Meteor.settings.public.googleImageSearchAPIKey
      }&start=${p * limit}&q=${imageSearchVal}${imgFilter}`

      if (!sessionStorage.getItem(`sb_${imageSearchVal}`)) {
        sessionStorage.setItem(`sb_${imageSearchVal}`, '0')
      }

      if (sessionStorage.getItem(`sb_${url}`)) {
        const d = JSON.parse(sessionStorage.getItem(`sb_${url}`))
        const next =
          parseInt(sessionStorage.getItem(`sb_${imageSearchVal}`), 10) + 1
        sessionStorage.setItem(`sb_${imageSearchVal}`, next.toString())
        dispatch({
          type: 'googleimages',
          imageItems: [...i, ...d.items],
          imagePage: p,
          isLoading: false,
          hasMoreImages:
            d?.queries?.nextPage?.length > 0 &&
            parseInt(sessionStorage.getItem(`sb_${imageSearchVal}`), 10) < 3,
        })
      } else {
        const req = new Request(url, {
          method: 'GET',
          mode: 'cors',
          cache: 'default',
        })
        const response = await fetch(req)
        const d = await response.json()
        if (d.error) {
          console.error('Unable to search for images ', d.error.message)
        } else {
          sessionStorage.setItem(`sb_${url}`, JSON.stringify(d))
          const next =
            parseInt(sessionStorage.getItem(`sb_${imageSearchVal}`), 10) + 1
          sessionStorage.setItem(`sb_${imageSearchVal}`, next.toString())
          dispatch({
            type: 'googleimages',
            imageItems: [...i, ...d.items],
            imagePage: p,
            isLoading: false,
            hasMoreImages: d?.queries?.nextPage?.length > 0 && next <= 3,
          })
        }
      }
    }
    search()
  }

  const updateimageSearchVal = (e) => {
    dispatch({
      type: 'googleimages',
      imageSearchVal: e.target.value,
    })
  }

  const handleClear = () => {
    dispatch({
      type: 'googleimages',
      imagePage: 0,
      currentimageSearchVal: '',
      isLoading: false,
      selectedImage: '',
      imageItems: [],
    })
  }

  const updateOptions = (opts) => {
    dispatch({
      type: 'googleimages',
      selectedImage: opts.selectedImage,
    })

    const pkg = {
      type: 'onNodeImageChanged',
      data: {
        img: opts.image,
        w: opts.width,
        h: opts.height,
      },
    }
    onChange(pkg)
  }

  function updateFilter(prop, e) {
    dispatch({
      type: 'googleimages',
      [prop]: e.target.value,
    })
  }

  const setImgColorType = (e) => {
    updateFilter('imgColorType', e)
  }

  const setImgSize = (e) => {
    updateFilter('imgSize', e)
  }

  const setImgType = (e) => {
    updateFilter('imgType', e)
  }

  const setImgDominantColor = (e) => {
    updateFilter('imgDominantColor', e)
  }

  const dominantColors = [
    'all',
    'black',
    'blue',
    'brown',
    'gray',
    'green',
    'orange',
    'pink',
    'purple',
    'red',
    'teal',
    'white',
    'yellow',
  ]

  const handleImageError = (e) => {
    e.target.src = 'data:image/jpeg;base64,SU1BR0UgTk9UIEZPVU5E'
  }

  NodeImage.propTypes = {
    height: PropTypes.number.isRequired,
    onChange: PropTypes.func.isRequired,
  }

  return (
    <Grid container alignItems="flex-start" justify="space-between" spacing={4}>
      <Grid item xs={2}>
        <FormControl variant="outlined" className={classes.formControl}>
          <InputLabel id="image-color-label">Image Color Type</InputLabel>
          <Select
            labelId="image-color-label"
            id="image-color"
            value={imgColorType}
            onChange={setImgColorType}
            label="Image Color Type"
          >
            <MenuItem value="all">
              <Translation>nodeDrawer.images.imgColorType.all</Translation>
            </MenuItem>
            <MenuItem value="color">
              <Translation>nodeDrawer.images.imgColorType.color</Translation>
            </MenuItem>
            <MenuItem value="gray">
              <Translation>nodeDrawer.images.imgColorType.gray</Translation>
            </MenuItem>
            <MenuItem value="mono">
              <Translation>
                nodeDrawer.images.imgColorType.blackAndWhite
              </Translation>
            </MenuItem>
            <MenuItem value="trans">
              <Translation>
                nodeDrawer.images.imgColorType.transparentBackground
              </Translation>
            </MenuItem>
          </Select>
        </FormControl>

        {['color', 'all'].includes(imgColorType) && (
          <FormControl variant="outlined" className={classes.formControl}>
            <InputLabel id="image-color-label">Image Dominant Color</InputLabel>
            <Select
              labelId="image-color-label"
              id="image-color"
              value={imgDominantColor}
              onChange={setImgDominantColor}
              label="Image Color Type"
            >
              {dominantColors.map((dominantColor) => (
                <MenuItem value={dominantColor} key={dominantColor}>
                  {dominantColor !== 'all' ? (
                    <Grid container>
                      <Grid item xs={1}>
                        <Brightness1Icon style={{ color: dominantColor }} />
                      </Grid>
                      <Grid item xs={11}>
                        <Typography style={{ marginLeft: '15px' }}>
                          <Translation>{`nodeDrawer.images.imgDominantColor.${dominantColor}`}</Translation>
                        </Typography>
                      </Grid>
                    </Grid>
                  ) : (
                    <Grid container>
                      <Grid item xs={1}>
                        <Typography>
                          <Translation>{`nodeDrawer.images.imgDominantColor.${dominantColor}`}</Translation>
                        </Typography>
                      </Grid>
                      <Grid item xs={11}>
                        <Typography style={{ marginLeft: '15px' }}>
                          <Brightness1Icon style={{ color: 'transparent' }} />
                        </Typography>
                      </Grid>
                    </Grid>
                  )}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
      </Grid>

      <Grid item xs={2}>
        <FormControl variant="outlined" className={classes.formControl}>
          <InputLabel id="image-size-label">Image Size</InputLabel>
          <Select
            labelId="image-size-label"
            id="image-size"
            value={imgSize}
            onChange={setImgSize}
            label="Image Size"
          >
            <MenuItem value="all">
              <Translation>nodeDrawer.images.imgSize.all</Translation>
            </MenuItem>
            <MenuItem value="icon">
              <Translation>nodeDrawer.images.imgSize.icon</Translation>
            </MenuItem>
            <MenuItem value="small">
              <Translation>nodeDrawer.images.imgSize.small</Translation>
            </MenuItem>
            <MenuItem value="medium">
              <Translation>nodeDrawer.images.imgSize.medium</Translation>
            </MenuItem>
            <MenuItem value="large">
              <Translation>nodeDrawer.images.imgSize.large</Translation>
            </MenuItem>
            <MenuItem value="xlarge">
              <Translation>nodeDrawer.images.imgSize.xlarge</Translation>
            </MenuItem>
            <MenuItem value="xxlarge">
              <Translation>nodeDrawer.images.imgSize.xxlarge</Translation>
            </MenuItem>
            <MenuItem value="huge">
              <Translation>nodeDrawer.images.imgSize.huge</Translation>
            </MenuItem>
          </Select>
        </FormControl>

        <FormControl variant="outlined" className={classes.formControl}>
          <InputLabel id="image-type-label">Image Type</InputLabel>
          <Select
            labelId="image-type-label"
            id="image-type"
            value={imgType}
            onChange={setImgType}
            label="Image Type"
          >
            <MenuItem value="all">
              <Translation>nodeDrawer.images.imgType.all</Translation>
            </MenuItem>
            <MenuItem value="clipart">
              <Translation>nodeDrawer.images.imgType.clipart</Translation>
            </MenuItem>
            <MenuItem value="face">
              <Translation>nodeDrawer.images.imgType.face</Translation>
            </MenuItem>
            <MenuItem value="lineart">
              <Translation>nodeDrawer.images.imgType.lineart</Translation>
            </MenuItem>
            <MenuItem value="stock">
              <Translation>nodeDrawer.images.imgType.stock</Translation>
            </MenuItem>
            <MenuItem value="photo">
              <Translation>nodeDrawer.images.imgType.photo</Translation>
            </MenuItem>
            <MenuItem value="animated">
              <Translation>nodeDrawer.images.imgType.animated</Translation>
            </MenuItem>
          </Select>
        </FormControl>
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
                nodeDrawer.images.searchInputPlaceholder
              </Translation>
            }
            value={imageSearchVal}
            variant="outlined"
            onChange={updateimageSearchVal}
            onKeyPress={(ev) => {
              if (ev.key === 'Enter') {
                handleSearch()
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
                      onClick={handleSearch}
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
          dataLength={imageItems?.length || 0} // This is important field to render the next data
          next={handleSearch}
          hasMore={hasMoreImages}
          loader={
            !isLoading && (
              <CircularProgress style={{ marginTop: '15px', color: '#fff' }} />
            )
          }
          height={`${height - 45}px`}
          endMessage={
            imageSearchVal !== '' && imagePage > 0 ? (
              <Grid container spacing={1}>
                <Grid item xs={6} style={{ marginTop: '10px' }}>
                  <Typography variant="body2" style={{ color: '#fff' }}>
                    <Translation>nodeDrawer.images.searchFinished</Translation>
                  </Typography>
                </Grid>
                <Grid item xs={6} style={{ marginTop: '10px' }}>
                  <Button
                    color="secondary"
                    variant="outlined"
                    onClick={handleClear}
                  >
                    <Translation>nodeDrawer.images.clearSearch</Translation>
                  </Button>
                </Grid>
              </Grid>
            ) : (
              <Grid
                container
                alignItems="center"
                justify="flex-start"
                style={{ height: '140px' }}
              >
                <Typography variant="body2" style={{ color: '#fff' }}>
                  &larr; <Translation>nodeDrawer.images.searchInfo</Translation>
                </Typography>
              </Grid>
            )
          }
        >
          <GridList cols={3}>
            {imageItems.map((image) => (
              <GridListTile
                className={classes.imageItemselect}
                key={image.link}
                cols={1}
                aria-label={image.title}
                onClick={() =>
                  updateOptions({
                    image: image.link,
                    width: image.image.width,
                    height: image.image.height,
                    selectedImage: image.image.thumnailLink,
                  })
                }
              >
                <img
                  style={
                    image?.image?.thumbnailLink === selectedImage
                      ? { border: '1px solid black' }
                      : {}
                  }
                  src={
                    ['huge', 'xxlarge', 'xlarge', 'large'].includes(imgSize)
                      ? image?.image?.thumbnailLink
                      : image.link
                  }
                  alt={image.image.title}
                  onError={handleImageError}
                />
                <GridListTileBar title={image.title} />
              </GridListTile>
            ))}
          </GridList>
        </InfiniteScroll>
      </Grid>
    </Grid>
  )
}
