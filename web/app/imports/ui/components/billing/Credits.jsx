import React, { useEffect, useState } from 'react'
import { Meteor } from 'meteor/meteor'
import { useAtom } from 'jotai'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import CONSTANTS from '../../../api/common/constants'
import { allowance } from '../../jotai/atoms'
import Balance from './Balance'
import OwnKeys from './OwnKeys'
import ProPanel from './ProPanel'
import { callsLeftText } from './money'
import { AccountActions, AccountNote, AccountPanel, AccountSection, FinePrint, SPACE } from '../../common/AccountLayout'

// Profile → Credits: Slatebox Pro, plain sentences about what is left this month, the balance
// and own keys where they are on (summary.ownKeysAvailable, own-keys.mjs): optional, free to use,
// and a request one of them serves spends no Slatebox credits. Where Pro is never needed (settings.free.proRequiredFrom 'never': self-host), the
// month's amount is free for everyone signed in and is shown as such.
export default function Credits() {
  const [summary, setSummary] = useState(null)
  const [resend, setResend] = useState(null)
  const [shared, setAllowance] = useAtom(allowance)

  const load = async () => {
    const next = await Meteor.callAsync(CONSTANTS.methods.meter.summary).catch(() => null)
    setSummary(next)
    setAllowance(next)
  }
  useEffect(() => { load() }, [])

  // The return from a payment that left the page (?topup=cs_…) opens the pay sheet's Welcome
  // (billing/pay/PaySheetHost.jsx). A payment in the sheet refreshes the shared summary, and this
  // page follows it.
  useEffect(() => { if (shared && shared !== summary && shared.metered !== undefined) setSummary(shared) }, [shared])

  const sendConfirmation = async () => {
    setResend({ busy: true })
    try {
      const result = await Meteor.callAsync(CONSTANTS.methods.users.sendVerification)
      if (result?.alreadyConfirmed) { setResend(null); load(); return }
      setResend({ text: result?.sent ? `We sent a confirmation link to ${result.address}. Open it, then come back here.` : 'This server cannot send email. Ask its administrator to confirm your address.' })
    } catch (err) {
      setResend({ text: err.reason || 'We could not send the email. Try again in a minute.' })
    }
  }

  if (!summary) return null
  if (!summary.metered) return <Typography>This server has no limits on AI or calls.</Typography>

  // Pro credits, or where Pro is not needed the same amount free for everyone signed in
  const amount = summary.pro ? 'Pro credits' : 'free amount'
  let heading = 'Free this month'
  if (summary.pro) heading = 'Pro credits this month'
  else if (summary.needsPro) heading = 'Included AI and calls'
  const aiLine = summary.aiMonthUsedUp
    ? `AI: this month's ${summary.pro ? 'Pro credits for AI are' : 'free AI is'} used up.`
    : `AI: ${summary.aiLeftToday} of ${summary.aiPerDay} drafts left today.`
  return (
    <AccountPanel>
      {/* Slatebox Pro shows where it is needed (Cloud: settings 'now'), on sale, or held */}
      {(summary.needsPro || summary.proAvailable || summary.proState) && (
        <ProPanel summary={summary} onChange={load} />
      )}
      <AccountSection title={heading}>
        {!summary.included ? (
          <Typography>
            {summary.ownKeysAvailable
              ? 'AI on Slatebox’s own models, image search and image generation, and calls you start come with Slatebox Pro, or are paid from your balance. Or use your own AI and call keys: optional, free to use, and they spend no Slatebox credits. Joining someone else’s call uses nothing of yours.'
              : 'AI, image search and image generation, and calls you start come with Slatebox Pro, or are paid from your balance. Joining someone else’s call uses nothing of yours.'}
          </Typography>
        ) : (<>
          {!summary.emailVerified && (
            <AccountNote>
              <Typography>Confirm your email address to use the {amount} each month. Until then, none of it is available.</Typography>
              <AccountActions sx={{ pt: SPACE.tight }}>
                <Button variant="outlined" disabled={Boolean(resend?.busy)} onClick={sendConfirmation}>Send the confirmation email again</Button>
              </AccountActions>
              {resend?.text && <FinePrint sx={{ mt: SPACE.tight }}>{resend.text}</FinePrint>}
            </AccountNote>
          )}
          <Box>
            <Typography>{aiLine}</Typography>
            <Typography>
              Calls you start: {callsLeftText({ voice: summary.voiceHoursLeft, video: summary.videoHoursLeft })}.
            </Typography>
          </Box>
          <FinePrint>Joining someone else’s call uses nothing of yours. {summary.pro ? 'Pro credits' : 'Free amounts'} start again on {summary.resetsOn} and don’t carry over.</FinePrint>
          {summary.stageNote && <FinePrint>{summary.stageNote}</FinePrint>}
        </>)}
      </AccountSection>
      <Balance wallet="me" summary={summary} onChange={load} />
      {summary.ownKeysAvailable && (
        <AccountSection title="Use your own key">
          <OwnKeys owner="me" onChange={load} />
        </AccountSection>
      )}
    </AccountPanel>
  )
}
