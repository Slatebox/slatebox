import assert from 'node:assert/strict'
import test from 'node:test'
import { searchImagesForNote } from '../web/app/server/methods/note-image-search.mjs'

// Picture search for a note runs on the server, behind the same AI meter as the other AI calls
// (images.search runs inside runAIAction and every provider query is charged by chargeFixed:
// scripts/meter-ai-paths.test.mjs). The browser no longer holds the search key or decides who may search.

const harness = ({ refuse = null } = {}) => {
  const calls = { searches: [] }
  const deps = {
    search: async (opts) => {
      if (refuse) throw refuse
      calls.searches.push(opts)
      return { items: [{ link: 'https://img/a.png', title: 'A', image: { width: 800, height: 600, thumbnailLink: 'https://img/a-t.png' }, mime: 'image/png' }], queries: { nextPage: [{}] } }
    },
  }
  return { deps, calls }
}

test('a guest or nobody is refused, and nothing is searched or counted', async () => {
  const { deps, calls } = harness()
  await assert.rejects(() => searchImagesForNote(deps, null, { query: 'dogs' }), /register|sign/i)
  await assert.rejects(() => searchImagesForNote(deps, { _id: 'g', isAnonymous: true }, { query: 'dogs' }), /register|sign/i)
  assert.equal(calls.searches.length, 0)
})

test("the meter's refusal (free amount used up, no balance) reaches the person with its reason, and nothing is returned", async () => {
  const refusal = Object.assign(new Error("You have used today's free AI. Add your own key or top up in your profile."), { error: 'ai-today' })
  const { deps } = harness({ refuse: refusal })
  await assert.rejects(() => searchImagesForNote(deps, { _id: 'u' }, { query: 'dogs' }), (err) => err === refusal)
  // No account is exempt: the master-user bypass is gone with the plans.
  await assert.rejects(() => searchImagesForNote(deps, { _id: 'm', isMasterUser: true }, { query: 'dogs' }), (err) => err === refusal)
})

test('a search returns only what the picture grid needs, each page is one provider query, and it is bounded', async () => {
  const { deps, calls } = harness()
  const res = await searchImagesForNote(deps, { _id: 'u' }, { query: '  dogs  ', page: 0 })
  assert.deepEqual(res, { items: [{ link: 'https://img/a.png', title: 'A', thumbnail: 'https://img/a-t.png', width: 800, height: 600 }], more: true })
  assert.deepEqual(calls.searches[0], { query: 'dogs', page: 0, limit: 9 })
  await searchImagesForNote(deps, { _id: 'u' }, { query: 'dogs', page: 1 })
  assert.deepEqual(calls.searches[1], { query: 'dogs', page: 1, limit: 9 }, 'each page is its own Google query, so the meter charges it')
  await assert.rejects(() => searchImagesForNote(deps, { _id: 'u' }, { query: '' }), /search/i)
  await assert.rejects(() => searchImagesForNote(deps, { _id: 'u' }, { query: 'dogs', page: 3 }), /more/i)
  await searchImagesForNote(deps, { _id: 'u' }, { query: 'x'.repeat(500) })
  assert.equal(calls.searches.at(-1).query.length, 120)
})
