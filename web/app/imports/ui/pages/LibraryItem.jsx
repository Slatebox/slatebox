import React, { useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate, useParams } from 'react-router-dom'
import Container from '@mui/material/Container'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Stack from '@mui/material/Stack'
import Chip from '@mui/material/Chip'
import Button from '@mui/material/Button'
import Link from '@mui/material/Link'
import Alert from '@mui/material/Alert'
import Skeleton from '@mui/material/Skeleton'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import AddIcon from '@mui/icons-material/Add'
import CallSplitIcon from '@mui/icons-material/CallSplit'
import libraryApi from '../../api/client/library'
import { categoryLabel } from '../../api/common/library-model.mjs'
import LibraryStill, { rememberContent } from '../components/library/gallery/LibraryStill'
import AddToSlateDialog from '../components/library/gallery/AddToSlateDialog'
import {
  authorLine, forkErrorText, KIND_NAMES, licenseLine, previewLabel, provenanceLine, readCopyRequest, actionLabel, usesLine, versionLine,
} from '../components/library/gallery/galleryCopy.mjs'

/** The phrases a component's board answers in chat ("Say it like this"), each checked on the board by the chat's own parser. */
async function sayItLikeThis(workshop) {
  await Promise.all([import('slateboxjs/workshops/behaviour'), import('slateboxjs/workshops/rules')])
  const lib = await import('../../api/common/library.mjs')
  return lib.boardMoves(workshop).slice(0, 6)
}

/**
 * One library item (library spec §7.1), open to everyone: a large read-only picture drawn by the one renderer, what
 * it is and who made it, where it came from, its license, and what to do with it. A slate or presentation opens as a
 * private copy; a component is added to a new slate or one of the person's slates, or branched off into a builder
 * slate. A visitor who acts becomes a guest first (libraryApi). slatebox.com links here with ?copy=1, which runs
 * "Open a copy" (a component: on a new slate) once and takes the flag out of the URL.
 */
export default function LibraryItem() {
  const { slug } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const [answer, setAnswer] = useState(null)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState(null)
  const [picking, setPicking] = useState(false)
  const [moves, setMoves] = useState([])
  const copyAsked = useRef(readCopyRequest(location.search).copy)

  useEffect(() => {
    let gone = false
    setAnswer(null)
    setError(null)
    libraryApi.get({ itemId: slug }).then((body) => {
      if (gone) return
      setAnswer(body)
      rememberContent(body.item.id, body.version.content)
      document.title = `${body.item.title} · Library · Slatebox`
    }, (err) => {
      if (!gone) setError(err?.error === 'not_found' ? 'This item isn’t in the library. It may have been taken down.' : (err?.reason || 'This item could not be loaded.'))
    })
    return () => { gone = true }
  }, [slug])

  const item = answer?.item
  const version = answer?.version
  const content = version?.content

  useEffect(() => {
    if (item?.kind !== 'component' || !content?.workshop) return undefined
    let gone = false
    sayItLikeThis(content.workshop).then(found => { if (!gone) setMoves(found) }, () => {})
    return () => { gone = true }
  }, [item?.id, content])

  /** Use the item: a copy of a slate or presentation, or a component on a new slate (no target) or beside a slate's boards. */
  async function use(target) {
    setBusy(true)
    setFailure(null)
    try {
      const made = await libraryApi.fork({ itemId: item.id, ...(target && { targetShareId: target.shareId }) })
      setPicking(false)
      navigate(`/canvas/${made.shareId}`)
    } catch (err) {
      setFailure(forkErrorText(err))
      setBusy(false)
    }
  }

  // The deep link from slatebox.com: once, then the flag leaves the URL so a reload or Back never copies again.
  useEffect(() => {
    if (!item || !copyAsked.current) return
    copyAsked.current = false
    navigate({ search: readCopyRequest(location.search).rest }, { replace: true })
    use(null)
  }, [item?.id])

  if (error) {
    return (
      <Container component="main" maxWidth="md" sx={{ py: 4 }}>
        <Alert severity="info" sx={{ mb: 2 }}>{error}</Alert>
        <Button component={RouterLink} to="/library" startIcon={<ArrowBackIcon />}>Back to the library</Button>
      </Container>
    )
  }

  const from = item && provenanceLine(item)
  const uses = item && usesLine(item)
  return (
    <Container component="main" maxWidth="lg" sx={{ py: { xs: 2, md: 3 }, px: { xs: 2, md: 3 } }}>
      <Button component={RouterLink} to="/library" startIcon={<ArrowBackIcon />} size="small" sx={{ mb: 1.5 }}>Library</Button>
      <Box sx={{ display: 'grid', gap: { xs: 2, md: 4 }, rowGap: { md: 2 }, gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 3fr) minmax(280px, 2fr)' }, alignItems: 'start' }}>
        <Box sx={{ gridColumn: { md: 1 }, gridRow: { md: 1 } }}>
          {item
            ? <LibraryStill itemId={item.id} content={content} title={item.title} label={previewLabel(item)} height={{ xs: 260, sm: 380, md: 480 }} eager fitShape />
            : <Skeleton variant="rounded" height={420} />}
          {item?.kind === 'presentation' && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {content?.deck?.viewpoints?.length ? `${content.deck.viewpoints.length} steps. ` : ''}Open a copy to play it, change it and present it as your own.
            </Typography>
          )}
        </Box>

        <Box component="section" aria-labelledby="item-title" sx={{ gridColumn: { md: 2 }, gridRow: { md: '1 / span 2' } }}>
          {item ? (
            <>
              <Stack direction="row" spacing={0.75} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
                <Chip size="small" label={KIND_NAMES[item.kind]} />
                {item.category && <Chip size="small" variant="outlined" label={categoryLabel(item.category)} component={RouterLink} to={`/library?category=${item.category}`} clickable />}
              </Stack>
              <Typography id="item-title" variant="h4" component="h1" sx={{ fontWeight: 700, fontSize: { xs: '1.6rem', md: '2rem' } }}>{item.title}</Typography>
              <Typography sx={{ mt: 1 }}>{item.summary}</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                {authorLine(item)}
                {from && <> · {from.text} <Link component={RouterLink} to={`/library/${from.itemId}`} data-provenance>{from.title}</Link></>}
              </Typography>
              {uses && <Typography variant="body2" color="text.secondary">{uses}</Typography>}

              {failure && <Alert severity="warning" sx={{ mt: 2 }}>{failure}</Alert>}
              <Stack direction={{ xs: 'column', sm: 'row', md: 'column', lg: 'row' }} spacing={1} sx={{ mt: 2.5 }}>
                {item.kind === 'component' ? (
                  <Button variant="contained" startIcon={<AddIcon />} onClick={() => setPicking(true)} disabled={busy} data-library-use>{actionLabel(item.kind)}</Button>
                ) : (
                  <Button variant="contained" startIcon={<ContentCopyIcon />} onClick={() => use(null)} disabled={busy} data-library-use>{busy ? 'Opening…' : actionLabel(item.kind)}</Button>
                )}
                {item.kind === 'component' && (
                  <Button variant="outlined" startIcon={<CallSplitIcon />} component={RouterLink} to={`/new#build=${encodeURIComponent(item.id)}`} data-library-branch>Branch off</Button>
                )}
              </Stack>
              <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>
                {item.kind === 'component'
                  ? 'Branch off to change how it works by chatting with Slatebox, then share your version with the library.'
                  : 'Your copy is private to you until you share it.'}
              </Typography>

              {item.description && <Typography sx={{ mt: 3, whiteSpace: 'pre-line' }}>{item.description}</Typography>}

              <Box component="dl" sx={{ mt: 3, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 2, rowGap: 0.5, typography: 'body2', '& dt': { color: 'text.secondary' }, '& dd': { m: 0 } }}>
                <dt>Kind</dt><dd>{KIND_NAMES[item.kind]}</dd>
                {item.category && <><dt>Category</dt><dd>{categoryLabel(item.category)}</dd></>}
                <dt>Version</dt><dd>{versionLine(item, version) || '—'}</dd>
                <dt>License</dt><dd data-library-license>{licenseLine(item)}</dd>
              </Box>
            </>
          ) : (
            <><Skeleton width="60%" height={48} /><Skeleton /><Skeleton width="80%" /></>
          )}
        </Box>
        {moves.length > 0 && (
          <Box component="section" aria-labelledby="say-heading" sx={{ gridColumn: { md: 1 }, gridRow: { md: 2 } }}>
            <Typography id="say-heading" variant="h6" component="h2" sx={{ fontSize: '1rem', mb: 1 }}>Say it like this</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Once it is on your slate, ask Slatebox in chat:</Typography>
            <Stack component="ul" spacing={0.75} sx={{ listStyle: 'none', p: 0, m: 0 }}>
              {moves.map(move => (
                <Box component="li" key={move.text} sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Chip size="small" variant="outlined" label={`“${move.text}”`} />
                  {move.words && <Typography variant="caption" color="text.secondary">{move.words}</Typography>}
                </Box>
              ))}
            </Stack>
          </Box>
        )}
      </Box>
      {item && <AddToSlateDialog open={picking} title={item.title} busy={busy} onPick={use} onClose={() => setPicking(false)} />}
    </Container>
  )
}
