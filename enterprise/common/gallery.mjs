// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The curated gallery of outside agents (first-party servers only, no gateways). S2a invites the
// open ones (no sign-in). The cards say what lands on the slate, never how many tools a server has.
// `featured` cards come first. Sign-in servers arrive with S2b.

export const GALLERY = Object.freeze([
  {
    id: 'excalidraw',
    name: 'Excalidraw',
    url: 'https://mcp.excalidraw.com/mcp',
    job: 'Diagrams',
    lands: 'Sketches a diagram as real notes and lines beside your selection.',
    try: 'Draw how a card payment is retried',
    featured: true,
    cost: 'Free',
  },
  {
    id: 'huggingface',
    name: 'Hugging Face',
    url: 'https://huggingface.co/mcp',
    job: 'Models and papers',
    lands: 'Finds models, datasets, Spaces and papers, and adds them as linked notes.',
    try: 'Find open models that remove image backgrounds',
    featured: true,
    cost: 'Free',
  },
  { id: 'apexcharts', name: 'ApexCharts', url: 'https://mcp.apexcharts.com/mcp', job: 'Charts', lands: 'Turns the numbers in your notes into a chart outline as notes.', try: 'Chart these sales by month', cost: 'Free' },
  { id: 'wolfram', name: 'Wolfram', url: 'https://agenttools.wolfram.com/mcp', job: 'Math and facts', lands: 'Adds computed facts and unit math as notes.', try: 'How far is the Moon in km?', cost: 'Free' },
  { id: 'deepwiki', name: 'DeepWiki', url: 'https://mcp.deepwiki.com/mcp', job: 'Code maps', lands: 'Maps a public GitHub repository\'s parts as a diagram.', try: 'Map the parts of facebook/react', cost: 'Free' },
  { id: 'firecrawl', name: 'Firecrawl', url: 'https://mcp.firecrawl.dev/v2/mcp', job: 'Web pages', lands: 'Reads a web page and adds a summary note with its link.', try: 'Summarise https://example.com', cost: 'Free tier' },
  { id: 'context7', name: 'Context7', url: 'https://mcp.context7.com/mcp', job: 'Library docs', lands: 'Adds current docs for the libraries named in your notes.', try: 'How do I use React useEffect?', cost: 'Free tier' },
  { id: 'exa', name: 'Exa', url: 'https://mcp.exa.ai/mcp', job: 'Research', lands: 'Fans out source notes around your question, each with a quote and link.', try: 'How do others retry declined cards?', cost: 'Free tier' },
])

/** The address as stored and compared: https, no trailing slash, no query or fragment. */
export function canonicalAddress(raw) {
  let url
  try {
    url = new URL(String(raw || '').trim())
  } catch {
    return null
  }
  url.hash = ''
  url.search = ''
  const path = url.pathname.replace(/\/+$/, '')
  return `${url.protocol}//${url.host.toLowerCase()}${path}`
}

/** The gallery card a pasted address is, or null. */
export const cardFor = (address) => {
  const canonical = canonicalAddress(address)
  return GALLERY.find((card) => canonicalAddress(card.url) === canonical) || null
}

/** Hosts that look like they stand for another (punycode, mixed scripts): a warning in the walkthrough. */
export function lookalikeHost(address) {
  try {
    const host = new URL(address).hostname
    return host.split('.').some((label) => label.startsWith('xn--')) || /[^\x00-\x7f]/.test(host)
  } catch {
    return false
  }
}

// Gateways and listings known to be gone: plain words instead of a confusing failure.
export const DEAD_HOSTS = Object.freeze(['server.smithery.ai'])
