import React from 'react'
import PropTypes from 'prop-types'
import { Link as RouterLink } from 'react-router-dom'
import Card from '@mui/material/Card'
import CardActionArea from '@mui/material/CardActionArea'
import CardContent from '@mui/material/CardContent'
import Typography from '@mui/material/Typography'
import Stack from '@mui/material/Stack'
import Chip from '@mui/material/Chip'
import { categoryLabel } from '../../../../api/common/library-model.mjs'
import LibraryStill from './LibraryStill'
import { authorLine, KIND_NAMES, previewLabel, provenanceLine, usesLine } from './galleryCopy.mjs'

/** One item in the gallery: its picture, kind and category, title, summary, who made it, where it came from, and how much it is used. */
export default function LibraryCard({ item }) {
  const from = provenanceLine(item)
  const uses = usesLine(item)
  return (
    <Card variant="outlined" component="article" data-library-card={item.slug} sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardActionArea component={RouterLink} to={`/library/${item.slug}`} sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
        <LibraryStill itemId={item.id} title={item.title} label={previewLabel(item)} height={168} />
        <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 0.75, p: 2 }}>
          <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
            <Chip size="small" label={KIND_NAMES[item.kind]} />
            {item.category && <Chip size="small" variant="outlined" label={categoryLabel(item.category)} />}
          </Stack>
          <Typography variant="h6" component="h3" sx={{ fontSize: '1.05rem', lineHeight: 1.3 }}>{item.title}</Typography>
          <Typography variant="body2" color="text.secondary">{item.summary}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 'auto', pt: 0.5 }}>
            {authorLine(item)}
            {from && <><br />{from.text} {from.title}</>}
            {uses && <><br />{uses}</>}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}

LibraryCard.propTypes = { item: PropTypes.object.isRequired }
