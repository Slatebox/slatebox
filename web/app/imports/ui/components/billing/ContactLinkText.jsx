import React from 'react'
import Link from '@mui/material/Link'
import { BILLING_CONTACT_URL } from '../../../api/common/contact.mjs'

// A billing or metering message as text, with the billing contact form's URL shown as a
// link that opens in a new tab. Server messages carry the URL as plain text; this is where
// the UI turns it into a link.
export default function ContactLinkText({ text }) {
  const parts = String(text ?? '').split(BILLING_CONTACT_URL)
  return parts.map((part, i) => (
    <React.Fragment key={i}>
      {part}
      {i < parts.length - 1 && (
        <Link href={BILLING_CONTACT_URL} target="_blank" rel="noopener noreferrer">{BILLING_CONTACT_URL}</Link>
      )}
    </React.Fragment>
  ))
}
