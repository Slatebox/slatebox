import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { useTracker } from 'meteor/react-meteor-data'
import { Link, useNavigate } from 'react-router-dom'
import { useColorScheme } from '@mui/material/styles'
import { WorkshopBoard } from 'slateboxjs/workshops'
import { WorkshopRooms } from '../../api/common/workshopRooms'
import BrandBar from '../common/BrandBar'

// This room page still draws its board with the Dragology renderer, whose SVG width is its
// coordinate system. Zoom the drawing uniformly so pointer hit testing keeps the same geometry
// on smaller screens.
function WorkshopBoardSurface({ value, ...props }) {
  const host = useRef(null)
  const fitLanes = value.lanes.length === 2 && !value.kind && !value.lanes[0].station
  useLayoutEffect(() => {
    const container = host.current
    if (fitLanes) {
      container.style.removeProperty('--board-scale')
      return undefined
    }
    function fit() {
      const svg = container.querySelector('svg')
      const width = Number(svg?.getAttribute('width'))
      if (width) container.style.setProperty('--board-scale', String(Math.min(1, Math.max(.6, container.clientWidth / width))))
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(container)
    return () => observer.disconnect()
  }, [value, fitLanes])
  return <div ref={host} className="workshop-drawing"><WorkshopBoard fitLanes={fitLanes} value={value} {...props} /></div>
}

export default function SharedWorkshopRoom({ shareId }) {
  const navigate = useNavigate()
  const { mode, systemMode } = useColorScheme()
  const { room, ready, userId, anonymous } = useTracker(() => {
    const subscription = Meteor.subscribe('workshops.room', shareId)
    return { room: WorkshopRooms.findOne(shareId), ready: subscription.ready(), userId: Meteor.userId(), anonymous: Meteor.user()?.isAnonymous }
  }, [shareId])
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [level, setLevel] = useState('READ')
  const copyRequest = useRef(null)
  const available = Boolean(room)
  useEffect(() => {
    if (!available) setMessage('')
  }, [available])
  async function action(fn) {
    if (pending) return
    setPending(true)
    setMessage('')
    try { await fn() } catch (error) { setMessage(error.reason || error.message || 'Please try again.') }
    finally { setPending(false) }
  }
  function move(next, intent) {
    if (!room.canEdit) return
    // Older engines report the changed model for one-card moves.
    const changed = !intent && next.cards.find((card, i) => card.laneId !== room.model.cards[i]?.laneId)
    const command = intent || (changed && { cardId: changed.id, laneId: changed.laneId })
    if (command) action(() => Meteor.callAsync('workshops.move', shareId, room.revision, command.cardId, command.laneId))
  }
  async function openCopy() {
    if (copyRequest.current?.revision !== room.revision) copyRequest.current = { id: Random.id(), revision: room.revision }
    const copy = await Meteor.callAsync('workshops.saveCanvas', room.model, copyRequest.current.id)
    navigate('/canvas/' + copy)
  }
  return <main className="workshops" data-mode={mode === 'system' ? systemMode : mode}>
    <BrandBar />
    <div className="workshop-content">
      {!room ? !ready ? <p role="status">Opening workshop…</p> : <>
        <h1>Workshop unavailable</h1><p>Open this link with an account that has access to the private slate.</p>
        {(!userId || anonymous) && <Link to={'/login?room=' + encodeURIComponent(shareId)}>Sign in</Link>}
      </> : <>
        <p className="workshop-kicker">Live workshop · {room.canEdit ? 'Can edit' : 'View only'}</p>
        <h1>{room.model.title}</h1>
        <p className="workshop-intro">{room.canEdit ? 'Move a card to an available destination. Everyone in this room sees the change.' : 'Follow the group’s decisions here as they happen.'}</p>
        <div className="workshop-surface" data-revision={room.revision}>
          <WorkshopBoardSurface value={room.model} readOnly={!room.canEdit} onChange={move}
            canUndo={room.canUndo && !pending} onUndo={room.model.kind === 'release-plan' ?
              () => action(() => Meteor.callAsync('workshops.undoReleaseMove', shareId, room.revision)) : undefined} />
          {!room.canEdit && <dl className="workshop-readonly">{room.model.lanes.map(lane => <div key={lane.id}><dt>{lane.label}</dt>
              <dd>{lane.station?.outcome} {room.model.cards.filter(card => card.laneId === lane.id).map(card => card.label).join(', ') || 'Empty'}</dd>
            </div>)}</dl>}
        </div>
        <div className="workshop-actions">
          <button onClick={() => action(async () => {
            await navigator.clipboard.writeText(new URL('/workshops?room=' + shareId, window.location.origin).href)
            setMessage('Workshop link copied.')
          })}>Copy workshop link</button>
          {room.canEdit && <button disabled={pending} onClick={() => action(openCopy)}>Open private canvas copy</button>}
        </div>
        {room.owner && <details className="workshop-more">
          <summary>Team access</summary>
          {room.team ? <form onSubmit={event => {
            event.preventDefault()
            action(async () => {
              await Meteor.callAsync('workshops.setMember', shareId, email, level)
              setMessage('Team access updated.')
            })
          }}>
            <label>Team member email <input required type="email" maxLength={254} value={email} onChange={event => setEmail(event.target.value)} /></label>
            <label>Access level <select value={level} onChange={event => setLevel(event.target.value)}>
              <option value="READ">View</option><option value="COMMENT">Comment on the native slate</option><option value="EDIT">Move cards</option><option value="NONE">Remove access</option>
            </select></label>
            <div className="workshop-actions"><button disabled={pending}>Save access</button></div>
          </form> : <p>Private workshop access uses your Slatebox team. <Link to="/team">Manage your team</Link>.</p>}
          <Link to={'/canvas/' + shareId}>Open the original slate</Link>
        </details>}
      </>}
      {message && <p role="status">{message}</p>}
      <footer><Link to="/workshops">All workshops</Link></footer>
    </div>
  </main>
}
