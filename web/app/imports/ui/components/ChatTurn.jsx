// One turn of Ask Slatebox's conversation, as a chat bubble: what the person said on the right, in
// their colour; what Slatebox said on the left, beside its sparkle (the mark on the "Ask Slatebox"
// button). A screen reader hears who said it ("You:", "Slatebox:"), as the old captions said.
// Theme tokens only, so it reads the same in light and dark.
import React from 'react'
import { Box, Typography } from '@mui/material'
import { alpha, keyframes } from '@mui/material/styles'
import AutoAwesome from '@mui/icons-material/AutoAwesome'

const visuallyHidden = { position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0 }

/** Slatebox's mark beside its turns. */
function Spark() {
  return <Box aria-hidden="true" sx={{ flex: 'none', width: 26, height: 26, borderRadius: '50%', display: 'grid', placeItems: 'center', mt: .25,
    bgcolor: theme => alpha(theme.palette.primary.main, .14), color: 'primary.main' }}>
    <AutoAwesome sx={{ fontSize: 15 }} />
  </Box>
}

const bubble = (you) => ({
  px: 1.5, py: 1, minWidth: 0, maxWidth: you ? '86%' : 'calc(100% - 34px)', boxSizing: 'border-box',
  borderRadius: you ? '16px 16px 4px 16px' : '4px 16px 16px 16px', overflowWrap: 'anywhere',
  bgcolor: theme => (you ? alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? .22 : .1) : theme.palette.action.hover),
  color: 'text.primary',
})

/**
 * A turn. `who` is 'you' or 'slatebox'; `as` is the element (a list item in a conversation list);
 * `after` sits under the bubble (a button, cards the turn answered with).
 */
export default function ChatTurn({ who, children, after = null, as = 'li', ...rest }) {
  const you = who === 'you'
  return <Box component={as} {...rest} sx={{ display: 'flex', flexDirection: 'column', alignItems: you ? 'flex-end' : 'stretch', my: 1.25, listStyle: 'none' }}>
    <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', justifyContent: you ? 'flex-end' : 'flex-start', width: '100%' }}>
      {!you && <Spark />}
      <Box sx={bubble(you)}>
        <Box component="span" sx={visuallyHidden}>{you ? 'You: ' : 'Slatebox: '}</Box>
        {typeof children === 'string'
          ? <Typography variant="body2" component="span" sx={{ whiteSpace: 'pre-wrap', display: 'block', lineHeight: 1.5 }}>{children}</Typography>
          : children}
      </Box>
    </Box>
    {after && <Box sx={{ pl: you ? 0 : 4.25, mt: .5, alignSelf: you ? 'flex-end' : 'stretch' }}>{after}</Box>}
  </Box>
}

const bounce = keyframes`0%, 80%, 100% { opacity: .3; transform: translateY(0) } 40% { opacity: 1; transform: translateY(-3px) }`

/** Slatebox is working on an answer: three soft dots in its bubble. Still for reduced motion; the reason is said in the message form. */
export function ChatThinking({ as = 'li' }) {
  return <Box component={as} aria-hidden="true" data-chat-thinking="" sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', my: 1.25, listStyle: 'none' }}>
    <Spark />
    <Box sx={{ ...bubble(false), display: 'flex', gap: .5, alignItems: 'center', py: 1.4 }}>
      {[0, 1, 2].map(i => <Box key={i} sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: 'text.secondary',
        animation: `${bounce} 1.2s ${i * .15}s infinite ease-in-out`,
        '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: .6 } }} />)}
    </Box>
  </Box>
}
