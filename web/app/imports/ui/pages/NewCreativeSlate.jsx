import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useTracker } from 'meteor/react-meteor-data'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Box, Button, Typography } from '@mui/material'
import { readWorkshopFragment } from '../../api/common/portableWorkshopSlate.mjs'
import { createBudgetWorkshop, encodeWorkshopFragment } from 'slateboxjs/workshops/model'
import { rememberLegacyWorkshop, readStoredWorkshop } from '../../api/common/legacy-workshop-entry.mjs'
import { mapFromQuestion } from '../../api/common/map-direct-edits.mjs'
import { readCreationBrief } from '../../api/common/native-diagram-brief.mjs'
import { readTeamMapBrief, workshopFromTeamBrief } from '../../api/common/team-map-brief.mjs'
import createAnonymousUser from '../../api/client/createAnonymousUser'
import { creativeSlates, nativeSlateStarters } from '../../api/common/creativeSlates.mjs'
import { BOARD_SAMPLES, boardInLink, loadBoardRoute } from '../../api/common/board-routes.mjs'

export default function NewCreativeSlate({fromBrief = false}) {
  const { creativeKind: legacyKind } = useParams()
  const { search, hash, state } = useLocation()
  const creation = useMemo(() => {
    if (!fromBrief) return null
    try { return readCreationBrief(hash) } catch (error) { return {error:error.message} }
  }, [fromBrief, hash])
  const routeKind = fromBrief ? (creation?.play ? 'map' : 'diagram') : legacyKind
  const newMap = routeKind === 'map'
  const pilotBudget = routeKind === 'pilot-budget'
  const boardRoute = Object.hasOwn(BOARD_SAMPLES, routeKind ?? '') ? routeKind : null
  const creativeKind = newMap || pilotBudget || boardRoute ? 'workshop' : routeKind
  // A business board's rules load before its model is read (they are not in the model a plain slate loads).
  const needsRules = Boolean(boardRoute || (creativeKind === 'workshop' && hash && boardInLink(hash)))
  const [rules, setRules] = useState(null)
  useEffect(() => {
    if (!needsRules || rules) return undefined
    let gone = false
    // The board's rules and its rulebook's module (board-routes.mjs), before its model is read.
    loadBoardRoute(boardRoute)
      .then(loaded => { if (!gone) setRules(loaded) }).catch(() => { if (!gone) setError('Could not open this slate.') })
    return () => { gone = true }
  }, [needsRules, rules, boardRoute])
  const waiting = needsRules && !rules
  const starterMap = useMemo(() => {
    if (creation?.play) {
      try {
        const words = creation.brief.replaceAll('->', '→').replace(/\s+/g, ' ')
        const workshop = words.length <= 160 ? workshopFromTeamBrief(words) : mapFromQuestion(words)
        return { fragment: encodeWorkshopFragment(workshop), brief: creation.brief }
      }
      catch { return {invalid:true} }
    }
    if (pilotBudget) return hash ? { invalid: true } : { fragment: encodeWorkshopFragment(createBudgetWorkshop()) }
    if (boardRoute) return hash ? { invalid: true } : rules ? { fragment: encodeWorkshopFragment(rules[BOARD_SAMPLES[boardRoute]]()) } : null
    if (!newMap) return null
    try { return readTeamMapBrief(hash) } catch { return { invalid: true } }
  }, [newMap, pilotBudget, boardRoute, rules, hash, creation])
  const starter = nativeSlateStarters.get(creativeKind)
  const readsFragment = Boolean(starter?.readFragment || creativeKind === 'workshop')
  const localWorkshop = creativeKind === 'workshop' && !newMap && !pilotBudget && !boardRoute && !hash && typeof state?.localWorkshop === 'string'
  const data = localWorkshop ? state.localWorkshop : starterMap?.fragment ?? (readsFragment ? hash : starter ? '' : search)
  const navigate = useNavigate()
  const loggingIn = useTracker(() => Meteor.loggingIn(), [])
  const request = useRef(null)
  const [retry, setRetry] = useState(0)
  const [error, setError] = useState('')
  const title = creativeSlates.get(creativeKind)?.title ?? starter?.source.options.name
  const invalidLink = useMemo(() => {
    if (waiting) return false
    if (creation?.error || starterMap?.invalid) return true
    const read = localWorkshop ? readStoredWorkshop : starter?.readFragment ?? (creativeKind === 'workshop' ? readWorkshopFragment : null)
    if (!read) return false
    try { read(data); return false }
    catch { return true }
  }, [creativeKind, data, starter, hash, starterMap, localWorkshop, creation, waiting])
  useEffect(() => {
    if (!title || loggingIn || invalidLink || waiting) return undefined
    let active = true
    setError('')
    const key = creativeKind + data
    if (request.current?.key !== key) {
      const previous = window.history.state || {}
      const id = previous.creativeRequest?.key === key ? previous.creativeRequest.id : Random.id()
      window.history.replaceState({ ...previous, creativeRequest: { key, id } }, '')
      const promise = (async () => {
        if (!Meteor.userId()) await createAnonymousUser()
        return Meteor.callAsync('creativeSlates.create', creativeKind, data, id)
      })()
      request.current = { key, promise }
    }
    request.current.promise.then(shareId => {
      if (!active) return
      if (state?.legacyWorkshop) {
        try { rememberLegacyWorkshop({source:state.legacyWorkshop,data,shareId,owner:Meteor.userId(),storage:sessionStorage}) } catch { /* The original draft and new slate remain available. */ }
      }
      const budgetBrief = creation?.source === 'pilot-budget' && creation.brief
      const opening = starterMap?.brief || budgetBrief
      if (opening) {
        const historyKey = (budgetBrief ? 'slatebox-workshop-studio:' : 'slatebox-map-studio:') + Meteor.userId() + ':' + shareId
        try {
          if (!localStorage.getItem(historyKey)) localStorage.setItem(historyKey, JSON.stringify([
            { role: 'user', content: opening },
            { role: 'assistant', content: budgetBrief ? 'Move an allocation to compare what the team can fund.' : opening.includes('→') ? 'The steps are connected. What should happen if someone takes a different path?' : 'Which two paths should your team be able to take? You can write both choices in one message, like “Approve now or request a review”.' },
          ]))
        } catch { /* The drawing is saved independently of the local conversation. */ }
      }
      navigate('/canvas/' + shareId, { replace: true })
    }).catch(() => { if (active) setError('Could not open this slate.') })
    return () => { active = false }
  }, [creativeKind, title, data, invalidLink, loggingIn, navigate, retry, starterMap, state, creation, waiting])

  return <Box component="main" sx={{ p: 4 }}>
    {!title ? <><Typography>That slate could not be found.</Typography><Button component={Link} to="/start">Start a slate</Button></> :
      invalidLink && fromBrief ? <><Typography role="alert">{creation?.error || 'This brief could not be opened. Check the question and try again.'}</Typography><Button component={Link} to="/new">Create slate</Button></> :
      invalidLink && newMap ? <><Typography role="alert">This brief could not be opened. Use up to 160 plain-text characters, or a path of two to five distinct steps.</Typography>
        <Button component={Link} to="/new">Create slate</Button></> :
      invalidLink && starter ? <><Typography role="alert">{creativeKind === 'incident-timeline' ? 'This timeline link contains invalid notes.' : 'This slate link contains invalid notes.'}</Typography>
        <Button component={Link} to={'/new/' + creativeKind}>{creativeKind === 'incident-timeline' ? 'Open the original timeline' : 'Open the original slate'}</Button></> :
      invalidLink ? <><Typography role="alert">This workshop link is incomplete or contains an invalid model.</Typography>
        <Button component={Link} to="/workshops">Open the workshop builder</Button></> :
      error ? <><Typography role="alert">{error}</Typography><Button onClick={() => {
        request.current = null
        setError('')
        setRetry(previous => previous + 1)
      }}>Try again</Button></> : <Typography role="status">Opening your {title.toLowerCase()}…</Typography>}
  </Box>
}
