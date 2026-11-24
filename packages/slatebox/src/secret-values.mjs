// Turn the secrets an install needs (variable -> reference) into values, once,
// right before they are written to the secrets file or the Kubernetes Secret.
// A value already stored for the install is kept unless its reference can be
// read now (so an upgrade never needs the admin's environment again), and the
// key encryption key is never generated twice.
import { EXIT, InstallError } from './errors.mjs'
import { generateKek, looksLikeKey, resolveRef } from './secrets.mjs'

// A reference is printed in messages, unless it looks like a key typed in its place.
const shown = ref => (ref.startsWith('env:') && looksLikeKey(ref.slice(4)) ? 'a variable name that looks like a key' : ref)

/**
 * @param {Record<string,string>} wanted variable -> reference or 'generate'
 * @param {Record<string,string>} stored values already stored for this install
 * @returns {Promise<{values: Record<string,string>, generated: string[]}>}
 */
export async function secretValues(ctx, wanted, stored = {}) {
  const values = {}
  const generated = []
  const missing = []
  for (const [name, ref] of Object.entries(wanted)) {
    if (ref === 'generate') {
      if (stored[name]) values[name] = stored[name]
      else {
        values[name] = generateKek()
        generated.push(name)
      }
    } else {
      const ask = ctx.interactive && ctx.prompt ? () => ctx.prompt.secret(`Value for ${name} (not shown)`) : undefined
      const value = (ref === 'prompt' && stored[name]) ? stored[name] : (await resolveRef(ref, { env: ctx.env, ask })) ?? stored[name]
      if (value) values[name] = value
      else missing.push({ field: name, question: `${name} comes from ${shown(ref)}, which is empty or unreadable`, flag: ref.startsWith('env:') && shown(ref) === ref ? `export ${ref.slice(4)}=…` : shown(ref), default: null })
    }
    ctx.redactor.add(values[name])
  }
  if (missing.length) {
    throw new InstallError(EXIT.NEEDS_INPUT, `Some keys could not be read: ${missing.map(item => `${item.field} (${shown(wanted[item.field])})`).join(', ')}. Set them and run again.`, { missing })
  }
  return { values, generated }
}
