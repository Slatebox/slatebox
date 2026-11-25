// What a person uploads (a picture for an AI request, a chat attachment, a team logo) is kept by
// the installation itself, in its own database, and comes back from a backup.
import assert from 'node:assert/strict'
import { after, afterEach, test } from 'node:test'
import { cleanup, docker, freePort, healthy, ready, logs, name, remove, removeVolume, start, volume } from './lib.mjs'
import { closeChrome, createSlate, person } from './slate.mjs'

afterEach(cleanup)
after(closeChrome)

// A 1x1 red PNG that every decoder reads (the server re-encodes it when it reads it back).
const PNG = '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63f8cfc0f01f00050001ff89993d1d0000000049454e44ae426082'

// The upload exactly as the app's upload boxes send it: one file, the login token in a header.
const upload = (page, { hex, text, type, filename }) => page.evaluate(async ({ hex, text, type, filename }) => {
  const body = hex ? new Uint8Array(hex.match(/../g).map(pair => parseInt(pair, 16))) : text
  const form = new FormData()
  form.append('file', new Blob([body], { type }), filename)
  const response = await fetch('/sbupload/image', { method: 'POST', body: form, headers: { 'X-Slatebox-Login-Token': localStorage.getItem('Meteor.loginToken') || '' } })
  return { status: response.status, url: await response.text() }
}, { hex, text, type, filename })

const call = (page, method, ...args) => page.evaluate(({ method, args }) => window.Meteor.callAsync(method, ...args), { method, args })

test('an upload is stored by the installation, served back, read by the server, removable, and kept in a backup', async () => {
  const port = await freePort()
  const id = name('uploads')
  const first = await start({ port, containerName: id })
  await ready(first)
  const author = await person()
  try {
    await createSlate(author.page, first.url)

    const picture = await upload(author.page, { hex: PNG, type: 'image/png', filename: 'logo.png' })
    assert.equal(picture.status, 200, `a signed-in PNG upload answered ${picture.status} ${picture.url}`)
    assert.ok(picture.url.startsWith(`${first.url}/files/`), `stored at ${picture.url}`)
    const served = await fetch(picture.url)
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('content-type'), 'image/png')
    assert.equal(served.headers.get('x-content-type-options'), 'nosniff')
    assert.match(served.headers.get('content-security-policy'), /sandbox/)
    assert.equal(Buffer.from(await served.arrayBuffer()).toString('hex'), PNG)

    // The server reads its own file the way an AI request with a picture does.
    const dataUrl = await call(author.page, 'utils.base64StringFromRemoteUrl', { type: 'image/png', url: picture.url })
    assert.match(dataUrl, /^data:image\/png;base64,/)

    const note = await upload(author.page, { text: 'Attachment for the chat', type: 'text/plain', filename: 'notes.txt' })
    assert.equal(note.status, 200, `a text upload answered ${note.status} ${note.url}`)
    const text = await fetch(note.url)
    assert.match(text.headers.get('content-type'), /^text\/plain/)
    assert.equal(await text.text(), 'Attachment for the chat')

    // Its owner removes it, and then it is gone.
    assert.equal(await call(author.page, 'images.removeImage', { url: note.url }), true)
    assert.equal((await fetch(note.url)).status, 404)
    // A name that is not a stored file is not found, and nothing outside the store is reachable.
    assert.equal((await fetch(`${first.url}/files/2026/01/01/u_none_AAAAAAAAAAAAAAAAA.png`)).status, 404)
    assert.equal((await fetch(`${first.url}/files/..%2F..%2Fetc%2Fpasswd`)).status, 404)

    const taken = await docker(['exec', first.id, 'slatebox', 'backup'], { encoding: null })
    assert.equal(taken.code, 0, taken.stderr)
    await remove(first.id)
    await removeVolume(first.data)
    const second = await start({ port, containerName: id, data: await volume() })
    await healthy(second.id)
    const restored = await docker(['exec', '-i', second.id, 'slatebox', 'restore'], { input: taken.stdout })
    assert.equal(restored.code, 0, restored.stderr)
    const back = await fetch(picture.url)
    assert.equal(back.status, 200, 'the picture is not back after the restore')
    assert.equal(Buffer.from(await back.arrayBuffer()).toString('hex'), PNG)
    assert.equal((await fetch(note.url)).status, 404, 'a removed file came back')
    assert.doesNotMatch(await logs(second.id), /Upload failed|imageBucket/)
  } finally {
    await author.close()
  }
})
