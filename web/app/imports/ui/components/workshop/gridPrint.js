// Print, or save as a PDF, the pages of a grid sheet (snap-grid spec §5): each page exactly as its notes are drawn on the
// slate, at true size. The page's own note is the frame (its box on the canvas), and the picture holds that page's notes
// only: the tray, the headers and the cell guides (data-export-never) never print.
//   Print: a hidden frame holds one SVG per page at the page's size in inches (@page size … margin 0), then the
//   browser's print dialog, which also offers "Save as PDF". Vector, so text stays sharp.
//   Download PDF: pdf-lib, loaded only now; each page a 300 dpi picture on a page sized in points (Letter 612 × 792,
//   A4 595.28 × 841.89), named after the sheet.
// Before either, what would print badly is asked about (gridPrintProblems): "Page 2 needs a heading. Print anyway?"

import { withNativeInk } from '../../common/canvasTheme.mjs'

/** The slate's note for a board part (`column-page-1`, `card-tile-3`), on a slate of one board or many (`b2:…`, `…--2`). */
function noteFor(engine, name) {
  const all = engine?.nodes?.allNodes ?? []
  return all.find(node => node.id === name) ?? all.find(node => node.id.endsWith(':' + name) || node.id.startsWith(name + '--') || node.id.includes(':' + name + '--')) ?? null
}

/**
 * The pages to print: each page's frame (its note's box), its notes, and its size. `pageIds` picks some; left out, all.
 * Null when the sheet is not drawn on this slate.
 */
export async function gridPrintJob(engine, workshop, pageIds) {
  const grid = await import('slateboxjs/boards/grid')
  const pages = grid.gridPrintPages(workshop, {}, { x: 0, y: 0 }, pageIds)
  const out = []
  for (const page of pages) {
    const note = noteFor(engine, 'column-' + page.pageId)
    if (!note) return null
    const o = note.options
    const nodes = page.nodeIds.map(name => noteFor(engine, name)).filter(Boolean)
    out.push({ ...page, frame: { x: o.x, y: o.y, width: o.width, height: o.height }, nodes })
  }
  return { pages: out, problems: grid.gridPrintProblems(workshop, pageIds) }
}

const confirmPrint = (problems, ask) => !problems.length || (ask ?? globalThis.confirm)?.(problems.join(' ') + ' Print anyway?') !== false

/** Each page as an SVG at its printed size (8.5in × 11in), its pictures written into it. */
export async function gridPageSvgs(engine, job) {
  const { inlinePictures } = await import('slateboxjs').catch(() => ({}))
  const svgs = []
  for (const page of job.pages) {
    // The slate's own export (Slate.svg, as the style bar's Copy as SVG uses it), in the page's ink, not a dark canvas's.
    let svg = withNativeInk(() => engine.svg({ nodes: page.nodes, frame: page.frame, size: { width: page.size.in[0] + 'in', height: page.size.in[1] + 'in' }, noBackground: true }))
    svg = svg.replace(/^<\?xml[^>]*>\s*/, '')
    if (inlinePictures) svg = await inlinePictures(svg)
    svgs.push({ ...page, svg })
  }
  return svgs
}

/** Print the pages: a hidden frame, one SVG a page, the browser's print dialog. Resolves with the frame (removed after printing). */
export async function printGrid({ engine, workshop, pageIds, ask }) {
  const job = await gridPrintJob(engine, workshop, pageIds)
  if (!job) throw new Error('This sheet is not on the canvas yet.')
  if (!confirmPrint(job.problems, ask)) return null
  const pages = await gridPageSvgs(engine, job)
  const [w, h] = pages[0].size.in
  const frame = document.createElement('iframe')
  frame.setAttribute('data-grid-print', '')
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0', visibility: 'hidden' })
  document.body.appendChild(frame)
  const doc = frame.contentDocument
  doc.open()
  doc.write(`<!doctype html><html><head><title>${String(workshop.title).replace(/[<&]/g, '')}</title><style>@page{size:${w}in ${h}in;margin:0}html,body{margin:0;padding:0}` +
    `.page{width:${w}in;height:${h}in;page-break-after:always;break-after:page;overflow:hidden}.page:last-child{page-break-after:auto;break-after:auto}.page svg{display:block}</style></head><body>` +
    pages.map(page => `<div class="page" data-page="${page.pageId}">${page.svg}</div>`).join('') + '</body></html>')
  doc.close()
  await new Promise(resolve => setTimeout(resolve, 50))
  frame.contentWindow.focus()
  frame.contentWindow.print()
  setTimeout(() => frame.remove(), 60000)
  return frame
}

/** A file name from the sheet's title. */
export const pdfName = title => (String(title || 'Printable page').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) || 'Printable page') + '.pdf'

/** The PDF of the pages, as bytes: each page a 300 dpi picture filling a page sized in points. */
export async function gridPdfBytes(engine, job) {
  const { PDFDocument } = await import('pdf-lib')
  const pdf = await PDFDocument.create()
  for (const page of job.pages) {
    const png = await withNativeInk(() => engine.png({ nodes: page.nodes, frame: page.frame, scale: 300 / 96, asBinary: true, noBackground: true }))
    const image = await pdf.embedPng(new Uint8Array(await png.arrayBuffer()))
    const [pw, ph] = page.size.pt
    const sheet = pdf.addPage([pw, ph])
    sheet.drawImage(image, { x: 0, y: 0, width: pw, height: ph })
  }
  return pdf.save()
}

/** Save the pages as a PDF named after the sheet. Resolves with the bytes. */
export async function downloadGridPdf({ engine, workshop, pageIds, ask }) {
  const job = await gridPrintJob(engine, workshop, pageIds)
  if (!job) throw new Error('This sheet is not on the canvas yet.')
  if (!confirmPrint(job.problems, ask)) return null
  const bytes = await gridPdfBytes(engine, job)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
  const link = document.createElement('a')
  link.href = url
  link.download = pdfName(workshop.title)
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60000)
  return bytes
}
