// Every email Slatebox sends, in one look: the branded layout and each email's words. Pure (no
// Meteor), so the tests and the preview script (scripts/email-preview.mjs) render exactly what is
// sent. The senders stay where they were (server/email/setup.js for the account emails, and the
// login link, Pro move link, library notices and meter alerts); they only call these.
//
// Each email is → { subject, preheader, html, text }. The HTML is a 600px table layout with inline
// styles (Gmail, Outlook and Apple Mail), one table-based button with a VML fallback for Outlook,
// the raw link under it, a footer that says why the email came, and a plain-text twin.
// The greeting uses the first name, else "Hi there": never the address or a part of it.

export const BRAND = Object.freeze({
  green: '#223e32', // the email header, the app bar's green
  ink: '#213d32',
  secondaryInk: '#53685b',
  page: '#f8f7ef',
  paper: '#fffef8',
  border: '#d3d7c9',
  button: '#254b3b',
  buttonInk: '#ffffff',
  peach: '#f2ce8b', // the mark's color; the button in dark mode
  darkPage: '#17251f',
  darkPaper: '#23362d',
  darkInk: '#f5f3e9',
  darkSecondaryInk: '#bdcdbd',
  darkBorder: '#475e50',
})

export const FONT_STACK = "Manrope, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"
export const DEFAULT_LOGO_URL = 'https://app.slatebox.com/brand/email-logo.png'
export const PRIVACY_URL = 'https://slatebox.com/privacy/'
export const COMPANY = 'Slatebox LLC'

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/** The first name to greet, or null: a missing, blank or address-like name is never shown. */
export function firstNameOf(user) {
  const raw = typeof user === 'string' ? user : user?.profile?.firstName ?? user?.firstName
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
  if (!name || name.includes('@')) return null
  return name
}

export const greeting = (firstName) => `Hi ${firstNameOf(firstName) || 'there'},`

/** The logo's address: this instance's own copy when it is served over https, else Slatebox Cloud's. */
export function logoUrlFor(origin) {
  const base = typeof origin === 'string' ? origin.trim().replace(/\/+$/, '') : ''
  return /^https:\/\/[^/\s]+/i.test(base) ? `${base}/brand/email-logo.png` : DEFAULT_LOGO_URL
}

// A paragraph is a string, or a list of strings and links ({ href, label }).
const segments = (paragraph) => (Array.isArray(paragraph) ? paragraph : [paragraph])
const linkStyle = `color:${BRAND.button};text-decoration:underline;`
const paragraphHtml = (paragraph) => segments(paragraph).map((part) => (typeof part === 'string'
  ? escapeHtml(part)
  : `<a href="${escapeHtml(part.href)}" class="sb-link" style="${linkStyle}">${escapeHtml(part.label || part.href)}</a>`)).join('')
const paragraphText = (paragraph) => segments(paragraph).map((part) => (typeof part === 'string'
  ? part
  : (!part.label || part.label === part.href ? part.href : `${part.label} (${part.href})`))).join('')

const P = `margin:0 0 16px;font-family:${FONT_STACK};font-size:16px;line-height:26px;color:${BRAND.ink};`
const SMALL = `margin:0 0 8px;font-family:${FONT_STACK};font-size:13px;line-height:20px;color:${BRAND.secondaryInk};`

// Outlook's VML button has a fixed width: wide enough for its label (about 9.5px a character at
// 16px bold, plus the padding), within the 600px column. A label too long for it (a long team
// name) shows the short label there instead, so Outlook never cuts the words off.
export const VML_MAX_WIDTH = 520
const vmlWidthFor = (label) => Math.max(200, Math.ceil(String(label || '').length * 9.5) + 56)
export function vmlButton({ label, shortLabel }) {
  const vmlLabel = vmlWidthFor(label) > VML_MAX_WIDTH && shortLabel ? shortLabel : label
  return { label: vmlLabel, width: Math.min(VML_MAX_WIDTH, vmlWidthFor(vmlLabel)) }
}

function buttonHtml({ label, url, shortLabel }) {
  const href = escapeHtml(url)
  const text = escapeHtml(label)
  const vml = vmlButton({ label, shortLabel })
  const width = vml.width
  // Outlook on Windows draws the VML shape; every other client the table cell and its link.
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:8px 0 24px;">
<tr><td>
<!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${href}" style="height:48px;v-text-anchor:middle;width:${width}px;" arcsize="50%" stroke="f" fillcolor="${BRAND.button}"><w:anchorlock/><center style="color:${BRAND.buttonInk};font-family:Arial,sans-serif;font-size:16px;font-weight:bold;">${escapeHtml(vml.label)}</center></v:roundrect><![endif]-->
<!--[if !mso]><!-- --><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
<td class="sb-button" align="center" bgcolor="${BRAND.button}" style="border-radius:24px;background:${BRAND.button};">
<a href="${href}" class="sb-button-link" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT_STACK};font-size:16px;line-height:20px;font-weight:700;color:${BRAND.buttonInk};text-decoration:none;border-radius:24px;">${text}</a>
</td></tr></table><!--<![endif]-->
</td></tr></table>`
}

/**
 * The one layout. content: { subject, preheader, headline, firstName, paragraphs[], quote?: { lead, text },
 * cta?: { label, url, textLabel? }, after[], reason, logoUrl }.
 */
export function renderEmail(content) {
  const {
    subject, preheader = '', headline, firstName = null, paragraphs = [], quote = null, cta = null,
    after = [], reason, logoUrl = DEFAULT_LOGO_URL,
  } = content
  const hello = greeting(firstName)
  const quoteHtml = quote
    ? `<p style="${P}margin-bottom:8px;">${escapeHtml(quote.lead)}</p>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:0 0 20px;"><tr>
<td class="sb-quote" style="border-left:3px solid ${BRAND.peach};padding:4px 0 4px 16px;font-family:${FONT_STACK};font-size:15px;line-height:24px;color:${BRAND.ink};">${escapeHtml(quote.text).replace(/\n/g, '<br>')}</td>
</tr></table>`
    : ''
  const fallback = cta
    ? `<p class="sb-muted" style="${SMALL}">If the button doesn't work, copy this link into your browser:</p>
<p style="${SMALL}margin-bottom:24px;word-break:break-all;"><a href="${escapeHtml(cta.url)}" class="sb-link" style="${linkStyle}">${escapeHtml(cta.url)}</a></p>`
    : ''
  const privacyLink = `<a href="${PRIVACY_URL}" class="sb-muted" style="color:${BRAND.secondaryInk};text-decoration:underline;">Privacy</a>`

  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="format-detection" content="telephone=no, date=no, address=no, email=no, url=no">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
<style>
  body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table { border-collapse: collapse; mso-table-lspace: 0; mso-table-rspace: 0; }
  img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
  a { color: ${BRAND.button}; }
  @media screen and (max-width: 620px) {
    .sb-container { width: 100% !important; }
    .sb-pad { padding-left: 20px !important; padding-right: 20px !important; }
    .sb-outer { padding: 12px 8px !important; }
    .sb-headline { font-size: 22px !important; line-height: 30px !important; }
  }
  @media (prefers-color-scheme: dark) {
    .sb-body, .sb-outer { background: ${BRAND.darkPage} !important; }
    .sb-card { background: ${BRAND.darkPaper} !important; border-color: ${BRAND.darkBorder} !important; }
    .sb-card p, .sb-card td, .sb-headline { color: ${BRAND.darkInk} !important; }
    .sb-card .sb-muted, .sb-card .sb-footer p, .sb-card .sb-footer a { color: ${BRAND.darkSecondaryInk} !important; }
    .sb-footer { border-color: ${BRAND.darkBorder} !important; }
    .sb-link { color: ${BRAND.peach} !important; }
    .sb-button { background: ${BRAND.peach} !important; }
    .sb-button-link { color: ${BRAND.darkPage} !important; }
  }
  [data-ogsc] .sb-card { background: ${BRAND.darkPaper} !important; }
  [data-ogsc] .sb-card p, [data-ogsc] .sb-card td, [data-ogsc] .sb-headline { color: ${BRAND.darkInk} !important; }
  [data-ogsc] .sb-card .sb-muted, [data-ogsc] .sb-card .sb-footer p, [data-ogsc] .sb-card .sb-footer a { color: ${BRAND.darkSecondaryInk} !important; }
  [data-ogsc] .sb-link { color: ${BRAND.peach} !important; }
</style>
</head>
<body class="sb-body" style="margin:0;padding:0;background:${BRAND.page};">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${BRAND.page};opacity:0;">${escapeHtml(preheader)}${'&#8199;&#65279;&#847; '.repeat(40)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND.page};">
<tr><td align="center" class="sb-outer" style="background:${BRAND.page};padding:32px 12px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0"><tr><td><![endif]-->
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" class="sb-container" style="width:600px;max-width:600px;">
<tr><td class="sb-card" style="background:${BRAND.paper};border:1px solid ${BRAND.border};border-radius:12px;overflow:hidden;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
<tr><td class="sb-pad" bgcolor="${BRAND.green}" style="background:${BRAND.green};padding:20px 32px;border-radius:11px 11px 0 0;">
<a href="https://slatebox.com/" style="text-decoration:none;"><img src="${escapeHtml(logoUrl)}" width="160" height="40" alt="Slatebox" style="display:block;width:160px;height:40px;border:0;color:#fffef8;font-family:${FONT_STACK};font-size:22px;font-weight:800;line-height:40px;"></a>
</td></tr>
<tr><td class="sb-pad" style="padding:32px 32px 8px;">
<p style="${P}">${escapeHtml(hello)}</p>
<h1 class="sb-headline" style="margin:0 0 16px;font-family:${FONT_STACK};font-size:26px;line-height:34px;font-weight:800;letter-spacing:-0.01em;color:${BRAND.ink};">${escapeHtml(headline)}</h1>
${quoteHtml}
${paragraphs.map((paragraph) => `<p style="${P}">${paragraphHtml(paragraph)}</p>`).join('\n')}
${cta ? buttonHtml(cta) : ''}
${fallback}
${after.map((paragraph) => `<p class="sb-muted" style="${P}color:${BRAND.secondaryInk};">${paragraphHtml(paragraph)}</p>`).join('\n')}
</td></tr>
<tr><td class="sb-pad sb-footer" style="padding:16px 32px 28px;border-top:1px solid ${BRAND.border};">
<p style="${SMALL}">${escapeHtml(reason)}</p>
<p style="${SMALL}margin:0;">${escapeHtml(COMPANY)} &nbsp;&middot;&nbsp; ${privacyLink}</p>
</td></tr>
</table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`

  const text = [
    hello,
    '',
    headline,
    '',
    ...(quote ? [`${quote.lead}\n${quote.text}`, ''] : []),
    ...paragraphs.flatMap((paragraph) => [paragraphText(paragraph), '']),
    ...(cta ? [`${cta.textLabel || cta.label}: ${cta.url}`, ''] : []),
    ...after.flatMap((paragraph) => [paragraphText(paragraph), '']),
    '-- ', // the signature separator (dash dash space), so mail clients can fold the footer
    reason,
    `${COMPANY} · Privacy: ${PRIVACY_URL}`,
    '',
  ].join('\n')

  return { subject, preheader, html, text }
}

// ---------- the emails ----------

/** Accounts verifyEmail: a new account, a changed address, or a Pro bought as a guest. */
export function verifyEmail({ firstName, url, logoUrl }) {
  return renderEmail({
    subject: 'Confirm your email for Slatebox',
    preheader: 'One click to confirm your address and finish setting up Slatebox.',
    headline: 'Confirm your email',
    firstName,
    paragraphs: ["Confirm this address for your Slatebox account. Once it's confirmed, every Slatebox feature is open to you."],
    cta: { label: 'Confirm my email', url, textLabel: 'Confirm your email' },
    after: ["If you didn't create a Slatebox account or change your address, you can ignore this email."],
    reason: 'You got this email because this address was used for a Slatebox account.',
    logoUrl,
  })
}

/** Accounts resetPassword. */
export function resetPassword({ firstName, url, logoUrl }) {
  return renderEmail({
    subject: 'Reset your Slatebox password',
    preheader: 'Choose a new password for your Slatebox account.',
    headline: 'Reset your password',
    firstName,
    paragraphs: ['We got a request to reset the password for your Slatebox account. Choose a new one with the button below.'],
    cta: { label: 'Choose a new password', url, textLabel: 'Reset your password' },
    after: ["If you didn't ask for this, you can ignore this email. Your password stays the same."],
    reason: 'You got this email because someone asked to reset the password for this Slatebox account.',
    logoUrl,
  })
}

/** Accounts enrollAccount: a team invitation (the team page, or a team import's placeholder). */
export function enrollAccount({ firstName, teamName, url, logoUrl }) {
  // A team names itself: line breaks and other control characters are flattened to spaces.
  // eslint-disable-next-line no-control-regex
  const cleaned = typeof teamName === 'string' ? teamName.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim() : ''
  const team = cleaned ? cleaned.slice(0, 80) : null
  return renderEmail({
    subject: team ? `You're invited to join ${team} on Slatebox` : "You're invited to join a team on Slatebox",
    preheader: team ? `Set your password to join ${team} and start building together.` : 'Set your password to join your team and start building together.',
    headline: team ? `Join ${team} on Slatebox` : 'Join your team on Slatebox',
    firstName,
    paragraphs: [
      `${team ? `You've been invited to join ${team}.` : "You've been invited to a team."} Slatebox is a shared canvas where people and agents build ideas together in real time, then share what they make.`,
      'Set your password to accept the invitation.',
    ],
    cta: { label: team ? `Join ${team}` : 'Join the team', shortLabel: 'Join the team', url, textLabel: 'Accept the invitation' },
    after: ["Not expecting this? You can ignore this email and nothing will change."],
    reason: 'You got this email because a team admin invited this address to Slatebox.',
    logoUrl,
  })
}

/** users.requestLoginLink: a one-time sign-in link, sent to the address that asked for it. */
export function loginLink({ firstName, url, logoUrl }) {
  return renderEmail({
    subject: 'Your Slatebox sign-in link',
    preheader: 'Use this one-time link to sign back in to Slatebox.',
    headline: 'Sign in to Slatebox',
    firstName,
    paragraphs: ["Can't remember your password? No problem. Use this one-time link to sign back in."],
    cta: { label: 'Sign in to Slatebox', url, textLabel: 'Sign in' },
    after: ["If you didn't ask for this link, you can ignore this email. Nobody can sign in without it."],
    reason: 'You got this email because a sign-in link was requested for this Slatebox account.',
    logoUrl,
  })
}

/** The Pro move link: Pro bought by a guest with an address that already has an account. */
export function proMergeLink({ firstName, url, days, logoUrl }) {
  return renderEmail({
    subject: 'Move your Slatebox Pro into your account',
    preheader: 'Slatebox Pro was bought with this address. Move it into your account with one link.',
    headline: 'Move Slatebox Pro into your account',
    firstName,
    paragraphs: [
      'Slatebox Pro was just bought with this email address by someone who was not signed in.',
      'This address already has a Slatebox account. If it was you, open this link to move Slatebox Pro and the slates you made into your account.',
    ],
    cta: { label: 'Move Slatebox Pro', url, textLabel: 'Move Slatebox Pro' },
    after: [`The link works once, for ${days} days. If it wasn't you, ignore this email: nothing changes in your account, and nobody was signed in to it.`],
    reason: 'You got this email because a Slatebox Pro purchase used this address.',
    logoUrl,
  })
}

/** A library decision for the item's author (server/library/notify.mjs has the outcome words). */
export function libraryDecision({ firstName, subject, headline, message, publicUrl, nextLine, libraryUrl, logoUrl }) {
  const said = typeof message === 'string' && message.trim() ? message.trim().slice(0, 2000) : null
  // Published: the button opens the item where everyone sees it; otherwise My library, where the thread is.
  return renderEmail({
    subject,
    preheader: said ? `${headline}. The reviewer left a note.` : `${headline}.`,
    headline,
    firstName,
    paragraphs: publicUrl ? [['Anyone can find it in the library now. You can also see it in ', { href: libraryUrl, label: 'My library' }, '.']] : [nextLine],
    quote: said ? { lead: 'The reviewer wrote:', text: said } : null,
    cta: publicUrl
      ? { label: 'See it in the library', url: publicUrl, textLabel: 'In the library' }
      : { label: 'Open My library', url: libraryUrl, textLabel: 'My library' },
    reason: 'You got this email because you submitted this item to the Slatebox library.',
    logoUrl,
  })
}

/** The meter's alert to the instance's alert address (staff, not customers). */
export function meterAlert({ text, adminUrl, logoUrl }) {
  return renderEmail({
    subject: 'Slatebox meter and billing',
    preheader: String(text || '').slice(0, 120),
    headline: 'Meter and billing alert',
    paragraphs: [String(text || '')],
    cta: adminUrl ? { label: 'Open the admin area', url: adminUrl, textLabel: 'Admin area' } : null,
    reason: "You got this email because this address is set as this Slatebox instance's meter alert address.",
    logoUrl,
  })
}
