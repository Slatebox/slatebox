// Import from Excalidraw (the + menu): a person's own drawing as native notes and lines. A
// .excalidraw (or .json) file is read here; an excalidraw.com share link is fetched by its id and
// decrypted here with the key in the link, which never leaves this page. Only the shapes, their
// words and the arrows go to the server (no pictures, no files), as a layout it checks again; the
// result is a preview in Ask Slatebox, kept with Keep like any drawing change (one undo step).
// A lazy chunk: loaded when someone picks Import from Excalidraw.
import React, { useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Meteor } from 'meteor/meteor'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { decryptShare, sceneElements, sceneToLayout, shareLinkParts, skippedWords, SCENE_LIMITS } from '../../../api/common/excalidraw-scene.mjs'

const inflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer())

/** onPreview(result, message): the server's preview, shown by the conversation as its draft. */
export default function ImportExcalidraw({ shareId, onPreview, onBack }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const file = useRef(null)

  async function send(elements, name) {
    const layout = sceneToLayout(elements)
    if (!layout.notes.length) throw new Error('That drawing has no shapes or words Slatebox can bring in.')
    const result = await Meteor.callAsync('canvasConversation.importPreview', shareId, { notes: layout.notes, lines: layout.lines }, name)
    const left = skippedWords(layout.skipped)
    onPreview({ ...result, said: null, left }, `Import ${name ? '“' + name + '”' : 'a drawing'} from Excalidraw`)
  }
  async function fromFile(event) {
    const picked = event.target.files?.[0]
    event.target.value = ''
    if (!picked) return
    setProblem('')
    if (picked.size > SCENE_LIMITS.bytes) return setProblem('That file is too large to import.')
    setBusy(true)
    try {
      const elements = sceneElements(await picked.text())
      if (!elements) throw new Error('That is not an Excalidraw drawing. Export it from Excalidraw as a .excalidraw file.')
      await send(elements, picked.name.replace(/\.(excalidraw|json)$/i, ''))
    } catch (error) {
      setProblem(error?.reason || error?.message || 'That drawing could not be read.')
    } finally {
      setBusy(false)
    }
  }
  async function fromLink(event) {
    event.preventDefault()
    const parts = shareLinkParts(link)
    if (!parts) return setProblem('Paste a share link from excalidraw.com: it looks like https://excalidraw.com/#json=…')
    setProblem('')
    setBusy(true)
    try {
      const bytes = await Meteor.callAsync('excalidraw.fetchShare', parts.id)
      const { elements } = await decryptShare(bytes, parts.key, { subtle: window.crypto.subtle, inflate })
      await send(elements, '')
      setLink('')
    } catch (error) {
      setProblem(error?.reason || (error?.name === 'OperationError' ? 'That link could not be opened: check it is the whole link, with the part after the comma.' : error?.message) || 'That drawing could not be read.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Box data-import-excalidraw="" sx={{ my: 1 }}>
      <Typography variant="subtitle2">Import from Excalidraw</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Bring your own drawing in as notes and lines you can edit. Shapes, their words and the arrows between them come in; pictures and free-hand lines stay out.</Typography>
      <input ref={file} type="file" accept=".excalidraw,.json,application/json" hidden onChange={fromFile} data-import-file="" />
      <Button variant="contained" size="small" disabled={busy} onClick={() => file.current?.click()}>Choose a .excalidraw file</Button>
      <Box component="form" onSubmit={fromLink} sx={{ display: 'flex', gap: 1, mt: 1.5 }}>
        <TextField size="small" fullWidth label="Or paste an excalidraw.com share link" value={link} onChange={(e) => setLink(e.target.value)} inputProps={{ 'data-import-link': '' }} disabled={busy} />
        <Button type="submit" size="small" disabled={busy || !link.trim()}>Import</Button>
      </Box>
      <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 1 }}>The link&apos;s key stays in this page: Slatebox fetches the locked drawing and opens it here.</Typography>
      {problem && <Typography role="status" variant="body2" sx={{ mt: 1 }}>{problem}</Typography>}
      <Button size="small" onClick={onBack} sx={{ mt: 1 }}>Back</Button>
    </Box>
  )
}

ImportExcalidraw.propTypes = {
  shareId: PropTypes.string.isRequired,
  onPreview: PropTypes.func.isRequired,
  onBack: PropTypes.func.isRequired,
}
