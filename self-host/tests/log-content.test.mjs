// What people write never reaches the container log. A realistic session
// (an account with an email address, notes edited live by two people, the
// slate chat, an AI-drafted workshop and its chat, a password-reset mail and
// a refused live connection) runs against one container; afterwards its whole
// log is searched for every piece of that content and every credential the
// session used. Outside services are local stand-ins; AI providers' public
// addresses resolve to this container, so nothing leaves the machine.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { after, test } from 'node:test'
import { cleanup, freePort, healthy, logs, mailSink, start, waitFor } from './lib.mjs'
import { closeChrome, createSlate, editLink, notes, openSlate, person, savedNotes, writeNote } from './slate.mjs'

after(async () => {
  await closeChrome()
  await cleanup()
})

// One unusual word per piece of content, so that a log line which shortens,
// escapes or re-wraps a text is still found by that word.
const word = label => `${label}${randomBytes(4).toString('hex')}`
const content = {
  email: `${word('ada')}@example.test`,
  password: `correct horse ${word('battery')}`,
  note: `Budget for the ${word('zephyr')} migration`,
  liveEdit: `Ben moves the ${word('quokka')} launch to Friday`,
  chat: `Collect the ${word('marmalade')} risks → Group them by owner → Agree next steps`,
  brief: `Make a workshop to decide which ${word('tangerine')} tasks the team does this week`,
  card: `Call the ${word('pelican')} supplier`,
  laneChat: `Which ${word('walrus')} card should move first?`,
  reply: `Move the ${word('nightjar')} card first; it unblocks the others.`,
}

/** Call one of the app's methods as the person on this page. */
const call = (page, method, ...args) => page.evaluate(async ([method, args]) => {
  try {
    return { result: await window.Meteor.callAsync(method, ...args) }
  } catch (error) {
    return { error: error.error, reason: error.reason }
  }
}, [method, args])

/** An OpenAI-compatible endpoint: drafts the workshop, answers its chat in plain text. */
async function aiStub(requests) {
  const server = createServer((request, response) => {
    let body = ''
    request.on('data', chunk => { body += chunk })
    request.on('end', () => {
      const parsed = JSON.parse(body)
      requests.push(body)
      const drafting = parsed.tools?.some(tool => tool.function?.name === 'draft_workshop')
      const message = drafting
        ? { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'draft_workshop', arguments: JSON.stringify({
          version: 1, title: 'This week',
          lanes: [{ id: 'this-week', label: 'This week' }, { id: 'later', label: 'Later' }],
          cards: [
            { id: 'supplier', label: content.card, laneId: 'this-week' },
            { id: 'pricing', label: 'Publish pricing', laneId: 'this-week' },
            { id: 'video', label: 'Record a demo', laneId: 'later' },
            { id: 'forum', label: 'Open the forum', laneId: 'later' },
          ],
        }) } }] }
        : { role: 'assistant', content: content.reply }
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        id: 'chatcmpl-test', object: 'chat.completion', model: 'slatebox-local',
        choices: [{ index: 0, finish_reason: drafting ? 'tool_calls' : 'stop', message }],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      }))
    })
  })
  const port = await freePort()
  await new Promise(resolve => server.listen(port, '0.0.0.0', resolve))
  return { port, close: () => new Promise(resolve => server.close(resolve)) }
}

test('a session of edits, chat, a workshop and account mail leaves no content or credential in the log', async () => {
  const requests = []
  const ai = await aiStub(requests)
  const sink = await mailSink()
  const secrets = { aiKey: `key-${word('ocelot')}`, keyEncryptionKey: randomBytes(32).toString('base64') }
  try {
    const box = await start({
      env: {
        SLATEBOX_AI_URL: `http://host.docker.internal:${ai.port}/v1`, SLATEBOX_AI_MODEL: 'slatebox-local', SLATEBOX_AI_KEY: secrets.aiKey,
        SLATEBOX_KEY_ENCRYPTION_KEY: secrets.keyEncryptionKey,
        SLATEBOX_MAIL_URL: `smtp://host.docker.internal:${sink.port}`, SLATEBOX_MAIL_FROM: 'Boards <boards@example.test>',
      },
      args: ['--add-host', 'host.docker.internal:host-gateway',
        ...['api.deepinfra.com', 'api.openai.com', 'api.anthropic.com'].flatMap(host => ['--add-host', `${host}:127.0.0.1`])],
    })
    await healthy(box.id)
    const ada = await person()
    const ben = await person()
    try {
      // Ada saves her account with an email address and a password.
      const slateUrl = await createSlate(ada.page, box.url)
      assert.deepEqual(await call(ada.page, 'users.identify', { firstName: 'Ada', lastName: 'Lovelace', email: content.email, password: content.password }), { result: true })
      await openSlate(ada.page, slateUrl)
      secrets.loginToken = await ada.page.evaluate(() => localStorage.getItem('Meteor.loginToken'))
      assert.ok(secrets.loginToken, 'Ada is signed in')

      // A note, saved; then Ben rewrites it live through an edit link, and it is kept after a reload.
      await writeNote(ada.page, content.note)
      await waitFor(async () => (await savedNotes(ada.page)).includes(content.note), { timeout: 30, what: 'the note to be saved' })
      const link = await editLink(ada.page)
      await openSlate(ben.page, link)
      await writeNote(ben.page, content.liveEdit)
      await waitFor(async () => (await notes(ada.page)).includes(content.liveEdit), { timeout: 30, what: "Ben's edit to reach Ada" })
      await waitFor(async () => (await savedNotes(ada.page)).includes(content.liveEdit), { timeout: 30, what: 'the live edit to be saved' })
      await ada.page.reload()
      await openSlate(ada.page, slateUrl)
      assert.ok((await notes(ada.page)).includes(content.liveEdit))
      const live = ada.sockets.find(url => url.includes('/live/'))
      assert.ok(live, 'a live-editing connection was opened')
      secrets.relayBearer = new URL(live).searchParams.get('bearer')

      // The slate's conversation, typed where a person types it. First a flow,
      // which the app draws by itself; then a workshop, which the AI drafts.
      const ask = async text => {
        const message = ada.page.getByLabel('Message Slatebox')
        // The conversation stays open once a person has opened it.
        if (!await message.isVisible()) await ada.page.getByRole('button', { name: 'Ask Slatebox' }).click()
        await message.fill(text)
        await message.press('Enter')
        // Keeping reloads the slate.
        const keep = ada.page.getByRole('button', { name: 'Keep changes' })
        await keep.waitFor({ timeout: 60_000 })
        await Promise.all([ada.page.waitForEvent('load', { timeout: 60_000 }), keep.click()])
        await openSlate(ada.page, slateUrl)
      }
      await ask(content.chat)
      const firstStep = content.chat.split(' → ')[0]
      assert.ok((await savedNotes(ada.page)).includes(firstStep), 'the kept flow is saved')
      await ask(content.brief)
      assert.ok(requests.some(body => body.includes(content.brief)), 'the workshop request reached the AI endpoint')
      const shareId = new URL(slateUrl).pathname.split('/')[2]
      assert.ok(JSON.stringify((await call(ada.page, 'slates.get', { shareId })).result).includes(content.card), 'the drafted workshop is kept')

      // A workshop of its own, and a question in its conversation, answered by the AI.
      await ada.page.goto(`${box.url}/workshops`)
      await ada.page.waitForURL(/\/canvas\/[a-zA-Z0-9]{10}$/, { timeout: 90_000 })
      const panel = ada.page.getByRole('complementary', { name: 'Conversation with Slatebox' })
      await panel.waitFor({ timeout: 90_000 })
      const question = panel.getByLabel('Message Slatebox')
      await question.fill(content.laneChat)
      await question.press('Enter')
      await waitFor(async () => (await panel.innerText()).includes(content.reply), { timeout: 60, what: 'the answer in the workshop conversation' })
      assert.ok(requests.some(body => body.includes(content.laneChat)), 'the question reached the AI endpoint')

      // Account mail: a password reset to Ada's address.
      assert.deepEqual(await call(ben.page, 'users.resetPassword', { email: content.email }), { result: true })
      const reset = await waitFor(() => sink.messages.find(message => /reset-password\//.test(message.replace(/=\r\n/g, ''))), { timeout: 60, what: 'the password reset mail' })
      secrets.resetToken = reset.replace(/=\r\n/g, '').match(/reset-password\/([A-Za-z0-9_-]+)/)[1]

      // A live connection refused because its stamp does not match its bearer.
      const refused = new URL(live)
      refused.searchParams.set('timestamp', 'collab.2001-01-01T00:00:00.000Z')
      const answer = await ada.page.evaluate(address => new Promise(resolve => {
        const socket = new WebSocket(address)
        socket.onmessage = event => { resolve(String(event.data)); socket.close() }
        socket.onclose = () => resolve('closed')
        setTimeout(() => resolve('no answer'), 10_000)
      }), refused.href)
      assert.equal(answer, 'Unauthenticated')
    } finally {
      await ada.close()
      await ben.close()
    }

    // Everything the container has written, from start to now.
    await new Promise(resolve => setTimeout(resolve, 2000))
    const log = await logs(box.id)
    const relayHash = Buffer.from(decodeURIComponent(secrets.relayBearer), 'base64').toString().split(':')[1]
    const searched = {
      ...content,
      ...Object.fromEntries(Object.entries(content).map(([key, text]) => [`${key} (its unusual word)`, text.match(/[a-z]+[0-9a-f]{8}/)[0]])),
      'email, local part': content.email.split('@')[0],
      'login token': secrets.loginToken,
      'relay bearer': secrets.relayBearer,
      'relay bearer hash': relayHash,
      'password-reset token': secrets.resetToken,
      'AI key': secrets.aiKey,
      'key encryption key': secrets.keyEncryptionKey,
    }
    const found = Object.entries(searched).filter(([, value]) => value && log.includes(value)).map(([label]) => label)
    assert.ok(log.split('\n').length > 5, 'the log was read')
    // Name what leaked, never print the log line itself.
    assert.deepEqual(found, [], `the container log carries: ${found.join(', ')}`)
  } finally {
    await sink.close()
    await ai.close()
  }
})
