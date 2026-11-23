import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import { useTheme } from '@mui/material/styles'
import { visuallyHidden } from './SheetParts'
import { proBrings } from './pay-copy.mjs'

// The celebration (design §8, mock-welcome.html): the pay pane gives way to this inside the same
// sheet. Timings count from the moment confirm() succeeds: glow and seal at 120 ms, the check drawn
// from 300 ms, 18 slate tiles from 260 ms (a first Pro only), the heading at 320 ms, the lead at
// 380 ms, the included box at 400 ms with its rows 40 ms apart, the button at 700 ms and the fine
// print at 800 ms: about 1.25 s, once, no sound, clipped to the sheet. Under reduced motion every
// part fades in over 150 ms and the check is already drawn. Focus: the heading at once (the Pay
// button is gone), then the button once the server confirms; no autofocus attribute.

// --x, --y, --r, colour, delay, size: 18 directions, 70–160 px out, a slight upward bias
export const TILES = [
  [-118, -38, 200, '#f4c37d', 0, 8], [-96, -86, -160, '#e8a15a', 0.02, 8], [-58, -112, 240, '#39604c', 0, 8],
  [-14, -128, -200, '#dce9ce', 0.03, 8], [30, -122, 180, '#f4c37d', 0.01, 8], [72, -100, -240, '#254b3b', 0, 8],
  [108, -64, 220, '#e8a15a', 0.04, 8], [130, -18, -180, '#dce9ce', 0, 8], [124, 30, 260, '#f2ce8b', 0.02, 8],
  [96, 62, -220, '#39604c', 0.05, 8], [-128, 16, -260, '#39604c', 0.03, 8], [-104, 58, 190, '#f2ce8b', 0, 8],
  [-140, -70, 150, '#dce9ce', 0.06, 6], [142, -90, -150, '#f4c37d', 0.06, 6], [-40, -150, 120, '#e8a15a', 0.07, 6],
  [54, -146, -120, '#39604c', 0.07, 6], [-160, -20, 90, '#f2ce8b', 0.08, 10], [160, 6, -90, '#e8a15a', 0.08, 10],
]

const CSS = `
.pw{position:relative;overflow:hidden;text-align:center;padding:40px 32px 28px;--ease-out:cubic-bezier(.2,.7,.3,1);--ease-spring:cubic-bezier(.34,1.56,.64,1);--ease-draw:cubic-bezier(.65,0,.35,1)}
.pw.burst:before{content:"";position:absolute;left:50%;top:-120px;width:420px;height:300px;transform:translateX(-50%);pointer-events:none;
  background:radial-gradient(closest-side,color-mix(in srgb,#f4c37d 38%,transparent),transparent);animation:pw-fade .6s .12s both}
.pw-stage{position:relative;width:96px;height:96px;margin:0 auto 20px}
.pw-halo{position:absolute;inset:16px;border-radius:50%;border:2px solid #f4c37d;opacity:0;animation:pw-halo .7s .3s var(--ease-out) both}
.pw-seal{position:absolute;inset:16px;border-radius:50%;background:var(--pw-primary);display:grid;place-items:center;animation:pw-seal .42s .12s var(--ease-spring) both}
.pw-seal svg{width:32px;height:32px}
.pw-seal path{stroke:var(--pw-on-primary);stroke-width:3.2;fill:none;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:28;stroke-dashoffset:28;animation:pw-draw .36s .3s var(--ease-draw) forwards}
.pw-tile{position:absolute;left:44px;top:44px;border-radius:2px;opacity:0;animation:pw-burst .9s calc(.26s + var(--d,0s)) var(--ease-out) both}
.pw h2{position:relative;margin:0;font-size:26px;line-height:1.2;font-weight:800;letter-spacing:-.01em;outline:none;animation:pw-rise .28s .32s var(--ease-out) both}
.pw-lead{position:relative;color:var(--pw-ink2);margin:8px auto 20px;max-width:340px;animation:pw-rise .28s .38s var(--ease-out) both}
.pw-incl{position:relative;list-style:none;margin:0 auto 24px;padding:14px 16px;display:grid;gap:10px;text-align:left;background:var(--pw-offset);border-radius:12px;max-width:380px;animation:pw-rise .28s .4s var(--ease-out) both}
.pw-incl .h{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--pw-ink2)}
.pw-incl li{display:flex;gap:10px;font-size:14px;animation:pw-fade .2s both}
.pw-incl li:nth-child(1){animation-delay:.42s}.pw-incl li:nth-child(2){animation-delay:.46s}.pw-incl li:nth-child(3){animation-delay:.5s}.pw-incl li:nth-child(4){animation-delay:.54s}
.pw-ico{flex:none;width:22px;height:22px;border-radius:6px;background:var(--pw-selected);display:grid;place-items:center;color:var(--pw-primary)}
.pw-ico svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.pw-go{animation:pw-rise .28s .7s var(--ease-out) both}
.pw-sub{position:relative;font-size:12.5px;color:var(--pw-ink2);margin:12px 0 0;animation:pw-fade .3s .8s both}
@keyframes pw-fade{from{opacity:0}to{opacity:1}}
@keyframes pw-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes pw-seal{0%{transform:scale(.6);opacity:0}70%{transform:scale(1.06);opacity:1}100%{transform:scale(1)}}
@keyframes pw-draw{to{stroke-dashoffset:0}}
@keyframes pw-halo{0%{opacity:.5;transform:scale(1)}100%{opacity:0;transform:scale(1.9)}}
@keyframes pw-burst{
  0%{opacity:0;transform:translate(0,0) rotate(0) scale(.4)}
  12%{opacity:1}
  60%{opacity:1;transform:translate(var(--x),var(--y)) rotate(var(--r)) scale(1)}
  100%{opacity:0;transform:translate(var(--x),calc(var(--y) + 26px)) rotate(calc(var(--r) * 1.3)) scale(.8)}
}
@media (prefers-reduced-motion: reduce){
  .pw-tile,.pw-halo,.pw.burst:before{display:none}
  .pw-seal,.pw h2,.pw-lead,.pw-incl,.pw-incl li,.pw-go,.pw-sub{animation:pw-fade .15s both}
  .pw-seal path{animation:none;stroke-dashoffset:0}
}
@media (max-width:599px){
  .pw{padding:12px 16px calc(20px + env(safe-area-inset-bottom))}
  .pw h2{font-size:23px}
}
`

const ICONS = {
  ai: <path d="M7 1.5l1.3 3.2L11.5 6 8.3 7.3 7 10.5 5.7 7.3 2.5 6l3.2-1.3z" />,
  picture: <><rect x="1.5" y="2.5" width="11" height="9" rx="1.5" /><path d="M2.5 10l3-3 2.5 2.5 1.5-1.5 2 2" /><circle cx="9.5" cy="5.3" r=".9" /></>,
  video: <><rect x="1.5" y="3.5" width="7.5" height="7" rx="1.5" /><path d="M9 6l3.5-2v6L9 8" /></>,
}

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// $0 → the amount over 500 ms (static under reduced motion)
function useCountUp(cents, run) {
  const [shown, setShown] = useState(run && !reducedMotion() ? 0 : cents)
  useEffect(() => {
    if (!run || reducedMotion()) { setShown(cents); return undefined }
    let frame
    const start = performance.now()
    const tick = t => {
      const k = Math.min(1, (t - start) / 500)
      setShown(Math.round(cents * (1 - (1 - k) ** 3)))
      if (k < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [cents, run])
  return shown
}

export default function Welcome({ copy, credits, ready, titleId, leadId, onPrimary, onSeePro, handle }) {
  const theme = useTheme()
  const h2 = useRef(null)
  const go = useRef(null)
  const p = theme.palette
  const dark = p.mode === 'dark'

  // focus: the heading at once; the button when it becomes enabled
  useEffect(() => { h2.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => { if (ready) go.current?.focus({ preventScroll: true }) }, [ready])

  const counting = copy.countUp != null
  const cents = useCountUp(copy.countUp || 0, counting)
  const figure = cents % 100 ? `$${(cents / 100).toFixed(2)}` : `$${cents / 100}`
  const title = counting ? copy.title.replace(/^\$[\d.]+/, '') : copy.title
  const rows = copy.included ? proBrings(credits, { perMonth: false }) : []

  return (
    <Box
      className={`pw${copy.burst ? ' burst' : ''}`}
      data-pay-welcome={ready ? 'ready' : 'finalizing'}
      style={{
        '--pw-primary': p.primary.main, '--pw-on-primary': p.primary.contrastText, '--pw-ink2': p.text.secondary,
        '--pw-offset': dark ? '#2c4338' : '#edf0e5', '--pw-selected': dark ? '#3c5344' : '#dce9ce',
      }}
    >
      <style>{CSS}</style>
      {handle}
      <div className="pw-stage" aria-hidden="true">
        {copy.burst && <span className="pw-halo" />}
        <span className="pw-seal"><svg viewBox="0 0 32 32"><path d="M9 16.5l4.6 4.5L23 11.5" /></svg></span>
        {copy.burst && TILES.map(([x, y, r, c, d, s]) => (
          <i key={`${x},${y}`} className="pw-tile" style={{ '--x': `${x}px`, '--y': `${y}px`, '--r': `${r}deg`, '--d': `${d}s`, background: c, width: s, height: s }} />
        ))}
      </div>
      <h2 id={titleId} ref={h2} tabIndex={-1}>
        {counting ? <><span aria-hidden="true">{figure}</span><span style={visuallyHidden}>{copy.title.match(/^\$[\d.]+/)?.[0]}</span>{title}</> : title}
      </h2>
      <p className="pw-lead" id={leadId}>{copy.lead}</p>
      {rows.length > 0 && (
        <ul className="pw-incl">
          <li className="h">Now included each month</li>
          {rows.map(r => (
            <li key={r.icon}><span className="pw-ico" aria-hidden="true"><svg viewBox="0 0 14 14">{ICONS[r.icon]}</svg></span><span>{r.text}</span></li>
          ))}
        </ul>
      )}
      <Box className="pw-go" sx={{ maxWidth: 380, mx: 'auto' }}>
        <Button
          ref={go}
          fullWidth
          disableFocusRipple
          variant="contained"
          disabled={!ready}
          onClick={onPrimary}
          sx={{ height: 48, fontSize: 16, fontWeight: 700, '&.Mui-disabled': { bgcolor: 'primary.main', color: 'primary.contrastText', opacity: 0.72, cursor: 'progress' }, '&:focus-visible': { outline: '3px solid #f4c37d', outlineOffset: 3 } }}
          data-pay-welcome-go=""
        >
          {!ready && <CircularProgress size={14} color="inherit" sx={{ mr: 1 }} aria-hidden />}
          {copy.button}
        </Button>
      </Box>
      {copy.included && (
        <p className="pw-sub">A receipt is on its way to your email. {onSeePro && <Button variant="text" size="small" onClick={onSeePro} sx={{ fontWeight: 600, fontSize: 'inherit', p: 0, minWidth: 0, verticalAlign: 'baseline' }}>See your Pro</Button>}</p>
      )}
      {!copy.included && copy.countUp != null && <p className="pw-sub">A receipt is on its way to your email.</p>}
    </Box>
  )
}

Welcome.propTypes = {
  copy: PropTypes.shape({ title: PropTypes.string, lead: PropTypes.string, button: PropTypes.string, burst: PropTypes.bool, included: PropTypes.bool, countUp: PropTypes.number }).isRequired,
  credits: PropTypes.shape({}),
  ready: PropTypes.bool.isRequired,
  titleId: PropTypes.string.isRequired,
  leadId: PropTypes.string.isRequired,
  onPrimary: PropTypes.func.isRequired,
  onSeePro: PropTypes.func,
  handle: PropTypes.node,
}
Welcome.defaultProps = { credits: null, onSeePro: null, handle: null }
