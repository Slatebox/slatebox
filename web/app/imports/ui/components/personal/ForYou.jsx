import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Typography from '@mui/material/Typography'
import AutoAwesomeOutlined from '@mui/icons-material/AutoAwesomeOutlined'
import CONSTANTS from '../../../api/common/constants'
import { IDEA_KIND_LABELS, IDEA_WORDS, buildingWords, ideasMadeLine } from '../../../api/common/personal-ideas.mjs'
import { SECTION_HEADING, SPACE } from '../../common/AccountLayout'

// For you: smart components and printable pages Slatebox suggests for this person's work, from what
// they keep in About you and the tools they connected (server/personal/core.mjs). Each card shows
// its title, why it fits and two buttons: Build it (the agent drafts it, it is saved as their own
// draft in the library and opens on a new private slate) and Not for me. Signed-in people only.
//   variant 'page'     My slates: the section with its empty state and Get ideas
//   variant 'library'  the Library page: its first group, shown only when there are ideas
//   variant 'panel'    the library in Ask Slatebox's column: the same, in its narrow column
//   variant 'start'    the start page (/new): a "Made for you" row under the person's own tiles, ideas only
// `fresh`: opened from the interview's "See ideas made for you", so ideas that are missing or no
// longer fit About you are asked for at once.
const M = CONSTANTS.methods.personal.ideas
const reason = (error, fallback) => error?.reason || error?.message || fallback
// While a request runs every button stays focusable (aria-disabled, its click ignored), so keyboard focus never drops to the page.
const waitingSx = (busy) => (busy ? { opacity: 0.6, cursor: 'default' } : null)
const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }

function IdeaCard({ idea, busy, building, stale, onBuild, onDismiss, compact }) {
  const titleId = useId()
  const words = buildingWords(idea)
  return (
    <Box component="li" data-idea={idea.id} aria-labelledby={titleId} aria-busy={building || undefined}
      sx={{ listStyle: 'none', border: 1, borderColor: 'divider', borderRadius: 2, bgcolor: 'background.paper', p: compact ? SPACE.tight : SPACE.text,
        display: 'flex', flexDirection: 'column', gap: SPACE.hair, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.3 }}>{IDEA_KIND_LABELS[idea.kind] || 'Smart component'}</Typography>
      <Typography id={titleId} component="h3" variant={compact ? 'body2' : 'subtitle1'} sx={{ fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere' }}>{idea.title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{idea.why}</Typography>
      {idea.tools?.length > 0 && (
        <Box role="group" sx={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.hair }} aria-label="Uses">
          {idea.tools.map((tool) => <Chip key={tool} label={tool} size="small" variant="outlined" />)}
        </Box>
      )}
      {/* said once, by the section's live region; shown here beside the card being built */}
      {building && <Typography variant="body2" sx={{ fontWeight: 600 }} data-idea-progress="">{words.progress}</Typography>}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: SPACE.tight, mt: 'auto', pt: SPACE.hair }}>
        {idea.built
          ? <Button size="small" variant="contained" color="secondary" component={RouterLink} to={`/canvas/${idea.built.shareId}`} aria-label={`Open it: ${idea.title}`}>Open it</Button>
          // an idea About you no longer fits cannot be built (the section says to get new ideas)
          : !stale && <Button size="small" variant="contained" color="secondary" onClick={() => { if (!busy) onBuild(idea) }} aria-disabled={busy || undefined} sx={waitingSx(busy)}
            aria-label={building ? words.building : words.button} data-idea-build="">
            {building ? 'Building…' : 'Build it'}
          </Button>}
        {!idea.built && <Button size="small" onClick={() => { if (!busy) onDismiss(idea) }} aria-disabled={busy || undefined} sx={waitingSx(busy)} aria-label={`Not for me: ${idea.title}`} data-idea-dismiss="">Not for me</Button>}
      </Box>
    </Box>
  )
}

const ideaShape = PropTypes.shape({
  id: PropTypes.string.isRequired,
  title: PropTypes.string.isRequired,
  kind: PropTypes.string.isRequired,
  why: PropTypes.string.isRequired,
  tools: PropTypes.arrayOf(PropTypes.string),
  built: PropTypes.shape({ shareId: PropTypes.string }),
})
IdeaCard.propTypes = {
  idea: ideaShape.isRequired,
  busy: PropTypes.bool.isRequired,
  building: PropTypes.bool.isRequired,
  stale: PropTypes.bool.isRequired,
  onBuild: PropTypes.func.isRequired,
  onDismiss: PropTypes.func.isRequired,
  compact: PropTypes.bool.isRequired,
}

export default function ForYou({ variant, fresh }) {
  const signedIn = useTracker(() => Boolean(Meteor.userId() && !Meteor.user()?.isAnonymous), [])
  const navigate = useNavigate()
  const headingId = useId()
  const heading = useRef(null)
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(null) // null | 'refresh' | ideaId
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const asked = useRef(false)
  // the interview's hand-off, read once at mount (clearing it from history below must not re-run the listing)
  const freshAtMount = useRef(fresh)
  const panel = variant === 'panel'
  // only My slates shows the section with no ideas in it (its empty state, Get ideas); the library and the start page show ideas or nothing
  const onlyIdeas = variant !== 'page'
  const start = variant === 'start'

  const refresh = useCallback(async () => {
    setBusy('refresh')
    setError('')
    setStatus('Slatebox is thinking of ideas made for you…')
    try {
      const next = await Meteor.callAsync(M.refresh, {})
      setState(next)
      setStatus(next.ideas.length ? ideasMadeLine(next.ideas.length) : '')
    } catch (err) {
      setError(reason(err, IDEA_WORDS.failed))
      setStatus('')
    } finally {
      setBusy(null)
    }
  }, [])

  useEffect(() => {
    if (!signedIn) { setState(null); return undefined }
    let gone = false
    Meteor.callAsync(M.list, {}).then((listed) => {
      if (gone) return
      setState(listed)
      if (freshAtMount.current && !asked.current) {
        asked.current = true
        // Used once: the hand-off lives in the history entry, so a reload or Back would otherwise ask (and charge) again.
        navigate(`${window.location.pathname}${window.location.search}`, { replace: true, state: null })
        // Arriving from the interview: focus lands on the section the button named.
        requestAnimationFrame(() => heading.current?.focus())
        // What was just kept should show in the ideas, so ask once if they are missing or out of date.
        if (listed.canRefresh && (!listed.ideas.length || listed.stale)) refresh()
      }
    }).catch(() => { if (!gone) setState(null) })
    return () => { gone = true }
  }, [signedIn, navigate, refresh])

  const build = async (idea) => {
    setBusy(idea.id)
    setError('')
    setStatus(buildingWords(idea).progress)
    try {
      const made = await Meteor.callAsync(M.build, { ideaId: idea.id })
      setStatus(`Built ${made.title}. Opening it…`)
      // from Ask Slatebox's library, on a slate: the page loads the new slate as a whole (as the library's own Add does)
      if (panel) window.location.assign(`/canvas/${made.shareId}`)
      else navigate(`/canvas/${made.shareId}`)
    } catch (err) {
      setError(reason(err, IDEA_WORDS.buildFailed))
      setStatus('')
      setBusy(null)
    }
  }

  const dismiss = async (idea) => {
    setBusy(idea.id)
    setError('')
    try {
      await Meteor.callAsync(M.dismiss, { ideaId: idea.id })
      setState((now) => (now ? { ...now, ideas: now.ideas.filter((item) => item.id !== idea.id) } : now))
      setStatus(`Not for you: ${idea.title}. It will not be suggested again.`)
      requestAnimationFrame(() => heading.current?.focus())
    } catch (err) {
      setError(reason(err, 'That could not be changed. Try again.'))
    } finally {
      setBusy(null)
    }
  }

  if (!signedIn || !state) return null
  // Personalization off: no section at all (About you is where it is turned on, and says so).
  if (state.empty?.code === 'personalization-off') return null
  const ideas = state.ideas || []
  // In the library the group shows only when there are ideas to show.
  if (onlyIdeas && !ideas.length) return null

  const refreshButton = state.canRefresh && (
    <Button size="small" variant={ideas.length ? 'text' : 'outlined'} color="secondary" onClick={() => { if (!busy) refresh() }} aria-disabled={Boolean(busy) || undefined} data-for-you-refresh=""
      sx={waitingSx(Boolean(busy))} startIcon={<AutoAwesomeOutlined fontSize="small" />}>
      {busy === 'refresh' ? 'Getting ideas…' : ideas.length ? 'Get new ideas' : 'Get ideas made for you'}
    </Button>
  )

  return (
    <Box component="section" aria-labelledby={headingId} data-for-you={variant} sx={panel ? { mt: 1 } : { px: variant === 'page' ? 1 : 0, mb: SPACE.block }}>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: SPACE.tight, mb: start ? SPACE.text : SPACE.tight }}>
        {/* on the start page it is one of the page's sections, headed as its siblings are (Yours, the jobs) */}
        <Typography id={headingId} ref={heading} tabIndex={-1} component="h2" variant={panel ? 'caption' : 'h6'}
          sx={start ? { ...SECTION_HEADING, outline: 'none', flex: '1 1 auto' } : { fontWeight: 700, outline: 'none', flex: '1 1 auto' }}>{start ? 'Made for you' : 'For you'}</Typography>
        {!onlyIdeas && refreshButton}
      </Box>
      {!onlyIdeas && !ideas.length && (
        <Box data-for-you-empty="" sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: SPACE.tight }}>
          <Typography variant="body2" color="text.secondary">{state.empty ? state.empty.message : IDEA_WORDS.noIdeasYet}</Typography>
          {state.empty && <Button size="small" variant="outlined" component={RouterLink} to="/profile?tab=about">Open About you</Button>}
        </Box>
      )}
      {state.stale && ideas.length > 0 && (
        <Alert severity="info" sx={{ mb: SPACE.tight }}>{IDEA_WORDS.stale}</Alert>
      )}
      {ideas.length > 0 && (
        <Box component="ul" aria-label="Ideas made for you"
          sx={{ m: 0, p: 0, display: 'grid', gap: panel ? 1 : SPACE.text,
            gridTemplateColumns: panel ? 'minmax(0, 1fr)' : { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' } }}>
          {ideas.map((idea) => (
            <IdeaCard key={idea.id} idea={idea} busy={Boolean(busy)} building={busy === idea.id && !idea.built} stale={Boolean(state.stale)} onBuild={build} onDismiss={dismiss} compact={panel} />
          ))}
        </Box>
      )}
      {onlyIdeas && state.stale && refreshButton}
      {error && <Alert severity="warning" role="alert" sx={{ mt: SPACE.tight }}>{error}</Alert>}
      <Box role="status" aria-live="polite" sx={visuallyHidden}>{status}</Box>
    </Box>
  )
}

ForYou.propTypes = {
  variant: PropTypes.oneOf(['page', 'library', 'panel', 'start']),
  fresh: PropTypes.bool,
}
ForYou.defaultProps = { variant: 'page', fresh: false }
