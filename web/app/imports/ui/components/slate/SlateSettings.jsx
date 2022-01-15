import React, { useEffect, useState } from 'react';
import { Meteor } from "meteor/meteor";
import { useDispatch, useSelector } from 'react-redux'
import { useTracker } from 'meteor/react-meteor-data';
import { useTheme } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import Grid from '@material-ui/core/Grid';
import TextField from '@material-ui/core/TextField';
import Tooltip from '@material-ui/core/Tooltip/Tooltip';
import Switch from '@material-ui/core/Switch/Switch';
import Typography from '@material-ui/core/Typography';
import Button from '@material-ui/core/Button';
import { CONSTANTS } from '../../../api/common/constants';

import { ApprovalRequests } from '../../../api/common/models.js'
import { promisify } from '../../../api/client/promisify';

export const SlateSettings = (props) => {

  const dispatch = useDispatch();
  const theme = useTheme();
  const matches = useMediaQuery(theme.breakpoints.up('md'));
  const slate = useSelector(state => state.slate);

  const [slateName, setSlateName] = React.useState(slate?.options?.name);
  const [slateDescription, setSlateDescription] = React.useState(slate?.options?.description);

  const [showGrid, setSlateShowGrid] = React.useState(slate?.options?.viewPort?.showGrid);
  const [snapToObjects, setSlatesnapToObjects] = React.useState(slate?.options?.viewPort?.snapToObjects);
  const [mindMapMode, setSlatemindMapMode] = React.useState(slate?.options?.mindMapMode);
  const [isTemplate, setSlateTemplate] = React.useState(slate?.options?.isTemplate);

  const isTheme = slate?.options?.eligibleForThemeCompilation;

  useEffect(() => {
    if (isTheme) {
      // when creating a theme, just display temporarily so the user understands
      if (mindMapMode) {
        for (let el of document.querySelectorAll('.association')) { el.style.display = 'block'; }
      } else {
        for (let el of document.querySelectorAll('.association')) { el.style.display = 'none'; }
      }
    }
  }, [mindMapMode, isTheme]);

  function setShowGrid(e) {
    setSlateShowGrid(e.target.checked);
    props.onChange({ type: "onSlateShowGridChanged", data: { showGrid: e.target.checked } });
  }

  function setSnapToObjects(e) {
    setSlatesnapToObjects(e.target.checked);
    props.onChange({ type: "onSlateSnapToObjectsChanged", data: { snapToObjects: e.target.checked } });
  }

  function setMindMap(e) {
    setSlatemindMapMode(e.target.checked);
    props.onChange({ type: "onSlateMindMapModeChanged", data: { mindMapMode: e.target.checked } });
  }

  function setTemplate(e) {
    setSlateTemplate(e.target.checked);
    props.onChange({ type: "onSlateTemplateChanged", data: { isTemplate: e.target.checked } });
  }

  const setName = (e) => {
    setSlateName(e.target.value);
    dispatch({ type: "canvas", slateName: e.target.value });
    props.onChange({ type: "onSlateNameChanged", data: { name: e.target.value } });
  }

  const setDescription = (e) => {
    setSlateDescription(e.target.value);
    props.onChange({ type: "onSlateDescriptionChanged", data: { description: e.target.value } });
  }

  const handleTemplateRequest = function (e) {
    ApprovalRequests.insert({ slateId: slate.options.id, type: "template", userId: Meteor.userId(), approved: false, message: "Your approval status is pending..." })
  }

  const handleThemeRequest = function (e) {
    ApprovalRequests.insert({ slateId: slate.options.id, type: "theme", userId: Meteor.userId(), approved: false, message: "Your approval status is pending..." })
  }

  const saveSlateAsTheme = async function() {
    if (slateName === "") {
      dispatch({ type: "canvas", globalMessage: { visible: true, text: `You need to provide a name for your theme.`, severity: "error", autoHide: 60000 } });
    } else if (slateName.toLowerCase().indexOf("default") > -1) {
      dispatch({ type: "canvas", globalMessage: { visible: true, text: `Your theme name cannot include the word 'default'`, severity: "error", autoHide: 60000 } });
    } else {
      const saved = await promisify(Meteor.call, CONSTANTS.methods.themes.parseSlateIntoTheme, { slateId: slate.options.id });
      if (saved) {
        dispatch({ type: "canvas", globalMessage: { visible: true, text: `Successfully updated theme`, severity: "info", autoHide: 60000 } });
      } else {
        dispatch({ type: "canvas", globalMessage: { visible: true, text: `There was an error saving your theme, please contact support`, severity: "error", autoHide: 60000 } });
      }
    }
  }

  const cancelTemplateRequest = function (e) {
    ApprovalRequests.remove({ _id: templateApproval?._id })
  }

  let templateApproval = useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.approvalRequests, "template", slate.options.id);
    return ApprovalRequests.findOne();
  });

  let themeApproval = useTracker(() => {
    Meteor.subscribe(CONSTANTS.publications.approvalRequests, "theme", slate.options.id);
    return ApprovalRequests.findOne();
  });

  const cancelThemeRequest = function (e) {
    ApprovalRequests.remove({ _id: themeApproval?._id })
  }

  return (
    <Grid container alignItems="center" justify="flex-start" spacing={2}>
      <Grid item xs={12}>
        <TextField label="Name" variant="outlined" onChange={setName} value={slateName} fullWidth />
      </Grid>
      <Grid item xs={12}>
        <TextField
          label="Description"
          multiline
          rows={4}
          value={slateDescription}
          onChange={setDescription}
          variant="outlined"
          fullWidth
          InputLabelProps={{
            style: { color: '#fff' },
          }}
        />
      </Grid>
      <Grid item xs={6}>
        Mind Map Mode
      </Grid>
      <Grid item xs={6}>
        <Tooltip title="Mind Map Mode - join added nodes by connecting lines" placement="top" aria-label="mindMapMode">
          <Switch onChange={setMindMap} checked={mindMapMode} />
        </Tooltip>
      </Grid>
      {!isTheme ?
        <>
          <Grid item xs={6}>
            Show grid
          </Grid>
          <Grid item xs={6}>
            <Tooltip title="Show underlying grid" placement="top" aria-label="setShowGrid">
              <Switch onChange={setShowGrid} checked={showGrid} />
            </Tooltip>
          </Grid>
          <Grid item xs={6}>
            Snap to neighbors
          </Grid>
          <Grid item xs={6}>
            <Tooltip title="Automatically align objects to their neighbors" placement="top" aria-label="setSnapToObjects">
              <Switch onChange={setSnapToObjects} checked={snapToObjects} />
            </Tooltip>
          </Grid>
          <Grid item xs={6}>
            Is Template
          </Grid>
          <Grid item xs={6}>
            <Tooltip title="Mark slate as a template " placement="top" aria-label="markSlateAsTemplate">
              <Switch onChange={setTemplate} checked={isTemplate} />
            </Tooltip>
          </Grid>
          {isTemplate &&
            <Grid item xs={12}>
              <Typography variant="body2">
                <p>Templates provide re-usable slates that center around a theme (e.g., product roadmap, user stories, swot analysis, etc).</p>
                {!templateApproval &&
                  <p>Click the below button to request approval for this template. When approved, it will be available for others to use.</p>
                }
              </Typography>
            </Grid>
          }
          {isTemplate &&
            <Grid item xs={12}>
              {!templateApproval &&
                <Button variant="outlined" color="secondary" onClick={handleTemplateRequest}>Request Template Approval</Button>
              }
              {templateApproval?.approved &&
                <p>Hooray! Your template is <a href='/templates' style={{color:"#fff"}}>approved and available</a>.</p>
              }
              {templateApproval && !templateApproval?.approved &&
                <>
                  <p>{templateApproval?.message}</p>
                  <Button variant="outlined" color="secondary" onClick={cancelTemplateRequest}>Cancel Request</Button>
                </>
              }
            </Grid>
          }
        </>
        :
        <>
          <Grid item xs={12}>
            <Typography variant="body2">
              <p>Themes provide opinionated styles to existing slates.</p>
              {!themeApproval &&
                <p>Click the below button to request approval for this theme. When approved, it will be available for others to use.</p>
              }
            </Typography>
          </Grid>
          <Grid item xs={12}>
            {!themeApproval &&
              <Button variant="outlined" color="secondary" onClick={handleThemeRequest}>Request Theme Approval</Button>
            }
            {themeApproval?.approved &&
              <p>Hooray! Your theme is <a href='/themes' style={{color:"#fff"}}>approved and available</a>.</p>
            }
            {themeApproval && !themeApproval?.approved &&
              <>
                <p>{themeApproval?.message}</p>
                <Button variant="outlined" color="secondary" onClick={cancelThemeRequest}>Cancel Request</Button>
              </>
            }
          </Grid>
          {/* <Grid item xs={12}>
            <Typography variant="body2">
              Use this slate to define a new theme. Provide a name and description above, define the colors and styles, then click the save button below to update your theme and make it available for other users.
            </Typography>
          </Grid>
          <Grid item xs={12}>
            <Button variant="outlined" fullWidth color="secondary" onClick={saveSlateAsTheme}>Save Theme</Button>
          </Grid> */}
        </>
      }
    </Grid>
  );
}