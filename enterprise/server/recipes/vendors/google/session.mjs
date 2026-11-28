// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// ctx.vendor.google for one recipe run (design B.7): the owner's own Google token, drive.file only,
// so a recipe reads only the files the owner picked in the Google Picker (or Slatebox made). Every
// call counts against the run's vendor budget. A refused token is renewed once (the vault's lease),
// then the recipe waits for "connect again".
//   files.get                 Drive, 1 call: a file's name, kind, version and link (the poll's whole cost)
//   spreadsheets.get          Sheets, the tab names (fields=sheets.properties)
//   spreadsheets.values.get   Sheets, one range (300 reads a minute a project, 60 a user)
//   documents.get             Docs, the body's paragraphs and tables only (300 reads a minute a project)
// All three APIs take drive.file for a picked file.

export const GOOGLE_BASES = Object.freeze({ drive: 'https://www.googleapis.com', sheets: 'https://sheets.googleapis.com', docs: 'https://docs.googleapis.com' })
export const GOOGLE_RECIPE_LIMITS = Object.freeze({ bytes: 4 * 1024 * 1024, rows: 2000, columns: 26, cellChars: 500 })
const FILE_ID = /^[A-Za-z0-9_-]{10,128}$/
const DOC_FIELDS = 'title,revisionId,body(content(paragraph(elements(textRun(content)),paragraphStyle(namedStyleType,headingId)),table(tableRows(tableCells(content(paragraph(elements(textRun(content)))))))))'

export class GoogleRecipeError extends Error {
  constructor(code, status) {
    super(`Google answered ${code}`)
    this.name = 'GoogleRecipeError'
    this.code = code
    this.status = status
  }
}
export class GoogleSignInNeeded extends Error {
  constructor() {
    super('Connect Google again on the Integrations page.')
    this.name = 'SignInNeeded'
    this.code = 'needs_sign_in'
  }
}

/** A1 notation for a tab and a range ('Roster'!A1:Z2000), the tab name quoted as Sheets wants. */
export const a1 = (tab, range) => `'${String(tab).replace(/'/g, "''")}'!${range}`
/** The column letter for an index (0 → A, 26 → AA). */
export function columnLetter(index) {
  let n = index + 1
  let out = ''
  while (n > 0) {
    const r = (n - 1) % 26
    out = String.fromCharCode(65 + r) + out
    n = Math.floor((n - 1) / 26)
  }
  return out
}

/**
 * deps: { userId, tokenFor(userId, { force }) → token, fetch (the guarded fetch), bases,
 *         budget { take(kind, n) → bool } | null, signal, writable }
 * writable adds writeValues: only perform() asks for it, after the owner allowed the write; a
 * recipe's session never has it.
 */
export function createGoogleRecipeSession({ userId, tokenFor, fetch, bases = GOOGLE_BASES, budget = null, signal = null, writable = false }) {
  const calls = {}
  const fileOk = (id) => {
    if (!FILE_ID.test(id || '')) throw new GoogleRecipeError('bad_file_id', 400)
  }

  async function api(what, method, url, body = null, retried = false) {
    if (signal?.aborted) throw Object.assign(new Error('timeout'), { name: 'AbortError', code: 'timeout' })
    if (!retried && budget && !budget.take('vendorCalls', 1)) throw Object.assign(new Error('The run\'s vendor call budget is spent.'), { name: 'RecipeBudgetSpent', code: 'budget' })
    calls[what] = (calls[what] || 0) + (retried ? 0 : 1)
    let token
    try {
      token = await tokenFor(userId, { force: retried })
    } catch {
      throw new GoogleSignInNeeded()
    }
    if (!token) throw new GoogleSignInNeeded()
    let response
    try {
      response = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/json', ...(body && { 'content-type': 'application/json' }) }, ...(body && { body: JSON.stringify(body) }), ...(signal && { signal }) })
    } catch {
      if (signal?.aborted) throw Object.assign(new Error('timeout'), { name: 'AbortError', code: 'timeout' })
      throw new GoogleRecipeError('unreachable', 502)
    }
    if (response.status === 401 && !retried) return api(what, method, url, body, true)
    if (response.status === 401) throw new GoogleSignInNeeded()
    if (response.status === 403) throw new GoogleRecipeError('forbidden', 403)
    if (response.status === 404) throw new GoogleRecipeError('not_found', 404)
    if (response.status === 429) throw new GoogleRecipeError('rate_limited', 429)
    if (!response.ok) throw new GoogleRecipeError('failed', response.status >= 500 ? response.status : 502)
    const text = await response.text()
    if (text.length > GOOGLE_RECIPE_LIMITS.bytes) throw new GoogleRecipeError('too_large', 413)
    try {
      return JSON.parse(text || '{}')
    } catch {
      throw new GoogleRecipeError('bad_answer', 502)
    }
  }

  return {
    name: 'google',
    calls,

    /** A file's name, kind, version (bumps on every change), modified time and link. */
    async fileMeta(fileId) {
      fileOk(fileId)
      const json = await api('files.get', 'GET', `${bases.drive}/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,version,modifiedTime,webViewLink`)
      return { id: json.id, name: String(json.name || 'Untitled').slice(0, 200), mimeType: json.mimeType, version: String(json.version || ''), modifiedTime: json.modifiedTime || null, link: typeof json.webViewLink === 'string' && json.webViewLink.startsWith('https://') ? json.webViewLink : null }
    },

    /** A spreadsheet's tabs: [{ title, sheetId, rows, columns }]. */
    async sheetTabs(fileId) {
      fileOk(fileId)
      const json = await api('spreadsheets.get', 'GET', `${bases.sheets}/v4/spreadsheets/${encodeURIComponent(fileId)}?fields=${encodeURIComponent('properties.title,sheets.properties(title,sheetId,gridProperties)')}`)
      return (json.sheets || []).map((s) => ({ title: String(s.properties?.title || ''), sheetId: s.properties?.sheetId, rows: s.properties?.gridProperties?.rowCount || 0, columns: s.properties?.gridProperties?.columnCount || 0 }))
    },

    /** One range's values as text (formatted as the sheet shows them), capped in rows, columns and characters. */
    async sheetValues(fileId, range) {
      fileOk(fileId)
      const json = await api('values.get', 'GET', `${bases.sheets}/v4/spreadsheets/${encodeURIComponent(fileId)}/values/${encodeURIComponent(range)}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`)
      return (json.values || []).slice(0, GOOGLE_RECIPE_LIMITS.rows + 1).map((row) => row.slice(0, GOOGLE_RECIPE_LIMITS.columns).map((cell) => String(cell ?? '').slice(0, GOOGLE_RECIPE_LIMITS.cellChars)))
    },

    /** A Doc's title, revision, paragraphs (with heading levels and ids) and tables, as plain data. */
    async document(fileId) {
      fileOk(fileId)
      const json = await api('documents.get', 'GET', `${bases.docs}/v1/documents/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(DOC_FIELDS)}`)
      const runs = (elements) => (elements || []).map((e) => e.textRun?.content || '').join('')
      const blocks = []
      for (const item of json.body?.content || []) {
        if (item.paragraph) {
          const style = item.paragraph.paragraphStyle || {}
          blocks.push({ type: 'paragraph', text: runs(item.paragraph.elements).replace(/\n$/, ''), style: style.namedStyleType || 'NORMAL_TEXT', ...(style.headingId && { headingId: style.headingId }) })
        } else if (item.table) {
          blocks.push({ type: 'table', rows: (item.table.tableRows || []).map((row) => (row.tableCells || []).map((cell) => (cell.content || []).map((c) => runs(c.paragraph?.elements).replace(/\n$/, '')).join(' ').trim())) })
        }
      }
      return { id: fileId, title: String(json.title || 'Untitled').slice(0, 200), revisionId: json.revisionId || null, blocks }
    },

    ...(writable && {
      /** Writes one range (perform only). */
      async writeValues(fileId, range, values) {
        fileOk(fileId)
        return api('values.update', 'PUT', `${bases.sheets}/v4/spreadsheets/${encodeURIComponent(fileId)}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`, { range, majorDimension: 'ROWS', values })
      },
    }),
  }
}
