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

/** Call one of the app's methods as the person on this page. */
const call = (page, method, ...args) => page.evaluate(([method, args]) => window.Meteor.callAsync(method, ...args), [method, args])

test('a page view sends nothing to any other address, and the interface fonts come from the instance', async () => {
  const visitor = await person()
  try {
    await createSlate(visitor.page, box.url)
    await visitor.page.goto(box.url + '/login')
    await visitor.page.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {})
    const elsewhere = visitor.requests.filter(url => !url.startsWith(box.url + '/') && !url.startsWith('data:') && !url.startsWith('blob:'))
    assert.deepEqual([...new Set(elsewhere.map(url => new URL(url).origin))], [], 'requests to other addresses')
    assert.ok(visitor.requests.some(url => url === `${box.url}/_fonts/fonts.css`), 'the font stylesheet is requested from the instance')
    // The browser has the interface font itself, not a fallback.
    const loaded = await visitor.page.evaluate(async () => {
      await document.fonts.ready
      return document.fonts.check('16px Manrope') && [...document.fonts].some(face => face.family.replace(/['"]/g, '') === 'Manrope' && face.status === 'loaded')
    })
    assert.ok(loaded, 'Manrope is loaded from the instance')
  } finally {
    await visitor.close()
  }
})

test('the instance offers no plans, quotas or cloud links it cannot provide', async () => {
  const member = await person()
  try {
    await createSlate(member.page, box.url)
    await call(member.page, 'users.identify', { firstName: 'Mia', lastName: 'Member', email: 'mia@example.test', password: 'member password 42' })
    const slateUrl = member.page.url()
    await openSlate(member.page, slateUrl)
    // Neither on the slate nor on the home page.
    for (const where of [slateUrl, box.url + '/']) {
      if (where !== slateUrl) {
        await member.page.goto(where)
        await member.page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
      }
      const shown = await member.page.locator('body').innerText()
      for (const hosted of [/Upgrade/i, /AI slates\/mo/i, /Free -/i]) assert.doesNotMatch(shown, hosted, `on ${member.page.url()}`)
    }
    // The profile menu, in the home page's header.
    await member.page.locator('#userLoginProfile').click()
    const menu = await member.page.locator('#profile-menu [role=menuitem]').allInnerTexts()
    assert.ok(menu.some(item => /Logout/.test(item)), `the profile menu opened: ${menu.join(', ')}`)
    for (const item of menu) assert.doesNotMatch(item, /Upgrade|Billing|Plans and pricing|Support/, 'a hosted-service menu item')
    await member.page.keyboard.press('Escape')
    await openSlate(member.page, slateUrl)
    // AI drafting has no monthly allowance to run out of.
    const usage = await call(member.page, 'users.getAIUsage')
    assert.equal(usage.thresholdMet, false)
    assert.equal(usage.monthly, null)


    // Board settings: images download, but no cloud link and no Pixabay search without their keys.
    await member.page.locator('#sbManageSlate').click()
    // The drawer is taller than the window; open the Export panel the way a scroll and a click would.
    await member.page.locator('#sbSlateExportAccordionBtn').dispatchEvent('click')
    await member.page.getByRole('button', { name: 'Download PNG' }).waitFor({ timeout: 30_000 })
    assert.equal(await member.page.locator('[aria-label="copy png slatebox cloud link"], [aria-label="copy svg slatebox cloud link"]').count(), 0)
    assert.equal(await member.page.locator('#backgroundPanelbh-header').count(), 0)

    // The hosted pricing page does not exist here.
    await member.page.goto(box.url + '/plans')
    await member.page.waitForURL(url => url.pathname !== '/plans', { timeout: 60_000 })
    await member.page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {})
    assert.doesNotMatch(await member.page.locator('body').innerText(), /Pricing|Go Pro|\$6/)
  } finally {
    await member.close()
  }
})
