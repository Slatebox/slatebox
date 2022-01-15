import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux'
import { makeStyles, withStyles } from '@material-ui/core/styles';
import { QueryClient, QueryClientProvider, useQuery } from 'react-query'
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

const queryClient = new QueryClient()

export const NodeImage = (props) => {
  
  const classes = useStyles();
  const dispatch = useDispatch();
  let limit = 10;

  //data.queries.nextPage?[0] = 

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

  //data.url.template
  //https://www.googleapis.com/customsearch/v1?q={searchTerms}&num={count?}&start={startIndex?}&lr={language?}&safe={safe?}&cx={cx?}&sort={sort?}&filter={filter?}&gl={gl?}&cr={cr?}&googlehost={googleHost?}&c2coff={disableCnTwTranslation?}&hq={hq?}&hl={hl?}&siteSearch={siteSearch?}&siteSearchFilter={siteSearchFilter?}&exactTerms={exactTerms?}&excludeTerms={excludeTerms?}&linkSite={linkSite?}&orTerms={orTerms?}&relatedSite={relatedSite?}&dateRestrict={dateRestrict?}&lowRange={lowRange?}&highRange={highRange?}&searchType={searchType}&fileType={fileType?}&rights={rights?}&imgSize={imgSize?}&imgType={imgType?}&imgColorType={imgColorType?}&imgDominantColor={imgDominantColor?}&alt=json
  let searchVal = useSelector(state => state.searchVal) || '';
  let interimSearchVal = useSelector(state => state.interimSearchVal) || '';
  let page = useSelector(state => state.page) || 0;
  let selectedImage = useSelector(state => state.selectedImage);

  const searchGoogleImages = async (p, v) => {
    console.log("paging is ", p, v);
    if (p != null && v) {
      let url = `https://customsearch.googleapis.com/customsearch/v1?cx=${Meteor.settings.public.googleImageSearchEngineKey}&num=${limit}&safe=active&searchType=image&key=${Meteor.settings.public.googleImageSearchAPIKey}&start=${p * limit}&q=${v}`;
      console.log('url is ', url);
      let response = await fetch(url); //.then(res => { let d = res.json(); console.log("got json back ", d); return d })
      let d = await response.json();
      console.log("data now is ", d);
      return d;
    } else {
      return {};
    }
  }
  
  const {
    isLoading,
    error,
    data
  } = useQuery(['images', page, searchVal], () => searchGoogleImages(page, searchVal), { keepPreviousData: true })

  console.log("raw data is ", data, page, searchVal);

  const handleSearch = (e) => {
    page++;
    dispatch({
      type: "googleimages"
      , searchVal: interimSearchVal
      , page: page
    });
  }

  const updateSearchVal = (e) => {
    dispatch({
      type: "googleimages"
      , interimSearchVal: e.target.value
    });
  }

  const handleClear = (e) => {
    dispatch({
      type: "googleimages"
      , page: 0
      , searchVal: ''
      , interimSearchVal: ''
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
            value={interimSearchVal}
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
            InputLabelProps={{
              style: { color: '#fff' },
            }}
          />
        </Grid>
      </Grid>
      <Grid item xs={7}>
        <Typography variant="h6" style={{ color: "#fff" }}>
          {(page > 0 || data?.queries?.nextPage?.length > 0) ? <Translation>nodeDrawer.images.searchResultText</Translation> : <span>&nbsp;</span>}
        </Typography>
        <InfiniteScroll
          dataLength={data?.queries?.nextPage?.length || 0} //This is important field to render the next data
          next={handleSearch}
          hasMore={data?.queries?.nextPage?.length > 0}
          loader={<CircularProgress style={{ marginTop: '15px', color: "#fff" }} />}
          height={250}
          endMessage={
            (searchVal !== '' && (page > 0 || data?.items?.length > 0)) ?
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
          <QueryClientProvider client={queryClient}>
            <GridList cellHeight={160} className={classes.gridList} cols={3}>
              {data?.items?.map((image, i) => (
                <GridListTile key={i} cols={1} aria-label={image.title} onClick={() => updateOptions({ image: image.link, selectedImage: image.image.thumnailLink })}>
                  <img style={ (image.image.thumbnailLink === selectedImage) ? { border: "1px solid black" } : {} } src={image.image.thumbnailLink} alt={image.image.title} />
                </GridListTile>
              ))}
            </GridList>
          </QueryClientProvider>
        </InfiniteScroll>
      </Grid>
    </Grid>

    // <div style={{backgroundColor: "#fff" }}>
    //   {isLoading ? (
    //     <div>Loading...</div>
    //   ) : isError ? (
    //     <div>Error: {error.message}</div>
    //   ) : (
    //     <div>
    //       {data?.items.map((image, i) => (
    //         <div key={i}>
    //           <img src={image.image.thumbnailLink} width={image.image.thumbnailWidth} height={image.image.thumbnailHeight}/>
    //           <p>{image.title}</p>
    //         </div>
    //       ))}
    //     </div>
    //   )}
    //   <span>Current Page: {page + 1}</span>
    //   <button
    //     onClick={() =>
    //       dispatch({
    //         type: "googleimages"
    //        , page: Math.max(old - 1, 0)
    //       })
    //     }
    //     disabled={page === 0}
    //   >
    //     Previous Page
    //   </button>{' '}
    //   <button
    //     onClick={() => {
    //       if (!isPreviousData && data?.queries?.nextPage) {
    //        dispatch({
    //          type: "googleimages"
    //         , page: old + 1
    //        });
    //       }
    //     }}
    //     // Disable the Next Page button until we know a next page is available
    //     disabled={ isPreviousData || data?.queries?.nextPage }
    //   >
    //     Next Page
    //   </button>
    //   {isFetching ? <span> Loading...</span> : null}{' '}
    // </div>
  )
}