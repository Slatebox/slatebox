import React, { useState } from 'react'
import { Random } from 'meteor/random'

export default function PlacementOutcomeFields({ card, lanes, signals, onChange, remaining }) {
  const [open, setOpen] = useState(null)
  const signal = signals.find(item => item.id === open)
  function edit(field, value) {
    onChange(signals.map(item => item.id === open ? { ...item, [field]: value } : item))
  }
  function add() {
    const id = Random.id()
    onChange([...signals, {id, cardId: card.id, label: '', laneId: card.laneId, whenPresent: '', whenAbsent: ''}])
    setOpen(id)
  }
  return <fieldset className="workshop-placement-fields"><legend>Placement outcomes</legend>
    {signals.map(item => <button key={item.id} type="button" aria-expanded={open === item.id}
      onClick={() => setOpen(open === item.id ? null : item.id)}>{item.label || 'New placement outcome'}</button>)}
    {signal && <div>
      <label>Outcome name<input value={signal.label} required maxLength={80} onChange={e => edit('label', e.target.value)} /></label>
      <label>Target lane<select value={signal.laneId} onChange={e => edit('laneId', e.target.value)}>
        {lanes.map(lane => <option key={lane.id} value={lane.id}>{lane.label}</option>)}
      </select></label>
      <label>When the card is here<input value={signal.whenPresent} required maxLength={160} onChange={e => edit('whenPresent', e.target.value)} /></label>
      <label>When the card is elsewhere<input value={signal.whenAbsent} required maxLength={160} onChange={e => edit('whenAbsent', e.target.value)} /></label>
      <button type="button" onClick={() => { onChange(signals.filter(item => item.id !== open)); setOpen(null) }}>Remove outcome</button>
    </div>}
    <button type="button" disabled={remaining <= 0} onClick={add}>Add placement outcome</button>
  </fieldset>
}
