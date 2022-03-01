import React from 'react'
import PropTypes from 'prop-types'
import Grid from '@material-ui/core/Grid'
import Button from '@material-ui/core/Button/Button'
import { useSelector } from 'react-redux'

export default function SlateExport({ onExport }) {
  const slate = useSelector((state) => state.slate)

  const exportSVG = () => {
    onExport('svg', {}, (opts) => {
      const svgBlob = new Blob([opts.svg], {
        type: 'image/svg+xml;charset=utf-8',
      })
      const svgUrl = URL.createObjectURL(svgBlob)
      const dl = document.createElement('a')
      dl.href = svgUrl
      dl.download = `${(slate?.options.name || 'slate')
        .replace(/[^a-z0-9]/gi, '_')
        .toLowerCase()}_${slate?.shareId}.svg`
      dl.click()
    })
  }

  const exportPNG = () => {
    onExport('png')
  }

  SlateExport.propTypes = {
    onExport: PropTypes.func.isRequired,
  }

  return (
    <Grid container alignItems="center" justify="center" spacing={2}>
      <Grid item>
        <Button
          variant="outlined"
          color="secondary"
          size="large"
          onClick={exportPNG}
        >
          PNG
        </Button>
      </Grid>
      <Grid item>
        <Button
          variant="outlined"
          color="secondary"
          size="large"
          onClick={exportSVG}
        >
          SVG
        </Button>
      </Grid>
    </Grid>
  )
}
