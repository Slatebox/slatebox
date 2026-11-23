// Agents on the canvas. The server publishes a record for each agent run saving to this slate
// (agentPresence.forSlate); the engine draws each one as a named pointer with its plan
// (createAgentPresence). People's cursors come from the relay and look different: nothing a page
// sets there can draw an agent here. The roster shows an agent chip with the full plan.
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import Chip from '@mui/material/Chip'
import Popover from '@mui/material/Popover'
import Typography from '@mui/material/Typography'
import Box from '@mui/material/Box'
import { visibleAgents, agentStepText, agentChecklist, AGENT_PALETTE } from 'slateboxjs'
import { AgentPresence } from '../../api/common/models'
import { clockOffset, onScreenClock } from '../../api/common/agent-clock.mjs'

// The records of this slate, newest per agent, as the engine would show them now. Re-read every
// second while any is shown, so a silent or ended run leaves on time: the server's time, carried
// over to this screen's clock, so a clock that is off neither hides a live agent nor keeps a
// stale one.
export function useAgentPresence(shareId) {
  const { records, offset } = useTracker(() => {
    if (!shareId) return { records: [], offset: 0 }
    Meteor.subscribe('agentPresence.forSlate', shareId)
    const clock = AgentPresence.findOne('clock')
    return {
      records: AgentPresence.find({ agentKey: { $exists: true } }, { sort: { updatedAt: -1 } }).fetch(),
      offset: clockOffset(clock),
    }
  }, [shareId])
  const [, tick] = useState(0)
  useEffect(() => {
    if (!records.length) return undefined
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [records.length])
  const newest = new Map()
  for (const record of records) if (!newest.has(record.agentKey)) newest.set(record.agentKey, onScreenClock(record, offset))
  return { all: [...newest.values()], shown: visibleAgents([...newest.values()], Date.now()).map((item) => item.record) }
}

export default function AgentPresenceListener({ slate }) {
  const { all } = useAgentPresence(slate.shareId)
  const presence = useRef(null)
  const latest = useRef(all)
  latest.current = all
  // The drawing (slateboxjs/presence) loads when the first agent arrives: a slate no agent works
  // on never fetches it.
  const wanted = all.length > 0
  useEffect(() => {
    // The page holds the v1 facade; the engine's own slate (its svg.js canvas) is slate.v2.
    const engine = slate?.v2 ?? slate
    if (!wanted || typeof engine?.canvas?.group !== 'function') return undefined
    let gone = false
    import('slateboxjs/presence')
      .then(({ createAgentPresence }) => {
        if (gone) return
        presence.current = createAgentPresence(engine)
        presence.current.set(latest.current)
      })
      .catch((error) => console.warn('Agents on this slate could not be drawn.', error))
    return () => {
      gone = true
      presence.current?.destroy()
      presence.current = null
    }
  }, [slate, wanted])
  useEffect(() => {
    presence.current?.set(all)
  }, [all])
  return null
}

AgentPresenceListener.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types
  slate: PropTypes.object.isRequired,
}

// The agent mark: a hexagon, not the round avatar a person has.
function Hexagon({ color }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" style={{ marginLeft: 6 }}>
      <polygon points="21.5,12 16.75,20.23 7.25,20.23 2.5,12 7.25,3.77 16.75,3.77" fill={color} stroke="#fff" strokeWidth="1.5" />
      <path d="M18 2 L19 4.5 L21.5 5.5 L19 6.5 L18 9 L17 6.5 L14.5 5.5 L17 4.5 Z" fill="#fde68a" />
    </svg>
  )
}
Hexagon.propTypes = { color: PropTypes.string.isRequired }

/** One chip per agent on the slate, apart from people and never a Huddle participant. Its popover shows the whole plan. */
export function AgentChips({ records }) {
  const [open, setOpen] = useState(null) // { key, anchor }
  if (!records.length) return null
  const openRecord = open && records.find((record) => record.agentKey === open.key)
  return (
    <>
      {records.map((record) => {
        const color = AGENT_PALETTE[record.colorIndex % AGENT_PALETTE.length]
        const step = agentStepText(record)
        return (
          <Chip
            key={'agent-' + record.agentKey}
            data-agent-chip=""
            variant="outlined"
            icon={<Hexagon color={color} />}
            label={record.label + (step ? ' · ' + step : '')}
            onClick={(event) => setOpen({ key: record.agentKey, anchor: event.currentTarget })}
            aria-label={record.label + ', an agent' + (step ? ': ' + step : '')}
            sx={{ borderColor: color, borderStyle: 'dashed', maxWidth: 360 }}
          />
        )
      })}
      <Popover
        open={Boolean(openRecord)}
        anchorEl={open?.anchor}
        onClose={() => setOpen(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        {openRecord && (
          <Box sx={{ p: 2, maxWidth: 320 }} aria-label={openRecord.label + ' plan'}>
            <Typography variant="subtitle2">{openRecord.label}</Typography>
            {agentChecklist(openRecord).length ? (
              <Box component="ul" sx={{ listStyle: 'none', p: 0, m: 0, mt: 1 }}>
                {agentChecklist(openRecord).map((line, index) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <Typography component="li" variant="body2" key={index}>{line}</Typography>
                ))}
              </Box>
            ) : (
              <Typography variant="body2" sx={{ mt: 1 }}>{agentStepText(openRecord) || 'Working on this slate'}</Typography>
            )}
          </Box>
        )}
      </Popover>
    </>
  )
}
AgentChips.propTypes = {
  // eslint-disable-next-line react/forbid-prop-types
  records: PropTypes.array.isRequired,
}
