import React, { useEffect, useRef, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Box, Button, Container, Stack, Typography } from '@mui/material'
import MarkdownIt from 'markdown-it'
import { Slate, Serialization } from 'slateboxjs'
import BrandBar from '../common/BrandBar'
import copySlate from '../../api/client/copySlate'
import { templateCopyTopic } from '../../api/common/template-policy.mjs'
import createAnonymousUser from '../../api/client/createAnonymousUser'

const markdown = new MarkdownIt({ html: false })

function TemplateCanvas({ board }) {
  const surface = useRef(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    const slate = new Slate(surface.current, {
      enabled: false, showbirdsEye: false, showZoom: false, allowCollaboration: false,
      showMultiSelect: false, showUndoRedo: false, panZoom: { enabled: false }, events: { isReadOnly: () => true },
    })
    setError(false)
    Serialization.deserialize(board, slate, false, true).then(() => {
      if (active) slate.fitToContent()
    }).catch(() => { if (active) setError(true) })
    return () => { active = false; slate.destroy() }
  }, [board])
  return <Box>
    <Box role="img" aria-label={'Canvas preview of ' + board.options.name}
      sx={{ height: 'clamp(240px, 42vh, 440px)', border: 1, borderColor: 'divider', overflow: 'hidden' }}>
      <div inert ref={surface} style={{ width: '100%', height: '100%' }} />
    </Box>
    {error && <p role="alert">The canvas preview could not load.</p>}
  </Box>
}

function TemplateTags({ tags }) {
  return <Stack direction="row" gap={2} flexWrap="wrap">{tags.map(tag =>
    <Link key={tag.slug} to={'/templates/tag/' + encodeURIComponent(tag.slug)}>{tag.title}</Link>
  )}</Stack>
}

export default function SlateTemplates() {
  const { slug, tag, preview } = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const query = search.get('q') || ''
  const topic = templateCopyTopic(search)
  const auth = useTracker(() => ({ id: Meteor.userId(), restoring: Meteor.loggingIn() }), [])
  const kind = preview ? 'preview' : tag ? 'tag' : slug ? 'slug' : 'list'
  const value = preview || tag || slug || ''
  const key = JSON.stringify([kind, value, preview ? auth.id : null])
  const [response, setResponse] = useState(null)
  const [copyError, setCopyError] = useState('')
  const [copying, setCopying] = useState(false)
  const inFlight = useRef(false)
  const data = response?.key === key ? response.data : null
  useEffect(() => {
    if (preview && auth.restoring) return
    let active = true
    setCopyError('')
    Meteor.callAsync('templates.directory', kind, value).then(next => {
      if (active) setResponse({ key, data: next })
    }).catch(() => { if (active) setResponse({ key, data: { type: 'error' } }) })
    return () => { active = false }
  }, [key, kind, value, preview, auth.restoring])

  async function useTemplate() {
    if (inFlight.current || data?.type !== 'template') return
    inFlight.current = true
    setCopying(true)
    setCopyError('')
    try {
      if (!Meteor.userId()) await createAnonymousUser()
      navigate('/canvas/' + await copySlate(data.key, { name: topic, projectName: topic }))
    } catch (err) {
      setCopyError(err.reason || 'Could not open a copy. Try again.')
    } finally {
      inFlight.current = false
      setCopying(false)
    }
  }

  const detail = data?.type === 'template' || data?.type === 'preview'
  const visibleItems = data?.items?.filter(item => [item.name, item.description, ...item.tags.map(t => t.title)]
    .join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <><BrandBar /><Container component="main" maxWidth="md" sx={{ py: { xs: 4, md: 7 }, '& a': { color: 'inherit' } }}>
    {kind !== 'list' && <Link to="/templates">All templates</Link>}
    {!data ? <p role="status">Loading templates…</p> : detail ? <Stack spacing={2.5} sx={{ mt: 2 }}>
      {data.type === 'preview' && <Typography>Author preview</Typography>}
      <Typography variant="h3" component="h1">{data.name}</Typography>
      {data.description && <Typography>{data.description}</Typography>}
      <TemplateCanvas board={data.board} />
      {topic && data.type === 'template' && <Typography>Your copy will be named “{topic}”.</Typography>}
      {data.type === 'template' && <div><Button variant="contained" disabled={copying || auth.restoring} onClick={useTemplate}>
        {copying ? 'Opening your slate…' : 'Use this template'}</Button></div>}
      {copyError && <p role="alert">{copyError}</p>}
      {data.markdown && <Box sx={{ overflowWrap: 'anywhere', '& img': { maxWidth: '100%' } }}
        dangerouslySetInnerHTML={{ __html: markdown.render(data.markdown) }} />}
      {data.type === 'template' && <TemplateTags tags={data.tags} />}
    </Stack> : data.items ? <Stack spacing={3} sx={{ mt: 2 }}>
      <Typography variant="h3" component="h1">{data.type === 'list' ? 'Slate templates' : data.title + ' templates'}</Typography>
      {data.type === 'list' && <Link to="/new">Create slate</Link>}
      {data.description && <Typography>{data.description}</Typography>}
      {data.tags?.length > 0 && <TemplateTags tags={data.tags} />}
      {data.items.length > 0 && <label>Find a template <input type="search" value={query} onChange={e => {
        const next = new URLSearchParams(search)
        if (e.target.value) next.set('q', e.target.value)
        else next.delete('q')
        setSearch(next, { replace: true })
      }} /></label>}
      {!visibleItems.length && <Typography>{query ? 'No templates match your search.' : 'No published templates are available.'}</Typography>}
      {data.type === 'tag' && !data.items.length && <Link to="/new">Start a blank slate</Link>}
      {visibleItems.map(item => <Box component="article" key={item.slug} sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
        <Typography variant="h5" component="h2"><Link to={'/templates/' + encodeURIComponent(item.slug)}>{item.name}</Link></Typography>
        {item.description && <Typography sx={{ my: 1 }}>{item.description}</Typography>}
        <TemplateTags tags={item.tags} />
      </Box>)}
    </Stack> : <Typography component="h1" variant="h4" sx={{ mt: 3 }}>{data.type === 'error' ? 'Templates could not load' : 'Template unavailable'}</Typography>}
  </Container></>
}
