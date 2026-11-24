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

test('@Slatebox stays Slatebox, even if an agent were named so', () => {
  assert.equal(mentionedAgent('@Slatebox make a mind map', [...agents, { name: 'Slatebox' }]), null)
  assert.equal(slateboxRequest('@Slatebox make a mind map'), 'make a mind map')
})

test('an agent\'s turn says what it did in plain words, and keeps only a safe name and colour', async () => {
  const { agentChatReply, agentOfTurn } = await import('../web/app/imports/api/common/agent-mention.mjs')
  assert.equal(agentChatReply('GitHub', { items: 2, actions: ['a', 'b'], saved: 0, say: 'Found 2 open issues', left: [] }),
    'Found 2 open issues. 2 suggestions are on the slate: keep or discard each where it sits.')
  assert.equal(agentChatReply('GitHub', { items: 1, actions: ['a'], saved: 0, say: '' }), 'One suggestion is on the slate: keep or discard it where it sits.')
  assert.equal(agentChatReply('Linear', { items: 3, actions: [], saved: 3, say: 'Done.' }), 'Done. Added 3 changes to the slate.')
  assert.equal(agentChatReply('Linear', { items: 0, actions: [], saved: 0, say: '' }), 'Linear had nothing to suggest for that.')
  assert.equal(agentChatReply('Linear', { items: 0, say: 'No issues match.', left: ['1 group could not be placed. Ask again to try it.'] }),
    'No issues match. 1 group could not be placed. Ask again to try it.')
  assert.deepEqual(agentOfTurn({ name: ' GitHub ', color: '#0f766e', ask: () => {} }), { name: 'GitHub', color: '#0f766e' })
  assert.deepEqual(agentOfTurn({ name: 'X', color: 'url(javascript:alert(1))' }), { name: 'X', color: '#6d28d9' })
  assert.equal(agentOfTurn({ name: '' }), null)
  assert.equal(agentOfTurn(null), null)
})
