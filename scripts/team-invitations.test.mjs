import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverTeamInvitations } from '../web/app/server/methods/team-invitations.mjs'

const org = { _id: 'crew' }
const first = { email: ' First@local.invalid ', firstName: 'First', lastName: 'Member' }
const second = { email: 'second@local.invalid', firstName: 'Second', lastName: 'Member' }
function fixture() {
  const members = [], envelopes = [], quantities = []
  const io = {
    async byTeamId(orgId, id) { return members.find(m => m._id === id && m.orgId === orgId) },
    async byEmail(email) { return members.find(m => m.emails[0].address === email) },
    async create(orgId, {email}) {
      assert.equal(await this.byEmail(email), undefined)
      const id = 'member-' + members.length
      members.push({ _id: id, orgId, emails: [{address: email, verified: false}] })
      return id
    },
    async send(id, email) {
      assert.equal(typeof id, 'string')
      assert.equal((await this.byTeamId(org._id, id)).emails[0].address, email)
      envelopes.push(email)
    },
    async markSent(orgId, id) { (await this.byTeamId(orgId, id)).teamEnrollmentSentAt = new Date() },
    // There are no seats: the delivery never asks for a seat count.
    async syncSeats() { quantities.push(members.length) },
    mailAvailable: () => true,
    error(code, message) { return Object.assign(new Error(message), {code}) },
  }
  const run = (args = {}) => deliverTeamInvitations({org, invites: [first, second], io, ...args})
  return {run, io, members, envelopes, quantities}
}

test('normalized batch creates distinct members and sends to their stored addresses only once', async () => {
  const {run, members, envelopes, quantities} = fixture()
  assert.equal((await run({invites: [first, first, second]})).sent, 2)
  members[0].services = {password: {bcrypt: 'enrolled'}}
  assert.equal((await run()).sent, 0)
  assert.equal(members.length, 2)
  assert.deepEqual(envelopes, ['first@local.invalid', 'second@local.invalid'])
  assert.deepEqual(quantities, [])
})

test('mail failure leaves one retryable member and preserves invitations already delivered', async () => {
  const {run, io, members, envelopes} = fixture()
  const send = io.send
  io.send = async function(id,email) { if (email === second.email) throw Error('test transport offline'); await send.call(this,id,email) }
  await assert.rejects(run(), {code:'enrollment-delivery'})
  assert.equal(members.length, 2)
  assert.deepEqual(envelopes, ['first@local.invalid'])
  io.send = send
  assert.equal((await run()).sent, 1)
  assert.deepEqual(envelopes, ['first@local.invalid','second@local.invalid'])
  assert.equal(members.length, 2)
  assert.equal((await run({memberIds:[members[1]._id]})).sent, 1)
  assert.equal(members.length, 2)
})

test('there are no seats: inviting any number of people never touches billing', async () => {
  const {run, quantities, members, envelopes} = fixture()
  const formerlyPaid = {...org, subscriptionId:'fixture', isEducationInstitution:false}
  await run({org:formerlyPaid})
  await run({org:formerlyPaid, memberIds:['member-0']})
  assert.equal(members.length, 2)
  assert.equal(envelopes.length, 3)
  assert.deepEqual(quantities, [])
})

test('resend accepts only an existing pending recipient in this team', async () => {
  const {run, members, envelopes} = fixture()
  await run()
  members[0].services = {password:{bcrypt:'enrolled'}}
  await assert.rejects(run({memberIds:['member-0']}), {code:'invalid-invitation'})
  members[1].orgId = 'different-team'
  await assert.rejects(run({memberIds:['member-1']}), {code:'invalid-invitation'})
  await assert.rejects(run({memberIds:['missing']}), {code:'invalid-invitation'})
  assert.equal(envelopes.length, 2)
})

test('disabled mail and invalid input make no accounts or provider calls', async () => {
  const {run, io, members, quantities} = fixture()
  await assert.rejects(run({invites:[first,{...second,email:'bad'}]}), {code:'invalid-invitation'})
  io.mailAvailable = () => false
  await assert.rejects(run(), {code:'mail-disabled'})
  assert.equal(members.length, 0)
  assert.deepEqual(quantities, [])
})
