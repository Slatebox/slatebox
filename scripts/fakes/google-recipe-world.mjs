// A Google Drive, Sheets and Docs for the Google recipes' tests (MIT, test support): a fake fetch
// that answers the calls the Google vendor makes (files.get, files.watch, channels.stop,
// spreadsheets.get, values.get, values.update, documents.get), checks the bearer token, and counts
// every call by API. No network.
import { createVendor } from '../../enterprise/server/recipes/vendors/google/index.mjs'
import { memoryWatchStores } from '../../enterprise/server/recipes/vendors/google/watch.mjs'
import { countingBudget, recipeContext } from './recipe-lite-context.mjs'

export const OWNER = 'owner1'
export const BASES = { drive: 'https://www.googleapis.com', sheets: 'https://sheets.googleapis.com', docs: 'https://docs.googleapis.com' }

/** A 30-person roster: a CEO, 3 VPs, 6 managers, 20 people; departments by VP. */
export function roster() {
  const rows = [['Name', 'Title', 'Manager', 'Department'], ['Mara Chen', 'CEO', '', 'Leadership']]
  const vps = [['Ivan Ortiz', 'VP Engineering', 'Engineering'], ['Lena Park', 'VP Sales', 'Sales'], ['Omar Haddad', 'VP Operations', 'Operations']]
  let k = 0
  for (const [vp, title, dept] of vps) {
    rows.push([vp, title, 'Mara Chen', dept])
    for (let m = 0; m < 2; m++, k++) {
      const manager = `${dept} Manager ${m + 1}`
      rows.push([manager, 'Manager', vp, dept])
      for (let r = 0; r < (k < 4 ? 3 : 4); r++) rows.push([`${dept} Person ${m + 1}.${r + 1}`, 'Specialist', manager, dept])
    }
  }
  return rows
}

export function googleWorld({ files = {}, verified = [] } = {}) {
  // token: what Google accepts; vault: what the vault hands out; refreshed: what a forced renewal hands out.
  const state = { token: 'ya29.test-token', vault: 'ya29.test-token', refreshed: null, calls: {}, writes: [], watches: [], stops: [], files }
  const count = (what) => (state.calls[what] = (state.calls[what] || 0) + 1)
  const answer = (status, json) => ({ ok: status >= 200 && status < 300, status, text: async () => (json === undefined ? '' : JSON.stringify(json)), headers: { get: () => null } })
  async function fetch(url, init = {}) {
    const u = new URL(url)
    if (!Object.values(BASES).includes(u.origin)) throw new Error('not a Google address: ' + u.origin)
    if (init.headers?.authorization !== `Bearer ${state.token}`) return answer(401, { error: { code: 401 } })
    const path = decodeURIComponent(u.pathname)
    let m
    if ((m = path.match(/^\/drive\/v3\/files\/([^/]+)$/)) && init.method === 'GET') {
      count('files.get')
      const f = state.files[m[1]]
      return f ? answer(200, { id: m[1], name: f.name, mimeType: f.mimeType, version: String(f.version), modifiedTime: '2026-11-27T10:00:00Z', webViewLink: `https://docs.google.com/x/${m[1]}` }) : answer(404, {})
    }
    if ((m = path.match(/^\/drive\/v3\/files\/([^/]+)\/watch$/))) {
      count('files.watch')
      const body = JSON.parse(init.body)
      state.watches.push({ fileId: m[1], ...body })
      return answer(200, { kind: 'api#channel', id: body.id, resourceId: 'res-' + m[1], expiration: String(body.expiration) })
    }
    if (path === '/drive/v3/channels/stop') {
      count('channels.stop')
      state.stops.push(JSON.parse(init.body))
      return answer(204)
    }
    if ((m = path.match(/^\/v4\/spreadsheets\/([^/]+)$/))) {
      count('spreadsheets.get')
      const f = state.files[m[1]]
      return answer(200, { sheets: Object.keys(f.tabs).map((title, i) => ({ properties: { title, sheetId: i, gridProperties: { rowCount: 1000, columnCount: 26 } } })) })
    }
    if ((m = path.match(/^\/v4\/spreadsheets\/([^/]+)\/values\/(.+)$/))) {
      const f = state.files[m[1]]
      const tab = m[2].match(/^'((?:[^']|'')+)'!/)[1].replace(/''/g, "'")
      if (init.method === 'PUT') {
        count('values.update')
        state.writes.push({ fileId: m[1], range: m[2], values: JSON.parse(init.body).values })
        return answer(200, { updatedCells: 1 })
      }
      count('values.get')
      return answer(200, { range: m[2], values: f.tabs[tab] })
    }
    if ((m = path.match(/^\/v1\/documents\/([^/]+)$/))) {
      count('documents.get')
      const f = state.files[m[1]]
      return answer(200, { title: f.name, revisionId: 'rev-' + f.version, body: { content: f.content } })
    }
    return answer(404, {})
  }
  const triggers = []
  const instances = new Map()
  const clock = { at: Date.parse('2026-11-27T18:00:00Z'), now() { return this.at } }
  const integration = { status: 'active' }
  const watchStore = memoryWatchStores()
  const vendor = createVendor({
    integrationOf: async (userId) => (userId === OWNER ? integration : null),
    tokenFor: async (userId, { force = false } = {}) => (userId !== OWNER ? null : force && state.refreshed ? state.refreshed : state.vault),
    fetch,
    bases: BASES,
    verifiedScopes: () => verified,
    watch: { store: watchStore, instances: { get: async (id) => instances.get(id) || null, polled: async () => [...instances.values()].filter((i) => i.state === 'active') }, secret: () => 'watch-secret-0123456789', origin: () => 'https://app.slatebox.com' },
    trigger: async (instanceId, trigger) => triggers.push({ instanceId, trigger }),
    now: () => clock.now(),
  })
  function addInstance(id, recipeId, config) {
    const instance = { _id: id, recipeId, ownerId: OWNER, projectId: 'proj1', state: 'active', config, cursor: {}, match: { google: { fileIds: config.fileIds || [config.fileId] } } }
    instances.set(id, instance)
    return instance
  }
  async function run(recipe, instance, { ai = null, budget = countingBudget({ vendorCalls: 200 }), trigger = { kind: 'manual' }, slates = {}, project = null, boardState = null } = {}) {
    const session = await vendor.session(instance, { budget })
    const world = recipeContext({ instance, vendor: { google: session }, ai, now: clock, trigger, slates, project })
    if (boardState) world.ctx.slates.boardState = boardState
    const result = await recipe.run(world.ctx)
    return { result, ...world, session }
  }
  return { state, fetch, vendor, triggers, instances, clock, integration, watchStore, addInstance, run }
}

/** A Doc's body content (the documents.get shape): [style, text] pairs and tables. */
export function docContent(items) {
  return items.map((item) => {
    if (item.table) return { table: { tableRows: item.table.map((row) => ({ tableCells: row.map((cell) => ({ content: [{ paragraph: { elements: [{ textRun: { content: cell + '\n' } }] } }] })) })) } }
    const [style, text, headingId] = item
    return { paragraph: { elements: [{ textRun: { content: text + '\n' } }], paragraphStyle: { namedStyleType: style, ...(headingId && { headingId }) } } }
  })
}
