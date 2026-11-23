import { useEffect, useRef, useState } from 'react'
import { useColorScheme } from '@mui/material/styles'
import { resolveMode, themeCanvas } from './canvasTheme.mjs'

const MODE_KEY = 'mui-mode'
const darkQuery = '(prefers-color-scheme: dark)'

/** The device's own scheme, kept current: for a page under a theme with no colour schemes of its own. */
function useSystemMode() {
  const [mode, setMode] = useState(() => (typeof window !== 'undefined' && window.matchMedia?.(darkQuery).matches ? 'dark' : 'light'))
  useEffect(() => {
    const query = window.matchMedia?.(darkQuery)
    if (!query) return undefined
    const changed = () => setMode(query.matches ? 'dark' : 'light')
    query.addEventListener?.('change', changed)
    return () => query.removeEventListener?.('change', changed)
  }, [])
  return mode
}

/** The app's mode ('light' or 'dark'), also where a nested theme hides the colour scheme. */
export function useAppMode() {
  const { mode, systemMode } = useColorScheme()
  const device = useSystemMode()
  if (mode) return resolveMode(mode, systemMode ?? device)
  let stored = null
  try { stored = window.localStorage.getItem(MODE_KEY) } catch { stored = null }
  return resolveMode(stored || 'system', device)
}

/**
 * The canvas inside `target` (a ref, or a function that finds the element) follows the app's mode
 * when its slate's background is the default nobody chose (canvasTheme.mjs). `getContainerStyle`
 * returns the slate's containerStyle (or its background colour); it is read whenever the element's
 * own style changes, and again when anything in `deps` does.
 */
export default function useCanvasTheme(target, getContainerStyle, deps = []) {
  const mode = useAppMode()
  const read = useRef(getContainerStyle)
  read.current = getContainerStyle
  useEffect(() => {
    const el = typeof target === 'function' ? target() : target?.current
    if (!el) return undefined
    return themeCanvas(el, { mode, getContainerStyle: () => read.current?.() })
  }, [mode, ...deps])
  return mode
}
