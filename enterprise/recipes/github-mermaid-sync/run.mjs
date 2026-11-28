// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// G3 run, per mapped slate and its file:
//   repo → slate  when a push to the default branch touched the file (or on Run now, or the first
//                 time): the file read at that commit. A file whose body hash is one Slatebox wrote
//                 (its own merged pull request) only moves the base. Any other edit is merged three
//                 ways (merge.mjs) and read onto the slate with sync plans (adds, text and shape
//                 changes, lines; never a move); a conflict keeps the canvas and leaves a note.
//   slate → repo  the slate written as canonical Mermaid (moving notes changes nothing). When its
//                 hash differs from what the pull request last carried (or, with none open, from
//                 the file), the file goes in one commit on the slatebox/ branch and one open pull
//                 request (a ProposedWrite: the runtime sends it only under the standing permission,
//                 else it is an action card). The commit carries Slatebox-Recipe-Run: <run id>.
//                 It runs after a person's edits (slate_saved, 10 minutes after a slate's last
//                 save), after Living architecture changed a mapped slate (recipe_event), and on
//                 Run now or "Save to repo now" (manual): each is the same export.
// The first contact with a file that already exists never changes the slate: the canvas is the truth
// until the two have agreed once. A conflict stays (its note on the slate, its line in the pull
// request) until the canvas version is merged or a later merged edit no longer disagrees. Loop prevention: our own merged body is recognized by its hash,
// and an import that changes nothing exports nothing new.
import { applyPlanToJSON } from 'slateboxjs/operations'
import { bodyHashOf, canonicalFromModel, canonicalGraph, extractMermaid, parseMermaid, slateToMermaid, syncPlans } from '/imports/api/common/mermaid/index.mjs'
import { graphChanges, mergeGraphs } from './merge.mjs'

const KEEP_PROPOSED = 5
const KEEP_CONFLICTS = 50

/** A conflict as the cursor keeps it, and its note on the slate. */
const conflictRow = (path, c) => ({
  kind: c.kind, id: c.id,
  text: c.reason === 'frame'
    ? `${path} puts “${c.canvas.text}” in another group. Notes are never moved for you: move it on the canvas to match.`
    : `Changed in both places: “${c.canvas?.text ?? c.canvas?.label ?? c.id}” here, “${c.repo?.text ?? c.repo?.label ?? 'removed'}” in ${path}. The canvas version is kept.`,
})
const slug = (name) => `${name ?? ''}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'diagram'

/** The file's Mermaid (a .md file holds it in a ```mermaid block). */
const mermaidOf = (text) => extractMermaid(text)

function fileText(out, format, name) {
  if (format !== 'md') return out.mermaid
  return `<!-- Kept by Slatebox from the slate "${`${name}`.replace(/--+/g, '-').slice(0, 100)}". Edit it here or on the canvas: both stay in step. -->\n\n\`\`\`mermaid\n${out.mermaid}\`\`\`\n`
}

function applyAll(slate, plans) {
  let out = slate
  for (const plan of plans) out = applyPlanToJSON(out, plan, { userMessage: 'sync', requireMatches: true }).slate
  return out
}

export default async function run(ctx) {
  const config = { folder: 'docs/architecture/', branch: 'slatebox/architecture', format: 'mmd', direction: 'LR', reviewers: [], ...ctx.instance.config }
  const trigger = ctx.run.trigger || {}
  const github = ctx.vendor.github
  const cursor = { files: {}, ...(ctx.instance.cursor || {}) }
  const folder = config.folder && !config.folder.endsWith('/') ? `${config.folder}/` : config.folder || ''
  const push = trigger.kind === 'vendor' && trigger.event === 'github.push' && trigger.repo === config.repo ? trigger : null
  const slates = []
  const files = []
  const lines = []
  const allConflicts = []
  let ref = push?.after ?? null

  for (const map of config.maps || []) {
    const got = await ctx.slates.read({ shareId: map.shareId })
    if (!got?.slate) {
      ctx.log('warn', 'slate_missing', `the slate ${map.shareId} is not in this project`)
      continue
    }
    const { slate, revision, slateId } = got
    const exclude = got.metaNoteIds || []
    const path = map.file || `${folder}${slug(slate.options?.name)}.${config.format === 'md' ? 'md' : 'mmd'}`
    const entry = { proposed: [], base: null, synced: null, conflicts: [], ...(cursor.files[path] || {}), shareId: map.shareId }
    const ours = canonicalGraph(slate, { exclude })
    const name = `${slate.options?.name ?? 'Diagram'}`

    // Repo → slate.
    const readFile = !entry.synced || (push ? (push.paths || []).includes(path) : trigger.kind === 'manual')
    let theirsText = null
    if (readFile) {
      if (!ref) ref = (await github.head(config.repo)).sha
      theirsText = await github.contents(config.repo, path, ref)
      entry.commit = ref
    }
    let after = slate
    let fileGraph = entry.base
    if (theirsText !== null) {
      const hash = bodyHashOf(mermaidOf(theirsText))
      let theirs
      try {
        theirs = canonicalFromModel(parseMermaid(mermaidOf(theirsText)))
      } catch {
        ctx.log('warn', 'file_unreadable', `${path} is not a Mermaid flowchart Slatebox can read; it is left as it is`)
        theirs = null
      }
      if (theirs) {
        fileGraph = theirs
        if (hash === entry.synced || entry.proposed.includes(hash)) {
          // Our own body, merged: the base moves; nothing to read onto the slate. What we proposed
          // before it is merged with it (or was replaced by it).
          entry.base = theirs
          entry.synced = hash
          entry.proposed = entry.proposed.includes(hash) ? entry.proposed.slice(entry.proposed.indexOf(hash) + 1) : entry.proposed
          // the canvas version of every conflict is in the file now
          entry.conflicts = []
        } else if (!entry.base) {
          // First contact with an existing file: the canvas stays as it is; the file will follow it.
          ctx.log('info', 'first_contact', `${path} exists; the slate is kept and the file will follow it`)
        } else {
          const { merged, conflicts } = mergeGraphs(entry.base, ours, theirs)
          const sync = syncPlans(merged, { current: slate, base: ours, direction: config.direction })
          if (sync.plans.length) {
            after = applyAll(slate, sync.plans)
            ctx.emit('mermaid.sync.imported', { file: path, slateId, added: sync.created.length, changed: sync.updated.length, removed: sync.deleted.length + sync.disconnected.length })
          }
          if (conflicts.length) ctx.emit('mermaid.sync.conflict', { file: path, elements: conflicts.map((c) => `${c.kind}:${c.id}`) })
          // this merge's conflicts replace the last ones (an element both sides now agree on is done)
          entry.conflicts = conflicts.map((c) => conflictRow(path, c)).slice(0, KEEP_CONFLICTS)
          if (sync.plans.length) slates.push({ role: 'mapped', key: map.shareId, slateId, expectedRevision: revision, plans: sync.plans, notes: [] })
          entry.base = theirs
          entry.synced = hash
        }
      }
    }

    // Slate → repo.
    const out = slateToMermaid(after, { canonical: true, direction: config.direction, shareId: map.shareId, revision, exclude })
    const legend = { key: `legend:${path}`, text: `Synced with ${config.repo} ${path}${entry.commit ? ` @ ${entry.commit.slice(0, 7)}` : ''}`, link: { url: `https://github.com/${config.repo}/blob/HEAD/${path.split('/').map(encodeURIComponent).join('/')}` }, anchor: 'legend' }
    const notes = [...entry.conflicts.map((c) => ({ key: `conflict:${path}:${c.kind}:${c.id}`, text: c.text, anchor: 'legend' })), legend]
    allConflicts.push(...entry.conflicts.map((c) => ({ file: path, kind: c.kind, id: c.id })))
    const listed = slates.find((s) => s.key === map.shareId)
    if (listed) listed.notes.push(...notes)
    else slates.push({ role: 'mapped', key: map.shareId, slateId, expectedRevision: revision, plans: [], notes })
    // Against the branch: what the open pull request last carried, else the file on the default branch.
    // Run now and Save to repo now offer the file whenever it differs from the default branch: what
    // was proposed may have waited as an approval card (the vendor commits only what the branch lacks).
    const fileNow = theirsText !== null ? bodyHashOf(mermaidOf(theirsText)) : entry.synced
    const branchNow = trigger.kind === 'manual' ? fileNow : entry.proposed.at(-1) ?? fileNow
    if (out.hash !== branchNow) {
      files.push({ path, content: fileText(out, config.format, name) })
      lines.push(`- \`${path}\`: ${graphChanges(fileGraph, canonicalGraph(after, { exclude }))}`)
      entry.proposed = [...entry.proposed.filter((h) => h !== out.hash), out.hash].slice(-KEEP_PROPOSED)
    }
    cursor.files[path] = entry
  }
  ctx.setCursor(cursor)

  const writes = []
  if (files.length) {
    const body = [
      'Slatebox keeps these diagrams in step with their slates. Merge this pull request to bring the files up to date; edit the files in any pull request and the slates follow once it merges.',
      '',
      ...lines,
      ...(allConflicts.length ? ['', 'Changed in both places (the canvas version is kept):', ...allConflicts.map((c) => `- \`${c.file}\`: ${c.kind} ${c.id}`)] : []),
    ].join('\n')
    writes.push({
      kind: 'github.pull_request',
      target: { repo: config.repo, branch: `refs/heads/${config.branch}` },
      body: { files, title: 'Update architecture diagrams', message: 'Update architecture diagrams', body, trailer: `Slatebox-Recipe-Run: ${ctx.run.id}`, reviewers: config.reviewers },
      key: `mermaid-sync:${config.repo}`,
      events: { opened: 'mermaid.sync.pr_opened', updated: 'mermaid.sync.pr_updated' },
    })
  }
  return {
    desired: { slates },
    writes,
    summary: files.length ? `${files.length} diagram file${files.length === 1 ? '' : 's'} to update in ${config.repo}.` : 'The diagrams and their files agree.',
  }
}
