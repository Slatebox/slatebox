// Testing a voice provider's key (Admin → AI control, Test): a realtime provider takes no chat
// request, so the test opens its socket the way a session does, sends the setup (the voice.chat
// part's registry prompt and the one tool), and waits for the provider to say it is ready
// (Gemini's setupComplete, OpenAI's session.updated). Nothing is said and no audio is sent. The
// provider's refusal is reported in a sentence, never with the key in it.
import { adapterFor } from './adapters/index.mjs'
import { voiceConfig } from './config.mjs'

/**
 * connection: { protocol, baseUrl, apiKey, model }; deps: { connect(url, headers) → ws-like socket,
 * timeoutMs?, now? }. → { ok, reachable, message }
 */
export function checkRealtime(connection, { connect, timeoutMs = 10000 }) {
  const adapter = adapterFor(connection.protocol)
  if (!adapter) return Promise.resolve({ ok: false, reachable: false, message: 'This is not a voice provider.' })
  if (!connection.model) return Promise.resolve({ ok: false, reachable: false, message: 'Add one of its voice models first, then test the key.' })
  const config = voiceConfig({ surface: 'voice.chat', route: { model: connection.model } })
  const info = adapter.connectInfo({ baseUrl: connection.baseUrl, apiKey: connection.apiKey, model: connection.model })
  return new Promise((resolve) => {
    let settled = false
    let opened = false
    let sock
    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { sock?.close() } catch { /* gone */ }
      resolve(result)
    }
    const timer = setTimeout(() => done({ ok: false, reachable: opened, message: opened ? 'The voice provider did not answer the setup in time.' : 'The voice provider could not be reached in time.' }), timeoutMs)
    try {
      sock = connect(info.url, info.headers)
    } catch {
      done({ ok: false, reachable: false, message: 'The voice provider could not be reached.' })
      return
    }
    sock.on('unexpected-response', (req, res) => {
      const status = res?.statusCode
      done({ ok: false, reachable: true, message: status === 401 || status === 403 ? 'The voice provider did not accept the key.' : `The voice provider refused the connection (HTTP ${status ?? 'error'}).` })
    })
    sock.on('open', () => {
      opened = true
      for (const msg of adapter.setup(config)) sock.send(JSON.stringify(msg))
    })
    sock.on('message', (data) => {
      let msg
      try {
        msg = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'))
      } catch {
        return
      }
      const events = adapter.read(msg)
      if (events.some((e) => e.type === 'ready')) done({ ok: true, reachable: true, message: 'Connected. The key works and the model is ready to talk.' })
      const error = events.find((e) => e.type === 'error')
      if (error) done({ ok: false, reachable: true, message: 'The voice provider refused the setup. Check the model name.' })
    })
    sock.on('error', () => {})
    sock.on('close', (code) => done({
      ok: false, reachable: opened,
      message: opened ? `The voice provider closed the connection (code ${code}). Check the key and the model name.` : 'The voice provider could not be reached.',
    }))
  })
}
