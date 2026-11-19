// A newcomer's first minutes, in real browsers, through the one published port.
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { cleanup, freePort, healthy, start, waitFor } from './lib.mjs'
import { closeChrome, createSlate, editLink, notes, openSlate, person, savedNotes, writeNote } from './slate.mjs'

let box

before(async () => {
  // A published port other than 7070, named in SLATEBOX_URL.
  const port = await freePort()
  box = await start({ port })
  await healthy(box.id)
})

after(async () => {
  await closeChrome()
  await cleanup()
})

test('open the address, get a slate, write a note, reload: it is still there', async () => {
  const author = await person()
  try {
    const url = await createSlate(author.page, box.url)
    assert.ok(url.startsWith(`${box.url}/canvas/`), `the new slate lives at ${url}`)
    await writeNote(author.page, 'First note on my own Slatebox')
    await waitFor(async () => (await savedNotes(author.page)).includes('First note on my own Slatebox'), { timeout: 30, what: 'the note to be saved' })
    await author.page.reload()
    await openSlate(author.page, url)
    assert.ok((await notes(author.page)).includes('First note on my own Slatebox'))
  } finally {
    await author.close()
  }
})

test('two people edit one slate live, and every connection uses the one port', async () => {
  const ada = await person()
  const ben = await person()
  try {
    await createSlate(ada.page, box.url)
    await writeNote(ada.page, 'Written by Ada')
    const link = await editLink(ada.page)
    assert.ok(link.startsWith(box.url + '/'), `the invitation link ${link} uses the configured address`)

    // Ben is someone else: a separate browser profile with no session.
    await openSlate(ben.page, link)
    await waitFor(async () => (await notes(ben.page)).includes('Written by Ada'), { timeout: 30, what: 'Ben to see the slate' })

    // Ada types; Ben sees it without reloading. Then the other way round.
    await writeNote(ada.page, 'Ada edits while Ben watches')
    await waitFor(async () => (await notes(ben.page)).includes('Ada edits while Ben watches'), { timeout: 30, what: "Ada's edit to reach Ben" })
    await writeNote(ben.page, 'Ben answers')
    await waitFor(async () => (await notes(ada.page)).includes('Ben answers'), { timeout: 30, what: "Ben's edit to reach Ada" })

    // Both browsers talk to one origin only: the app's own socket and the
    // live-editing socket under /live, on the published port.
    const origin = box.url.replace(/^http/, 'ws')
    for (const who of [ada, ben]) {
      assert.ok(who.sockets.some(url => url.startsWith(`${origin}/live/`)), 'a live-editing connection was opened under /live')
      assert.deepEqual(who.sockets.filter(url => !url.startsWith(origin + '/')), [], 'no connection to any other address')
    }

    // And the result is saved.
    await ada.page.reload()
    await waitFor(async () => (await notes(ada.page).catch(() => [])).includes('Ben answers'), { timeout: 60, what: 'the saved slate after a reload' })
  } finally {
    await ada.close()
    await ben.close()
  }
})
