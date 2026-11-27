// Sample data for every email Slatebox sends (web/app/server/email/templates.mjs), for the preview
// script (scripts/email-preview.mjs) and the snapshot tests. Dev only: kept out of the server bundle.
import {
  enrollAccount, libraryDecision, loginLink, meterAlert, passkeyAdded, proMergeLink, resetPassword, verifyEmail,
} from '../web/app/server/email/templates.mjs'

export const SAMPLES = Object.freeze({
  'verify-email': () => verifyEmail({ firstName: null, url: 'https://app.slatebox.com/verify-email/sample-token' }),
  'verify-email-named': () => verifyEmail({ firstName: 'Ada', url: 'https://app.slatebox.com/verify-email/sample-token' }),
  'reset-password': () => resetPassword({ firstName: 'Ada', url: 'https://app.slatebox.com/reset-password/sample-token' }),
  'enroll-account': () => enrollAccount({ firstName: 'Grace', teamName: 'Acme Design', url: 'https://app.slatebox.com/enroll-account/sample-token' }),
  'enroll-account-long-team': () => enrollAccount({ firstName: 'Grace', teamName: 'The Northwest Regional Product Design and Research Collaborative', url: 'https://app.slatebox.com/enroll-account/sample-token' }),
  'enroll-account-no-team': () => enrollAccount({ firstName: null, teamName: '', url: 'https://app.slatebox.com/enroll-account/sample-token' }),
  'login-link': () => loginLink({ firstName: 'Ada', url: 'https://app.slatebox.com/login-link/sample-link' }),
  'passkey-added': () => passkeyAdded({ firstName: 'Ada', passkeyName: 'iCloud Keychain', url: 'https://app.slatebox.com/profile?tab=sign-in' }),
  'pro-merge-link': () => proMergeLink({ firstName: 'Ada', url: 'https://app.slatebox.com/login-link/sample-link', days: 7 }),
  'library-approved': () => libraryDecision({
    firstName: 'Ada', subject: 'Slatebox: your slate "Kickoff notes" is published', headline: 'Your slate "Kickoff notes" was published',
    message: 'Thanks, this is a great starter.', publicUrl: 'https://app.slatebox.com/library/kickoff-notes-i1',
    libraryUrl: 'https://app.slatebox.com/library/mine',
  }),
  'library-changes-requested': () => libraryDecision({
    firstName: 'Ada', subject: 'Slatebox: your smart component "Retro board" needs changes', headline: 'Your smart component "Retro board" needs changes',
    message: 'Add a "Try" column.\nThen submit it again.', nextLine: 'Change it, then submit it again from My library.',
    libraryUrl: 'https://app.slatebox.com/library/mine',
  }),
  'meter-alert': () => meterAlert({ text: "Today's free spend reached the daily ceiling. Free calls pause until midnight UTC.", adminUrl: 'https://app.slatebox.com/admin' }),
})
