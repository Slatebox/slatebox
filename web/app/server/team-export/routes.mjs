// The two addresses an archive travels through (transfer.mjs issues them):
//   POST /team-transfer/export/<ticket>  the archive, written while it downloads. A passphrase
//        comes as a form field or JSON field "passphrase", or in a header; without one the archive
//        is signed and checked but not encrypted.
//   POST /team-transfer/import/<ticket>  the archive as the raw body (application/octet-stream),
//        its passphrase in a header; answers with the import report.
//   POST /team-transfer/move/<ticket>    the same, for a team's own owner moving it here (a move);
//        answers 201 with the report, or 200 with the earlier move when this archive was moved already.
// The passphrase header is Slatebox-Export-Passphrase-Base64 (base64url of the passphrase's UTF-8
// bytes, so any passphrase travels as it was typed), or Slatebox-Export-Passphrase for one in plain
// ASCII. The base64 header wins when both are sent.
// A ticket in the address is the credential: it is random, single use and short lived, so a page
// on another site can't use one it does not know.
import { Buffer } from 'node:buffer'
import { pipeline } from 'node:stream'

export const TRANSFER_PATH = '/team-transfer'
const TICKET = /^[A-Za-z0-9_-]{20,100}$/

function sendError(res, error) {
  const status = Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 ? error.status : 500
  const known = status < 500 && typeof error?.code === 'string'
  if (!known) console.error('team transfer failed', error?.message)
  res.setHeader('Cache-Control', 'no-store')
  return res.status(status).json({ error: { code: known ? error.code : 'internal_error', message: known ? error.message : 'The request could not be completed.' } })
}

const badPassphraseHeader = () =>
  Object.assign(new Error('The Slatebox-Export-Passphrase-Base64 header is not base64url of UTF-8 text.'), { status: 400, code: 'passphrase_header_invalid' })

// The passphrase from the headers, or null. Throws when the base64 header cannot be read.
export function passphraseFromHeaders(req) {
  const encoded = req.get('slatebox-export-passphrase-base64')
  if (typeof encoded === 'string' && encoded) {
    if (!/^[A-Za-z0-9_-]+={0,2}$/.test(encoded) || encoded.length > 8192) throw badPassphraseHeader()
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(encoded, 'base64url')) || null
    } catch {
      throw badPassphraseHeader()
    }
  }
  const header = req.get('slatebox-export-passphrase')
  return typeof header === 'string' && header ? header : null
}

const passphraseOf = (req) => {
  const header = passphraseFromHeaders(req)
  if (header) return header
  const field = req.body && typeof req.body === 'object' ? req.body.passphrase : undefined
  return typeof field === 'string' && field ? field : null
}

export function mountTeamTransfer(app, transfer, { express }) {
  const form = express.urlencoded({ extended: false, limit: '4kb' })
  app.post(TRANSFER_PATH + '/export/:ticket', form, async (req, res) => {
    if (!TICKET.test(req.params.ticket)) return sendError(res, { status: 404, code: 'ticket_invalid', message: 'This download address is used or expired.' })
    let opened
    try {
      opened = await transfer.openExport(req.params.ticket, passphraseOf(req))
    } catch (error) {
      return sendError(res, error)
    }
    res.status(200)
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${opened.filename}"`)
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    // A failure part way through cuts the download short: the archive then has no end line, and
    // an import refuses it.
    pipeline(opened.stream, res, (error) => {
      if (error) console.error('team export stopped', error.message)
    })
    return undefined
  })

  const upload = (receive) => async (req, res) => {
    if (!TICKET.test(req.params.ticket)) return sendError(res, { status: 404, code: 'ticket_invalid', message: 'This upload address is used or expired.' })
    const type = String(req.get('content-type') || '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/octet-stream')
      return sendError(res, { status: 415, code: 'unsupported_type', message: 'Send the archive as application/octet-stream.' })
    try {
      const result = await receive(req.params.ticket, req, passphraseFromHeaders(req))
      res.setHeader('Cache-Control', 'no-store')
      return res.status(result?.duplicate ? 200 : 201).json(result)
    } catch (error) {
      // stop reading what is left of the upload
      req.unpipe?.()
      req.resume?.()
      return sendError(res, error)
    }
  }
  app.post(TRANSFER_PATH + '/import/:ticket', upload((ticket, body, passphrase) => transfer.receiveImport(ticket, body, passphrase)))
  app.post(TRANSFER_PATH + '/move/:ticket', upload((ticket, body, passphrase) => transfer.receiveMove(ticket, body, passphrase)))
}
