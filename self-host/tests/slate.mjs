// What a person does with a slate, driven through a real browser against the
// one published port.
import assert from 'node:assert/strict'
import { browser as launch, waitFor } from './lib.mjs'

let shared

export async function chrome() {
  shared ||= await launch()
  return shared
}

export async function closeChrome() {
  await shared?.close()
  shared = undefined
}

/** A person in their own browser profile. Records every WebSocket and every request the browser makes. */
export async function person(options = {}) {
  const context = await (await chrome()).newContext({ viewport: { width: 1300, height: 900 }, ...options })
  const page = await context.newPage()
  const sockets = [], requests = []
  page.on('websocket', socket => sockets.push(socket.url()))
  context.on('request', request => requests.push(request.url()))
  return { context, page, sockets, requests, close: () => context.close() }
}

async function dismissWelcome(page) {
  const ok = page.getByRole('dialog', { name: /welcome/i }).getByRole('button', { name: 'OK', exact: true })
  if (await ok.waitFor({ timeout: 4000 }).then(() => true, () => false)) await ok.click()
}

const canvasReady = page => page.waitForFunction(() =>
  window.__slateboxInstances?.some(slate => slate.element?.id === 'slateCanvas' && slate.nodes.allNodes.length > 0),
null, { timeout: 90_000 })

/** The text of every note on the open slate, as the canvas engine holds it. */
export const notes = page => page.evaluate(() => {
  const slate = window.__slateboxInstances.filter(candidate => candidate.element?.id === 'slateCanvas').at(-1)
  return slate.nodes.allNodes.map(node => node.options.text)
})

/**
 * Open the address a newcomer is given and arrive on a new slate of their own.
 * Returns the slate's URL.
 */
export async function createSlate(page, address) {
  await page.goto(address)
  await page.waitForURL(/\/canvas\/[A-Za-z0-9]+/, { timeout: 120_000 })
  await canvasReady(page)
  await dismissWelcome(page)
  return page.url()
}

export async function openSlate(page, url) {
  await page.goto(url)
  await canvasReady(page)
  await dismissWelcome(page)
}

/** Type into the first note the way a person does: double-click, type, Enter. */
export async function writeNote(page, text) {
  const note = page.locator('#slateCanvas [data-node-id]').first()
  await note.dblclick()
  const editor = page.locator('#slateCanvas [contenteditable="true"]').first()
  await editor.waitFor({ timeout: 15_000 })
  await editor.fill(text)
  await editor.press('Enter')
  await waitFor(async () => (await notes(page)).includes(text), { timeout: 20, what: `the note to read "${text}"` })
}

/** What the server has saved for this slate, asked through the app's own method. */
export async function savedNotes(page) {
  const key = new URL(page.url()).pathname.split('/')[2]
  return page.evaluate(async shareId => {
    const record = await window.Meteor.callAsync('slates.get', { shareId })
    return record.slateBase.nodes.map(node => node.options.text)
  }, key)
}

/** Create an edit link in the Share dialog and return it. */
export async function editLink(page) {
  await page.getByRole('button', { name: 'Share', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Share this slate' })
  const unlisted = dialog.getByRole('button', { name: /^Unlisted/ })
  if (await unlisted.getAttribute('aria-expanded') !== 'true') await unlisted.click()
  const region = dialog.getByRole('region', { name: /Unlisted/ })
  await region.getByRole('combobox', { name: 'Link permission' }).click()
  await page.getByRole('option', { name: 'edit', exact: true }).click()
  const commit = region.getByRole('button', { name: /^(Create link|Apply access)$/ })
  if (await commit.count()) await commit.click()
  const link = region.getByRole('textbox', { name: 'Invitation link' })
  await link.waitFor()
  const url = await link.inputValue()
  await dialog.getByRole('button', { name: 'Done', exact: true }).click()
  return url
}

/** A slate with one recognisable note, saved on the server. Returns its URL. */
export async function seedSlate(address, text) {
  const author = await person()
  try {
    const url = await createSlate(author.page, address)
    await writeNote(author.page, text)
    await waitFor(async () => (await savedNotes(author.page)).includes(text), { timeout: 30, what: 'the note to be saved' })
    return { url, storage: await author.context.storageState() }
  } finally {
    await author.close()
  }
}

/** Open a saved slate as its author in a fresh browser and expect the note. */
export async function expectSlate({ url, storage }, text) {
  const reader = await person({ storageState: storage })
  try {
    await openSlate(reader.page, url)
    assert.ok((await notes(reader.page)).includes(text), `the slate at ${url} shows "${text}"`)
  } finally {
    await reader.close()
  }
}
