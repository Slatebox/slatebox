// Download the TrueType files for each Google Fonts family named on the command
// line, and write a list of each family's copyright and license as the font
// files themselves state them. The build stops if a family yields no file or
// a file names no license this image carries the text of, so an image never
// ships with a font silently missing or unaccounted for.
//
//   node fetch-fonts.mjs OUTPUT_DIRECTORY LICENSE_LIST FAMILY...
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const [out, list, ...families] = process.argv.slice(2)
if (!out || !list || !families.length) throw new Error('Usage: fetch-fonts.mjs OUTPUT_DIRECTORY LICENSE_LIST FAMILY...')
await mkdir(out, { recursive: true })

// The license URL a font records (name ID 14), and the text in this image.
const LICENSES = [
  { match: /scripts\.sil\.org\/OFL|openfontlicense\.org/, name: 'SIL Open Font License 1.1', text: 'fonts-OFL-1.1.txt' },
  { match: /apache\.org\/licenses\/LICENSE-2\.0/, name: 'Apache License 2.0', text: 'fonts-Apache-2.0.txt' },
]

async function get(url, attempt = 1) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok) throw new Error(`${response.status} for ${url}`)
    return response
  } catch (error) {
    if (attempt >= 4) throw error
    await new Promise(resolve => setTimeout(resolve, attempt * 2000))
    return get(url, attempt + 1)
  }
}

/** Windows-platform strings from a TrueType file's name table, by name ID. */
function names(bytes) {
  const tables = bytes.readUInt16BE(4)
  for (let i = 0; i < tables; i++) {
    const record = 12 + 16 * i
    if (bytes.toString('latin1', record, record + 4) !== 'name') continue
    const table = bytes.readUInt32BE(record + 8)
    const count = bytes.readUInt16BE(table + 2)
    const strings = table + bytes.readUInt16BE(table + 4)
    const found = {}
    for (let j = 0; j < count; j++) {
      const at = table + 6 + 12 * j
      if (bytes.readUInt16BE(at) !== 3) continue
      const id = bytes.readUInt16BE(at + 6)
      const start = strings + bytes.readUInt16BE(at + 10)
      const utf16be = bytes.subarray(start, start + bytes.readUInt16BE(at + 8))
      found[id] ??= Buffer.from(utf16be).swap16().toString('utf16le').trim()
    }
    return found
  }
  return {}
}

const rows = []
for (const family of families) {
  // Without a browser user agent the stylesheet lists TrueType sources.
  const css = await (await get(`https://fonts.googleapis.com/css2?family=${family}&display=swap`)).text()
  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/s\/[^)]*\.ttf/g) || [])]
  if (!urls.length) throw new Error(`No TrueType files listed for ${family}`)
  const seen = new Map()
  for (const url of urls) {
    const bytes = Buffer.from(await (await get(url)).arrayBuffer())
    const file = basename(new URL(url).pathname)
    await writeFile(join(out, file), bytes)
    const { 0: copyright, 1: name, 14: licenseUrl = '' } = names(bytes)
    const license = LICENSES.find(entry => entry.match.test(licenseUrl))
    if (!license) throw new Error(`${file} (${family}) names no license this image carries: "${licenseUrl}"`)
    if (!copyright) throw new Error(`${file} (${family}) carries no copyright notice`)
    const key = `${name}\u0000${copyright}\u0000${license.name}`
    if (!seen.has(key)) seen.set(key, { name, copyright, license, files: [] })
    seen.get(key).files.push(file)
  }
  rows.push(...seen.values())
  console.log(`${family}: ${urls.length} file(s)`)
}

const cell = text => text.replaceAll('|', '\\|')
await writeFile(list, [
  '# Fonts in this image',
  '',
  'The font families the server uses to render slate images, from Google Fonts,',
  'in `/usr/share/fonts/googlefonts`. Each copyright notice is the one the font',
  'files carry. The license texts are in this folder.',
  '',
  '| Family | Copyright | License | Text |',
  '| --- | --- | --- | --- |',
  ...rows.map(row => `| ${cell(row.name)} | ${cell(row.copyright)} | ${row.license.name} | \`${row.license.text}\` |`),
  '',
  'Liberation fonts come from the Ubuntu package `fonts-liberation`; their',
  'license is in `/usr/share/doc/fonts-liberation/copyright`.',
  '',
].join('\n'))
