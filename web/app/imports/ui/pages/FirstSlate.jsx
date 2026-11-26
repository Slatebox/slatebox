// The signed-out "Create slate" first run (/new with no hash, before any slate exists): "What should
// your first slate do?", eight jobs, a second one-click question for five of them, their own words, or
// Skip. One call builds a real working board for the answer (methods/first-slate.js) and the canvas
// opens on it. The answer is remembered here (localStorage 'slatebox.start') and on the account, so the
// next "Create slate" opens a blank slate. Deep links: /new?job=<id> and /new?job=<id>&with=<id>.
// Under their own words, "Talk it through with Slatebox" (/new?talk=1) opens the use-case interview in place
// (components/start/StartInterview.jsx): the plan it ends with is kept as the person's own tile, shown
// under "Yours" (components/start/YourTiles.jsx) with Make another, Make a fresh version, Rename and
// Remove; For you's ideas follow as "Made for you" (personal/ForYou.jsx), then "Or start from a job" and
// the eight jobs. A member, or anyone who keeps tiles, comes back to it on "Create slate": it then asks what
// this slate should do, and keeps "Start with an empty slate" at the top.
// Theme tokens only; no timers; reduced motion turns the transitions off. Copy in lowercase prose.
import React, { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom'
import { useTracker } from 'meteor/react-meteor-data'
import { useSetAtom } from 'jotai'
import { Box, Button, ButtonBase, TextField, Typography } from '@mui/material'
import RocketLaunchOutlined from '@mui/icons-material/RocketLaunchOutlined'
import ViewKanbanOutlined from '@mui/icons-material/ViewKanbanOutlined'
import TrendingUpOutlined from '@mui/icons-material/TrendingUpOutlined'
import HandshakeOutlined from '@mui/icons-material/HandshakeOutlined'
import FormatQuoteOutlined from '@mui/icons-material/FormatQuoteOutlined'
import HistoryOutlined from '@mui/icons-material/HistoryOutlined'
import AccountBalanceWalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined'
import EventNoteOutlined from '@mui/icons-material/EventNoteOutlined'
import ForumOutlined from '@mui/icons-material/ForumOutlined'
import EmojiEventsOutlined from '@mui/icons-material/EmojiEventsOutlined'
import GroupsOutlined from '@mui/icons-material/GroupsOutlined'
import ChecklistOutlined from '@mui/icons-material/ChecklistOutlined'
import SpaOutlined from '@mui/icons-material/SpaOutlined'
import ArrowBack from '@mui/icons-material/ArrowBack'
import CONSTANTS from '../../api/common/constants'
import createAnonymousUser from '../../api/client/createAnonymousUser'
import { JOBS, STEP_TWO, STORAGE_KEY, asksStepTwo, buildingLine, firstSlatePlan, jobOf, startRecord, validWith } from '../../api/common/first-slate.mjs'
import { initialPrompt, createSlateWithAIContent } from '../jotai/atoms'
import SlateLoading from '../components/SlateLoading'
import StartInterview from '../components/start/StartInterview'
import YourTiles from '../components/start/YourTiles'
import ForYou from '../components/personal/ForYou'
import { tileBuildWords } from '../../api/common/personal-tiles.mjs'
import { sectionHeading, space } from '../common/AccountLayout'

// The start page's icon set: the eight jobs' and a few general ones (start-interview.mjs TILE_ICONS names them for the
// agent, which picks one for each tile it plans), and the talk's.
const icons = { ship: RocketLaunchOutlined, week: ViewKanbanOutlined, deals: TrendingUpOutlined, golive: HandshakeOutlined,
  feedback: FormatQuoteOutlined, lookback: HistoryOutlined, money: AccountBalanceWalletOutlined, plan: EventNoteOutlined,
  trophy: EmojiEventsOutlined, group: GroupsOutlined, checklist: ChecklistOutlined, leaf: SpaOutlined, talk: ForumOutlined }
// The card under their own words: the use-case interview, in place. Where no meter runs (a self-hosted server), a guest
// gets no agent turns, so the card says so and opens saving the account instead (server/start/meteor.js guestOnly).
const TALK = { id: 'talk', title: 'Talk it through with Slatebox', line: 'Say what you want to make. Slatebox asks a few questions, then builds it, and keeps it here for next time.' }
const TALK_SAVE_FIRST = 'Save your account to talk it through with Slatebox on this server.'
const T = CONSTANTS.methods.start.tiles
const reasonOf = (error, fallback) => error?.reason || error?.message || fallback
const still = { '@media (prefers-reduced-motion: reduce)': { transition: 'none', transform: 'none !important' } }
const ring = { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: '2px' }
// a card on the page (the talk's and each job's)
const cardSx = { display: 'flex', flexDirection: { xs: 'row', sm: 'column' }, alignItems: { xs: 'center', sm: 'flex-start' }, justifyContent: 'flex-start',
  gap: { xs: space.text, sm: space.group }, textAlign: 'left', minHeight: { xs: 64, sm: 176 }, p: { xs: space.text, sm: space.block },
  borderRadius: { xs: 3, sm: 4 }, border: 1, borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary',
  transition: 'border-color .15s, box-shadow .15s, transform .15s',
  '&:hover': { borderColor: 'primary.main', transform: 'translateY(-2px)',
    boxShadow: theme => (theme.palette.mode === 'dark' ? '0 12px 32px rgb(0 0 0 / 40%)' : '0 12px 32px rgb(25 53 41 / 12%)') },
  '&.Mui-focusVisible, &:focus-visible': ring, ...still }
const iconBox = { flex: 'none', display: 'grid', placeItems: 'center', width: { xs: 40, sm: 48 }, height: { xs: 40, sm: 48 }, borderRadius: 3, bgcolor: 'action.hover', color: 'primary.main' }
const cardTitle = { display: 'block', fontWeight: 700, fontSize: { xs: 16, sm: 19 }, lineHeight: 1.25, letterSpacing: '-.01em' }
const cardLine = { display: 'block', color: 'text.secondary', fontSize: { xs: 14, sm: 15 }, lineHeight: 1.45, mt: { xs: .25, sm: space.hair } }

/** The answer a deep link names: a job alone (step two, or straight to the board), or a job and its second answer. */
function linkedAnswer(params) {
  const job = params.get('job')
  if (!jobOf(job)) return null
  const withId = params.get('with')
  if (!asksStepTwo(job)) return { job }
  return withId && validWith(job, withId) ? { job, with: withId } : { job, ask: true }
}

/** The card on the next row down (dir 1) or up (dir -1), nearest across. */
function rowNeighbor(buttons, index, dir) {
  const me = buttons[index]
  if (!me) return index
  const place = buttons.map((button, i) => ({ i, top: button?.offsetTop ?? 0, left: button?.offsetLeft ?? 0 }))
  const beyond = place.filter(card => (dir > 0 ? card.top > me.offsetTop : card.top < me.offsetTop))
  if (!beyond.length) return index
  const top = dir > 0 ? Math.min(...beyond.map(card => card.top)) : Math.max(...beyond.map(card => card.top))
  return beyond.filter(card => card.top === top).reduce((best, card) => (Math.abs(card.left - me.offsetLeft) < Math.abs(best.left - me.offsetLeft) ? card : best)).i
}

/** Arrow keys move between the job cards as they are laid out (a grid of 4, 2 or 1 across). */
function roveCards(event, buttons, index, setActive) {
  const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const last = buttons.length - 1
  const next = { ArrowRight: index + 1, ArrowLeft: index - 1, ArrowDown: rowNeighbor(buttons, index, 1), ArrowUp: rowNeighbor(buttons, index, -1), Home: 0, End: last }[event.key]
  const to = Math.min(last, Math.max(0, next))
  setActive(to)
  buttons[to]?.focus()
}

export default function FirstSlate() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const setPrompt = useSetAtom(initialPrompt)
  const setAIContext = useSetAtom(createSlateWithAIContent)
  const linked = linkedAnswer(params)
  const stepJob = linked?.ask ? linked.job : null
  const talk = params.get('talk') === '1' && !linked
  // a member (not a guest), and whether a guest may talk here (only where the meter runs: the guest allowance)
  const member = useTracker(() => Meteor.user()?.isAnonymous === false, [])
  const talkNeedsAccount = !member && Meteor.settings.public?.metered !== true
  // the talk opened from the card is an entry of its own in history: its Back goes back to it, not to a second /new
  const pushedTalk = useRef(false)
  const [text, setText] = useState('')
  const [active, setActive] = useState(0)
  const [building, setBuilding] = useState(null)
  const [error, setError] = useState('')
  const cards = useRef([])
  const heading = useRef(null)
  const requests = useRef(new Map())
  const ran = useRef(false)
  const legendId = useId()
  const textId = useId()
  // The person's own tiles (start.tiles.list): a guest's too, once the guest exists.
  const [tiles, setTiles] = useState([])
  const [tileBusy, setTileBusy] = useState(null)
  const [tileError, setTileError] = useState('')
  const [tileErrorCode, setTileErrorCode] = useState(null)
  const loadTiles = useCallback(async () => {
    if (!Meteor.userId()) return
    try { setTiles((await Meteor.callAsync(T.list, {})).tiles) } catch { /* The page works without them. */ }
  }, [])
  useEffect(() => { loadTiles() }, [loadTiles])

  // Step two: focus moves to its question (the live region says "Step 2 of 2").
  useEffect(() => { if (stepJob && !building) heading.current?.focus() }, [stepJob, building])

  async function create(answer) {
    const plan = answer.via === 'text' ? null : firstSlatePlan(answer.via === 'skip' ? {} : answer)
    setError('')
    setBuilding(plan ? buildingLine(plan.title) : 'Building your board…')
    // The same answer, tried again, names the same request: the server makes its slate once.
    const key = JSON.stringify([answer.job, answer.with, answer.text, answer.via])
    if (!requests.current.has(key)) requests.current.set(key, Random.id())
    try {
      // The guest is made on the click: a visitor who leaves before choosing leaves nothing behind.
      if (!Meteor.userId()) await createAnonymousUser()
      const shareId = await Meteor.callAsync(CONSTANTS.methods.firstSlate.create, {
        job: answer.job ?? null, with: answer.with ?? null, text: answer.text ?? null, via: answer.via, requestId: requests.current.get(key),
      })
      if (!shareId) throw new Error('Missing share ID')
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(startRecord({ job: plan?.job, with: plan?.with, via: answer.via }))) } catch { /* Private browsing can block storage; the account remembers. */ }
      setPrompt('')
      setAIContext(null)
      navigate('/canvas/' + shareId, { replace: true })
    } catch (err) {
      setBuilding(null)
      setError(err?.reason || 'Could not open the board. Try again.')
      requests.current.lastAnswer = answer
    }
  }

  // A tile's slate: its first build (each board drafted), Make another (its kept boards, no model) or a fresh version.
  async function buildTile(tile, { fresh = false } = {}) {
    setTileError('')
    setTileErrorCode(null)
    setTileBusy(tile.id)
    setBuilding(tileBuildWords(tile, { fresh, repeat: !fresh && Boolean(tile.built) }).progress)
    try {
      const made = await Meteor.callAsync(fresh ? T.rebuild : T.build, { tileId: tile.id })
      setPrompt('')
      setAIContext(null)
      navigate('/canvas/' + made.shareId)
    } catch (err) {
      setBuilding(null)
      setTileBusy(null)
      setTileError(reasonOf(err, 'That could not be built just now. Try again.'))
      setTileErrorCode(err?.error || null)
      // the talk's plan is kept under Yours: the page shows it there, with what went wrong
      if (talk) closeTalk()
      loadTiles()
    }
  }
  const renameTile = async (tile, title) => {
    const renamed = await Meteor.callAsync(T.rename, { tileId: tile.id, title })
    setTiles(all => all.map(item => (item.id === renamed.id ? renamed : item)))
  }
  const removeTile = async (tile) => {
    setTileError('')
    try {
      await Meteor.callAsync(T.remove, { tileId: tile.id })
      // (YourTiles moves focus to the next tile)
      setTiles(all => all.filter(item => item.id !== tile.id))
    } catch (err) {
      setTileError(reasonOf(err, 'That could not be changed. Try again.'))
    }
  }

  // A deep link runs its steps by itself, once.
  useEffect(() => {
    if (ran.current || !linked || linked.ask) return
    ran.current = true
    create({ ...linked, via: 'deeplink' })
  }, [])

  // Step two takes the place of step one in history (its Back button returns to step one): the board then
  // replaces that one entry, so the browser's Back from the board never lands on /new again, where a
  // visitor who has answered would get a new, empty slate.
  const pick = job => {
    if (asksStepTwo(job.id)) setParams({ job: job.id }, { replace: true })
    else create({ job: job.id, via: 'card' })
  }
  // the talk opens in place, as an entry of its own: the browser's Back closes it, and so does its own Back
  const openTalk = () => {
    if (talkNeedsAccount) { navigate('/signup'); return }
    pushedTalk.current = true
    setParams({ talk: '1' })
  }
  function closeTalk() {
    if (pushedTalk.current) { pushedTalk.current = false; navigate(-1) }
    else setParams({}, { replace: true })
  }
  const skip = () => create({ via: 'skip' })
  // An empty slate, chosen: remembered in this browser, so the next "Create slate" doesn't ask again.
  const startEmpty = to => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(startRecord({ via: 'empty' }))) } catch { /* Asked again next time. */ }
    navigate(to, { replace: true })
  }
  const submitText = event => {
    event?.preventDefault()
    if (text.trim()) create({ text: text.trim(), via: 'text' })
  }

  if (building) return <Box component="main"><SlateLoading label={building} /></Box>
  if (error) return <Box component="main" sx={{ minHeight: '100svh', bgcolor: 'background.default', color: 'text.primary', p: 3,
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, textAlign: 'center' }}>
    <Typography role="alert" sx={{ fontSize: 17 }}>{error}</Typography>
    <Button variant="contained" disableElevation sx={{ borderRadius: 6, px: 3, minHeight: 48 }}
      onClick={() => { const again = requests.current.lastAnswer; setError(''); if (again) create(again) }}>Try again</Button>
  </Box>

  const skipButton = <Button onClick={skip} sx={{ minHeight: 48, px: 2, borderRadius: 6, textTransform: 'none', fontWeight: 600, color: 'text.secondary', '&:focus-visible': ring }}>Skip</Button>
  const page = { minHeight: '100svh', bgcolor: 'background.default', color: 'text.primary', boxSizing: 'border-box',
    px: { xs: space.group, sm: space.block, md: space.page }, py: { xs: space.block, md: space.page } }
  const column = { maxWidth: 1120, mx: 'auto' }

  if (talk) {
    return <Box component="main" sx={page}>
      <Box sx={{ ...column, maxWidth: 760 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: space.block }}>
          <Button startIcon={<ArrowBack />} onClick={closeTalk} sx={{ minHeight: 48, borderRadius: 6, textTransform: 'none', fontWeight: 600, '&:focus-visible': ring }}>Back</Button>
          {skipButton}
        </Box>
        {/* the talk's own visible title is this view's h1 (StartInterview's ConversationPanel) */}
        <StartInterview onPlanned={loadTiles} onBuild={tile => buildTile(tile)} onClose={closeTalk} building={tileBusy} />
      </Box>
    </Box>
  }

  if (stepJob) {
    const job = jobOf(stepJob)
    const ask = STEP_TWO[stepJob]
    const Icon = icons[stepJob]
    return <Box component="main" sx={page}>
      <Box sx={column}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: space.section }}>
          <Button startIcon={<ArrowBack />} onClick={() => setParams({}, { replace: true })} sx={{ minHeight: 48, borderRadius: 6, textTransform: 'none', fontWeight: 600, '&:focus-visible': ring }}>Back</Button>
          {skipButton}
        </Box>
        <Typography role="status" aria-live="polite" variant="body2" sx={{ color: 'text.secondary', mb: space.tight }}>Step 2 of 2</Typography>
        <Box component="fieldset" sx={{ border: 0, p: 0, m: 0, minWidth: 0 }} aria-labelledby={legendId}>
          <Box component="legend" sx={{ p: 0, width: '100%' }}>
            <Typography id={legendId} ref={heading} tabIndex={-1} component="h2" variant="h3"
              sx={{ fontWeight: 800, letterSpacing: '-.03em', fontSize: { xs: 32, sm: 44 }, outline: 'none' }}>{ask.question}</Typography>
          </Box>
          <Typography sx={{ color: 'text.secondary', mt: space.tight, mb: space.section, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Icon fontSize="small" aria-hidden="true" />{job.title}
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: space.text }}>
            {ask.chips.map(chip => <Button key={chip.id} variant="outlined" data-first-chip={chip.id} onClick={() => create({ job: stepJob, with: chip.id, via: 'card' })}
              sx={{ minHeight: 56, px: 3, borderRadius: 7, textTransform: 'none', fontSize: 18, fontWeight: 600, borderWidth: 2, color: 'text.primary', borderColor: 'divider',
                transition: 'border-color .15s, transform .15s', '&:hover': { borderWidth: 2, borderColor: 'primary.main', transform: 'translateY(-1px)' }, '&:focus-visible': ring, ...still }}>{chip.label}</Button>)}
          </Box>
        </Box>
      </Box>
    </Box>
  }

  // Someone coming back (a member, or anyone who keeps tiles here) is asked about this slate, not a first one.
  const returning = member || tiles.length > 0
  const TalkIcon = icons.talk
  const talkLine = talkNeedsAccount ? TALK_SAVE_FIRST : TALK.line
  return <Box component="main" sx={page}>
    <Box sx={column}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', flexWrap: 'wrap', gap: space.tight, mb: { xs: space.tight, md: space.group } }}>
        {returning && <Button variant="text" onClick={() => startEmpty('/new?empty=1')} data-start-empty-top=""
          sx={{ minHeight: 48, px: 2, borderRadius: 6, textTransform: 'none', fontWeight: 600, color: 'text.secondary', '&:focus-visible': ring }}>Start with an empty slate</Button>}
        {skipButton}
      </Box>
      <Typography component="h1" variant="h2"
        sx={{ fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.05, fontSize: { xs: 34, sm: 48, md: 60 } }}>{returning ? 'What should this slate do?' : 'What should your first slate do?'}</Typography>
      <Typography sx={{ color: 'text.secondary', fontSize: { xs: 17, sm: 20 }, mt: space.text, maxWidth: 640 }}>
        {returning ? 'Pick one and it opens as a working board you can change.' : 'Pick one and it opens as a working board you can change. No account needed.'}
      </Typography>

      <Box component="form" onSubmit={submitText} sx={{ display: 'flex', gap: space.tight, alignItems: 'flex-end', mt: space.section, mb: space.block, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
        <TextField id={textId} label="Or say it in your own words" value={text} onChange={event => setText(event.target.value)} fullWidth multiline maxRows={4}
          placeholder="e.g. Plan a launch for day 20: Design 4 days, Build 8 days after Design, QA 3 days after Build"
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) submitText(event) }}
          slotProps={{ htmlInput: { enterKeyHint: 'go', maxLength: 1200, 'data-first-text': '' } }}
          sx={{ '& .MuiInputBase-root': { minHeight: 56, borderRadius: 3 } }} />
        <Button type="submit" variant="contained" disableElevation disabled={!text.trim()}
          sx={{ minHeight: 56, px: 3, borderRadius: 7, textTransform: 'none', fontWeight: 700, fontSize: 16, flex: 'none', width: { xs: '100%', sm: 'auto' }, '&:focus-visible': ring }}>Make it</Button>
      </Box>

      {/* the talk: its own card, right under their own words, not one of the jobs */}
      <ButtonBase data-start-talk="" onClick={openTalk} aria-label={TALK.title + '. ' + talkLine}
        sx={{ ...cardSx, width: '100%', flexDirection: 'row', alignItems: 'center', minHeight: { xs: 64, sm: 112 }, mb: space.section }}>
        <Box aria-hidden="true" sx={iconBox}><TalkIcon /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography component="span" sx={cardTitle}>{TALK.title}</Typography>
          <Typography component="span" sx={cardLine}>{talkLine}</Typography>
        </Box>
      </ButtonBase>

      <YourTiles tiles={tiles} icons={icons} busy={Boolean(tileBusy)} error={tileError}
        onBuild={tile => buildTile(tile)} onRebuild={tile => buildTile(tile, { fresh: true })} onRename={renameTile} onRemove={removeTile} />
      {!tiles.length && tileError && <Typography role="alert" sx={{ color: 'error.main', mb: space.group }}>{tileError}</Typography>}
      {/* a guest's build refused (today's free build used, or no guest allowance here): the way on is saving the account */}
      {tileError && tileErrorCode === 'guest' && <Box sx={{ mb: space.group }}><Button size="small" variant="outlined" component={RouterLink} to="/signup" data-start-save-account="">Save your account</Button></Box>}
      <ForYou variant="start" />

      <Box component="section" aria-labelledby={legendId}>
        <Typography id={legendId} component="h2" sx={{ ...sectionHeading, mb: space.text }}>{tiles.length ? 'Or start from a job' : 'Start from a job'}</Typography>
        <Box role="group" aria-labelledby={legendId} sx={{ display: 'grid', gap: { xs: space.tight, sm: space.text },
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
          {JOBS.map((job, index) => {
            const Icon = icons[job.id]
            return <ButtonBase key={job.id} data-first-job={job.id} ref={node => { cards.current[index] = node }} tabIndex={index === active ? 0 : -1}
              onFocus={() => setActive(index)} onKeyDown={event => roveCards(event, cards.current, index, setActive)} onClick={() => pick(job)}
              aria-label={job.title + '. ' + job.line}
              sx={cardSx}>
              <Box aria-hidden="true" sx={iconBox}><Icon /></Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography component="span" sx={cardTitle}>{job.title}</Typography>
                <Typography component="span" sx={cardLine}>{job.line}</Typography>
              </Box>
            </ButtonBase>
          })}
        </Box>
      </Box>

      <Box component="nav" aria-label="Other ways to start" sx={{ display: 'flex', flexWrap: 'wrap', gap: space.block, mt: space.section }}>
        <Button variant="text" onClick={() => startEmpty('/new?empty=1')} sx={{ minHeight: 48, textTransform: 'none', color: 'text.secondary', '&:focus-visible': ring }}>Start with an empty slate</Button>
        <Button variant="text" onClick={() => startEmpty('/new?empty=1&library=1')} sx={{ minHeight: 48, textTransform: 'none', color: 'text.secondary', '&:focus-visible': ring }}>Browse all boards</Button>
      </Box>
    </Box>
  </Box>
}
