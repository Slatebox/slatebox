import React from 'react'
import AddIcon from '@mui/icons-material/Add'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import TitleIcon from '@mui/icons-material/Title'
import HorizontalRuleIcon from '@mui/icons-material/HorizontalRule'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import ShapeMaker from '../shapes/ShapeMaker'
import { noteBase } from '../node/addNote'
import defaultShapes from '../node/defaultShapes'
import addNote from '../node/addNote'
import { Sheet } from './parts'
import { loadBoardsRows } from '../library/libraryBus'

// The sheet's Boards and starters row: its own chunk, fetched when the sheet opens.
const BoardsRow = React.lazy(() => loadBoardsRows().then((m) => ({ default: m.BoardsRow })))

/**
 * "+ Add" on a phone: the tool dock folded into the bottom bar. A tap opens a sheet of what
 * can be added; the new note is selected, so its own bar is there to style it.
 */
export default function AddTools({ slate, onAdded, commentOnly = false, canComment = false, selectedNotes, onShapeNotes }) {
  const [open, setOpen] = React.useState(false)
  const [maker, setMaker] = React.useState(false)
  const [targets, setTargets] = React.useState([])
  const button = React.useRef(null)
  const add = (shape) => {
    const node = addNote(slate, shape)
    setOpen(false)
    onAdded?.(node, shape)
  }
  const shape = (key) => ({ ...defaultShapes.find((s) => s.key === key), key })
  const tools = commentOnly
    ? [{ key: 'comment', name: 'Comment', icon: <ChatBubbleOutlineIcon />, shape: { key: 'comment' } }]
    : [
      { key: 'note', name: 'Note', icon: <CropSquareIcon />, shape: shape('roundedRect') },
      { key: 'text', name: 'Text', icon: <TitleIcon />, shape: { key: 'addText' } },
      { key: 'line', name: 'Line', icon: <HorizontalRuleIcon />, shape: shape('line') },
      ...(canComment ? [{ key: 'comment', name: 'Comment', icon: <ChatBubbleOutlineIcon />, shape: { key: 'comment' } }] : []),
      { key: 'custom', name: 'Custom shape', icon: <AutoAwesomeIcon />, maker: true },
    ]
  const base = noteBase((slate?.nodes?.allNodes ?? []).filter((n) => !slate.v2?.governanceOf?.(n.v2)))
  return (
    <>
      <ShapeMaker open={maker} onClose={() => setMaker(false)} target={targets.length || 'new'} fill={base.backgroundColor} stroke={base.borderColor || '#333'}
        onApply={(s) => (targets.length && onShapeNotes ? onShapeNotes(targets, s) : add({ key: 'customShape', path: s.d, ...s }))} />
      <button ref={button} type="button" className="sb-add" aria-expanded={open} aria-controls="sb-add-sheet" onClick={() => setOpen((o) => !o)}>
        <AddIcon aria-hidden />Add
      </button>
      {open && (
        <Sheet id="sb-add-sheet" title="Add to the slate" onClose={() => { setOpen(false); button.current?.focus() }}>
          {!commentOnly && <React.Suspense fallback={null}><BoardsRow onDone={() => setOpen(false)} /></React.Suspense>}
          <div className="sb-add-grid" role="group" aria-label="Add">
            {tools.map((t) => (
              <button key={t.key} type="button" className="sb-btn" onClick={() => (t.maker ? (setTargets(selectedNotes?.() ?? []), setOpen(false), setMaker(true)) : add(t.shape))}>{t.icon}<span>{t.name}</span></button>
            ))}
          </div>
          {!commentOnly && (
            <>
              <div className="sb-label" style={{ marginTop: 14 }}>Shapes</div>
              <div className="sb-shapes" role="group" aria-label="Shapes" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                {defaultShapes.filter((s) => s.key !== 'line').map((s) => (
                  <button key={s.key} type="button" className="sb-btn" aria-label={s.name} title={s.name} onClick={() => add(shape(s.key))}>
                    <svg viewBox="0 0 24 24" aria-hidden>{s.iconFill
                      ? <path d={s.path} fill={s.iconFill} stroke="#8a7a2a" strokeWidth="1" style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.35))' }} />
                      : <path d={s.path} fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.4" />}</svg>
                  </button>
                ))}
              </div>
            </>
          )}
        </Sheet>
      )}
    </>
  )
}
