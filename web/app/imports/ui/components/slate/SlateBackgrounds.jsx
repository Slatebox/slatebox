import React, { useEffect, useState } from 'react';
import { Meteor } from 'meteor/meteor';
import { makeStyles, useTheme } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import Grid from '@material-ui/core/Grid';
import ToggleButtonGroup from '@material-ui/lab/ToggleButtonGroup';
import GridList from '@material-ui/core/GridList';
import GridListTile from '@material-ui/core/GridListTile';
import TextField from '@material-ui/core/TextField';
import GridListTileBar from '@material-ui/core/GridListTileBar';
import ToggleButton from '@material-ui/lab/ToggleButton';
import { useSelector } from 'react-redux';
import cloneDeep from 'lodash.clonedeep';
import Button from '@material-ui/core/Button';
import { promisify } from '../../../api/client/promisify';
import { CONSTANTS } from '../../../api/common/constants';
import Typography from '@material-ui/core/Typography';

const useStyles = makeStyles((theme) => ({
  bgImage: {
    width: "inherit", 
    height: "inherit", 
    padding: "0 important",
    transition: "all 500ms",
    cursor: "pointer",
    "&:hover": {
      transform: "scale(1.2)"
    }
  }
}));

export const SlateBackgrounds = (props) => {

  const theme = useTheme();
  const classes = useStyles();
  const matches = useMediaQuery(theme.breakpoints.up('md'));
  const slate = useSelector(state => state.slate);

  let bUrl = slate?.options?.containerStyle?.backgroundImage;
  let bSize = slate?.options?.containerStyle?.backgroundSize;
  let bAttribution = slate?.options?.containerStyle?.backgroundAttribution || {};
  const [filter, setFilter] = React.useState("");
  const [searchAttempted, setSearchAttempted] = React.useState(false);
  const [selectedBackground, updateBackground] = React.useState({
    url: bUrl,
    size: bSize,
    attribution: bAttribution
  });

  const [currentSearchResults, setSearchResults] = React.useState([])

  const setBackground = async (index) => {
    //event.target.value
    console.log("selected", currentSearchResults[index]);
    updateBackground(currentSearchResults[index]);
    let cacheUrl = await promisify(Meteor.call, CONSTANTS.methods.slates.cacheImage, { ...currentSearchResults[index], provider: `pixabay` });
    let bg = currentSearchResults[index];
    console.log("got cacheUrl", cacheUrl);
    props.onChange({ type: "onSlateBackgroundImageChanged", data: { 
        bg: { 
          size: "cover", 
          url: cacheUrl, 
          attribution: bg.attribution
        } 
      } 
    });
  }

  const setBackgroundSize = (event, newSize) => {
    if (newSize != null) {
      let copy = cloneDeep(selectedBackground);
      copy.size = newSize;
      updateBackground(copy);
      props.onChange({ type: "onSlateBackgroundImageChanged", data: { bg: copy } });
    }
  }

  const searchBackgroundImages = async (val) => {
    let results = await promisify(Meteor.call, CONSTANTS.methods.slates.searchBackgroundImages, { filter: val, provider: "pixabay" });
    setSearchAttempted(true);
    setSearchResults(results);
  }

  const setBackgroundFilter = (term, explicitClear) => {
    setFilter(term);
    if (explicitClear) {
      setSearchAttempted(false);
      setSearchResults([]);
    }
  }

  return (
    <Grid container alignItems="center" justify="space-between" spacing={2}>
      <Grid item>
        <a href="https://pixabay.com/" target="_tab" style={{ margin: "2px", fontSize: "12px", color: "#fff", display: "block", float: "left", padding: "9px 12px 6px", border: "1px solid #ccc"}}>
          <i style={{ display: "block", width: "68px", height: "18px", overflow: "hidden" }}>
            <img src="/images/pixabay_logo.svg" style={{ width: "inherit" }} alt="Free Images on Pixabay"/>
          </i> 
          Free Images
        </a>
      </Grid>
      <Grid item>
        <ToggleButtonGroup
          value={bSize}
          exclusive
          onChange={setBackgroundSize}
          style={{flexWrap: "wrap"}}
          aria-label="slate background"
        >
          {[{ name: "Repeat", val: "" }, { name: "Stretch", val: "cover" }].map(v => (
            <ToggleButton size="small" key={v.name} value={v.val} aria-label={v.name}>
              {v.name}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Grid>
      <Grid item xs={12}>
        <TextField
          variant="outlined"
          fullWidth
          id="search-backgrounds"
          label="Search..."
          value={filter}
          InputLabelProps={{
            style: { color: '#fff' },
          }}
          onKeyPress={(ev) => {
            if (ev.key === "Enter") {
              searchBackgroundImages(filter);
              ev.preventDefault();
            }
          }}
          onChange={(e) => {
            setBackgroundFilter(e.target.value);
          }}
          InputProps={{ endAdornment: 
            <>
              <Button size="small" onClick={(e) => {
                searchBackgroundImages(filter);
              }}>
                go
              </Button>
              {filter && 
                <Button size="small" onClick={(e) => {
                  setBackgroundFilter("", true);
                }}>
                  clear
                </Button>
              }
            </>
          }}
        />
      </Grid>
      <Grid item xs={12}>
        <GridList spacing={1} cols={1} cellHeight={180}>
          {currentSearchResults.length === 0 && filter !== "" && searchAttempted ?
            <Typography variant="body2">No Results Found</Typography> :
            currentSearchResults.map((s, index) => (
              <GridListTile key={index} cols={1} onClick={(e) => { setBackground(index) }} className={classes.bgImage}>
                <img src={s.previewUrl} alt={s.attribution.title} />
                <GridListTileBar title={s.attribution.title} subtitle={s.attribution.author}/>
              </GridListTile>
            ))
          }
        </GridList>
      </Grid>
    </Grid>
  );
}