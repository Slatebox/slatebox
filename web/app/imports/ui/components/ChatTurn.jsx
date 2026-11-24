// One turn of Ask Slatebox's conversation, as a chat bubble: what the person said on the right, in
// their colour; what Slatebox said on the left, beside its sparkle (the mark on the "Ask Slatebox"
// button); what an invited agent said on the left, beside its own mark and name in its colour. A
// screen reader hears who said it ("You:", "Slatebox:", "GitHub:"), as the old captions said.
// Theme tokens only, so it reads the same in light and dark.
import React from 'react'
import { Box, Typography } from '@mui/material'
import { alpha, keyframes } from '@mui/material/styles'
import AutoAwesome from '@mui/icons-material/AutoAwesome'
import { SPACE } from '../common/AccountLayout'
import Hexagon from './AgentMark'

const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }

/** Slatebox's mark beside its turns. */
function Spark() {
  return <Box aria-hidden="true" sx={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', mt: SPACE.hair / 2,
    bgcolor: theme => alpha(theme.palette.primary.main, .14), color: 'primary.main' }}>
    <AutoAwesome sx={{ fontSize: 15 }} />
  </Box>
}

const bubble = (you) => ({
  px: SPACE.text, py: SPACE.tight, minWidth: 0, maxWidth: you ? '86%' : 'calc(100% - 34px)', boxSizing: 'border-box',
  borderRadius: you ? '16px 16px 4px 16px' : '4px 16px 16px 16px', overflowWrap: 'anywhere',
  // Yours: a pale green in light; in dark, the chrome's own selected green (amber over green mixed to olive).
  bgcolor: theme => (you ? (theme.palette.mode === 'dark' ? theme.palette.shell.selected : alpha(theme.palette.primary.main, .1)) : theme.palette.action.hover),
  color: 'text.primary',
})

/** An invited agent's mark beside its turns: its hexagon in its colour (as its chip on the people strip). */
function AgentMark({ agent }) {
  return <Box aria-hidden="true" sx={{ flex: 'none', width: 26, height: 26, display: 'grid', placeItems: 'center', mt: SPACE.hair / 2 }}>
    {agent.iconUrl
      ? <Box component="img" src={agent.iconUrl} alt="" sx={{ width: 22, height: 22, borderRadius: '6px', border: `2px solid ${agent.color}` }} />
      : <Hexagon color={agent.color} size={24} style={{}} />}
  </Box>
}

/**
 * A turn. `who` is 'you', 'slatebox' or 'agent' (an invited agent answering "@its name": `agent`
 * is { name, color, iconUrl? }, and its turn carries its name, colour and mark); `as` is the element
 * (a list item in a conversation list); `after` sits under the bubble (a button, cards the turn
 * answered with).
 */
export default function ChatTurn({ who, children, after = null, as = 'li', agent = null, ...rest }) {
  const you = who === 'you'
  const asAgent = who === 'agent' && agent?.name
  return <Box component={as} data-chat-turn={who} {...(asAgent && { 'data-chat-agent': agent.name })} {...rest} sx={{ display: 'flex', flexDirection: 'column', alignItems: you ? 'flex-end' : 'stretch', my: SPACE.text, listStyle: 'none' }}>
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', justifyContent: you ? 'flex-end' : 'flex-start', width: '100%' }}>
      {!you && (asAgent ? <AgentMark agent={agent} /> : <Spark />)}
      <Box sx={asAgent ? { ...bubble(false), borderLeft: `3px solid ${agent.color}` } : bubble(you)}>
        <Box component="span" sx={visuallyHidden}>{you ? 'You: ' : asAgent ? `${agent.name}: ` : 'Slatebox: '}</Box>
        {asAgent && <Typography variant="caption" component="span" aria-hidden="true" sx={{ display: 'block', fontWeight: 700, color: agent.color, lineHeight: 1.4 }}>{agent.name}</Typography>}
        {typeof children === 'string'
          ? <Typography variant="body2" component="span" sx={{ whiteSpace: 'pre-wrap', display: 'block', lineHeight: 1.5 }}>{children}</Typography>
          : children}
      </Box>
    </Box>
    {/* Under the bubble, lined up with it (the mark is 26px and the gap 8px: 34px). */}
    {after && <Box sx={{ pl: you ? 0 : '34px', mt: SPACE.hair, alignSelf: you ? 'flex-end' : 'stretch' }}>{after}</Box>}
  </Box>
}

const bounce = keyframes`0%, 80%, 100% { opacity: .3; transform: translateY(0) } 40% { opacity: 1; transform: translateY(-3px) }`

/** Slatebox is working on an answer: three soft dots in its bubble. Still for reduced motion; the reason is said in the message form. */
export function ChatThinking({ as = 'li' }) {
  return <Box component={as} aria-hidden="true" data-chat-thinking="" sx={{ display: 'flex', gap: SPACE.tight, alignItems: 'flex-start', my: SPACE.text, listStyle: 'none' }}>
    <Spark />
    <Box sx={{ ...bubble(false), display: 'flex', gap: SPACE.hair, alignItems: 'center', py: SPACE.text }}>
      {[0, 1, 2].map(i => <Box key={i} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'text.secondary',
        animation: `${bounce} 1.2s ${i * .15}s infinite ease-in-out`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: .6 } }} />)}
    </Box>
  </Box>
}
