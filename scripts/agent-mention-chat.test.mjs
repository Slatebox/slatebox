// "@name" in Ask Slatebox asks an invited agent (owner decision 2026-11-24, 3): the mention is found
// by the agent's name, without case or spaces, and the request is what is left.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mentionedAgent, slateboxRequest } from '../web/app/imports/api/common/agent-mention.mjs'

const agents = [{ name: 'GitHub' }, { name: 'Linear' }, { name: 'Linear Docs' }, { name: 'Test Diagrams' }, { name: 'Excalidraw' }]

test('a mention picks the agent and leaves the request', () => {
  assert.deepEqual(mentionedAgent('@github open issues about login', agents), { agent: agents[0], request: 'open issues about login' })
  assert.deepEqual(mentionedAgent('@Linear: this sprint', agents), { agent: agents[1], request: 'this sprint' })
  assert.deepEqual(mentionedAgent('ask @excalidraw for a sketch of this', agents), { agent: agents[4], request: 'ask for a sketch of this' })
  assert.equal(mentionedAgent('@TestDiagrams draw the flow', agents).agent, agents[3])
  assert.equal(mentionedAgent('@Test Diagrams draw the flow', agents).request, 'draw the flow')
  // the longest name that fits wins
  assert.equal(mentionedAgent('@Linear Docs the API pages', agents).agent, agents[2])
})

test('no mention, a partial name or an email address asks no agent', () => {
  assert.equal(mentionedAgent('open issues about login', agents), null)
  assert.equal(mentionedAgent('@git open issues', agents), null)
  assert.equal(mentionedAgent('@githubber hello', agents), null)
  assert.equal(mentionedAgent('mail ada@github.com', agents), null)
  assert.equal(mentionedAgent('@github hi', []), null)
  assert.equal(mentionedAgent(null, agents), null)
})

test('your own agent wins @name over someone else\'s with the same or a longer name; theirs only explains the refusal', async () => {
  const { sameAgentName } = await import('../web/app/imports/api/common/agent-mention.mjs')
  const bobs = { name: 'GitHub', canAsk: false, inviterName: 'Bob' }
  const bobsLonger = { name: 'GitHub issues', canAsk: false, inviterName: 'Bob' }
  const adas = { name: 'GitHub', canAsk: true }
  // Bob invited first, so his agent comes first in the list.
  assert.equal(mentionedAgent('@GitHub open issues', [bobs, adas]).agent, adas)
  assert.deepEqual(mentionedAgent('@GitHub issues about login', [bobsLonger, adas]), { agent: adas, request: 'issues about login' })
  // Only someone else's agent by that name: it is found, so the answer can say who may ask it.
  assert.equal(mentionedAgent('@GitHub issues about login', [bobsLonger]).agent, bobsLonger)
  assert.equal(sameAgentName('Git Hub', 'github'), true)
  assert.equal(sameAgentName('GitHub', 'GitHub issues'), false)
})

test('@Slatebox stays Slatebox, even if an agent were named so', () => {
  assert.equal(mentionedAgent('@Slatebox make a mind map', [...agents, { name: 'Slatebox' }]), null)
  assert.equal(slateboxRequest('@Slatebox make a mind map'), 'make a mind map')
})

test('an agent\'s turn says what it did in plain words, and keeps only a safe name and colour', async () => {
  const { agentChatReply, agentOfTurn } = await import('../web/app/imports/api/common/agent-mention.mjs')
  // one ask is one suggestion: its notes and lines, kept or discarded on its frame
  assert.equal(agentChatReply('GitHub', { items: 1, actions: ['a'], saved: 0, say: 'Found 2 open issues', left: [], added: { notes: 2, lines: 0 } }),
    'Found 2 open issues. Added 2 notes as one suggestion: Keep all or Discard all on its frame, or point at a note to keep it alone.')
  assert.equal(agentChatReply('Excalidraw', { items: 1, actions: ['a'], added: { notes: 3, lines: 2 } }),
    'Added 3 notes and 2 lines as one suggestion: Keep all or Discard all on its frame, or point at a note to keep it alone.')
  assert.equal(agentChatReply('GitHub', { items: 1, actions: ['a'], saved: 0, say: '' }), 'One suggestion is on the slate: Keep all or Discard all on its frame.')
  assert.equal(agentChatReply('Linear', { items: 3, actions: [], saved: 3, say: 'Done.' }), 'Done. Added 3 changes to the slate.')
  assert.equal(agentChatReply('Linear', { items: 0, actions: [], saved: 0, say: '' }), 'Linear had nothing to suggest for that.')
  assert.equal(agentChatReply('Linear', { items: 0, say: 'No issues match.', left: ['Kept the 3 notes you asked for; 2 more notes left out.'] }),
    'No issues match. Kept the 3 notes you asked for; 2 more notes left out.')
  assert.deepEqual(agentOfTurn({ name: ' GitHub ', color: '#0f766e', ask: () => {} }), { name: 'GitHub', color: '#0f766e' })
  assert.deepEqual(agentOfTurn({ name: 'X', color: 'url(javascript:alert(1))' }), { name: 'X', color: '#6d28d9' })
  assert.equal(agentOfTurn({ name: '' }), null)
  assert.equal(agentOfTurn(null), null)
})

test('a failed ask says why and what to do next, never a bare error', async () => {
  const { agentErrorReply } = await import('../web/app/imports/api/common/agent-mention.mjs')
  assert.deepEqual(agentErrorReply('GitHub', { error: 'needs_sign_in', reason: 'x' }), { text: 'GitHub needs you to sign in again before it can look anything up.', next: 'signIn' })
  assert.equal(agentErrorReply('GitHub', { error: 'pro_required' }).next, 'pay')
  assert.equal(agentErrorReply('GitHub', { error: 'agents_paused' }).text, 'Agents are paused on this slate. Resume agents on the roster under the canvas, then ask GitHub again.')
  assert.equal(agentErrorReply('GitHub', { error: 'upstream', reason: 'Bad credentials.' }).text, 'GitHub couldn\'t do that: Bad credentials. Try asking in other words.')
  assert.equal(agentErrorReply('GitHub', { error: 'x', reason: 'Internal server error' }).text, 'GitHub couldn\'t do that. Try asking in other words.')
})

test('a question only an agent can answer, sent to Slatebox, names that agent; drawings and other asks stay with Slatebox', async () => {
  const { agentHint } = await import('../web/app/imports/api/common/agent-mention.mjs')
  const github = { name: 'GitHub', canAsk: true, galleryId: 'github' }
  const theirs = { name: 'Linear', canAsk: false, galleryId: 'linear' }
  assert.equal(agentHint('what are my latest commits? can you make a couple notes on the slate about those?', [github]), github)
  assert.equal(agentHint('which PRs are waiting for me', [{ name: 'GH', canAsk: true, galleryId: 'github' }]).name, 'GH')
  assert.equal(agentHint('show me open issues', [{ name: 'my github', canAsk: true }]).name, 'my github', 'by name when the card is not known')
  assert.equal(agentHint('draw a diagram of our PR review process', [github]), null)
  assert.equal(agentHint('add three ideas for the launch', [github]), null)
  assert.equal(agentHint('@GitHub my commits', [github]), null, 'an @ already names who to ask')
  assert.equal(agentHint('what is in the current cycle', [theirs]), null, 'only agents this person may ask')
})

test('a drawing request that brought no change says why, never "try again" alone', async () => {
  const { chatUnavailableWords } = await import('../web/app/imports/api/common/chat-words.mjs')
  assert.match(chatUnavailableWords({ reason: 'no_answer' }), /ask an invited agent with @/)
  assert.match(chatUnavailableWords({ reason: 'no_change' }), /^Slatebox found nothing to change/)
  assert.equal(chatUnavailableWords({ reason: 'failed', message: 'No note is called Budget.' }), 'Slatebox couldn\'t make that change: No note is called Budget. Try saying it another way.')
  assert.doesNotMatch(chatUnavailableWords({}), /Revise the request/)
})

test('after "@GitHub", follow-ups stay with GitHub until cleared or someone else is named (prod, slate 3b38bdf775)', async () => {
  const { routeMessage } = await import('../web/app/imports/api/common/agent-mention.mjs')
  const github = { agentId: 'gh', name: 'GitHub', canAsk: true, galleryId: 'github' }
  const linear = { agentId: 'li', name: 'Linear', canAsk: true, galleryId: 'linear' }
  const agents = [github, linear]
  // "@GitHub hey" goes to GitHub, and the conversation is with GitHub after it
  assert.deepEqual(routeMessage('@GitHub hey', { agents }), { kind: 'agent', agent: github, request: 'hey', replyingTo: 'gh' })
  // the follow-up with no @ goes to GitHub too (it went to Slatebox's canvas chat on prod)
  const follow = routeMessage('what are my latest commits? can you make a couple notes on the slate about those?', { agents, replyingTo: 'gh' })
  assert.equal(follow.kind, 'agent')
  assert.equal(follow.agent, github)
  assert.equal(follow.request, 'what are my latest commits? can you make a couple notes on the slate about those?')
  // naming someone else switches; @Slatebox hands it back
  assert.equal(routeMessage('@Linear current cycle', { agents, replyingTo: 'gh' }).replyingTo, 'li')
  assert.deepEqual(routeMessage('@Slatebox make a mind map', { agents, replyingTo: 'gh' }), { kind: 'slatebox', replyingTo: null })
  // cleared (×): a question only GitHub can answer is named, not sent to Slatebox's canvas chat
  assert.deepEqual(routeMessage('what are my latest commits?', { agents }), { kind: 'hint', agent: github, replyingTo: null })
  // buttons choose: "Ask @GitHub" and "Ask Slatebox anyway"
  assert.equal(routeMessage('what are my latest commits?', { agents, to: 'gh' }).agent, github)
  assert.deepEqual(routeMessage('what are my latest commits?', { agents, replyingTo: 'gh', to: 'slatebox' }), { kind: 'slatebox', replyingTo: null })
  // an agent that can no longer be asked (removed, Pro ended) does not hold the conversation
  assert.deepEqual(routeMessage('add three ideas', { agents: [{ ...github, canAsk: false }], replyingTo: 'gh' }), { kind: 'slatebox', replyingTo: null })
})

test('the same ask while its answer waits is said once (no second "one suggestion is on the slate")', async () => {
  const { agentChatReply } = await import('../web/app/imports/api/common/agent-mention.mjs')
  const said = 'That answer is still on the slate, waiting: Keep all or Discard all on its frame, then ask again for a new one.'
  assert.equal(agentChatReply('Exa', { repeated: true, actions: ['a1'], say: said, added: { notes: 0, lines: 0 } }), said)
})
