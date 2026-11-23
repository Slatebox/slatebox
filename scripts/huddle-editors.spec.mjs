// Run against a dedicated staging video slate with two synthetic Pro editors.
// SLATEBOX_HUDDLE_URL, SLATEBOX_EDITOR_A and SLATEBOX_EDITOR_B supply the slate
// URL and two Playwright storage-state file paths. From scripts/, run
// npx playwright test huddle-editors.spec.mjs. Install Chromium and Firefox for
// the same Playwright release. Both accounts must have transcription off.
import { expect, firefox, test } from '@playwright/test'

test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
})

async function moveText(from, to, nodeId, text) {
  await from.evaluate(({ nodeId, text }) => {
    const slate = window.__slateboxInstances.find(s => s.element.id === 'slateCanvas')
    slate.nodes.one(nodeId).setText(text)
  }, { nodeId, text })
  await to.waitForFunction(({ nodeId, text }) => {
    const slate = window.__slateboxInstances.find(s => s.element.id === 'slateCanvas')
    return slate.nodes.one(nodeId)?.options.text === text
  }, { nodeId, text }, { timeout: 15000 })
}

async function verifyRemotePlayback(page, remoteSessionId) {
  await page.waitForFunction(expected => {
    const call = require('@daily-co/daily-js').default.getCallInstance()
    const remote = Object.values(call.participants()).find(p => !p.local && p.session_id === expected)
    return ['audio', 'video'].every(kind => {
      const track = remote?.tracks[kind]
      return track?.state === 'playable' && [...document.querySelectorAll(kind)].some(
        media => !media.paused && media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && media.currentTime > 0.25
          && (kind === 'video' ? media.videoWidth > 0 && media.videoHeight > 0 : !media.muted && media.volume > 0)
          && media.srcObject?.getTracks().some(t => t.id === track.persistentTrack?.id && t.readyState === 'live')
      )
    })
  }, remoteSessionId, { timeout: 25000 })
}

async function callSession(page) {
  return page.evaluate(() => require('@daily-co/daily-js').default.getCallInstance().participants().local.session_id)
}

async function join(page) {
  await page.locator('[name="huddleEnabled"]').check()
  const camera = page.getByRole('button', { name: 'Turn camera on', exact: true })
  await camera.click()
  const unmute = page.getByRole('button', { name: 'Unmute microphone', exact: true })
  if (await unmute.isVisible()) await unmute.click()
  await expect(page.getByRole('button', { name: 'Mute microphone', exact: true })).toBeVisible()
}

test('Chromium and Firefox play remote huddle media and rejoin with the shared edit intact', async ({ browser }) => {
  test.setTimeout(180000)
  const { SLATEBOX_HUDDLE_URL: url, SLATEBOX_EDITOR_A: first, SLATEBOX_EDITOR_B: second } = process.env
  test.skip(!url || !first || !second, 'A dedicated two-editor staging fixture is required')
  const target = new URL(url)
  expect(['test.slatebox.com', 'localhost', '127.0.0.1']).toContain(target.hostname)
  expect(target.pathname).toMatch(/^\/canvas\/[\w-]+$/)

  expect(browser.browserType().name()).toBe('chromium')
  const secondBrowser = await firefox.launch({ firefoxUserPrefs: {
    'media.navigator.streams.fake': true,
    'media.navigator.permission.disabled': true,
    'media.autoplay.default': 0,
  } })
  const contexts = []
  let original
  let nodeId
  let a
  let b
  try {
    const viewport = { width: 1440, height: 900 }
    contexts.push(await browser.newContext({ storageState: first, viewport, permissions: ['camera', 'microphone'] }))
    contexts.push(await secondBrowser.newContext({ storageState: second, viewport }))
    a = await contexts[0].newPage()
    b = await contexts[1].newPage()
    const editors = await Promise.all([a, b].map(async page => {
      page.setDefaultTimeout(30000)
      await page.goto(url)
      await page.locator('#slateCanvas [data-node-id]').first().waitFor()
      const result = await page.evaluate(async shareId => {
        const constants = require('/imports/api/common/constants.js').default
        const record = await Meteor.callAsync(constants.methods.slates.get, { shareId })
        return {
          user: Meteor.userId(),
          edit: record.accessLevel === constants.slateAccessPermissions.edit.id,
          video: record.slateBase.options.huddleType === 'video',
          guestWelcome: record.slateBase.userId !== Meteor.userId() && !record.slateBase.options.isEmbedded && !record.slateBase.options.basedOnTemplate,
          transcription: !!Meteor.user()?.profile?.transcribeOnStart,
        }
      }, target.pathname.split('/').pop())
      expect(result.user).toBeTruthy()
      expect(result.edit && result.video && !result.transcription).toBe(true)
      const consent = page.getByText('I understand', { exact: true })
      if (await consent.isVisible()) await consent.click()
      const welcome = page.getByRole('button', { name: 'OK', exact: true })
      if (result.guestWelcome || await welcome.isVisible()) await welcome.click()
      return result
    }))
    expect(editors[0].user).not.toBe(editors[1].user)
    const peers = await Promise.all([a, b].map(async page => {
      await page.waitForFunction(() => window.__slateboxInstances
        .find(s => s.element.id === 'slateCanvas')?.collab.isCollabConnected())
      return page.evaluate(() => window.__slateboxInstances.find(s => s.element.id === 'slateCanvas').collab.getClientID())
    }))
    await Promise.all([a, b].map((page, index) => page.waitForFunction(peerId => {
      const slate = window.__slateboxInstances.find(s => s.element.id === 'slateCanvas')
      return slate?.collab.getCollabUsers().some(peer => peer.clientID === peerId)
    }, peers[1 - index])))

    nodeId = await a.locator('#slateCanvas [data-node-id]').first().getAttribute('data-node-id')
    original = await a.evaluate(id => window.__slateboxInstances.find(s => s.element.id === 'slateCanvas').nodes.one(id).options.text, nodeId)
    await moveText(a, b, nodeId, 'Revised by the first editor')
    await join(a)
    await join(b)
    const [ownerSession, firstPeerSession] = await Promise.all([callSession(a), callSession(b)])
    await Promise.all([verifyRemotePlayback(a, firstPeerSession), verifyRemotePlayback(b, ownerSession)])
    const callEdit = 'Reviewed during the call ' + Date.now()
    await moveText(b, a, nodeId, callEdit)
    // Simulate losing the peer browser context without pressing Leave. The
    // returning editor must see the saved change and establish a new call.
    await contexts[1].close()
    const returnContext = await secondBrowser.newContext({ storageState: second, viewport })
    contexts.push(returnContext)
    b = await returnContext.newPage()
    b.setDefaultTimeout(30000)
    await b.goto(url)
    if (editors[1].guestWelcome) await b.getByRole('button', { name: 'OK', exact: true }).click()
    await b.waitForFunction(({ id, text }) => window.__slateboxInstances?.find(s => s.element.id === 'slateCanvas')?.nodes.one(id)?.options.text === text, { id: nodeId, text: callEdit })
    await join(b)
    const nextPeerSession = await callSession(b)
    expect(nextPeerSession).not.toBe(firstPeerSession)
    await Promise.all([verifyRemotePlayback(a, nextPeerSession), verifyRemotePlayback(b, ownerSession)])
    for (const page of [a, b]) {
      await expect.poll(() => page.evaluate(id => window.__slateboxInstances
        .find(s => s.element.id === 'slateCanvas').nodes.one(id)?.options.text, nodeId)).toBe(callEdit)
    }
    await expect.poll(() => b.evaluate(async ({ shareId, id }) => {
      const record = await Meteor.callAsync('slates.get', { shareId })
      return record?.slateBase?.nodes?.find(node => node.options.id === id)?.options.text
    }, { shareId: target.pathname.split('/').pop(), id: nodeId })).toBe(callEdit)
    const lateContext = await browser.newContext({ storageState: first, viewport })
    contexts.push(lateContext)
    const late = await lateContext.newPage()
    await late.goto(url)
    await late.waitForFunction(({ id, text }) => {
      const slate = window.__slateboxInstances?.find(s => s.element.id === 'slateCanvas')
      return slate?.collab.isCollabConnected() && slate.collab.provider?.synced && slate.nodes.one(id)?.options.text === text
    }, { id: nodeId, text: callEdit }, { timeout: 25000 })
    await lateContext.close()
    await moveText(b, a, nodeId, original)
    await b.locator('[name="huddleEnabled"]').uncheck()
    await a.waitForFunction(() => Object.keys(require('@daily-co/daily-js').default.getCallInstance().participants()).length === 1, null, { timeout: 90000 })
    await a.locator('[name="huddleEnabled"]').uncheck()
  } finally {
    try {
      if (typeof original === 'string' && a && b && !b.isClosed()) await moveText(a, b, nodeId, original)
    } finally {
      await Promise.allSettled(contexts.map(ctx => ctx.close()))
      await secondBrowser.close()
    }
  }
})
