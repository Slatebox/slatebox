import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import BrandBar from '../common/BrandBar'
import SharedWorkshopRoom from './SharedWorkshopRoom.jsx'
import { validateWorkshop } from 'slateboxjs/workshops/model'
import { legacyWorkshopEntry, legacyWorkshopKeys, storedWorkshopData } from '../../api/common/legacy-workshop-entry.mjs'
import customerImport from './customer-import-map.json'
import './workshops.css'

export default function Workshops() {
  const {userId,loggingIn} = useTracker(() => ({userId:Meteor.userId(),loggingIn:Meteor.loggingIn()}), [])
  const [params] = useSearchParams()
  const room = params.get('room')
  if (room !== null) return <SharedWorkshopRoom key={room + (userId || '')} shareId={room} />
  const requested = params.get('format')
  const format = ['lanes','map','release-plan'].includes(requested) ? requested : 'lanes'
  const sample = format === 'map' && params.get('example') === 'customer-import' ? 'customer-import' : null
  if (loggingIn) return <p role="status">Opening your slate…</p>
  if (params.get('view') === 'saved') return <SavedWorkshops key={(userId || 'guest') + format} userId={userId} format={format} params={params} />
  const entry = legacyWorkshopEntry({format,sample,userId,storage:{getItem:key=>sessionStorage.getItem(key)},customerImport})
  return <Navigate to={entry.to} state={entry.state} replace />
}

function SavedWorkshops({userId,format,params}) {
  const [rows,setRows]=useState(null)
  const [error,setError]=useState(false)
  const [restored,setRestored]=useState(null)
  const source=params.get('resume')
  const base='/workshops?view=saved&format='+format
  useEffect(()=>{
    let active=true
    if(userId) Meteor.callAsync('workshops.recent',format).then(items=>{if(active)setRows(items)}).catch(()=>{if(active)setError(true)})
    return ()=>{active=false}
  },[userId,format])
  useEffect(()=>{
    let active=true
    if(userId && /^[a-f0-9]{10}$/.test(source)) {
      Meteor.callAsync('workshops.restore',source).then(draft=>{if(active)setRestored({source,draft:validateWorkshop(draft)})}).catch(()=>{if(active)setError(true)})
    }
    return ()=>{active=false}
  },[source,userId])
  let draft
  try {draft=validateWorkshop(JSON.parse(sessionStorage.getItem(legacyWorkshopKeys[format]+(userId||'guest'))).draft)} catch { /* no tab draft */ }
  if (source === 'tab' && draft) {
    const entry = legacyWorkshopEntry({format, userId, storage: sessionStorage})
    return <Navigate replace to={entry.to} state={entry.state}/>
  }
  if (restored && source === restored.source) {
    return <Navigate replace to="/new/workshop" state={{localWorkshop:storedWorkshopData(restored.draft)}}/>
  }
  return <main className="workshops"><BrandBar/><section className="workshop-content">
    <h1>Saved workshops</h1>
    <nav aria-label="Saved workshop types">{Object.entries({lanes:'Sorting boards',map:'Maps','release-plan':'Release plans'}).map(([id,name])=>
      <Link key={id} aria-current={id===format?'page':undefined} to={'/workshops?view=saved&format='+id}>{name}{' '}</Link>)}</nav>
    {draft && <p><Link to={base+'&resume=tab'}>Resume tab draft: {draft.title}</Link></p>}
    {!userId ? <p><Link to="/login">Sign in</Link> to open your saved workshops.</p> :
      error ? <p role="alert">Your saved workshop could not be loaded. Reload to try again.</p> :
      !rows ? <p role="status">Loading workshops…</p> : rows.length ? <ul>{rows.map(row=><li key={row.shareId}>
        <Link to={'/canvas/'+row.shareId}>{row.options?.name || 'Open workshop'}</Link>{' '}
        <Link to={base+'&resume='+row.shareId}>Open saved workshop</Link>{' '}
        {row.live && <Link to={'/workshops?room='+row.shareId}>Rejoin live room for {row.options?.name}</Link>}
      </li>)}</ul> : <p>You have no archived workshops.</p>}
    <Link to="/">My Slates</Link>
  </section></main>
}
