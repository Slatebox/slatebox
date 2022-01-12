import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux'
import { useTheme } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import Grid from '@material-ui/core/Grid';
import TextField from '@material-ui/core/TextField';
import Switch from '@material-ui/core/Switch';
import Typography from '@material-ui/core/Typography/Typography';
import { CONSTANTS } from '../../../api/common/constants';
import { promisify } from '../../../api/client/promisify';
import { Tooltip } from '@material-ui/core';
import IconButton from '@material-ui/core/IconButton';
import FileCopyIcon from '@material-ui/icons/FileCopy';

export const SlateEmbed = (props) => {

  const slate = props.slate; // useSelector(state => state.slate);

  //   const _orient = Meteor.currentSlate.getOrientation();
  //   if (_init) {
  //     let _es = parseInt(Math.max(_orient.width, _orient.height), 10);
  //     $("#txtEmbedSize").val(_es);
  //     _init = false;
  //   }
  //   const _size = $("#txtEmbedSize").val();

  //   if (Meteor.isNumber(_size)) {

  //     Meteor.call("getEmbedCode", { slateId: Session.get("currentSlateId"), size: _size, orient: _orient }, function(err, result) {
  //       if (err) {
  //         bootbox.alert("Sorry, there was a problem grabbing the embed code..." + err.reason);
  //       } else {
  //         let _embed = "";
  //         if (_isIframe && !_isShareable) {
  //           _embed = result.iframe_noshare;
  //         } else if (_isIframe && _isShareable) {
  //           _embed = result.iframe_share;
  //         } else if (!_isIframe && !_isShareable) {
  //           _embed = result.non_noshare;
  //         } else if (!_isIframe && _isShareable) {
  //           _embed = result.non_share;
  //         }
  //         //const _embed = _isIframe ? result.iframe : result.non;
  //         $(".embedCode").val(_embed);
  //       }
  //     });
  //   } else if (_size !== "" && $(".bootbox-alert").length === 0) {
  //     bootbox.alert("That's not a number!", function() {
  //       $("#txtEmbedSize").focus();
  //     });
  //   }
  // }

  const dispatch = useDispatch();
  const theme = useTheme();
  const lastEmbedSize = useSelector(state => state.lastEmbedSize) || 600;
  //const [localEmbedSize, setLocalSize] = React.useState(lastEmbedSize);
  const lastEmbedTemplate = useSelector(state => state.lastEmbedTemplate);
  const isIFrame = useSelector(state => state.isIFrame) || false;

  function handleSize(e) {
    //setLocalSize(e.target.value);
    dispatch({ type: "embed", lastEmbedSize: e.target.value });
    console.log("embeds", lastEmbedSize);
    //load();
  }

  function setIFrame(e) {
    dispatch({ type: "embed", isIFrame: e.target.checked });
  }

  async function load() {
    const embedOpts = {
      slateId: slate?.options.id
      , orient: props.getOrientation()
      , size: lastEmbedSize
    };
    let template = await promisify(Meteor.call, CONSTANTS.methods.slates.getEmbedCode, embedOpts);
    dispatch({ type: "embed", lastEmbedTemplate: template });
  }

  useEffect(() => {
    load();
  }, [lastEmbedSize, slate?.slateId]);

  function copyEmbeddableCode() {
    navigator.clipboard.writeText(isIFrame ? lastEmbedTemplate?.iframe_share : lastEmbedTemplate?.non_share);
    dispatch({ type: "canvas", globalMessage: { visible: true, isSnackBar: true, text: `Embeddable code copied to clipboard!`, severity: "info", autoHide: 10000 } });
  }

  return (
    <Grid container alignItems="center" justify="center" spacing={4}>
      <Grid item xs={4}>
        <TextField label="Size" size="small" variant="outlined" onChange={handleSize} value={lastEmbedSize} fullWidth />
      </Grid>
      <Grid item xs={8}>
        <Grid container alignItems="center" justify="center" spacing={4}>
          <Typography>iFrame</Typography>
          <Tooltip title="iFrame embed code may be more compatible. If you're having trouble embedding, try this." placement="top" aria-label="searchForCustomShape">
            <Switch onChange={setIFrame} value={isIFrame} />
          </Tooltip>
        </Grid>
      </Grid>
      <Grid item xs={2}>
        <Tooltip title="Copy embeddable code to clipboard">
          <IconButton
            aria-label="copy embeddable code"
            onClick={(e) => { copyEmbeddableCode(); } }
            edge="end"
          >
            <FileCopyIcon />
          </IconButton>
        </Tooltip>
      </Grid>
      <Grid item xs={10}>
        <TextField
          multiline
          rows={2}
          value={
            isIFrame ? lastEmbedTemplate?.iframe_share : lastEmbedTemplate?.non_share
          }
          variant="outlined"
          fullWidth
          autoFocus
          onFocus={(e) => { 
            let self = e.target;
            setTimeout(function() { 
              self.selectionStart = self.selectionEnd = 10000; 
            }, 0);
          }}
          InputLabelProps={{
            style: { color: '#fff' },
          }}
        />
      </Grid>
    </Grid>
  );
}