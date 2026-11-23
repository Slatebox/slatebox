/* eslint-disable no-underscore-dangle */
import React, { useEffect, useState } from 'react'
import { useSetAtom } from 'jotai'
// import { BrowserRouter as Router, Routes, Route } from 'react-router-dom' // Moved to main.jsx
import DailyIframe from '@daily-co/daily-js'
import { DailyProvider } from '@daily-co/daily-react'
import { LocaleProvider } from './common/i18n'
import Main from './Main'
// import Present from './pages/Present' // Will be routed in main.jsx
// import GetStarted from './pages/GetStarted' // Will be routed in main.jsx
// import Login from './pages/Login' // Will be routed in main.jsx
import { isMobileOrTouchDevice } from './jotai/atoms'
import InitSubscriptions from './InitSubscriptions'
import PaySheetHost from './components/billing/pay/PaySheetHost'
// import { ThemeProvider } from '@mui/material/styles' // Moved to main.jsx
// import CssBaseline from '@mui/material/CssBaseline' // Moved to main.jsx

export default function App() {
  const [co, setCo] = useState(null)
  const setIsMobile = useSetAtom(isMobileOrTouchDevice)

  useEffect(() => {
    if (co) return

    // One call object per page, with Daily's defaults: every call now uses its current camera
    // and microphone handling, and the old switch for it is deprecated.
    let _co = DailyIframe.getCallInstance()
    if (!_co) _co = DailyIframe.createCallObject()
    setCo(_co)
  }, [co])

  useEffect(() => {
    const mobile =
      /(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ipad|iphone|ipod|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series40|symbian|treo|up\.browser|up\.link|vodafone|wap|windows (ce|phone)|xda|xiino/i.test(
        navigator.userAgent
      )
    const touch = 'ontouchend' in document
    setIsMobile(mobile || touch)
  }, [setIsMobile])

  // Router, ThemeProvider, CssBaseline, and specific routes (Present, GetStarted, Login) are now handled in main.jsx
  return (
    <DailyProvider callObject={co}>
      <LocaleProvider>
        <InitSubscriptions>
          {/* the one pay sheet: renders nothing until a surface opens it (usePaySheet) */}
          <PaySheetHost>
            <Main />
          </PaySheetHost>
        </InitSubscriptions>
      </LocaleProvider>
    </DailyProvider>
  )
}
