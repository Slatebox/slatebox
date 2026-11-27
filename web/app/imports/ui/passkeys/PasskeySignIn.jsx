// The sign-in page's passkey parts: the "Sign in with a passkey" button, and the browser's autofill
// (conditional UI), which offers this site's passkeys in the email field (autocomplete="username
// webauthn" on Login.jsx's field). Both end in the 'passkey' login handler (server/passkeys).
import React, { useEffect, useRef, useState } from 'react'
import PropTypes from 'prop-types'
import Button from '@mui/material/Button'
import KeyIcon from '@mui/icons-material/Key'
import { PASSKEY_WORDS, browserErrorText } from './passkey-copy.mjs'
import { autofillAvailable, cancelPasskeyPrompt, passkeysAvailable, signInWithPasskey } from './passkeys'

export default function PasskeySignIn({ onSignedIn, onError }) {
  const [available, setAvailable] = useState(false)
  const [waiting, setWaiting] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    let autofill = false
    ;(async () => {
      if (!await passkeysAvailable() || !mounted.current) return
      setAvailable(true)
      // Autofill waits in the background until a passkey is picked in the email field.
      if (!await autofillAvailable() || !mounted.current) return
      autofill = true
      try {
        if (await signInWithPasskey({ autofill: true }) && mounted.current) onSignedIn()
      } catch (error) {
        const text = browserErrorText(error)
        if (text && mounted.current) onError(text)
      }
    })()
    return () => {
      mounted.current = false
      if (autofill) cancelPasskeyPrompt()
    }
  }, [])

  if (!available) return null
  const start = async () => {
    setWaiting(true)
    try {
      // This replaces the autofill request; the browser shows its passkey prompt.
      if (await signInWithPasskey() && mounted.current) onSignedIn()
    } catch (error) {
      const text = browserErrorText(error)
      if (text && mounted.current) onError(text)
    } finally {
      if (mounted.current) setWaiting(false)
    }
  }
  return (
    <Button id="passkeySignIn" type="button" fullWidth variant="outlined" color="primary" size="large" disableElevation
      startIcon={<KeyIcon />} onClick={start} disabled={waiting} sx={{ mt: 1, mb: 1, borderRadius: 6 }}>
      {waiting ? PASSKEY_WORDS.signingIn : PASSKEY_WORDS.signIn}
    </Button>
  )
}

PasskeySignIn.propTypes = {
  onSignedIn: PropTypes.func.isRequired,
  onError: PropTypes.func.isRequired,
}
