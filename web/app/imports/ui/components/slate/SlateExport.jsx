import React, { useEffect, useState } from 'react';
import { useTheme } from '@material-ui/core/styles';
import useMediaQuery from '@material-ui/core/useMediaQuery';
import Grid from '@material-ui/core/Grid';
import Button from '@material-ui/core/Button/Button';
import { Typography } from '@material-ui/core';
import { useSelector } from 'react-redux';

export const SlateExport = (props) => {

  const theme = useTheme();
  const slate = useSelector(state => state.slate);

  function exportSVG() {
    props.onExport("svg", {}, (opts) => {
      const svgBlob = new Blob([opts.svg], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);
      const dl = document.createElement("a");
      dl.href = svgUrl;
      dl.download = `${(slate?.options.name || "slate").replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${slate?.shareId}.svg`;
      dl.click();
    })
  }

  function exportPNG() {
    props.onExport("png");
  }

  return (
    <Grid container alignItems="center" justify="center" spacing={2}>
      <Grid item>
        <Button variant="outlined" color="secondary" size="large" onClick={exportPNG}>PNG</Button>
      </Grid>
      <Grid item>
        <Button variant="outlined" color="secondary" size="large" onClick={exportSVG}>SVG</Button>
      </Grid>
    </Grid>
  );
}