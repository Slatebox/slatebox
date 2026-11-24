import React from 'react'
import { Meteor } from 'meteor/meteor'
import { useTracker } from 'meteor/react-meteor-data'
import { useAtomValue, useAtom, useSetAtom } from 'jotai'
import Tooltip from '@mui/material/Tooltip'
import Box from '@mui/material/Box'
import Switch from '@mui/material/Switch'
import IconButton from '@mui/material/IconButton'
import SettingsIcon from '@mui/icons-material/Settings'
import RecordVoiceOverIcon from '@mui/icons-material/RecordVoiceOver'
import VoiceOverOffIcon from '@mui/icons-material/VoiceOverOff'
import MicIcon from '@mui/icons-material/Mic'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import MicOffIcon from '@mui/icons-material/MicOff'
import { dailyCall } from './huddle/daily-call.mjs'
import Pulse from '../common/Pulse'
import {
  slateHuddleType,
  huddleEnabled,
  isHuddlePropertiesOpen,
  currentSlate,
  canManageHuddleTranscription,
} from '../jotai/atoms'
import CONSTANTS from '../../api/common/constants'

// The huddle: one labelled switch ("Huddle"), and while it is on, its settings and the AI listening
// toggle. `variant="bar"` is the phone's bottom bar, where it keeps the same label.
export default function HuddleUp({ variant = 'header' }) {
  const slate = useAtomValue(currentSlate)
  const canTranscribe = useAtomValue(canManageHuddleTranscription)
  const huddleType = useAtomValue(slateHuddleType)
  const [on, setOn] = useAtom(huddleEnabled)
  const isTranscribing = useTracker(() => Meteor.user()?.profile?.transcribeOnStart)
  const setHuddleProperties = useSetAtom(isHuddlePropertiesOpen)

  const video = huddleType === 'video'
  const Icon = video ? (on ? VideocamIcon : VideocamOffIcon) : (on ? MicIcon : MicOffIcon)

  const showHuddleProperties = () => setHuddleProperties({ open: true })

  // Anyone may join a call that is running; the server says who may start one and who pays.
  const toggle = () => setOn(!on)

  const manageTranscription = async () => {
    await Meteor.callAsync(CONSTANTS.methods.users.update, {
      transcribeOnStart: !isTranscribing,
      userId: Meteor.userId(),
    })
    if (!isTranscribing) {
      dailyCall()?.startTranscription({ model: 'nova-2', endpointing: 1500, punctuate: true })
    } else dailyCall()?.stopTranscription()
  }

  return (
    <Box className={`sb-huddle sb-huddle-${variant}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, flex: 'none' }}>
      <Box component="label" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, height: 36, pl: 1.25, pr: 0.25,
        border: 1, borderRadius: 18, cursor: 'pointer', whiteSpace: 'nowrap',
        fontWeight: 600, fontSize: 14, '& .MuiSvgIcon-root': { fontSize: 18 }, borderColor: 'shell.border' }}>
        <Icon aria-hidden="true" />
        <span className="sb-huddle-label">Huddle</span>
        <Switch size="small" name="huddleEnabled" checked={Boolean(on)} onChange={toggle} color="secondary"
          slotProps={{ input: { role: 'switch', 'aria-label': 'Huddle' } }} />
      </Box>
      {on && (
        <>
          <Tooltip title="Huddle settings">
            <IconButton aria-label="Huddle settings" color="inherit" size="small" onClick={showHuddleProperties}>
              <SettingsIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title={isTranscribing ? 'Stop the AI listening to the huddle' : 'Let the AI listen to the huddle and help'}>
            <span>
              <IconButton aria-label="AI listens to the huddle" aria-pressed={Boolean(isTranscribing)} size="small"
                sx={{ color: isTranscribing ? '#f7c073' : 'inherit' }} disabled={!canTranscribe} onClick={manageTranscription}>
                {isTranscribing ? <Pulse><RecordVoiceOverIcon fontSize="small" /></Pulse> : <VoiceOverOffIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
        </>
      )}
    </Box>
  )
}
