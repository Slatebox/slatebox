// A public slate's Mermaid at a stable plain-text address: /slates/<shareId>.mmd (the Mermaid)
// and /slates/<shareId>.md (the same in a ```mermaid block), for READMEs, docs and agents that
// pull a diagram by URL. It is the export action run as a visitor: only a public slate answers,
// limited per address like every visitor read, and a token or session is never read here.
import { principalFromVisitor } from './principal.mjs'
import { clientAddress } from './http.mjs'

const FILE = /^([A-Za-z0-9_-]{1,80})\.(mmd|md)$/
const NOT_FOUND = 'Not found. Only a public slate has a Mermaid address.\n'

export function mountMermaidFiles(app, registry, { forwardedCount = 0 } = {}) {
  app.get('/slates/:file', async (req, res, next) => {
    const match = FILE.exec(req.params.file)
    if (!match) return next()
    const [, shareId, kind] = match
    res.setHeader('Cache-Control', 'no-store')
    // The text is people's words: never let a browser read it as a page.
    res.setHeader('X-Content-Type-Options', 'nosniff')
    const input = { shareId }
    for (const name of ['format', 'start']) if (typeof req.query[name] === 'string') input[name] = req.query[name]
    if (req.query.styles === 'true') input.styles = true
    try {
      const { body } = await registry.run(principalFromVisitor(clientAddress(req, forwardedCount)), 'slates.exportMermaid', input)
      res.type(kind === 'md' ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8')
      return res.status(200).send(kind === 'md' ? body.markdown : body.mermaid + '\n')
    } catch (error) {
      res.type('text/plain; charset=utf-8')
      if (error?.status === 429) {
        if (error.retryAfter !== undefined) res.setHeader('Retry-After', String(error.retryAfter))
        return res.status(429).send('Too many requests. Wait and retry.\n')
      }
      if (error?.status === 400 || error?.status === 422) return res.status(error.status).send(`${error.message}\n`)
      if (error?.status && error.status < 500) return res.status(404).send(NOT_FOUND)
      return res.status(500).send('The diagram could not be written.\n')
    }
  })
}
