// Disposable accounts never outlive the browser spec that made them, on a local app or on staging
// (test.slatebox.com, which has no job that removes old guests). Same rules as the engine's
// tests/e2e/app-cleanup.shared.ts.
//
// Call deleteDisposableAccounts(test) once at the top of a *.spec.mjs. Every page the spec opens,
// through the page fixture or browser.newContext() / browser.newPage(), deletes its signed-in
// account (users.delete) before it closes, and again after each test. Only a disposable account is
// ever deleted: a guest (isAnonymous) or an address on the reserved .invalid top-level domain.
// SLATEBOX_CLEANUP_LOG=<file> records each one, for a later check that none is left.
import { appendFileSync } from 'node:fs'

const cleaned = new WeakSet()
// Every context a spec opened, so the accounts in one a failed test never closed are deleted too.
const opened = new Set()

export function deleteDisposableAccounts(test) {
  test.beforeEach(async ({ browser }) => patchBrowser(browser))
  test.afterEach(async ({ page, context }, testInfo) => {
    // Deleting the account signs the page out: keep what a failed test saw first.
    if (testInfo.status !== testInfo.expectedStatus)
      for (const [i, open] of [...context.pages(), ...[...opened].flatMap(other => other.pages())].entries())
        await open.screenshot({ path: testInfo.outputPath(`before-cleanup-${i}.png`) }).catch(() => null)
    for (const open of context.pages()) await deleteAccountOn(open)
    await deleteAccountOn(page)
    for (const other of opened) {
      for (const open of other.pages()) await deleteAccountOn(open)
      opened.delete(other)
    }
  })
}

/** Delete the disposable account signed in on `page`, if there is one. Never throws. */
export async function deleteAccountOn(page) {
  if (page.isClosed() || cleaned.has(page)) return
  cleaned.add(page)
  const result = await page.evaluate(async () => {
    const meteor = window.Meteor
    if (!meteor?.userId?.()) return null
    const id = meteor.userId()
    // The account's own fields (isAnonymous, emails) arrive with the 'me' publication.
    const me = await new Promise(resolve => {
      const handle = meteor.subscribe('me', { onReady: () => resolve(handle), onStop: () => resolve(null) })
      setTimeout(() => resolve(handle), 5000)
    })
    const user = meteor.user?.()
    me?.stop()
    if (!user) return { id, deleted: false, kept: 'no account (already deleted)' }
    const address = user?.emails?.[0]?.address || ''
    if (user?.isAnonymous !== true && !/\.invalid$/i.test(address)) return { id, deleted: false, kept: 'not disposable' }
    const deleted = await meteor.callAsync('users.delete').then(() => true, () => false)
    return { id, deleted }
  }).catch(() => null)
  if (result && process.env.SLATEBOX_CLEANUP_LOG) appendFileSync(process.env.SLATEBOX_CLEANUP_LOG, JSON.stringify(result) + '\n')
}

function patchBrowser(browser) {
  if (browser.__disposable) return
  browser.__disposable = true
  const newContext = browser.newContext.bind(browser)
  browser.newContext = async (...args) => patchContext(await newContext(...args))
  const newPage = browser.newPage.bind(browser)
  browser.newPage = async (...args) => {
    const page = await newPage(...args)
    patchContext(page.context())
    return patchPage(page)
  }
}

function patchContext(context) {
  if (context.__disposable) return context
  context.__disposable = true
  opened.add(context)
  context.on('close', () => opened.delete(context))
  const close = context.close.bind(context)
  context.close = async (...args) => {
    for (const page of context.pages()) await deleteAccountOn(page)
    return close(...args)
  }
  const newPage = context.newPage.bind(context)
  context.newPage = async () => patchPage(await newPage())
  return context
}

function patchPage(page) {
  if (page.__disposable) return page
  page.__disposable = true
  const close = page.close.bind(page)
  page.close = async (...args) => {
    await deleteAccountOn(page)
    return close(...args)
  }
  return page
}
