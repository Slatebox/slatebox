// Download the TrueType files for each Google Fonts family named on the command
// line. The build stops if a family yields no file, so an image never ships
// with a font silently missing.
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

const [out, ...families] = process.argv.slice(2)
if (!out || !families.length) throw new Error('Usage: fetch-fonts.mjs OUTPUT_DIRECTORY FAMILY...')
await mkdir(out, { recursive: true })

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

for (const family of families) {
  // Without a browser user agent the stylesheet lists TrueType sources.
  const css = await (await get(`https://fonts.googleapis.com/css2?family=${family}&display=swap`)).text()
  const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/s\/[^)]*\.ttf/g) || [])]
  if (!urls.length) throw new Error(`No TrueType files listed for ${family}`)
  for (const url of urls) {
    const bytes = Buffer.from(await (await get(url)).arrayBuffer())
    await writeFile(join(out, basename(new URL(url).pathname)), bytes)
  }
  console.log(`${family}: ${urls.length} file(s)`)
}
