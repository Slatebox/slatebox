import React from 'react'
import './bar.css'

/**
 * While the line tool is drawing (the note bar's Line button, or More → Draw a line on a phone),
 * the canvas says so and offers Cancel: on a phone there is no Esc key and no pointer to show a
 * preview, so this is how a person knows the next tap ends the line, and how they stop it.
 * It sits over the canvas, outside the drawing, so a tap on it is not taken as the line's end.
 */
export default function LineToolStatus({ phone, onCancel }) {
  const hint = phone
    ? 'Tap a note to connect, or anywhere to leave the end free.'
    : 'Click a note to connect, or anywhere to leave the end free. Esc cancels.'
  return (
    <div className="sb-line-tool-status" role="status" aria-label="Drawing a line" data-mode={phone ? 'phone' : 'full'}>
      <span className="sb-line-tool-status__text"><strong>Drawing a line.</strong> {hint}</span>
      <button type="button" className="sb-line-tool-status__cancel" onClick={onCancel}>Cancel</button>
    </div>
  )
}
