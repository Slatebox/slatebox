// Your Pro in the pay sheet (design §5.1 Manage, §6 Manage actions): one list, no tabs. The status,
// then "Pay yearly instead" (with the server's own preview) or "Monthly from … · Keep yearly", the
// card, receipts, "Stop renewing" or "Keep Pro", and the billing page as the fallback. Pure: what
// the pane shows for a meter.summary, and what each server answer means for the sheet
// (sheet-machine.mjs). Tested in scripts/manage-pane.test.mjs. Never the processor's name.
import { PRO_FIGURES, money } from './pay-copy.mjs'
import { billingDate } from '../billing-date.mjs'

/** "December 22, 2026": the person's own calendar date, the same as the profile's (billing-date.mjs). */
export const longDate = at => billingDate(at)

const BRANDS = {
  visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', diners: 'Diners Club',
  jcb: 'JCB', unionpay: 'UnionPay', cartes_bancaires: 'Cartes Bancaires', eftpos_au: 'eftpos', interac: 'Interac', link: 'Link',
}
export const brandName = brand => BRANDS[brand] || 'Card'

const STATUS_WORDS = { paid: 'Paid', open: 'Not paid yet', void: 'Void', uncollectible: 'Not paid' }

/** Receipts as rows: date, amount, status, and the processor's own View and PDF pages. */
export const receiptRows = invoices => (invoices || []).map(i => ({
  key: i.number, date: longDate(i.created), amount: money(i.totalCents), status: STATUS_WORDS[i.status] || 'Paid', url: i.url || null, pdf: i.pdf || null,
}))

const twoDigits = n => String(n ?? '').padStart(2, '0').slice(-2)

function switchRow(summary, preview) {
  const pro = summary.proState
  if (summary.proPending) {
    return {
      key: 'pending', title: `Monthly from ${longDate(summary.proPending.from)}`, sub: 'Your year runs to the end, then $5 a month plus tax.',
      button: 'Keep yearly', job: 'keep-year', confirm: null, disabled: false,
    }
  }
  if (pro.interval === 'year') {
    const from = longDate(pro.renewsOn)
    return {
      key: 'switch', title: 'Pay monthly instead', sub: `$5 a month plus tax from ${from}, when this year ends. Nothing changes until then.`,
      button: 'Switch', job: 'to-month', disabled: false,
      confirm: { text: `Switch to monthly from ${from}? Your year runs to the end, and nothing is refunded.`, yes: 'Switch at renewal', no: 'Not now' },
    }
  }
  const base = { key: 'switch', title: 'Pay yearly instead', button: 'Switch', job: 'to-year' }
  if (preview === undefined) {
    return { ...base, sub: `${PRO_FIGURES.year.label}, ${PRO_FIGURES.year.tag}. Working out what you pay today…`, disabled: true, confirm: null }
  }
  if (!preview) {
    return {
      ...base, disabled: false,
      sub: `${PRO_FIGURES.year.label}, ${PRO_FIGURES.year.tag}. You pay the difference today, after credit for the rest of this month.`,
      confirm: { text: 'Pay yearly: the difference is charged today, after credit for the rest of this month.', yes: 'Pay and switch', no: 'Not now' },
    }
  }
  const today = money(preview.todayCents)
  const tax = preview.taxCents > 0 ? ', tax included' : ''
  const next = preview.nextDate ? ` Pro then renews on ${longDate(preview.nextDate)}.` : ''
  return {
    ...base, disabled: false,
    sub: `${PRO_FIGURES.year.label}. You pay ${today} today${tax}, after credit for the rest of this month.`,
    confirm: { text: `Pay yearly: ${today} today${tax}.${next}`, yes: `Pay ${today} and switch`, no: 'Not now' },
  }
}

function receiptsRow(invoices) {
  let sub = 'Loading…'
  if (invoices === null) sub = 'Receipts are on the billing page.'
  else if (Array.isArray(invoices) && !invoices.length) sub = 'No receipts yet.'
  else if (Array.isArray(invoices)) sub = `Latest: ${longDate(invoices[0].created)}, ${money(invoices[0].totalCents)}`
  return { key: 'receipts', title: 'Receipts', sub, button: Array.isArray(invoices) && invoices.length ? 'View all' : null, job: null, confirm: null, disabled: false }
}

/**
 * summary: meter.summary. preview: pro.preview's answer for yearly (undefined while asked, null if
 * it failed). invoices: pro.invoices rows (undefined while asked, null if they failed).
 * → { status: { title, when, warn }, notices: [text], pinned: null | { key, title, sub, button, href? },
 *     rows: [{ key, title, sub, button, job, confirm: { text, yes, no } | null, disabled }], portal: { show, note } }
 */
export function manageView(summary, { preview, invoices } = {}) {
  const pro = summary?.proState || null
  const view = { status: { title: '', when: '', warn: false }, notices: [], pinned: null, rows: [], portal: { show: Boolean(pro), note: null } }
  if (!pro) {
    view.status.title = 'You do not have Slatebox Pro.'
    if (summary?.proAvailable) view.rows.push({ key: 'get', title: 'Slatebox Pro', sub: '$5 a month or $50 a year, plus tax.', button: 'Get Pro', job: null, confirm: null, disabled: false })
    return view
  }
  const amount = pro.interval === 'year' ? 'yearly, $50' : 'monthly, $5'
  const ending = Boolean(pro.active && pro.endsOn)
  if (pro.pastDue) {
    Object.assign(view.status, { title: "Pro's last payment didn't go through", when: '', warn: true })
  } else if (ending) {
    Object.assign(view.status, { title: `Pro is on until ${longDate(pro.endsOn)}`, when: 'It will not renew.' })
  } else if (pro.active) {
    Object.assign(view.status, { title: `Pro is on · ${amount} plus tax`, when: pro.renewsOn ? `Renews on ${longDate(pro.renewsOn)}` : '' })
  } else {
    view.status.title = 'Your Pro has ended'
    if (summary.proAvailable) view.rows.push({ key: 'get', title: 'Slatebox Pro', sub: '$5 a month or $50 a year, plus tax.', button: 'Get Pro again', job: null, confirm: null, disabled: false })
    view.rows.push(receiptsRow(invoices))
    return view
  }

  if (summary.proSwitchExpired) view.notices.push("Your switch to yearly didn't go through: the bank's confirmation wasn't finished. Nothing was charged, and Pro stays monthly.")
  if (pro.onHold) view.notices.push('Your Pro credits are paused while a card dispute on a Pro payment is open.')

  if (summary.proActionNeeded) {
    view.pinned = { key: 'confirm', title: 'Confirm your card', sub: 'Your bank wants you to confirm the last Pro payment.', button: 'Confirm' }
    // where payments leave the app, the open receipt's own page takes the bank's confirmation
    if (summary.inApp === false) {
      const open = (invoices || []).find(i => i.status === 'open' && i.url)
      if (open) view.pinned.href = open.url
    }
  } else if (pro.pastDue) {
    view.pinned = { key: 'past-due', title: 'Update your card', sub: 'Your Pro credits are paused. Add a card and we try the payment again at once.', button: 'Update card' }
  }

  if (pro.active && !pro.pastDue && !ending) view.rows.push(switchRow(summary, preview))

  const card = summary.proCard
  view.rows.push(card?.last4
    ? { key: 'card', title: `${brandName(card.brand)} ending ${card.last4}`, sub: card.expMonth ? `Expires ${twoDigits(card.expMonth)}/${twoDigits(card.expYear)}` : '', button: 'Change card', job: null, confirm: null, disabled: false }
    : { key: 'card', title: 'Card', sub: 'Add the card your next Pro payment uses.', button: 'Add a card', job: null, confirm: null, disabled: false })

  view.rows.push(receiptsRow(invoices))

  if (ending) {
    view.rows.push({ key: 'renewal', title: 'Keep Pro', sub: `Pro renews on ${longDate(pro.endsOn)} again, ${pro.interval === 'year' ? '$50 a year' : '$5 a month'} plus tax.`, button: 'Keep Pro', job: 'keep', confirm: null, disabled: false })
  } else {
    const until = longDate(pro.renewsOn || pro.endsOn)
    const dropped = summary.proPending ? ' Your switch to monthly is dropped.' : ''
    view.rows.push({
      key: 'renewal', title: 'Stop renewing', sub: until ? `Pro stays on until ${until}.` : 'Pro stays on until the end of what you paid for.', button: 'Stop renewing', job: 'stop', disabled: false,
      confirm: { text: `Stop renewing? Pro stays on until ${until || 'the end of what you paid for'}, then ends. Nothing more is charged.${dropped}`, yes: 'Stop renewing', no: 'Keep Pro' },
    })
  }

  // the billing page cannot stop or switch a subscription while a schedule is attached (lane B)
  if (summary.proPending) view.portal.note = 'While monthly is waiting, the billing page can change your card and show receipts, but not stop or switch Pro.'
  return view
}

const FALLBACK = 'That did not work. Nothing was changed. Try again in a moment.'
const sentence = text => {
  const t = String(text || '').trim()
  return t && !/[.!?]$/.test(t) ? `${t}.` : t
}

/**
 * A Manage action's answer (or the server's refusal: { error, reason }) as the sheet event.
 * summaryAfter: meter.summary read after the action.
 */
export function manageOutcome(job, result, summaryAfter) {
  if (!result || result.error) return { type: 'manage-error', message: result?.reason || FALLBACK }
  const pro = summaryAfter?.proState
  switch (result.status) {
    case 'switched':
      return { type: 'manage-done', kind: 'switch', detail: { interval: result.interval || 'year', nextDate: pro?.renewsOn || null } }
    case 'needs-action':
      return { type: 'manage-bank' }
    case 'declined':
      return { type: 'manage-error', message: `${sentence(result.message) || 'Your card was declined.'} Nothing was charged, and Pro stays monthly.` }
    case 'scheduled':
      return { type: 'manage-notice', text: `Pro switches to monthly on ${longDate(result.from || summaryAfter?.proPending?.from)}.` }
    case 'kept':
      return { type: 'manage-notice', text: 'You stay on yearly.' }
    case 'ending':
      return { type: 'manage-notice', text: `Pro stays on until ${longDate(result.until || pro?.endsOn)}, then ends.` }
    case 'renewing':
      return { type: 'manage-notice', text: `Pro renews again on ${longDate(pro?.renewsOn)}.` }
    default:
      return { type: 'manage-error', message: FALLBACK }
  }
}

/** Which Welcome a payment the bank confirmed gets: a past-due card payment, or the switch to yearly. */
export const bankKind = summary => (summary?.proState?.pastDue ? 'card' : 'switch')

const BANK_TAIL = 'Nothing was charged. Try again, or use another card.'

/**
 * The bank step (design §3.2: pro.actionSecret, then handleNextAction): the recorded payment's
 * secret, the bank's own confirmation window, then the server is asked until it sees the payment.
 * askSecret() → { clientSecret } | { status:'done' } (pro.actionSecret); confirmWithBank(secret) →
 * { paymentIntent } | { error }. → { outcome: 'done' | 'already' | 'error' | 'slow', message? }
 */
export async function runBankStep({ askSecret, confirmWithBank, wait, tries = 5 }) {
  let first
  try {
    first = await askSecret()
  } catch (err) {
    return { outcome: 'error', message: err?.reason || FALLBACK }
  }
  if (!first?.clientSecret) return { outcome: 'already' }
  let answer
  try {
    answer = await confirmWithBank(first.clientSecret)
  } catch (err) {
    return { outcome: 'error', message: `${sentence(err?.message) || 'Your bank could not confirm this payment.'} ${BANK_TAIL}` }
  }
  if (answer?.error) return { outcome: 'error', message: `${sentence(answer.error.message) || 'Your bank could not confirm this payment.'} ${BANK_TAIL}` }
  for (let i = 0; i < tries; i += 1) {
    if (i > 0) await wait(1000) // eslint-disable-line no-await-in-loop
    let again
    try {
      again = await askSecret() // eslint-disable-line no-await-in-loop
    } catch (err) {
      again = null
    }
    if (again && !again.clientSecret) return { outcome: 'done' }
  }
  return { outcome: 'slow' }
}
