// The signed-out "Create slate" first run: one call makes the visitor's first slate from their answer
// (a job and its second answer, their own words, or Skip), with no agent call and nothing metered. The
// board comes from the plan (imports/api/common/first-slate.mjs, built by server/first-slate-board.mjs);
// the slate is stored once per request id (a retry gets the same slate); the answer is kept on the
// account as profile.start, so the next "Create slate" opens a blank slate instead of asking again.
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import { DDPRateLimiter } from 'meteor/ddp-rate-limiter'
import CONSTANTS from '../../imports/api/common/constants'
import { FIRST_SLATE_VERSION, FIRST_TEXT_LIMIT, JOBS, firstSlatePlan, firstTextPlan, validWith, viaOfAnswer } from '../../imports/api/common/first-slate.mjs'
import { firstSlateContent } from '../first-slate-board.mjs'
import { createWorkshopSlate } from './creative-slates'
import { Slates } from '../../imports/api/common/models'

const VIA = ['card', 'text', 'skip', 'deeplink']
const jobIds = JOBS.map(job => job.id)

/** The plan an answer names, or a refusal said in plain words. */
export function planOfAnswer({ job, with: withId, text, via }) {
  if (via === 'skip') return firstSlatePlan({})
  if (typeof text === 'string' && text.trim()) {
    try { return firstTextPlan(text) } catch (error) { throw new Meteor.Error('invalid-answer', error.message) }
  }
  if (!jobIds.includes(job) || !validWith(job, withId)) throw new Meteor.Error('invalid-answer', 'Pick one of the boards, or say it in your own words.')
  return firstSlatePlan({ job, with: withId })
}

Meteor.methods({
  async [CONSTANTS.methods.firstSlate.create](answer) {
    check(answer, {
      job: Match.Optional(Match.OneOf(null, ...jobIds)),
      with: Match.Optional(Match.OneOf(null, Match.Where(value => typeof value === 'string' && value.length <= 20))),
      text: Match.Optional(Match.OneOf(null, Match.Where(value => typeof value === 'string' && value.length <= FIRST_TEXT_LIMIT))),
      via: Match.OneOf(...VIA),
      requestId: Match.Where(value => typeof value === 'string' && /^[a-zA-Z0-9]{17}$/.test(value)),
    })
    const user = await Meteor.userAsync()
    if (!user) throw new Meteor.Error('sign-in', 'Open Slatebox again to start a board.')
    const plan = planOfAnswer(answer)
    let content
    try { content = firstSlateContent(plan) } catch (error) { throw new Meteor.Error('invalid-answer', error.message) }
    const shareId = await createWorkshopSlate(user, content, 'first-' + user._id + '-' + answer.requestId, 'first-run')
    // What they answered, and nothing else about them.
    const start = { job: plan.job ?? null, with: plan.with ?? null, via: viaOfAnswer(answer), resolved: plan.key, at: new Date(), v: FIRST_SLATE_VERSION }
    await Meteor.users.updateAsync({ _id: user._id }, { $set: { 'profile.start': start } })
    return shareId
  },
  // Share was opened once on a first-run slate: its one-time label ("Invite your team") is not shown again.
  async [CONSTANTS.methods.firstSlate.shareSeen](shareId) {
    check(shareId, Match.Where(value => typeof value === 'string' && /^[A-Za-z0-9]{1,40}$/.test(value)))
    if (!this.userId) return false
    // Only the owner's label, and only a field of the slate's options (no drawing is touched, no revision moves).
    const changed = await Slates.updateAsync({ shareId, userId: this.userId, 'options.firstRun.v': FIRST_SLATE_VERSION }, { $set: { 'options.firstRun.shareSeen': true } })
    return changed > 0
  },
})

// Anyone may start once a click. A script must not fill the database: five a minute per connection, and
// since a new connection is cheap, thirty a minute per address (an office shares one) and ten per account as well.
const create = CONSTANTS.methods.firstSlate.create
DDPRateLimiter.addRule({ type: 'method', name: create, connectionId: () => true }, 5, 60000)
DDPRateLimiter.addRule({ type: 'method', name: create, clientAddress: () => true }, 30, 60000)
DDPRateLimiter.addRule({ type: 'method', name: create, userId: userId => Boolean(userId) }, 10, 60000)
DDPRateLimiter.addRule({ type: 'method', name: CONSTANTS.methods.firstSlate.shareSeen, connectionId: () => true }, 10, 60000)
