// Runs inside the image under test (see image.test.mjs). Reads a JSON request
// on standard input and prints a JSON report. It never prints what it found,
// only where.
//
//   { values: [...] }   exact strings to look for in every file of the image;
//                       each hit names the positions of the values found
//   { roots: [...] }    folders to search for credential-shaped strings
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const request = JSON.parse(readFileSync(0, 'utf8'))
const skip = new Set(['/proc', '/sys', '/dev'])

function* files(dir) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (skip.has(path)) continue
    if (entry.isDirectory()) yield* files(path)
    else if (entry.isFile()) yield path
  }
}

const shapes = {
  'Stripe key': /sk_(?:live|test)_[0-9A-Za-z]{20,}/,
  'AWS access key': /AKIA[0-9A-Z]{16}/,
  'Google API key': /AIza[0-9A-Za-z_-]{35}/,
  'Slack token': /xox[baprs]-[0-9A-Za-z-]{10,}/,
  'GitHub token': /gh[pousr]_[0-9A-Za-z]{36}/,
  'SendGrid key': /SG\.[0-9A-Za-z_-]{22}\.[0-9A-Za-z_-]{43}/,
  'Mailgun key': /key-[0-9a-f]{32}/,
  'private key': /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----(?:\\r|\\n|\s)*[A-Za-z0-9+/]{60,}/,
  'database address with a password': /mongodb(?:\+srv)?:\/\/[A-Za-z0-9_.-]+:[^@/\s"'`$<{}*]{8,}@[a-z0-9]/,
  'mail address with a password': /smtps?:\/\/[A-Za-z0-9_.%+-]+:[^@/\s"'`$<{}*]{8,}@[a-z0-9]/,
}

const report = { files: 0, bytes: 0, hits: [] }
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const exact = request.values?.length ? new RegExp(request.values.map(escape).join('|')) : null

for (const root of request.roots || ['/']) {
  for (const path of files(root)) {
    let size
    try { size = statSync(path).size } catch { continue }
    if (size === 0 || size > 400 * 1024 * 1024) continue
    let text
    try { text = readFileSync(path, 'latin1') } catch { continue }
    report.files += 1
    report.bytes += size
    if (exact) {
      if (exact.test(text)) {
        const found = request.values.flatMap((value, index) => text.includes(value) ? [index] : [])
        report.hits.push({ path, found })
      }
    } else {
      for (const [what, shape] of Object.entries(shapes)) {
        if (shape.test(text)) report.hits.push({ path, what })
      }
    }
  }
}
process.stdout.write(JSON.stringify(report))
