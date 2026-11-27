// Tamper evidence for the activity log, cheap enough to run on every write.
//
// Each entry is written with entryHash = sha256(its canonical JSON) and a seq from its scope's
// counter. One sealer (under a lease) then walks each scope in seq order and sets, once,
// chain = sha256(previous chain ‖ entryHash). Editing an entry breaks its entryHash; deleting one
// leaves a seq missing; rewriting the chain from some point changes the head, which a SIEM that
// pulls GET /api/v1/audit/verify keeps outside Slatebox. A seq that was taken but never written
// (a process stopped between the two writes) is sealed as an explicit audit.gap entry.
// Pure: hashing, sealing order and verification over plain rows.
import { createHash } from 'node:crypto'

export const GENESIS = '0'.repeat(64)

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

// Keys sorted, undefined left out, times as ISO strings: one byte string per entry whatever the
// driver or the key order it came back in.
export function canonical(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString())
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value ?? null)
}

// The fields an entry's hash covers: everything it says, nothing the store adds after.
export const HASHED_FIELDS = Object.freeze(['scope', 'seq', 'at', 'action', 'actor', 'target', 'slateId', 'orgId', 'via', 'ipHash', 'details', 'expiresAt'])

export function entryHash(entry) {
  const covered = {}
  for (const key of HASHED_FIELDS) if (entry[key] !== undefined && entry[key] !== null) covered[key] = entry[key]
  return sha256(canonical(covered))
}

export const chainHash = (previous, hash) => sha256(`${previous}${hash}`)

/**
 * Checks a scope's sealed entries, in seq order, against their own hashes and the chain.
 *   events       the sealed entries, ascending by seq (an array or an async iterable)
 *   checkpoints  { seq, chain } rows the sealer wrote, any order
 * The oldest entry still kept anchors the walk (older ones expired): at seq 1 its chain must
 * follow GENESIS; later, its stored chain is taken as given and checked against any checkpoint.
 * → { ok, checked, firstSeq, headSeq, head, since, problem: null | { seq, kind } }
 *   kind: 'edited' (an entry's content no longer matches its hash), 'missing' (a seq is absent),
 *   'chain' (the link to the entry before is broken), 'checkpoint' (a daily checkpoint disagrees)
 */
export async function verifyChain(events, checkpoints = []) {
  const marks = new Map(checkpoints.map((row) => [row.seq, row.chain]))
  let previous = null
  let lastSeq = null
  let firstSeq = null
  let since = null
  let checked = 0
  const fail = (seq, kind) => ({ ok: false, checked, firstSeq, headSeq: lastSeq, head: previous, since, problem: { seq, kind } })
  for await (const event of events) {
    if (firstSeq === null) {
      firstSeq = event.seq
      since = event.at
    }
    if (lastSeq !== null && event.seq !== lastSeq + 1) return fail(lastSeq + 1, 'missing')
    if (entryHash(event) !== event.entryHash) return fail(event.seq, 'edited')
    const before = previous ?? (event.seq === 1 ? GENESIS : null)
    if (before !== null && chainHash(before, event.entryHash) !== event.chain) return fail(event.seq, 'chain')
    if (marks.has(event.seq) && marks.get(event.seq) !== event.chain) return fail(event.seq, 'checkpoint')
    previous = event.chain
    lastSeq = event.seq
    checked += 1
  }
  return { ok: true, checked, firstSeq, headSeq: lastSeq, head: previous, since, problem: null }
}
