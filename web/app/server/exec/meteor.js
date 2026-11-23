// The Meteor side of exec: real collections, the runner child's path in the bundle, and the
// operator's limits. Everything it builds is in system.mjs and runs without Meteor in tests.
import { Meteor } from 'meteor/meteor'
import { Mongo } from 'meteor/mongo'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { SlateAccess, Slates } from '../../imports/api/common/models'
import { slateVisibility } from '../methods/slate-role.mjs'
import { createExecSystem } from './system.mjs'
import { ensureExecIndexes } from './audit.mjs'
import { resolveExecLimits } from './limits.mjs'

const ExecRuns = new Mongo.Collection('execRuns')
const ExecConfirmations = new Mongo.Collection('execConfirmations')
const ExecLocks = new Mongo.Collection('execLocks')

// The runner child reads `run` from the server bundle's own node_modules, as sdk-chat.cjs loads
// its pinned packages, and nothing else of the app.
const serverRequire = () =>
  createRequire(
    typeof __meteor_bootstrap__ === 'undefined'
      ? join(process.cwd(), 'package.json')
      : join(__meteor_bootstrap__.serverDir, 'npm', 'package.json')
  )

export const execLimits = () =>
  resolveExecLimits({
    ...(Meteor.settings.public?.env === 'selfhost' ? Meteor.settings.selfHosted?.exec : {}),
    ...(Number.isSafeInteger(Meteor.settings.exec?.auditDays) && { auditDays: Meteor.settings.exec.auditDays }),
  })

// Who can see a slate: private (only its people), invite (an unlisted link or named people),
// public. A save to a wider audience than a script read from is held for confirmation.
export async function audienceOf(slate) {
  const type = slateVisibility(slate)
  if (type === 'public') return 'public'
  if (type === 'unlisted') return 'invite'
  const shared = await SlateAccess.findOneAsync(
    { slateId: slate._id, type: 'private', userId: { $nin: [null, slate.userId] } },
    { fields: { _id: 1 } }
  )
  return shared ? 'invite' : 'private'
}

export const readSlateByShareId = (shareId) =>
  typeof shareId === 'string' ? Slates.findOneAsync({ shareId }) : null

export function createMeteorExec({ registry, idempotency, readSlate = readSlateByShareId, pool, presence = null }) {
  const collections = {
    runs: ExecRuns.rawCollection(),
    confirmations: ExecConfirmations.rawCollection(),
    locks: ExecLocks.rawCollection(),
  }
  const system = createExecSystem({
    registry,
    idempotency,
    collections,
    readSlate,
    audienceOf,
    childPath: Assets.absoluteFilePath('exec/runner-child.mjs'),
    runEntry: serverRequire().resolve('run'),
    limits: execLimits(),
    pool,
    presence,
  })
  return system
}

let indexed = false
export function ensureExecCollections() {
  if (indexed) return
  indexed = true
  Meteor.startup(() =>
    ensureExecIndexes({
      runs: ExecRuns.rawCollection(),
      confirmations: ExecConfirmations.rawCollection(),
      locks: ExecLocks.rawCollection(),
    }).catch((error) => console.error('[exec] could not create indexes:', error.message))
  )
}
