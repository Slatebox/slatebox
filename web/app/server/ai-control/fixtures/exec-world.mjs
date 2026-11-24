// The exec client a test run of the canvas conversation describes: built once from the action
// registry, as the conversation's own (client-render.mjs), on first use.
let built = null
export async function execWorld() {
  if (!built) {
    built = (async () => {
      const [{ createAppRegistry }, { buildClientManifest, renderExecTool }] = await Promise.all([
        import('../../actions/index.mjs'), import('../../actions/client-render.mjs'),
      ])
      const manifest = buildClientManifest(createAppRegistry())
      const exec = renderExecTool(manifest).exec
      return { manifest, tool: { name: exec.name, description: exec.description, parameters: exec.inputSchema } }
    })()
  }
  return built
}

export const DRAWING = { nodes: [
  { options: { id: 'n1', text: 'Spring party', xPos: 0, yPos: 0, width: 160, height: 70 } },
  { options: { id: 'n2', text: 'Book a venue', xPos: 240, yPos: 0, width: 160, height: 70 } },
] }
