import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux'
import { makeStyles, withStyles } from '@material-ui/core/styles';
import Button from '@material-ui/core/Button';
import Grid from '@material-ui/core/Grid';
import GridList from '@material-ui/core/GridList';
import GridListTile from '@material-ui/core/GridListTile';
import TextField from '@material-ui/core/TextField';
import Typography from '@material-ui/core/Typography';
import SearchIcon from '@material-ui/icons/Search';
import InputAdornment from '@material-ui/core/InputAdornment';
import IconButton from '@material-ui/core/IconButton';
import Link from '@material-ui/core/Link';
import CircularProgress from '@material-ui/core/CircularProgress';
import InfiniteScroll from 'react-infinite-scroll-component';

import { Translation } from "../../common/Translation.jsx";

const useStyles = makeStyles((theme) => ({
  inputRoot: {
    "& .MuiFormLabel-root": {
      color: "#fff"
    },
    "& fieldset": {
      border: "1px solid #fff"
    },
    "& .MuiOutlinedInput-notchedOutline-focused": {
      borderColor: "#fff"
    },
    "& input": {
      color: "#fff"
    }
  },
  txtSearch: {
    backgroundColor: "#fff"
    , color: "#fff"
  }
}));

export const NodeImage = (props) => {
  
  const classes = useStyles();
  const dispatch = useDispatch();

  // {
  //   "_type": "images"
  //   "totalCount": 783
  //   "value": [{
  //     "url":"https://sunbeamwsvn.files.wordpress.com/2016/09/160923-deepwater-horizon.jpg?quality=60&#038;strip=color&#038;w=634"
  //     "height":346
  //     "width":634
  //     "thumbnail":"https://rapidapi.usearch.com/api/thumbnail/get?value=7185814763471316115"
  //     "thumbnailHeight":259
  //     "thumbnailWidth":474
  //     "base64Encoding":NULL
  //     "name":""
  //     "title":"Deepwater Horizon WSVN 7News | Miami News, Weather, Sports | Fort Lauderdale"
  //     "provider":{
  //       "name":"wordpress"
  //       "favIcon":""
  //       "favIconBase64Encoding":""
  //     }
  //     "imageWebSearchUrl":"https://usearch.com/search/deepwater%20horizon/images"
  //     "webpageUrl":"https://wsvn.com/entertainment/deepwater-horizon/"
  //   }]
  // }

  const searchVal = useSelector(state => state.searchVal) || '';
  const currentSeachVal = useSelector(state => state.currentSeachVal);
  const isLoading = useSelector(state => state.isLoading);
  const totalCount = useSelector(state => state.totalCount) || -1;
  const items = useSelector(state => state.items) || [];
  const limit = useSelector(state => state.limit) || 5;
  const page = useSelector(state => state.page) || 0;
  const selectedImage = useSelector(state => state.selectedImage);

  const handleSearch = (e) => {

    async function search() {
      let p  = page;
      let i = items;
      if (searchVal !== currentSeachVal) {
        //clear
        console.log("clearing search", searchVal, currentSeachVal);
        dispatch({
          type: "googleimages"
          , page: 0
          , currentSeachVal: searchVal
          , isLoading: true
          , selectedImage: ''
          , items: []
        });
        p = 0;
        i = [];
      }
      p = p + 1;
      console.log("page changed ", p);

      let url = `https://contextualwebsearch-websearch-v1.p.rapidapi.com/api/Search/ImageSearchAPI?q=${searchVal}}&pageNumber=${p}&pageSize=${limit}&autoCorrect=true&safeSearch=true`
      console.log('url is ', url);
      const req = new Request(url, {
        method: 'GET',
        headers: new Headers({
          "x-rapidapi-key": Meteor.settings.public.rapidAPIKey,
          "x-rapidapi-host": "contextualwebsearch-websearch-v1.p.rapidapi.com",
          "useQueryString": true
        }),
        mode: 'cors',
        cache: 'default',
      });
      let response = await fetch(req); //.then(res => { let d = res.json(); console.log("got json back ", d); return d })
      let d = await response.json();
      dispatch({
        type: "googleimages"
        , items: [...i, ...d.value]
        , page: p
        , isLoading: false
        , totalCount: d.totalCount
      });
    }
    search();
  }

  const updateSearchVal = (e) => {
    dispatch({
      type: "googleimages"
      , searchVal: e.target.value
    });
  }

  const handleClear = (e) => {
    dispatch({
      type: "googleimages"
      , page: 0
      , currentSearchVal: ''
      , isLoading: false
      , selectedImage: ''
      , items: []
    })
  }

  const updateOptions = (opts) => {
    dispatch({
      type: "googleimages"
      , selectedImage: opts.selectedImage
    });
    
    var pkg = {
      type: 'onNodeImageChanged'
      , data: {
        image: opts.image
      }
    };
    props.onChange(pkg);
  }

  console.log("has more ", page, limit, totalCount, page * limit < totalCount);

  return (
    <Grid container alignItems="flex-start" justify="center" spacing={2}>
      <Grid item xs={2}>
        <Typography variant="h6" style={{ color: "#fff" }}><Translation>nodeDrawer.images.filterText</Translation></Typography>
        <Grid container alignItems="flex-start" justify="flex-start" spacing={1}>
          FILTER
        </Grid>
      </Grid>
      <Grid item xs={3}>
        <Grid container alignItems="center" justify="flex-end" style={{ height: "250px" }}>
          <TextField
            label={<Translation>nodeDrawer.images.searchInputPlaceholder</Translation>}
            value={searchVal}
            variant='outlined'
            onChange={updateSearchVal}
            onKeyPress={(ev) => {
              if (ev.key === 'Enter') {
                handleSearch();
                ev.preventDefault();
              }
            }}
            className={classes.inputRoot}
            InputProps={{
              endAdornment: (
                <InputAdornment>
                  <IconButton>
                    <SearchIcon style={{ color: "#fff" }} onClick={handleSearch} />
                  </IconButton>
                </InputAdornment>
              )
            }}
          />
        </Grid>
      </Grid>
      <Grid item xs={7}>
        <Typography variant="h6" style={{ color: "#fff" }}>
          {(page > 0 || totalCount > 0) ? <Translation>nodeDrawer.images.searchResultText</Translation> : <span>&nbsp;</span>}
        </Typography>
        <InfiniteScroll
          dataLength={items?.length || 0} //This is important field to render the next data
          next={handleSearch}
          hasMore={page * limit < totalCount}
          loader={!isLoading && <CircularProgress style={{ marginTop: '15px', color: "#fff" }} />}
          height={250}
          endMessage={
            (searchVal !== '' && (page > 0 || totalCount > 0)) ?
              <Grid container spacing={3}>
                <Grid item xs={6}>
                  <Typography variant="body2" style={{ marginTop: '15px', color: "#fff" }}>
                    <Translation>nodeDrawer.images.searchFinished</Translation>
                  </Typography>
                </Grid>
                <Grid item xs={6}>
                  <Link style={{ color: "#fff", border: '1px solid #fff', padding: '5px' }} href="#" onClick={handleClear}><Translation>nodeDrawer.images.clearSearch</Translation></Link>
                </Grid>
              </Grid>
              :
              <Grid container alignItems="center" justify="flex-start" style={{ height: "250px" }}>
                <Typography variant="body2" style={{ color: "#fff" }}>
                  &larr; <Translation>nodeDrawer.images.searchInfo</Translation>
                </Typography>
              </Grid>
          }
        >
          {isLoading && <CircularProgress style={{ marginTop: '15px', color: "#fff" }} />}
          <GridList cellHeight={160} className={classes.gridList} cols={3}>
            {items.map((image, i) => (
              <GridListTile key={i} cols={1} aria-label={image.title} onClick={() => updateOptions({ image: image.url, width: image.width, height: image.height, selectedImage: image.thumbnail })}>
                <img style={ (image.thumbnail === selectedImage) ? { border: "1px solid black" } : {} } src={image.thumbnail} alt={image.title} />
              </GridListTile>
            ))}
          </GridList>
        </InfiniteScroll>
      </Grid>
    </Grid>
  )
}