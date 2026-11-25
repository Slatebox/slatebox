// The signed-out "Create slate" first run (/new with no hash, before any slate exists): "What should
// your first slate do?", eight jobs, a second one-click question for five of them, their own words, or
// Skip. One call builds a real working board for the answer (methods/first-slate.js) and the canvas
// opens on it. The answer is remembered here (localStorage 'slatebox.start') and on the account, so the
// next "Create slate" opens a blank slate. Deep links: /new?job=<id> and /new?job=<id>&with=<id>.
// Theme tokens only; no timers; reduced motion turns the transitions off. Copy in lowercase prose.
import React, { useEffect, useId, useRef, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useNavigate, useSearchParams } from 'react-router-dom'
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
import ArrowBack from '@mui/icons-material/ArrowBack'
import CONSTANTS from '../../api/common/constants'
import createAnonymousUser from '../../api/client/createAnonymousUser'
import { JOBS, STEP_TWO, STORAGE_KEY, asksStepTwo, buildingLine, firstSlatePlan, jobOf, startRecord, validWith } from '../../api/common/first-slate.mjs'
import { initialPrompt, createSlateWithAIContent } from '../jotai/atoms'
import SlateLoading from '../components/SlateLoading'
import { space } from '../common/AccountLayout'

const icons = { ship: RocketLaunchOutlined, week: ViewKanbanOutlined, deals: TrendingUpOutlined, golive: HandshakeOutlined,
  feedback: FormatQuoteOutlined, lookback: HistoryOutlined, money: AccountBalanceWalletOutlined, plan: EventNoteOutlined }
const still = { '@media (prefers-reduced-motion: reduce)': { transition: 'none', transform: 'none !important' } }
const ring = { outline: '3px solid', outlineColor: 'primary.main', outlineOffset: '2px' }

/** The answer a deep link names: a job alone (step two, or straight to the board), or a job and its second answer. */
function linkedAnswer(params) {
  const job = params.get('job')
  if (!jobOf(job)) return null
  const withId = params.get('with')
  if (!asksStepTwo(job)) return { job }
  return withId && validWith(job, withId) ? { job, with: withId } : { job, ask: true }
}

/** Arrow keys move between the cards as they are laid out (a grid of 4, 2 or 1 across). */
function roveCards(event, buttons, index, setActive) {
  const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  event.preventDefault()
  const tops = buttons.map(button => button?.offsetTop ?? 0)
  const across = Math.max(1, tops.filter(top => top === tops[0]).length)
  const last = buttons.length - 1
  const next = { ArrowRight: index + 1, ArrowLeft: index - 1, ArrowDown: index + across, ArrowUp: index - across, Home: 0, End: last }[event.key]
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

  // A deep link runs its steps by itself, once.
  useEffect(() => {
    if (ran.current || !linked || linked.ask) return
    ran.current = true
    create({ ...linked, via: 'deeplink' })
  }, [])

  const pick = job => {
    if (asksStepTwo(job.id)) setParams({ job: job.id })
    else create({ job: job.id, via: 'card' })
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

  if (stepJob) {
    const job = jobOf(stepJob)
    const ask = STEP_TWO[stepJob]
    const Icon = icons[stepJob]
    return <Box component="main" sx={page}>
      <Box sx={column}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: space.section }}>
          <Button startIcon={<ArrowBack />} onClick={() => setParams({})} sx={{ minHeight: 48, borderRadius: 6, textTransform: 'none', fontWeight: 600, '&:focus-visible': ring }}>Back</Button>
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

  return <Box component="main" sx={page}>
    <Box sx={column}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: { xs: space.tight, md: space.group } }}>{skipButton}</Box>
      <Box component="fieldset" aria-labelledby={legendId} sx={{ border: 0, p: 0, m: 0, minWidth: 0 }}>
        <Box component="legend" sx={{ p: 0, width: '100%' }}>
          <Typography id={legendId} component="h1" variant="h2"
            sx={{ fontWeight: 800, letterSpacing: '-.035em', lineHeight: 1.05, fontSize: { xs: 34, sm: 48, md: 60 } }}>What should your first slate do?</Typography>
        </Box>
        <Typography sx={{ color: 'text.secondary', fontSize: { xs: 17, sm: 20 }, mt: space.text, maxWidth: 640 }}>
          Pick one and it opens as a working board you can change. No account needed.
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

        <Box role="group" aria-label="Pick a job" sx={{ display: 'grid', gap: { xs: space.tight, sm: space.text },
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' } }}>
          {JOBS.map((job, index) => {
            const Icon = icons[job.id]
            return <ButtonBase key={job.id} data-first-job={job.id} ref={node => { cards.current[index] = node }} tabIndex={index === active ? 0 : -1}
              onFocus={() => setActive(index)} onKeyDown={event => roveCards(event, cards.current, index, setActive)} onClick={() => pick(job)}
              aria-label={job.title + '. ' + job.line}
              sx={{ display: 'flex', flexDirection: { xs: 'row', sm: 'column' }, alignItems: { xs: 'center', sm: 'flex-start' }, justifyContent: 'flex-start',
                gap: { xs: space.text, sm: space.group }, textAlign: 'left', minHeight: { xs: 64, sm: 176 }, p: { xs: space.text, sm: space.block },
                borderRadius: { xs: 3, sm: 4 }, border: 1, borderColor: 'divider', bgcolor: 'background.paper', color: 'text.primary',
                transition: 'border-color .15s, box-shadow .15s, transform .15s',
                '&:hover': { borderColor: 'primary.main', transform: 'translateY(-2px)',
                  boxShadow: theme => (theme.palette.mode === 'dark' ? '0 12px 32px rgb(0 0 0 / 40%)' : '0 12px 32px rgb(25 53 41 / 12%)') },
                '&.Mui-focusVisible, &:focus-visible': ring, ...still }}>
              <Box aria-hidden="true" sx={{ flex: 'none', display: 'grid', placeItems: 'center', width: { xs: 40, sm: 48 }, height: { xs: 40, sm: 48 }, borderRadius: 3,
                bgcolor: 'action.hover', color: 'primary.main' }}><Icon /></Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography component="span" sx={{ display: 'block', fontWeight: 700, fontSize: { xs: 16, sm: 19 }, lineHeight: 1.25, letterSpacing: '-.01em' }}>{job.title}</Typography>
                <Typography component="span" sx={{ display: 'block', color: 'text.secondary', fontSize: { xs: 14, sm: 15 }, lineHeight: 1.45, mt: { xs: .25, sm: space.hair } }}>{job.line}</Typography>
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
