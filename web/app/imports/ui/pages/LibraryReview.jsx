import React from 'react'
import { useNavigate, Link as RouterLink } from 'react-router-dom'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Tab from '@mui/material/Tab'
import Typography from '@mui/material/Typography'
import Alert from '@mui/material/Alert'
import Dialog from '@mui/material/Dialog'
import DialogTitle from '@mui/material/DialogTitle'
import DialogContent from '@mui/material/DialogContent'
import DialogActions from '@mui/material/DialogActions'
import TextField from '@mui/material/TextField'
import { AccountTabs, FinePrint, SPACE } from '../common/AccountLayout'
import AppPage from '../common/AppPage'
import LibraryPreview from '../components/library/LibraryPreview'
import libraryApi from '../../api/client/library'
import { categoryLabel } from '../../api/common/library-model.mjs'
import { KIND_FILTERS, KindTitle, QUEUE_TABS, waitedFor } from '../components/library/libraryCopy.mjs'

// The review queue (administrators only: /admin/library). Everything people send to the library
// waits here: smart components, slates and presentations. Open one to review it on a canvas of
// its own, refine it with AI, then approve and publish it, ask for changes, or turn it down.
export default function LibraryReview() {
  const navigate = useNavigate()
  const [tab, setTab] = React.useState('waiting')
  const [kind, setKind] = React.useState('')
  const [migrated, setMigrated] = React.useState(false)
  const [answer, setAnswer] = React.useState(null)
  const [problem, setProblem] = React.useState('')
  const [busy, setBusy] = React.useState(null)
  const [unpublishing, setUnpublishing] = React.useState(null)
  const [reason, setReason] = React.useState('')
  const [refresh, setRefresh] = React.useState(0)

  React.useEffect(() => {
    let live = true
    setAnswer(null)
    setProblem('')
    libraryApi.review.queue({ status: tab, ...(kind && { kind }), ...(migrated && { source: 'migration' }) })
      .then((next) => { if (live) setAnswer(next) })
      .catch((error) => { if (live) { setAnswer({ items: [], total: 0 }); setProblem(error?.reason || 'The queue could not be read.') } })
    return () => { live = false }
  }, [tab, kind, migrated, refresh])

  const [ownItem, setOwnItem] = React.useState(null)
  async function open(item, { selfReview = false } = {}) {
    setBusy(item.id)
    setProblem('')
    setOwnItem(null)
    try {
      const opened = await libraryApi.review.open({ itemId: item.id, ...(selfReview && { selfReview: true }) })
      navigate(`/canvas/${opened.reviewShareId}`)
    } catch (error) {
      // Your own submission: another administrator reviews it, unless you are the only one.
      if (error?.error === 'self_review' && !selfReview) setOwnItem(item)
      setProblem(error?.reason || 'It could not be opened for review.')
      setBusy(null)
    }
  }

  // "Approve all shown" for the moved community slates: each is opened and approved on its own,
  // so each writes its own approval in its thread.
  async function approveAll() {
    const rows = answer?.items || []
    setBusy('all')
    setProblem('')
    let done = 0
    for (const item of rows) {
      try {
        await libraryApi.review.open({ itemId: item.id })
        await libraryApi.review.approve({ itemId: item.id, message: 'Approved with the other slates moved from Community slates.' })
        done += 1
      } catch (error) {
        setProblem(`${item.title}: ${error?.reason || 'not approved'}`)
      }
    }
    setBusy(null)
    setProblem((now) => now || `${done} approved.`)
    setRefresh((n) => n + 1)
  }

  async function unpublish() {
    if (!unpublishing || !reason.trim()) return
    setBusy(unpublishing.id)
    try {
      await libraryApi.review.unpublish({ itemId: unpublishing.id, message: reason.trim() })
      setUnpublishing(null)
      setReason('')
      setRefresh((n) => n + 1)
    } catch (error) {
      setProblem(error?.reason || 'It could not be taken out.')
    } finally {
      setBusy(null)
    }
  }

  const items = answer?.items || []
  return (
    <AppPage title="Library review"
      eyebrow={<Button component={RouterLink} to="/admin" size="small" sx={{ px: 0, minWidth: 0 }} data-admin-back="">Server admin</Button>}
      subtitle="What people sent to the library. Nothing is public until you approve it.">
      <AccountTabs value={tab} onChange={(_event, next) => setTab(next)} aria-label="Queue">
        {QUEUE_TABS.map((entry) => <Tab key={entry.id} value={entry.id} label={entry.label} data-testid={`queue-tab-${entry.id}`} />)}
      </AccountTabs>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: SPACE.group }} role="group" aria-label="Kind">
        {KIND_FILTERS.map((entry) => (
          <Chip key={entry.id || 'all'} label={entry.label} clickable color={kind === entry.id ? 'primary' : 'default'}
            variant={kind === entry.id ? 'filled' : 'outlined'} onClick={() => setKind(entry.id)} aria-pressed={kind === entry.id} />
        ))}
        <Chip label="From Community slates" clickable color={migrated ? 'secondary' : 'default'} variant={migrated ? 'filled' : 'outlined'}
          onClick={() => setMigrated((now) => !now)} aria-pressed={migrated} />
      </Box>
      {migrated && tab === 'waiting' && items.length > 0 && (
        <Box sx={{ mt: SPACE.text }}>
          <Button variant="outlined" onClick={approveAll} disabled={busy !== null}>Approve all shown ({items.length})</Button>
        </Box>
      )}
      {problem && <Alert severity={/approved\.$/.test(problem) ? 'success' : 'error'} sx={{ mt: SPACE.text }} role="status"
        action={ownItem && <Button color="inherit" size="small" onClick={() => open(ownItem, { selfReview: true })} data-testid="self-review-open">Review it myself</Button>}>{problem}</Alert>}
      <Box component="ul" data-testid="queue-list" sx={{ listStyle: 'none', p: 0, m: 0, mt: SPACE.block, display: 'grid', gap: SPACE.group }}>
        {answer === null && <Typography component="li" color="text.secondary">Loading…</Typography>}
        {answer && items.length === 0 && <Typography component="li" color="text.secondary">Nothing here.</Typography>}
        {items.map((item) => (
          <Box component="li" key={item.id} data-testid="queue-row"
            sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' }, gap: SPACE.group, p: SPACE.text, border: 1, borderColor: 'divider', borderRadius: 1 }}>
            <LibraryPreview itemId={item.id} title={item.title} height={110} />
            <Box sx={{ minWidth: 0, display: 'grid', gap: SPACE.hair, alignContent: 'start' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>{item.pendingMeta?.title || item.title}</Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center' }}>
                <Chip size="small" label={KindTitle(item.kind)} />
                {item.category && <Chip size="small" variant="outlined" label={categoryLabel(item.category)} />}
                {item.isUpdate && <Chip size="small" color="info" label="Update to a published item" />}
                {item.migrated && <Chip size="small" variant="outlined" label="From Community slates" />}
              </Box>
              <Typography variant="body2" color="text.secondary">
                {item.authorName}{item.waitingMs !== undefined && tab !== 'published' ? ` · waiting ${waitedFor(item.waitingMs)}` : ''}
                {item.provenance?.branchedFrom ? ` · branched from ${item.provenance.branchedFrom.title}` : ''}
                {item.provenance?.forkedFrom ? ` · based on ${item.provenance.forkedFrom.title}` : ''}
              </Typography>
              <Typography variant="body2">{item.pendingMeta?.summary || item.summary}</Typography>
              {item.lastMessage && (
                <FinePrint>{item.lastMessage.by === 'reviewer' ? 'You' : 'Author'}: {item.lastMessage.text}</FinePrint>
              )}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, pt: SPACE.hair }}>
                {['waiting', 'in_review'].includes(tab) && (
                  <Button variant="contained" size="small" onClick={() => open(item)} disabled={busy !== null} data-testid="queue-open">
                    {item.reviewStatus === 'in_review' || item.status === 'in_review' ? 'Continue the review' : 'Open for review'}
                  </Button>
                )}
                {tab === 'published' && <>
                  <Button size="small" component={RouterLink} to={`/library/${item.slug}`}>See it in the library</Button>
                  <Button size="small" color="error" onClick={() => setUnpublishing(item)} disabled={busy !== null}>Unpublish</Button>
                </>}
              </Box>
            </Box>
          </Box>
        ))}
      </Box>
      <Dialog open={Boolean(unpublishing)} onClose={() => setUnpublishing(null)} fullWidth maxWidth="xs">
        <DialogTitle>Take “{unpublishing?.title}” out of the library?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ mb: 2 }}>Copies people already made stay theirs. The author is told why.</Typography>
          <TextField label="Why" value={reason} onChange={(event) => setReason(event.target.value)} multiline minRows={2} fullWidth autoFocus />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUnpublishing(null)}>Keep it</Button>
          <Button color="error" variant="contained" onClick={unpublish} disabled={!reason.trim() || busy !== null}>Unpublish</Button>
        </DialogActions>
      </Dialog>
    </AppPage>
  )
}
