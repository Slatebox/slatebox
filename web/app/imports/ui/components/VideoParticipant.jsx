import React from 'react'
import { useAtomValue } from 'jotai'
import {
  DailyVideo,
  useAudioTrack,
  useDaily,
  useLocalSessionId,
  useParticipantProperty,
  useVideoTrack,
} from '@daily-co/daily-react'
import { Box, IconButton, Stack, Typography } from '@mui/material'
import MicIcon from '@mui/icons-material/Mic'
import MicOffIcon from '@mui/icons-material/MicOff'
import VideocamIcon from '@mui/icons-material/Videocam'
import VideocamOffIcon from '@mui/icons-material/VideocamOff'
import { isHuddlePropertiesOpen } from '../jotai/atoms'

export default function VideoParticipant({ sessionId, audioOnly, isActiveSpeaker }) {
  const callObject = useDaily()
  const localSessionId = useLocalSessionId()
  const isLocal = localSessionId === sessionId
  const name = useParticipantProperty(sessionId, 'user_name') || 'Guest'
  const audioMuted = useAudioTrack(sessionId).isOff
  const videoMuted = useVideoTrack(sessionId).isOff
  const properties = useAtomValue(isHuddlePropertiesOpen)
  const visibleVideo = !audioOnly && !videoMuted && !properties.open

  return (
    <Stack alignItems="center" spacing={0.25}>
      <Box
        sx={{
          width: audioOnly ? 84 : 120,
          height: audioOnly ? 32 : 64,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 1,
          display: 'grid',
          placeItems: 'center',
          color: '#fff',
          bgcolor: '#2d4147',
          outline: isActiveSpeaker ? '2px solid #73c49f' : undefined,
        }}
      >
        {visibleVideo && (
          <DailyVideo
            sessionId={sessionId}
            type="video"
            automirror
            fit="cover"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
          />
        )}
        <Typography
          variant="caption"
          noWrap
          sx={{
            maxWidth: '100%',
            px: 0.5,
            ...(visibleVideo && { position: 'absolute', bottom: 0, left: 0, bgcolor: '#0009' }),
          }}
        >
          {isLocal ? 'You' : name}
        </Typography>
      </Box>
      <Stack direction="row" alignItems="center">
        {isLocal ? (
          <IconButton
            size="small"
            aria-label={audioMuted ? 'Unmute microphone' : 'Mute microphone'}
            onClick={() => callObject.setLocalAudio(audioMuted)}
          >
            {audioMuted ? <MicOffIcon fontSize="small" /> : <MicIcon fontSize="small" />}
          </IconButton>
        ) : audioMuted ? (
          <MicOffIcon fontSize="small" titleAccess="Microphone muted" />
        ) : (
          <MicIcon fontSize="small" titleAccess="Microphone on" />
        )}
        {isLocal && !audioOnly && (
          <IconButton
            size="small"
            aria-label={videoMuted ? 'Turn camera on' : 'Turn camera off'}
            onClick={() => callObject.setLocalVideo(videoMuted)}
          >
            {videoMuted ? <VideocamOffIcon fontSize="small" /> : <VideocamIcon fontSize="small" />}
          </IconButton>
        )}
      </Stack>
    </Stack>
  )
}
