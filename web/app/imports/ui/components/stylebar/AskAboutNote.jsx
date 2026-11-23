import React from 'react'
import { useAtom, useAtomValue } from 'jotai'
import CloseIcon from '@mui/icons-material/Close'
import CONSTANTS from '../../../api/common/constants'
import { askAboutNotes, outstandingAIRequests } from '../../jotai/atoms'

/**
 * "About: <note>" at the top of Ask Slatebox, opened from a note's bar. Its suggestions are the
 * old AI tab's actions, one tap each; they send the same packages (onNodeAITextChanged) through
 * the canvas page's updateNode, so they run, save and sync as before.
 */
export default function AskAboutNote({ send }) {
  const [about, setAbout] = useAtom(askAboutNotes)
  const busy = useAtomValue(outstandingAIRequests)
  const [view, setView] = React.useState(null)
  const [words, setWords] = React.useState('')
  React.useEffect(() => { setView(null); setWords('') }, [about?.ids?.join(',')])
  if (!about?.ids?.length) return null
  const name = about.ids.length > 1 ? `${about.ids.length} notes` : (about.text || 'This note').replace(/\s+/g, ' ').slice(0, 60)
  const ai = (data) => send(about.ids, { type: 'onNodeAITextChanged', data: { ai: data } })
  const chip = { border: '1px solid currentColor', borderRadius: 16, padding: '6px 12px', background: 'transparent', color: 'inherit', font: '600 13px Manrope, system-ui, sans-serif', cursor: 'pointer' }
  return (
    <section aria-label={`About: ${name}`} style={{ margin: '12px 0 16px' }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 16, padding: '4px 6px 4px 12px', background: '#f2ce8b', color: '#17251f', font: '700 13px Manrope, system-ui, sans-serif' }}>
        About: {name}
        <button type="button" aria-label="Stop asking about this note" onClick={() => setAbout(null)}
          style={{ border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', display: 'inline-flex', padding: 2 }}><CloseIcon fontSize="small" /></button>
      </div>
      <p style={{ margin: '12px 0 8px' }}>What should happen to {about.ids.length > 1 ? 'these notes' : 'this note'}?</p>
      <div role="group" aria-label="Suggestions" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button type="button" style={chip} disabled={busy} onClick={() => setView(view === 'children' ? null : 'children')} aria-expanded={view === 'children'}>Add ideas under it</button>
        <button type="button" style={chip} disabled={busy} onClick={() => ai({ generateSimilar: true, generateSimilarCount: 3, isDetailedSimilar: false })}>More notes like it</button>
        <button type="button" style={chip} disabled={busy} onClick={() => ai({ shrink: true })}>Shorten</button>
        <button type="button" style={chip} disabled={busy} onClick={() => ai({ grow: true })}>Expand</button>
        <button type="button" style={chip} disabled={busy} onClick={() => setView(view === 'tone' ? null : 'tone')} aria-expanded={view === 'tone'}>Change tone</button>
        {about.ids.length === 1 && (
          <button type="button" style={chip} disabled={busy} onClick={() => setView(view === 'picture' ? null : 'picture')} aria-expanded={view === 'picture'}>
            Make a picture <span style={{ color: '#b45309', fontSize: 11, marginLeft: 4 }}>counts as AI use</span>
          </button>
        )}
      </div>
      {view === 'tone' && (
        <div role="group" aria-label="Tone" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {Object.entries(CONSTANTS.ai.tone).map(([key, { display, description }]) => (
            <button key={key} type="button" style={chip} title={description} disabled={busy} onClick={() => { ai({ tone: key }); setView(null) }}>{display}</button>
          ))}
        </div>
      )}
      {(view === 'children' || view === 'picture') && (
        <form style={{ display: 'grid', gap: 8, marginTop: 10 }} onSubmit={(e) => {
          e.preventDefault()
          if (!words.trim()) return
          ai(view === 'picture' ? { textToImage: words.trim() } : { textToChildNodes: words.trim(), textToChildNodesCount: 'as many as needed', isDetailedChild: false })
          setWords('')
          setView(null)
        }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span>{view === 'picture' ? 'Describe the picture' : 'What should the new notes be about?'}</span>
            <textarea rows={3} value={words} maxLength={1200} autoFocus onChange={(e) => setWords(e.target.value)}
              style={{ font: '500 14px Manrope, system-ui, sans-serif', padding: 8, borderRadius: 8 }} />
          </label>
          <button type="submit" disabled={busy || !words.trim()} style={{ ...chip, justifySelf: 'start' }}>
            {view === 'picture' ? 'Make the picture' : 'Add the notes'}
          </button>
        </form>
      )}
    </section>
  )
}
