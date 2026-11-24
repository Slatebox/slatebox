// Team settings (/team/settings): who sees which section, the team-name rule, what the danger
// zone says and allows, and that the page keeps the same server paths and permission checks.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  SECTIONS, confirmsName, deleteTeamState, pickSection, teamNameProblem, teamSettingsSections,
} from '../web/app/imports/ui/components/teams/team-settings-model.mjs'

const app = (path) => readFileSync(new URL(`../web/app/${path}`, import.meta.url), 'utf8')
const ids = (list) => list.map((s) => s.id)

test('sections: admins see every real section; members read the basics; no team, no sections', () => {
  assert.deepEqual(ids(SECTIONS), ['general', 'members', 'billing', 'ai', 'branding', 'data', 'danger'])
  assert.deepEqual(ids(teamSettingsSections({ inTeam: true, admin: true, owner: true, billing: true })), ids(SECTIONS))
  assert.deepEqual(ids(teamSettingsSections({ inTeam: true, admin: true, owner: false, billing: false })), ['general', 'members', 'ai', 'branding', 'data', 'danger'])
  assert.deepEqual(ids(teamSettingsSections({ inTeam: true, admin: false, owner: false, billing: true })), ['general', 'members', 'billing'])
  assert.deepEqual(teamSettingsSections({ inTeam: false, admin: true, owner: true, billing: true }), [])
})

test('the asked section opens only when this person sees it', () => {
  const member = teamSettingsSections({ inTeam: true, admin: false, owner: false, billing: false })
  assert.equal(pickSection(member, 'danger'), 'general')
  assert.equal(pickSection(member, 'members'), 'members')
  assert.equal(pickSection(member, null), 'general')
  assert.equal(pickSection([], 'general'), null)
})

test('team name: the same characters as before, never empty, no outer spaces, 120 at most', () => {
  for (const ok of ['SBTEST', 'Design Team', 'team_2026', 'North-East']) assert.equal(teamNameProblem(ok), null, ok)
  assert.match(teamNameProblem(''), /Give the team a name/)
  assert.match(teamNameProblem('   ', 'classroom'), /Give the classroom a name/)
  assert.match(teamNameProblem('Team '), /start or end with a space/)
  assert.match(teamNameProblem("Tim's team"), /letters, numbers/)
  assert.match(teamNameProblem('a'.repeat(121)), /under 120/)
})

test('danger zone: only the owner deletes, only once no one else is left, and the copy says what goes', () => {
  const owner = { name: 'Tim Owner', email: 'tim@example.test' }
  assert.equal(deleteTeamState({ implications: null, owner: true, teamName: 'SBTEST' }).state, 'loading')

  const notOwner = deleteTeamState({ implications: { otherUsers: 2, otherSlates: 4, mySlates: 1, orgOwner: owner }, owner: false, teamName: 'SBTEST' })
  assert.equal(notOwner.state, 'not-owner')
  assert.match(notOwner.lines[0], /Only the team's owner, Tim Owner \(tim@example\.test\), can delete SBTEST/)

  const left = deleteTeamState({ implications: { otherUsers: 2, otherSlates: 5, mySlates: 1, orgOwner: owner }, owner: true, teamName: 'SBTEST' })
  assert.equal(left.state, 'members-left')
  assert.match(left.lines[0], /SBTEST still has 2 other members, with 5 slates between them/)
  const oneStudent = deleteTeamState({ implications: { otherUsers: 1, otherSlates: 0, mySlates: 0 }, owner: true, teamName: 'Room 4', noun: 'classroom', people: 'students' })
  assert.match(oneStudent.lines[0], /Room 4 still has 1 other student\.$/)

  const ready = deleteTeamState({ implications: { otherUsers: 0, otherSlates: 0, mySlates: 3 }, owner: true, teamName: 'SBTEST', metered: true, payments: true })
  assert.equal(ready.state, 'ready')
  assert.deepEqual(ready.removed, ['The team SBTEST.', 'Your 3 slates in it.', 'Your Slatebox account. You are signed out and cannot sign in with it again.'])
  assert.ok(ready.first.some((l) => /balance .* back to the card/.test(l)))
  assert.ok(ready.first.some((l) => /Slatebox Business .* ends at once, with no refund/.test(l)))
  assert.ok(ready.first.some((l) => /Slatebox Pro ends at once/.test(l)))
  assert.equal(ready.safety, 'If any of this fails, nothing is removed.')
  // a server without payments or a meter says nothing about balances, Business or Pro
  const plain = deleteTeamState({ implications: { otherUsers: 0, otherSlates: 0, mySlates: 1 }, owner: true, teamName: 'SBTEST' })
  assert.deepEqual(plain.first, [])
  assert.equal(plain.safety, null)
  // nothing anywhere calls the team "your account" alone (the old copy said deleting the team deleted "your account")
  for (const line of [...ready.removed, ...ready.first, ...ready.lines]) assert.doesNotMatch(line, /Once you delete your account/)
})

test('typed confirmation: the exact team name', () => {
  assert.equal(confirmsName('SBTEST', 'SBTEST'), true)
  assert.equal(confirmsName('  SBTEST ', 'SBTEST'), true)
  assert.equal(confirmsName('sbtest', 'SBTEST'), false)
  assert.equal(confirmsName('', 'SBTEST'), false)
  assert.equal(confirmsName('x', ''), false)
})

test('the page keeps the same server paths and checks, and links the pages it does not own', () => {
  const page = app('imports/ui/pages/TeamSettings.jsx')
  // the name is written through the Organizations allow rule (team admin only, name only)
  assert.match(page, /Organizations\.updateAsync\(\{ _id: org\._id \}, \{ \$set: \{ name \} \}\)/)
  assert.match(app('server/permissions.js'), /onlyFields\(fieldNames, \['name'\]\)/)
  // team admin is the admin claim, read as before
  assert.match(page, /AuthManager\.userHasClaim\(userId, \[CONSTANTS\.claims\.admin\._id\]\)/)
  // delete: the organization path, and the page leaves only when the server says it is done
  assert.match(page, /callAsync\(CONSTANTS\.methods\.organizations\.delete\)/)
  assert.match(page, /if \(out\?\.success\) \{\n\s+window\.location\.href = '\/'/)
  assert.match(page, /disabled=\{busy \|\| !confirmsName\(typed, teamName\)\}/)
  // and the server delivers that answer: like users.delete, it releases this connection's login
  // observer before removing the owner, so the result is not lost with the closed connection
  const orgs = app('server/methods/organizations.js')
  const del = orgs.slice(orgs.indexOf('method[CONSTANTS.methods.organizations.delete]'), orgs.indexOf('async function admitSlateGuest'))
  assert.match(del, /async function deleteOrganization\(\)/)
  assert.ok(del.indexOf('Accounts._setLoginToken(user._id, connection, null)') < del.indexOf('Meteor.users.removeAsync({ _id: user._id })'))
  assert.match(del, /if \(connection\) await this\.setUserId\(null\)/)
  // the owner-only, no-one-else-left rule is unchanged
  assert.match(del, /if \(user\?\.orgId && user\.isOrgOwner\)/)
  assert.match(del, /implications\.otherUsers === 0 && implications\.otherSlates === 0/)
  // no amounts in the page: Business prices come from Stripe through BusinessPanel
  assert.doesNotMatch(page, /\$\s?\d|\d+\s?(USD|per month)/)
  // the brand kit and the team page are linked, never rebuilt here
  assert.match(page, /to="\/team\/branding"/)
  assert.match(page, /to="\/team"/)
  assert.doesNotMatch(page, /BrandingSettings|ManageOrganization/)
  // the team AI is the same Level the AI tab uses, at level team
  assert.match(page, /<Level settings=\{settings\} level="team"/)
  assert.match(app('imports/ui/components/profile/AISettings.jsx'), /export function Level\(/)
})
