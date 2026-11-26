// The interview, S2 (2026-11-26), enterprise side: what personalization may know of a person's
// integrations (enterprise/server/service.mjs profileIntegration), which enterprise/server/meteor.js
// hands the MIT core through the profile integrations seam (web/app/server/profile/integration-hooks.mjs):
// a name, the gallery card it came from and its kind, never an address, a token, its tools or what it holds.
// Run: node --import ./scripts/enterprise-resolve.mjs --test scripts/interview-enterprise.test.mjs
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { profileIntegration } from '../enterprise/server/service.mjs'
import { GALLERY } from '../enterprise/common/gallery.mjs'
import { toolLines } from '../web/app/imports/api/common/interview.mjs'

const doc = {
  _id: 'int1', ownerId: 'ada', kind: 'mcp', name: 'Linear', host: 'mcp.linear.app', address: 'https://mcp.linear.app/mcp', galleryId: 'linear',
  status: 'active', auth: { kind: 'oauth', issuer: 'https://linear.app' }, scopes: ['read'], tools: [{ name: 'list_issues', hash: 'x' }], colorIndex: 2,
}

test('an integration as personalization sees it: name, card and kind only', () => {
  assert.deepEqual(profileIntegration(doc), { name: 'Linear', cardId: 'linear', kind: 'mcp' })
  assert.deepEqual(Object.keys(profileIntegration(doc)).sort(), ['cardId', 'kind', 'name'])
  assert.doesNotMatch(JSON.stringify(profileIntegration(doc)), /mcp\.linear\.app|oauth|list_issues|ada/)
})

test('the card is found by address when it was not recorded; a custom server has none; the kind defaults to mcp', () => {
  const card = GALLERY.find((c) => c.url)
  assert.ok(card, 'the gallery lists a card with an address (url)')
  assert.equal(profileIntegration({ name: 'Mine', address: card.url }).cardId, card.id)
  assert.deepEqual(profileIntegration({ name: 'Wiki', address: 'https://wiki.example.com/mcp' }), { name: 'Wiki', cardId: null, kind: 'mcp' })
  assert.equal(profileIntegration({ name: 'Drive', kind: 'native', galleryId: 'googledrive' }).kind, 'native')
  assert.deepEqual(profileIntegration(null), { name: '', cardId: null, kind: 'mcp' })
})

test('what the interview prompt names from them', () => {
  assert.equal(toolLines([profileIntegration(doc), profileIntegration({ name: 'Wiki', address: 'https://wiki.example.com/mcp' })]), '- Linear\n- Wiki')
})
