// What the Providers and keys and Models tabs say, without React (so it is tested under node):
// a connection's key in words, its last test, a model's prices and whether it is unpriced, and the
// forms' text fields turned into the actions' input.

const day = (value) => {
  const at = value ? new Date(value) : null
  return at && !Number.isNaN(at.getTime()) ? at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) : null
}
const tail = (fingerprint) => (typeof fingerprint === 'string' && fingerprint.includes('…') ? `…${fingerprint.split('…').pop()}` : null)

/** A connection's key in words: never the key, only which key it is and where it lives. */
export function keyText(connection) {
  const ref = connection?.keyRef?.kind
  if (ref === 'env') return connection.hasKey ? `Key read from ${connection.keyRef.name}` : `Key read from ${connection.keyRef.name}, which is not set on this server`
  if (ref === 'file') return 'Key in the settings file'
  if (!connection?.hasKey) return 'No key saved'
  const which = tail(connection.keyFingerprint)
  const added = day(connection.keyRotatedAt)
  return `A key is saved${which ? ` (${which}${added ? `, added ${added}` : ''})` : ''}`
}

/** The last Test connection in words. */
export function lastCheckText(connection) {
  const check = connection?.lastCheck
  if (!check) return 'Not tested yet'
  const when = day(check.at)
  if (check.ok) return `Worked${typeof check.latencyMs === 'number' ? ` in ${check.latencyMs} ms` : ''}${when ? ` on ${when}` : ''}`
  return `Failed${when ? ` on ${when}` : ''}: ${check.error || 'no answer'}`
}

/** A Test connection result in one sentence ("Answered in 820 ms, tools work, pictures: not claimed"). */
export function checkResultText(result, connection = {}) {
  if (!result) return ''
  if (!result.ok) return result.message || 'The test failed.'
  const parts = [`Answered${typeof result.latencyMs === 'number' ? ` in ${result.latencyMs} ms` : ''}`]
  if (result.tools === 'yes') parts.push('tools work')
  else if (result.tools === 'no') parts.push('tools do not work')
  if (connection.capabilities) parts.push(`pictures: ${connection.capabilities.vision === true ? 'claimed' : 'not claimed'}`)
  return parts.join(', ')
}

const dollars = (value) => (typeof value === 'number' ? `$${value}` : '–')
/** A model's prices per million tokens in and out (or per image). */
export function priceText(model) {
  const p = model?.prices
  if (!p) return 'Unpriced'
  if (typeof p.inputPerM === 'number' && typeof p.outputPerM === 'number') return `${dollars(p.inputPerM)} in · ${dollars(p.outputPerM)} out per million`
  if (typeof p.imageEach === 'number') return `${dollars(p.imageEach)} per picture`
  return 'Unpriced'
}

/** Whether a model row has a price (the server also accepts a table or settings-file price: warnings say which are unpriced). */
export const hasOwnPrice = (model) => priceText(model) !== 'Unpriced'

/** "name: value" lines to an extraHeaders object; throws with a plain message for a bad line. */
export function parseHeaders(text) {
  const out = {}
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const at = line.indexOf(':')
    if (at < 1) throw new Error(`Write each header as name: value (${line.slice(0, 40)}).`)
    out[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  return out
}

/** A number field: blank is null, otherwise a number (or NaN for the form to refuse). */
export const numberOrNull = (text) => (String(text ?? '').trim() === '' ? null : Number(text))

/** The model ids that are unpriced, from ai.control.get's warnings. */
export const unpricedIds = (warnings = []) => new Set(warnings.filter((w) => w.kind === 'unpriced').map((w) => w.id))

// The Add a connection and Add provider forms as they open. Every field the dialogs read on their
// first render is here (a form that started empty and was filled after the first render blanked
// the page: form.name.trim() of undefined).
export function connectionFormDefaults(open = null) {
  return { provider: (open && open.provider) || 'openai-compatible', name: '', baseUrl: '', model: '', apiKey: '', fromEnv: false, envName: 'SLATEBOX_AI_KEY_', tools: true, vision: false, images: false }
}
export function providerFormDefaults() {
  return { id: '', label: '', protocol: 'openai-chat', baseUrl: '', baseUrlLocked: true, authStyle: 'bearer', authName: '', headers: '', caps: { tools: true } }
}

/**
 * The Add a model / Change form as it opens (open: { model?, connection?, modelName? } or null
 * while closed). Every field a Select or text field reads is set from the first render, so no
 * field turns from uncontrolled to controlled when the dialog fills.
 */
export function modelFormDefaults(open = null, connections = [], builtin = []) {
  const m = open?.model || {}
  return {
    connection: m.connection || open?.connection || connections[0] || builtin[0] || '', model: m.model || open?.modelName || '', label: m.label || '',
    caps: m.capabilities || { tools: true }, maxContext: m.maxContext ?? '', maxOutput: m.maxOutput ?? '',
    inputPerM: m.prices?.inputPerM ?? '', outputPerM: m.prices?.outputPerM ?? '', status: m.status || 'enabled', existing: Boolean(open?.model),
  }
}
