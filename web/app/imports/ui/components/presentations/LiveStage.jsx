import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import { Slatebox } from 'slateboxjs'
import { mountLiveDeck } from './livePresenter.mjs'
import { PRESENTATION_STYLES_MARKER } from './presentationStyles.mjs'

/**
 * A styled deck played on a live SlateboxJS canvas of its own (see livePresenter): the slate's
 * real notes in the style, the deck's stage notes, and the engine's camera flying between steps.
 * `goTo(index)` moves it; it remounts when the deck, its style or the screen's orientation
 * changes, landing on the step it was on (a style switch keeps the place).
 */
const LiveStage = forwardRef(({ deck, slateJSON, name = '', onReady, onTap, bottomInset = 0 }, ref) => {
  const hostRef = useRef(null)
  const controller = useRef(null)
  const wanted = useRef(0)
  const down = useRef(null)
  const insetRef = useRef(bottomInset)
  insetRef.current = bottomInset
  useEffect(() => { controller.current?.setInset(bottomInset) }, [bottomInset])
  const [portrait, setPortrait] = useState(() => (typeof window !== 'undefined' ? window.innerHeight > window.innerWidth : false))
  const [failed, setFailed] = useState(false)

  useImperativeHandle(ref, () => ({
    goTo: (index, options) => {
      wanted.current = Math.max(0, index)
      return controller.current?.goTo(wanted.current, options)
    },
    index: () => controller.current?.index() ?? -1,
  }), [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || !deck || !slateJSON) return undefined
    let alive = true
    let live = null
    setFailed(false)
    mountLiveDeck({ host, Slatebox, slateJSON, deck, name, portrait })
      .then(async (mounted) => {
        if (!alive) { mounted.destroy(); return }
        live = mounted
        controller.current = mounted
        mounted.setInset(insetRef.current)
        await mounted.goTo(Math.min(wanted.current, deck.steps.length - 1), { instant: true })
        if (alive) onReady?.()
      })
      .catch((error) => {
        console.error('The live presenter could not start:', error)
        if (alive) setFailed(true)
      })
    return () => {
      alive = false
      if (controller.current === live) controller.current = null
      live?.destroy()
    }
  }, [deck, slateJSON, portrait])

  // Refit on resize; a turn of the phone composes the portrait (or landscape) stage again.
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(() => {
      const nowPortrait = host.clientHeight > host.clientWidth
      if (nowPortrait !== portrait) setPortrait(nowPortrait)
      else controller.current?.resize()
    })
    observer.observe(host)
    return () => observer.disconnect()
  }, [portrait])

  return (
    <div
      ref={hostRef}
      className="sb-live-stage"
      data-presentation-style={deck?.style?.id}
      data-presentation-marker={PRESENTATION_STYLES_MARKER}
      onPointerDown={(event) => { down.current = { x: event.clientX, y: event.clientY } }}
      onPointerUp={(event) => {
        // A tap (not a swipe) on a phone moves on.
        const start = down.current
        down.current = null
        if (event.pointerType === 'touch' && start && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 12) onTap?.(event)
      }}
      style={{ position: 'absolute', inset: 0, overflow: 'clip' }}
    >
      {failed && (
        <div role="alert" style={{ position: 'absolute', top: 72, left: '50%', transform: 'translateX(-50%)', background: '#fff', color: '#111', padding: '8px 16px', borderRadius: 6, zIndex: 5 }}>
          This slate could not be drawn for the presentation. Close the presenter and try again.
        </div>
      )}
    </div>
  )
})

LiveStage.propTypes = {
  deck: PropTypes.object,
  slateJSON: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  name: PropTypes.string,
  onReady: PropTypes.func,
  onTap: PropTypes.func,
  bottomInset: PropTypes.number,
}

export default LiveStage
