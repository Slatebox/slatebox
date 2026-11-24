// The plan: everything an install will write, run and create, shown before
// anything changes. It names where secrets go, never what they are.

/**
 * @typedef {{
 *   action: 'install'|'upgrade'|'change'|'uninstall'|'restore'|'export'|'nothing',
 *   target: string, name: string, where: string, address: string|null,
 *   image?: {ref: string, pinned: string, previous?: string},
 *   files: {path: string, note?: string}[], commands: string[], objects: string[],
 *   ports: string[], secretsLocation: string|null, warnings: string[], notes: string[],
 *   changes: string[],
 * }} Plan
 */

export function emptyPlan(fields) {
  return { files: [], commands: [], objects: [], ports: [], secretsLocation: null, warnings: [], notes: [], changes: [], ...fields }
}

export function formatPlan(plan) {
  const lines = []
  const title = {
    install: `Plan: install Slatebox "${plan.name}" on ${plan.where}`,
    upgrade: `Plan: upgrade Slatebox "${plan.name}" on ${plan.where}`,
    change: `Plan: change Slatebox "${plan.name}" on ${plan.where}`,
    uninstall: `Plan: remove Slatebox "${plan.name}" from ${plan.where}`,
    restore: `Plan: restore Slatebox "${plan.name}" on ${plan.where} from a backup`,
    export: `Plan: write the files for Slatebox "${plan.name}"`,
    nothing: `Slatebox "${plan.name}" on ${plan.where}: nothing to change`,
  }[plan.action]
  lines.push(title, '')
  if (plan.address) lines.push(`  Address:   ${plan.address}`)
  if (plan.image) {
    lines.push(`  Image:     ${plan.image.ref}`)
    if (plan.image.pinned !== plan.image.ref) lines.push(`             pinned as ${plan.image.pinned}`)
    if (plan.image.previous && plan.image.previous !== plan.image.pinned) lines.push(`             replacing ${plan.image.previous}`)
  }
  if (plan.ports.length) lines.push(`  Ports:     ${plan.ports.join(', ')}`)
  if (plan.secretsLocation) lines.push(`  Secrets:   ${plan.secretsLocation}`)
  const section = (label, items) => {
    if (!items.length) return
    lines.push('', `  ${label}:`)
    for (const item of items) lines.push(`    - ${item}`)
  }
  section('Changes', plan.changes)
  section('Files', plan.files.map(file => (file.note ? `${file.path} (${file.note})` : file.path)))
  section('Commands', plan.commands)
  section('Objects', plan.objects)
  section('Notes', plan.notes)
  section('Warnings', plan.warnings)
  return lines.join('\n')
}
