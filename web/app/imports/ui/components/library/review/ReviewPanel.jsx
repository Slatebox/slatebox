import React from 'react'
import PropTypes from 'prop-types'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import Paper from '@mui/material/Paper'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Divider from '@mui/material/Divider'
import IconButton from '@mui/material/IconButton'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import useMediaQuery from '@mui/material/useMediaQuery'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import libraryApi from '../../../../api/client/library'
import { INTEGRATION_AUTH_LABELS, categoryLabel, reviewStateOf } from '../../../../api/common/library-model.mjs'
import { KindTitle, REFINE_STARTERS, categoryChipsFor, diffLines, eventLine, probeLines } from '../libraryCopy.mjs'
import { refineHistory, proposalChanges } from './refineTurns.mjs'
import { useAtom } from 'jotai'
import { conversationOpen } from '../../../jotai/atoms'
import PayNotice, { isCreditRefusal } from '../../PayNotice'

const STATE_WORDS = { submitted: 'Submitted', in_review: 'In review', changes_requested: 'Changes asked for', published: 'Published', rejected: 'Not accepted', unpublished: 'Taken out' }

// The review panel on a reviewer's private review copy (slate.library.mode 'review', made by
// library.review.open). The canvas beside it is the item: notes and boards change there as on any
// slate. Here: the item's details, a chat that refines it with AI (each proposal a diff to keep or
// discard), the thread with its author, and the decision. Approve publishes what is on the canvas.
// Docked on the left on a wide screen (Ask Slatebox keeps the right); below 1000px docked under the canvas, foldable.
// Either way it takes its own room: the canvas shrinks around it, so it never covers a card or a card's bar.
// A suggested integration has no canvas: the panel stands alone on its own page (/admin/library/review/:itemId,
// `standalone`), with what Slatebox found reaching the server in place of the canvas, and "Check again".
export default function ReviewPanel({ slate, itemId: givenItemId, standalone }) {
  const wideScreen = useMediaQuery('(min-width:1000px)')
  const wide = wideScreen || standalone
  const navigate = useNavigate()
  const itemId = slate?.library?.itemId || givenItemId
  const [open, setOpen] = React.useState(true)
  // Below 1000px the canvas, Ask Slatebox and this panel share one column: one of the two panels open at a time, so the
  // canvas always keeps its room. Ask Slatebox opening folds this panel to its heading; this panel opening closes it.
  const [askOpen, setAskOpen] = useAtom(conversationOpen)
  React.useEffect(() => { if (!wide && askOpen) setOpen(false) }, [wide, askOpen])
  const toggle = () => {
    if (!open && !wide) setAskOpen(false)
    setOpen(!open)
  }
  const [data, setData] = React.useState(null)
  const [problem, setProblem] = React.useState('')
  const [reload, setReload] = React.useState(0)
  const [turns, setTurns] = React.useState([])
  const [message, setMessage] = React.useState('')
  const [asking, setAsking] = React.useState(false)
  const [meta, setMeta] = React.useState(null)
  const [savingMeta, setSavingMeta] = React.useState(false)
  const [reply, setReply] = React.useState('')
  const [decision, setDecision] = React.useState(null)
  // The dialog keeps its words while it fades out after a decision (decision is null by then).
  const [asked, setAsked] = React.useState(null)
  const [askedVersion, setAskedVersion] = React.useState(null)
  React.useEffect(() => { if (decision) setAsked(decision) }, [decision])
  const askedNow = decision || asked
  const [decisionText, setDecisionText] = React.useState('')
  const [deciding, setDeciding] = React.useState(false)
  const [done, setDone] = React.useState(null)
  const composer = React.useRef(null)
  // Reviewing your own submission: refused unless this server has one administrator and you say so.
  const [selfReview, setSelfReview] = React.useState(false)
  const [selfAsk, setSelfAsk] = React.useState(false)
  const [checking, setChecking] = React.useState(false)
  const asReviewer = (call, input) => call({ ...input, ...(selfReview && { selfReview: true }) }).catch((error) => {
    if (error?.error === 'self_review') setSelfAsk(true)
    throw error
  })

  React.useEffect(() => {
    if (!itemId) return undefined
    let live = true
    libraryApi.get({ itemId }).then((answer) => {
      if (!live) return
      setData(answer)
      const shown = { ...answer.item, ...(answer.item.pendingMeta || {}) }
      setMeta({ title: shown.title || '', summary: shown.summary || '', description: shown.description || '', category: shown.category || '', synonyms: (shown.synonyms || []).join(', ') })
    }, (error) => { if (live) setProblem(error?.reason || 'This item could not be read.') })
    return () => { live = false }
  }, [itemId, reload])

  if (!itemId) return null
  const item = data?.item
  const shown = item ? { ...item, ...(item.pendingMeta || {}) } : null
  const state = item ? reviewStateOf(item) : null
  const reviewing = state === 'in_review'
  // The version approving publishes: the one its author sent (approve keeps the review copy's changes in it),
  // so the number said here is the stored publishedVersion afterwards, the item page's and the thread's.
  const nextVersion = item?.pendingVersion ?? null
  // A decision is asked about the version as it stands when the button is pressed.
  const choose = (kind) => { setAskedVersion(nextVersion); setDecision(kind) }

  async function ask(text) {
    const said = (text ?? message).trim()
    if (!said || asking) return
    const history = refineHistory(turns)
    setTurns((now) => [...now, { role: 'user', text: said }])
    setMessage('')
    setAsking(true)
    try {
      const answer = await asReviewer(libraryApi.review.refine, { itemId, message: said, history, mode: 'preview' })
      setTurns((now) => [...now, { role: 'assistant', text: answer.reply || 'Here is what I would change.', ask: said, history, answer, state: proposalChanges(answer) ? 'pending' : 'reply' }])
    } catch (error) {
      // The meter's refusal (no Pro or balance, the included amount used): its ways on inside the turn, and the ask again once paid.
      const code = error?.error === 'ai_unavailable' ? error.details?.reason : null
      const refusal = code && (isCreditRefusal(code) || error.details?.pay) ? { code, reason: error.reason, details: { ...(error.details?.pay && { pay: error.details.pay }) } } : null
      setTurns((now) => [...now, { role: 'assistant', text: error?.reason || 'That could not be done. Ask in another way.', state: 'error', ...(refusal && { refusal, ask: said }) }])
    } finally {
      setAsking(false)
    }
  }

  async function keep(index) {
    const turn = turns[index]
    setTurns((now) => now.map((row, i) => (i === index ? { ...row, state: 'keeping' } : row)))
    try {
      const kept = await asReviewer(libraryApi.review.refine, { itemId, message: turn.ask, history: turn.history, mode: 'save', ...(turn.answer?.previewId && { previewId: turn.answer.previewId }) })
      setTurns((now) => now.map((row, i) => (i === index ? { ...row, state: kept.kept ? 'kept' : 'reply' } : row)))
      setReload((n) => n + 1)
    } catch (error) {
      setTurns((now) => now.map((row, i) => (i === index ? { ...row, state: 'pending', error: error?.reason || 'It could not be kept.' } : row)))
    }
  }

  async function saveMeta() {
    if (!meta || savingMeta) return
    setSavingMeta(true)
    setProblem('')
    try {
      const synonyms = meta.synonyms.split(',').map((word) => word.trim()).filter(Boolean)
      await asReviewer(libraryApi.review.update, {
        itemId, title: meta.title.trim(), summary: meta.summary.trim(), ...(meta.description.trim() && { description: meta.description.trim() }),
        ...(meta.category && !item.categoryLocked && { category: meta.category }), ...(item.kind === 'component' && { synonyms }),
      })
      setReload((n) => n + 1)
    } catch (error) {
      setProblem(error?.reason || 'The details could not be saved.')
    } finally {
      setSavingMeta(false)
    }
  }

  // An integration: reach its server again (anonymously), and show what was found.
  async function checkAgain() {
    setChecking(true)
    setProblem('')
    try {
      await asReviewer(libraryApi.review.open, { itemId })
      setReload((n) => n + 1)
    } catch (error) {
      setProblem(error?.reason || 'It could not be checked.')
    } finally {
      setChecking(false)
    }
  }

  async function sendReply() {
    if (!reply.trim()) return
    try {
      await libraryApi.comment({ itemId, message: reply.trim() })
      setReply('')
      setReload((n) => n + 1)
    } catch (error) {
      setProblem(error?.reason || 'The message could not be sent.')
    }
  }

  async function decide() {
    if (!decision || deciding) return
    setDeciding(true)
    setProblem('')
    try {
      const text = decisionText.trim()
      if (decision === 'approve') {
        const result = await asReviewer(libraryApi.review.approve, { itemId, ...(text && { message: text }) })
        setDone({ kind: 'approve', url: item.kind === 'integration' ? null : `/library/${item.slug}`, version: result.publishedVersion ?? nextVersion })
      } else if (decision === 'changes') {
        await libraryApi.review.requestChanges({ itemId, message: text })
        setDone({ kind: 'changes' })
      } else if (decision === 'reject') {
        await libraryApi.review.reject({ itemId, message: text })
        setDone({ kind: 'reject' })
      } else if (decision === 'unpublish') {
        await libraryApi.review.unpublish({ itemId, message: text })
        setDone({ kind: 'unpublish' })
      }
      setDecision(null)
      setDecisionText('')
      setReload((n) => n + 1)
    } catch (error) {
      setProblem(error?.reason || 'That could not be done.')
    } finally {
      setDeciding(false)
    }
  }

  const header = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="overline" sx={{ lineHeight: 1.4, display: 'block' }}>Library review</Typography>
        <Typography variant="subtitle1" noWrap sx={{ fontWeight: 650 }} title={shown?.title}>{shown?.title || 'Loading…'}</Typography>
      </Box>
      <Button size="small" component={RouterLink} to="/admin/library">Queue</Button>
      {!wide && <IconButton aria-label={open ? 'Fold the review panel' : 'Open the review panel'} onClick={toggle}>{open ? <ExpandMoreIcon /> : <ExpandLessIcon />}</IconButton>}
    </Box>
  )

  return (
    <Paper component="aside" elevation={0} square aria-label="Library review" data-testid="review-panel" data-docked=""
      sx={{
        // Docked beside the canvas, never over it: the canvas page's row (or, below 1000px, its column) gives it its own
        // room and the canvas shrinks to what is left, as it does for Ask Slatebox. A selected card's bar stays whole.
        position: 'relative', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflow: 'hidden', minWidth: 0, minHeight: 0,
        ...(standalone
          ? { width: '100%', border: 1, borderColor: 'divider', borderRadius: 2 }
          : wide
            ? { order: -1, flex: '0 0 384px', width: 384, height: '100%', borderRight: 1, borderColor: 'divider' }
            : { flex: 'none', width: '100%', maxHeight: open ? '46dvh' : 'none', borderTop: 1, borderColor: 'divider' }),
      }}>
      {header}
      {(wide || open) && (
        <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2.5, py: 2, display: 'grid', gap: 1.5, alignContent: 'start' }}>
          {problem && <Alert severity="error" role="alert" onClose={() => setProblem('')}>{problem}</Alert>}
          {selfAsk && !selfReview && (
            <Alert severity="info" data-testid="self-review-ask"
              action={<Button color="inherit" size="small" onClick={() => { setSelfReview(true); setSelfAsk(false); setProblem('') }}>Review it myself</Button>}>
              You sent this one. Ask another administrator to review it, or review it yourself if you are the only one. The thread records it.
            </Alert>
          )}
          {item && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }} data-testid="review-header">
              <Chip size="small" label={KindTitle(item.kind)} />
              <Chip size="small" color={reviewing ? 'info' : 'default'} label={STATE_WORDS[state] || state} data-testid="review-state" />
              {item.status === 'published' && item.pendingVersion && <Chip size="small" color="info" variant="outlined" label="Update to a published item" />}
              <Typography variant="caption" color="text.secondary">
                by {item.authorName}{item.status === 'published' ? ` · published ${item.publishedCount ?? 1} time${(item.publishedCount ?? 1) === 1 ? '' : 's'}` : ''}
                {item.provenance?.branchedFrom ? ` · branched from ${item.provenance.branchedFrom.title}` : ''}
                {item.provenance?.forkedFrom ? ` · copy of ${item.provenance.forkedFrom.title}` : ''}
              </Typography>
            </Box>
          )}

          {done && (
            <Alert severity="success" data-testid="review-done">
              {done.kind === 'approve' && (done.url
                ? <>Published{done.version ? ` as version ${done.version}` : ''}. <RouterLink to={done.url}>See it in the library</RouterLink>.</>
                : <>Published. It is listed under Existing in Connect an integration, marked Community. <RouterLink to="/integrations">See it</RouterLink>.</>)}
              {done.kind === 'changes' && 'Sent back to the author with your message.'}
              {done.kind === 'reject' && 'Not accepted. The author has your reason.'}
              {done.kind === 'unpublish' && 'Taken out of the library.'}
              {' '}<Button size="small" onClick={() => navigate('/admin/library')}>Back to the queue</Button>
            </Alert>
          )}

          {item?.kind === 'integration' && <IntegrationCheck item={item} reviewing={reviewing} checking={checking} onCheck={checkAgain} />}

          {meta && item && (
            <Box component="section" aria-label="Details" sx={{ display: 'grid', gap: 1 }}>
              <TextField size="small" label={item.kind === 'integration' ? 'Name on its card' : 'Title'} value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} inputProps={{ maxLength: item.kind === 'integration' ? 40 : 80 }} disabled={!reviewing} />
              <TextField size="small" label="One line" value={meta.summary} onChange={(e) => setMeta({ ...meta, summary: e.target.value })} inputProps={{ maxLength: 160 }} InputLabelProps={{ shrink: true }} disabled={!reviewing} multiline />
              {item.categoryLocked && item.category
                ? <Typography variant="body2">Category: {categoryLabel(item.category)} (from {item.provenance?.branchedFrom?.title || 'its parent'}, locked)</Typography>
                : (
                  <Box role="radiogroup" aria-label="Category" sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {categoryChipsFor(item.kind).map((chip) => (
                      <Chip key={chip.id} size="small" label={chip.label} role="radio" aria-checked={meta.category === chip.id} disabled={!reviewing}
                        color={meta.category === chip.id ? 'primary' : 'default'} variant={meta.category === chip.id ? 'filled' : 'outlined'}
                        onClick={() => setMeta({ ...meta, category: meta.category === chip.id ? '' : chip.id })} />
                    ))}
                  </Box>
                )}
              {item.kind === 'component' && (
                <TextField size="small" label="Words people might search for" value={meta.synonyms} onChange={(e) => setMeta({ ...meta, synonyms: e.target.value })}
                  helperText="Separated by commas." disabled={!reviewing} />
              )}
              {item.kind !== 'integration' && <TextField size="small" label="Description" value={meta.description} onChange={(e) => setMeta({ ...meta, description: e.target.value })} multiline minRows={2} inputProps={{ maxLength: 2000 }} InputLabelProps={{ shrink: true }} disabled={!reviewing} />}
              {reviewing && <Box><Button size="small" variant="outlined" onClick={saveMeta} disabled={savingMeta}>{savingMeta ? 'Saving…' : 'Save the details'}</Button></Box>}
            </Box>
          )}

          <Divider />
          <Box component="section" aria-label="Refine with AI" sx={{ display: 'grid', gap: 1 }} data-testid="refine-chat">
            <Typography variant="subtitle2">Refine it</Typography>
            <Typography variant="caption" color="text.secondary">
              {item?.kind === 'integration'
                ? 'Ask for a change to its words: you see it first and keep it only if you want it. Its address never changes here.'
                : 'Ask for a change: you see it first and keep it only if you want it. Change the notes and boards on the canvas directly.'}
            </Typography>
            {turns.map((turn, index) => (
              <RefineTurn key={index} turn={turn} last={index === turns.length - 1} onAgain={() => ask(turn.ask)} onKeep={() => keep(index)}
                onDiscard={() => setTurns((now) => now.map((row, i) => (i === index ? { ...row, state: 'discarded' } : row)))}
                onChange={() => { setMessage(`Instead: `); composer.current?.focus() }} />
            ))}
            {asking && <Typography variant="body2" color="text.secondary" role="status">Thinking…</Typography>}
            {reviewing && (
              <>
                {turns.length === 0 && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {REFINE_STARTERS.filter((line) => item?.kind === 'component' || line !== 'Tighten the rules').map((line) => (
                      <Chip key={line} size="small" variant="outlined" label={line} onClick={() => ask(line)} clickable data-testid="refine-starter" />
                    ))}
                  </Box>
                )}
                <Box component="form" onSubmit={(event) => { event.preventDefault(); ask() }} sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                  <TextField inputRef={composer} size="small" fullWidth multiline maxRows={4} placeholder="Ask for a change…" value={message}
                    onChange={(event) => setMessage(event.target.value)} inputProps={{ 'aria-label': 'Ask for a change', maxLength: 2000 }}
                    onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask() } }} />
                  <Button type="submit" variant="contained" disabled={!message.trim() || asking}>Ask</Button>
                </Box>
              </>
            )}
          </Box>

          <Divider />
          <Box component="section" aria-label="Thread" sx={{ display: 'grid', gap: 0.75 }} data-testid="review-thread">
            <Typography variant="subtitle2">Thread with the author</Typography>
            {(data?.thread || []).map((event) => (
              <Box key={event.id} sx={{ borderLeft: 2, borderColor: event.actor?.kind === 'author' ? 'secondary.main' : 'divider', pl: 1 }}>
                <Typography variant="caption" color="text.secondary">{new Date(event.at).toLocaleString()}</Typography>
                <Typography variant="body2">{eventLine(event)}</Typography>
                {event.message && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: 'text.secondary' }}>{event.message}</Typography>}
                {diffLines(event.diff).map((line) => <Typography key={line} variant="caption" component="div" sx={{ fontFamily: 'monospace' }}>{line}</Typography>)}
              </Box>
            ))}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <TextField size="small" fullWidth multiline maxRows={4} placeholder="Write to the author…" value={reply} onChange={(event) => setReply(event.target.value)}
                inputProps={{ 'aria-label': 'Write to the author', maxLength: 2000 }} />
              <Button onClick={sendReply} disabled={!reply.trim()}>Send</Button>
            </Box>
          </Box>
        </Box>
      )}
      {(wide || open) && item && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, px: 2, py: 1.25, borderTop: 1, borderColor: 'divider' }} data-testid="review-actions">
          {reviewing && <>
            <Button variant="contained" color="success" onClick={() => choose('approve')} data-testid="review-approve">Approve and publish</Button>
            <Button variant="outlined" onClick={() => choose('changes')} data-testid="review-changes">Request changes</Button>
            <Button color="error" onClick={() => choose('reject')} data-testid="review-reject">Reject</Button>
          </>}
          {item.status === 'published' && !reviewing && <Button color="error" onClick={() => choose('unpublish')}>Unpublish</Button>}
        </Box>
      )}
      <Dialog open={Boolean(decision)} onClose={() => !deciding && setDecision(null)} fullWidth maxWidth="xs">
        <DialogTitle>
          {askedNow === 'approve' && ((askedVersion ?? nextVersion) ? `Publish version ${askedVersion ?? nextVersion} for everyone?` : 'Publish it for everyone?')}
          {askedNow === 'changes' && 'Ask the author for changes'}
          {askedNow === 'reject' && 'Turn this down?'}
          {askedNow === 'unpublish' && 'Take it out of the library?'}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 1.5 }}>
            {askedNow === 'approve' && (item?.kind === 'integration'
              ? 'It is listed under Existing in Connect an integration for everyone, marked Community. Each person still signs in and chooses its tools themselves. The author is told.'
              : 'What is on this canvas now is what people will get. The author is told.')}
            {askedNow === 'changes' && 'Say what to change. The author sees your message and can submit it again.'}
            {askedNow === 'reject' && 'Say why. The author sees your reason.'}
            {askedNow === 'unpublish' && 'Copies people already made stay theirs. Say why: the author is told.'}
          </Typography>
          <TextField autoFocus fullWidth multiline minRows={2} label={askedNow === 'approve' ? 'Message to the author (optional)' : 'Message to the author'}
            value={decisionText} onChange={(event) => setDecisionText(event.target.value)} inputProps={{ maxLength: 2000, 'data-testid': 'decision-message' }} InputLabelProps={{ shrink: true }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDecision(null)} disabled={deciding}>Cancel</Button>
          <Button variant="contained" color={askedNow === 'approve' ? 'success' : askedNow === 'changes' ? 'primary' : 'error'} onClick={decide}
            disabled={deciding || (askedNow !== 'approve' && !decisionText.trim())} data-testid="decision-confirm">
            {askedNow === 'approve' ? 'Publish' : askedNow === 'changes' ? 'Send back' : askedNow === 'reject' ? 'Reject' : 'Unpublish'}
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  )
}

function RefineTurn({ turn, last = false, onAgain = null, onKeep, onDiscard, onChange }) {
  if (turn.role === 'user') {
    return <Typography variant="body2" sx={{ justifySelf: 'end', bgcolor: 'action.selected', borderRadius: 2, px: 1.25, py: 0.75, maxWidth: '90%', whiteSpace: 'pre-wrap' }}>{turn.text}</Typography>
  }
  const lines = turn.answer ? diffLines(turn.answer.diff) : []
  const check = turn.answer?.proposal?.check || []
  return (
    <Box data-testid="refine-turn" sx={{ display: 'grid', gap: 0.75 }}>
      {turn.refusal && last
        ? <PayNotice refusal={turn.refusal} from="draft" retry={onAgain} inline />
        : <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: turn.state === 'error' ? 'error.main' : 'text.primary' }}>{turn.text}</Typography>}
      {(lines.length > 0 || check.length > 0) && (
        <Box data-testid="refine-diff" sx={{ border: 1, borderColor: turn.state === 'kept' ? 'success.main' : 'divider', borderRadius: 1, p: 1, display: 'grid', gap: 0.5,
          opacity: turn.state === 'discarded' ? 0.55 : 1 }}>
          {lines.map((line) => <Typography key={line} variant="caption" component="div" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{line}</Typography>)}
          {check.length > 0 && <>
            <Typography variant="caption" sx={{ fontWeight: 700 }}>Check:</Typography>
            {check.map((line) => <Typography key={line} variant="caption" component="div">• {line}</Typography>)}
          </>}
          {turn.error && <Typography variant="caption" color="error">{turn.error}</Typography>}
          {turn.state === 'pending' && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              <Button size="small" variant="contained" onClick={onKeep} data-testid="refine-keep">Keep</Button>
              <Button size="small" onClick={onDiscard}>Discard</Button>
              <Button size="small" onClick={onChange}>Change something first</Button>
            </Box>
          )}
          {turn.state === 'keeping' && <Typography variant="caption" role="status">Keeping…</Typography>}
          {turn.state === 'kept' && <Typography variant="caption" color="success.main" data-testid="refine-kept">Kept.</Typography>}
          {turn.state === 'discarded' && <Typography variant="caption" color="text.secondary">Discarded.</Typography>}
        </Box>
      )}
    </Box>
  )
}

RefineTurn.propTypes = {
  turn: PropTypes.shape({ role: PropTypes.string, text: PropTypes.string, state: PropTypes.string, error: PropTypes.string, answer: PropTypes.object }).isRequired,
  onKeep: PropTypes.func.isRequired,
  onDiscard: PropTypes.func.isRequired,
  onChange: PropTypes.func.isRequired,
  last: PropTypes.bool,
  onAgain: PropTypes.func,
}

/** A suggested integration's facts and the reviewer's own check of its server. */
function IntegrationCheck({ item, reviewing, checking, onCheck }) {
  const fields = item.pendingIntegration || item.integration || {}
  const tone = { ok: 'success.main', info: 'text.secondary', warning: 'warning.main', error: 'error.main' }
  return (
    <Box component="section" aria-label="The server" data-testid="integration-check" sx={{ display: 'grid', gap: 0.75, border: 1, borderColor: 'divider', borderRadius: 1, p: 1.5 }}>
      <Typography variant="subtitle2">The server</Typography>
      <Typography variant="body2" sx={{ overflowWrap: 'anywhere', fontFamily: 'monospace' }} data-testid="integration-address">{fields.address}</Typography>
      <Typography variant="body2" color="text.secondary">
        {INTEGRATION_AUTH_LABELS[fields.auth] || 'No sign-in'} (as the author says)
        {fields.homepage && <> · <a href={fields.homepage} target="_blank" rel="noopener noreferrer nofollow">Homepage</a></>}
      </Typography>
      <Box role="status" aria-live="polite" sx={{ display: 'grid', gap: 0.25 }} data-testid="integration-probe">
        {probeLines(item.reviewProbe, { auth: fields.auth }).map((line) => (
          <Typography key={line.text} variant="body2" sx={{ color: tone[line.tone] }}>{line.tone === 'ok' ? '✓ ' : line.tone === 'error' || line.tone === 'warning' ? '! ' : ''}{line.text}</Typography>
        ))}
        {item.reviewProbe?.at && <Typography variant="caption" color="text.secondary">Checked {new Date(item.reviewProbe.at).toLocaleString()}, signed out, with every address check.</Typography>}
      </Box>
      <Typography variant="caption" color="text.secondary">Check that the name is fair to whoever runs it, that its sign-in goes where you expect, and that it is not a look-alike.</Typography>
      {reviewing && <Box><Button size="small" variant="outlined" onClick={onCheck} disabled={checking} data-testid="integration-check-again">{checking ? 'Checking…' : 'Check again'}</Button></Box>}
    </Box>
  )
}
IntegrationCheck.propTypes = { item: PropTypes.object.isRequired, reviewing: PropTypes.bool, checking: PropTypes.bool, onCheck: PropTypes.func.isRequired }

ReviewPanel.propTypes = { slate: PropTypes.object, itemId: PropTypes.string, standalone: PropTypes.bool }
ReviewPanel.defaultProps = { slate: null, itemId: null, standalone: false }
