import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {runInNewContext} from 'node:vm'

const read = path => readFile(new URL(path, import.meta.url), 'utf8')
const profile = await read('../imports/ui/pages/Profile.jsx')
const team = await read('../imports/ui/pages/TeamSettings.jsx')
assert.match(profile, /callAsync\(CONSTANTS\.methods\.users\.delete\)/)
assert.doesNotMatch(profile, /callAsync\(CONSTANTS\.methods\.organizations\.delete\)/)
assert.match(team, /callAsync\(CONSTANTS\.methods\.organizations\.delete\)/)

const source = await read('../server/methods/users.js')
const methodBody = source.split('method[CONSTANTS.methods.users.delete] = ')[1].split('\nmethod[')[0]
const people = [{_id:'owner'}, {_id:'other'}, {_id:'member', orgId:'team'}]
function collection(rows) {
  return {rows, async removeAsync(selector) {
    for (let index = rows.length - 1; index >= 0; index--) {
      const row = rows[index]
      if (Object.entries(selector).every(([key,value]) => row[key] === value)) rows.splice(index,1)
    }
  }}
}
const users = collection(people.slice())
let signedIn
const refunds = []
let refundFails = false
const environment = {
  Meteor: {userAsync:async () => signedIn, users, Error: class extends Error { constructor(code, reason) { super(reason); this.error = code; this.reason = reason } }},
  JoinedSlates: {removeAsync: async () => 0},
  SlatePresentations: {removeAsync: async () => 0},
  // A balance is refunded before anything is removed; a failed refund removes nothing.
  refundBalance: async walletId => { if (refundFails) throw new Error('card gone'); refunds.push(walletId) },
  removeAccountAfterRefund: async ({refund, remove}) => {
    try { await refund() } catch { throw new Error('We could not refund your balance. Nothing was removed. Try again or write to us at https://slatebox.com/contact/?topic=billing.') }
    return remove()
  },
}
const names = ['Slates','Messages','SlateApiTokens','SlateOperationRuns']
for (const name of names) environment[name] = collection(people.map(person => ({userId:person._id})))
const remove = runInNewContext('(' + methodBody.trim() + ')',environment)
for (const actor of [null,people[2]]) {
  signedIn = actor
  assert.equal(await remove.call({}),false)
  assert.equal(users.rows.length,3)
  for (const name of names) assert.equal(environment[name].rows.length,3)
}
signedIn = people[0]
refundFails = true
await assert.rejects(remove.call({}), {reason: 'We could not refund your balance. Nothing was removed. Try again or write to us at https://slatebox.com/contact/?topic=billing.'})
assert.equal(users.rows.length,3)
for (const name of names) assert.equal(environment[name].rows.length,3)
refundFails = false
const connection = {id:'initiator'}
let observerRemoved = false, signedOut = false
environment.Accounts = {
  _getLoginToken: id => { assert.equal(id,connection.id); return 'fixture-session' },
  _setLoginToken(userId, client, token) {
    assert.equal(userId,people[0]._id)
    assert.equal(client,connection)
    assert.equal(token,null)
    observerRemoved = true
  },
}
const deleteUser = users.removeAsync.bind(users)
users.removeAsync = selector => { assert.equal(observerRemoved,true); return deleteUser(selector) }
assert.equal(await remove.call({connection,setUserId:id=>{assert.equal(id,null); signedOut = true}}),true)
assert.equal(signedOut,true)
assert.deepEqual(refunds,['user:owner'])
assert.deepEqual(users.rows,[people[1],people[2]])
for (const name of names) assert.deepEqual(environment[name].rows.map(row => row.userId),['other','member'])
console.log('Individual self-removal is scoped to the signed-in account, including its API credentials; team removal uses the organization path.')
