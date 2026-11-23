// Titles, descriptions and author names are plain text, including when pasted into a share preview.
export function presentationMeta(attributes, kind = 'property') {
  const escaped = value => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  return Object.entries(attributes).map(([key, value]) =>
    `<meta ${kind}="${key}" content="${escaped(value)}">`).join('\n')
}
