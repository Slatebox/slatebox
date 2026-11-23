// Who pays for an AI request or a call, and what each person has left.
// Pure: every input is passed in, nothing is read or written here.
import { CALL_PRICES, ESTIMATES } from './prices.mjs'
import { BILLING_CONTACT_URL } from '../../imports/api/common/contact.mjs'

// Slatebox Cloud's switch to Slatebox Pro (settings.free.proRequiredFrom): 'now' (Cloud, from
// 2026-11-22), 'never' (the default, and every self-hosted meter: self-host has no Pro) or a
// moment in ms for a server that wants a date.
export const PRO_SWITCH = Object.freeze({ now: 'now', never: 'never' })

// Pro credits (the included amount) are sized by one number, what full use may cost Slatebox in
// provider fees per person a month, shared out as below. AI is a dollar ceiling (30 drafts a day
// within it); calls are participant-minutes at the call prices (prices.mjs).
export const CREDIT_SHARES = Object.freeze({ ai: 0.25, voice: 0.375, video: 0.375 })
// Minutes come in whole hours of a four-person call (voice), and half hours (video).
const VOICE_STEP = 60
const VIDEO_STEP = 30
const floorTo = (value, step) => Math.max(0, Math.floor(value / step) * step)

/** The monthly allowances for a provider cost of `creditCostMicrosPerMonth`. Full use stays at or below it. */
export function sizeCredits(creditCostMicrosPerMonth) {
  const total = creditCostMicrosPerMonth
  return {
    creditCostMicrosPerMonth: total,
    aiMicrosPerMonth: Math.floor(total * CREDIT_SHARES.ai),
    voiceMinutesPerMonth: floorTo(total * CREDIT_SHARES.voice / CALL_PRICES.voiceMicros, VOICE_STEP),
    videoMinutesPerMonth: floorTo(total * CREDIT_SHARES.video / CALL_PRICES.videoMicros, VIDEO_STEP),
  }
}

/** What one person's whole monthly amount costs Slatebox if every part of it is used. */
export const fullUseMicros = free => (free.aiMicrosPerMonth || 0)
  + Math.ceil((free.voiceMinutesPerMonth || 0) * CALL_PRICES.voiceMicros)
  + Math.ceil((free.videoMinutesPerMonth || 0) * CALL_PRICES.videoMicros)

/**
 * The part of a calendar month (UTC) that a paid span covers, 0 to 1: Pro credits are counted per
 * calendar month, so the month Pro starts in (and the month it ends in, once it will not renew)
 * gives only its share. Buying monthly Pro on the 30th never brings two whole months of credits.
 * span: { from, until } in ms; until null or missing means it renews.
 */
export function monthShare({ from, until = null } = {}, now) {
  const d = new Date(now)
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
  const a = Math.max(start, Number.isFinite(from) ? from : start)
  const b = Math.min(end, Number.isFinite(until) ? until : end)
  return Math.max(0, Math.min(1, (b - a) / (end - start)))
}

/** The settings with this month's allowances cut to `share` (a person's monthShare); unchanged for 1 or none. */
export function creditsForShare(settings, share) {
  if (typeof share !== 'number' || !(share < 1)) return settings
  const part = Math.max(0, share)
  const { free } = settings
  return {
    ...settings,
    free: {
      ...free,
      aiMicrosPerMonth: Math.floor((free.aiMicrosPerMonth || 0) * part),
      voiceMinutesPerMonth: Math.floor((free.voiceMinutesPerMonth || 0) * part),
      videoMinutesPerMonth: Math.floor((free.videoMinutesPerMonth || 0) * part),
    },
  }
}

export const DEFAULT_METERING = Object.freeze({
  free: Object.freeze({
    aiActionsPerDay: 30,            // shown to people
    // $3.75 of provider cost a month (about $3.62 at full use): $0.94 of AI (and image search),
    // 1,380 voice and 330 video participant-minutes (sizeCredits). Pro at $50 a year still covers
    // full use in the worst likely case: an international card with currency conversion, and card,
    // billing and tax fees on a total with 27% tax added (scripts/stripe-catalog.test.mjs).
    ...sizeCredits(3_750_000),
    perPersonMicrosPerDay: 500_000, // $0.50, all included spend except a call already running
    // A presentation plan for a guest on their own slate, or an account whose email is not
    // confirmed yet: per person, and per network address (many guest accounts, one machine).
    guestPresentationsPerDay: 5,
    guestPresentationsPerAddressPerDay: 20,
    // From this moment the amounts above come with Slatebox Pro, and a signed-in person without
    // Pro pays from a balance (or, self-hosted only, their own key) (PRO_SWITCH).
    proRequiredFrom: PRO_SWITCH.never,
  }),
  budget: Object.freeze({
    monthlyMicros: 1_000_000_000,   // P = $1,000
    alertAt: 50, videoToVoiceAt: 70, smallerAiAt: 90, pauseCallsAt: 100, pauseAiAt: 110,
    reducedAiActionsPerDay: 10,
    dailyCeilingDivisor: 20,        // $50 a day
    spikeFactor: 2,
    hold: null,                     // null | 'video-to-voice' | 'smaller-ai' | 'pause-calls' | 'pause-ai'
  }),
  marginPercent: 5,
  // cardFee: 'included' (processing folded into the price) or 'absorb' (imports/api/billing/top-up.mjs)
  topUp: Object.freeze({ minCents: 1000, firstMaxCents: 2500, maxBalanceCents: 50000, holdHours: 24, cardFee: 'included' }),
  alertEmail: null,
})

export const HOLDS = Object.freeze({ 'video-to-voice': 70, 'smaller-ai': 90, 'pause-calls': 100, 'pause-ai': 110 })

// Slatebox Cloud's words: AI and calls come with Slatebox Pro credits, a balance pays after them,
// and nobody brings their own key (own keys are for self-hosted Slatebox: own-keys.mjs). A
// self-hosted meter (settings.ownKeys) says the same with its own keys in it (OWN_KEY_COPY).
export const COPY = Object.freeze({
  // Slatebox's own AI comes with Pro once Pro is needed, so the guest copy promises nothing about price
  guestAI: 'Sign in to use AI.',
  guestCall: 'Sign in to start a call. Anyone can join a call that is already running.',
  unverified: 'Confirm your email address to use the free amount each month. Your balance still works.',
  aiToday: "You have used today's free AI. Top up in your profile.",
  aiMonth: "You have used this month's free AI. Top up in your profile.",
  aiPaused: 'Free AI is paused until the 1st. Your balance still works.',
  callsToday: "You have used today's free amount for starting calls. Top up in your profile.",
  callsMonth: "You have used this month's free calls. Top up in your profile.",
  callsPaused: 'Free calls are paused until the 1st. Calls paid from your balance still work.',
  videoToVoice: 'Your free video for this month is used up, so this call is voice. Top up for video.',
  frozen: `Your balance is on hold. Write to us at ${BILLING_CONTACT_URL}.`,
  freeStopped: `Free use is off for this account. Your balance still works. Write to us at ${BILLING_CONTACT_URL}.`,
  balanceLow: 'Your balance is too low for this request. Top up in your profile.',
  presentationsToday: "You have used today's free presentation plans. Sign in with a confirmed email for more, or try again tomorrow.",
  stagePaused: 'Free AI and free calls are paused until the 1st. Your balance still works.',
  // Slatebox Pro (Cloud, once settings.free.proRequiredFrom has passed)
  getPro: 'AI on Slatebox comes with Slatebox Pro, $5 a month, or a balance. Get Pro or top up in your profile.',
  getProCalls: "Starting a call comes with Slatebox Pro, $5 a month, or a balance. Anyone can join a call that's already running.",
  getProImages: 'Image search and image generation come with Slatebox Pro or a balance. Get Pro or top up in your profile.',
  proPastDue: "Your Pro payment didn't go through, so your credits are paused. Update your card in your profile. Your balance still works.",
  proAiToday: "You have used today's Pro credits for AI. Top up in your profile.",
  proAiMonth: "You have used this month's Pro credits for AI. Top up in your profile.",
  proCallsToday: "You have used today's Pro credits for starting calls. Top up in your profile.",
  proCallsMonth: "You have used this month's Pro credits for calls. Top up in your profile.",
  proStopped: `Included AI and calls are off for this account. Your balance still works. Write to us at ${BILLING_CONTACT_URL}.`,
  balanceTooLow: 'Your balance is too low for this request.',
  balanceVoiceOnly: 'Your balance covers voice but not video, so this call is voice. Top up for video.',
})

// A self-hosted meter's words where they differ: there people may bring their own AI and call
// keys (settings.ownKeys), which are free and come first.
export const OWN_KEY_COPY = Object.freeze({
  unverified: 'Confirm your email address to use the free amount each month. Your own key still works.',
  aiToday: "You have used today's free AI. Add your own key or top up in your profile.",
  aiMonth: "You have used this month's free AI. Add your own key or top up in your profile.",
  aiPaused: 'Free AI is paused until the 1st. Your own key and your balance still work.',
  callsToday: "You have used today's free amount for starting calls. Add a Daily key or top up in your profile.",
  callsMonth: "You have used this month's free calls. Add a Daily key or top up in your profile.",
  callsPaused: 'Free calls are paused until the 1st. Calls on your own Daily key or your balance still work.',
  videoToVoice: 'Your free video for this month is used up, so this call is voice. Add a Daily key or top up for video.',
  freeStopped: `Free use is off for this account. Your own key and your balance still work. Write to us at ${BILLING_CONTACT_URL}.`,
  stagePaused: 'Free AI and free calls are paused until the 1st. Your own keys and your balance still work.',
  getPro: 'AI on Slatebox\'s own models comes with Slatebox Pro, $5 a month. Get Pro in your profile, or connect your own AI, which is free.',
  getProCalls: "Starting a call comes with Slatebox Pro, $5 a month, or add your own Daily key for free. Anyone can join a call that's already running.",
  proPastDue: "Your Pro payment didn't go through, so your credits are paused. Update your card in your profile. Your own keys and your balance still work.",
  proAiToday: "You have used today's Pro credits for AI. Add your own AI or top up in your profile.",
  proAiMonth: "You have used this month's Pro credits for AI. Add your own AI or top up in your profile.",
  proCallsToday: "You have used today's Pro credits for starting calls. Add a Daily key or top up in your profile.",
  proCallsMonth: "You have used this month's Pro credits for calls. Add a Daily key or top up in your profile.",
  proStopped: `Included AI and calls are off for this account. Your own key and your balance still work. Write to us at ${BILLING_CONTACT_URL}.`,
})
const WITH_OWN_KEYS = Object.freeze({ ...COPY, ...OWN_KEY_COPY })
/** The meter's words for this server: Cloud's, or a self-hosted meter's with own keys (settings.ownKeys). */
export const copyFor = settings => (settings?.ownKeys === true ? WITH_OWN_KEYS : COPY)

// Whether included AI and calls need Slatebox Pro at this moment (settings.free.proRequiredFrom).
// Anything but 'now' or a moment that has passed is "never": a mistyped stored value never takes
// the included amount away (deploy settings are checked at start, resolveMetering).
export function proNeeded(settings, now = Date.now()) {
  const from = settings?.free?.proRequiredFrom
  if (from === PRO_SWITCH.now) return true
  return typeof from === 'number' && Number.isFinite(from) && now >= from
}

/** A switch setting as stored: 'now', 'never' (also for null or nothing), a moment in ms, or an
 *  ISO day ('2026-11-22', 00:00 UTC). Throws for anything else. */
export function proSwitchValue(value) {
  if (value === undefined || value === null || value === PRO_SWITCH.never) return PRO_SWITCH.never
  if (value === PRO_SWITCH.now) return PRO_SWITCH.now
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const ms = Date.parse(`${value}T00:00:00Z`)
    if (Number.isFinite(ms) && new Date(ms).toISOString().startsWith(value)) return ms
  }
  throw new Error(`settings metering proRequiredFrom is "now", "never" or a date (YYYY-MM-DD), not ${JSON.stringify(value)}.`)
}

function creditCost(value, where) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1_000_000_000) {
    throw new Error(`settings metering ${where}creditCostMicrosPerMonth is the monthly provider cost of Pro credits in micro-dollars (3750000 is $3.75).`)
  }
  return value
}

/**
 * The meter's settings: the defaults, then the deploy settings (Meteor.settings.metering:
 * proRequiredFrom and creditCostMicrosPerMonth, e.g. 'now' on Cloud), then what an administrator
 * stored (SystemSettings 'metering', the admin page). The credit size resizes every allowance
 * (sizeCredits) unless that allowance is itself set. Throws for a wrong deploy value.
 */
export function resolveMetering({ stored = {}, deploy = {}, ownKeys = false } = {}) {
  const deployFree = {}
  if (deploy?.proRequiredFrom !== undefined) deployFree.proRequiredFrom = proSwitchValue(deploy.proRequiredFrom)
  if (deploy?.creditCostMicrosPerMonth !== undefined) deployFree.creditCostMicrosPerMonth = creditCost(deploy.creditCostMicrosPerMonth, '')
  const storedFree = { ...(stored?.free || {}) }
  const cost = storedFree.creditCostMicrosPerMonth ?? deployFree.creditCostMicrosPerMonth ?? DEFAULT_METERING.free.creditCostMicrosPerMonth
  const free = { ...DEFAULT_METERING.free, ...sizeCredits(creditCost(cost, 'free.')), ...deployFree, ...storedFree }
  free.proRequiredFrom = free.proRequiredFrom === null || free.proRequiredFrom === undefined ? PRO_SWITCH.never : free.proRequiredFrom
  return {
    ...DEFAULT_METERING, ...stored,
    free,
    budget: { ...DEFAULT_METERING.budget, ...stored?.budget },
    topUp: { ...DEFAULT_METERING.topUp, ...stored?.topUp },
    // whether own AI and call keys pay here: a self-hosted server only (own-keys.mjs), never stored
    ownKeys: ownKeys === true,
  }
}

// Cloud settings turn the meter on. A self-hosted server has no meter unless its operator sets one.
// It fails closed: only public.env 'selfhost' or 'dev' may leave metering.enabled out (and run
// with no meter). Production refuses to start without the meter, and any other env, including a
// missing or misspelled one, must say true or false, so a settings mistake never means "no limits".
const UNMETERED_ENVS = new Set(['selfhost', 'dev'])
export function meteringEnabled(settings = {}) {
  const env = settings.public?.env
  const enabled = settings.metering?.enabled
  if (env === 'prod' && enabled !== true) {
    throw new Error('Slatebox Cloud does not start without the meter: set metering.enabled to true in the server settings.')
  }
  if (!UNMETERED_ENVS.has(env) && typeof enabled !== 'boolean') {
    throw new Error(`Set metering.enabled to true or false in the server settings (public.env is ${env === undefined ? 'missing' : JSON.stringify(env)}; only "selfhost" and "dev" may leave it out).`)
  }
  return enabled === true
}

// What an own key pays for. Image search and image generation always use Slatebox's own
// Google and Stability keys, so an own AI key never covers them.
const OWN_KEY_FAMILY = Object.freeze({ ai: 'ai', voice: 'daily', video: 'daily' })
export const ownKeyCovers = kind => Boolean(OWN_KEY_FAMILY[kind])

const pad = n => String(n).padStart(2, '0')
export function monthKey(now) {
  const d = new Date(now)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}
export function dayKey(now) {
  const d = new Date(now)
  return `${monthKey(now)}-${pad(d.getUTCDate())}`
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export function nextMonthStart(now) {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}
export function resetsOn(now) {
  return '1 ' + MONTHS[new Date(nextMonthStart(now)).getUTCMonth()]
}

// The stage of the global free budget: the highest of this month's share of P, the admin
// hold, and the daily rule (a day that reaches P / 20 runs at the 100 percent rules).
export function budgetLevel({ monthFreeMicros = 0, todayFreeMicros = 0, budget }) {
  const percent = budget.monthlyMicros > 0 ? (monthFreeMicros / budget.monthlyMicros) * 100 : 1000
  const steps = [budget.pauseAiAt, budget.pauseCallsAt, budget.smallerAiAt, budget.videoToVoiceAt, budget.alertAt]
  let level = steps.find(step => percent >= step) ?? 0
  level = Math.max(level, HOLDS[budget.hold] ?? 0)
  const dailyCeilingHit = todayFreeMicros >= budget.monthlyMicros / budget.dailyCeilingDivisor
  if (dailyCeilingHit) level = Math.max(level, budget.pauseCallsAt)
  return { level, percent, dailyCeilingHit }
}

export function aiActionsPerDay(settings, level) {
  return level >= settings.budget.smallerAiAt ? settings.budget.reducedAiActionsPerDay : settings.free.aiActionsPerDay
}

export function videoAllowance(settings) {
  return settings.free.videoMinutesPerMonth
}

function callMicros(kind, minutes) {
  return Math.ceil(minutes * (kind === 'video' ? CALL_PRICES.videoMicros : CALL_PRICES.voiceMicros))
}

function refuse(code, message) { return { ok: false, code, message } }
const isCall = kind => kind === 'voice' || kind === 'video'

// Free route for one kind, or the reason it is not available.
function freeCheck({ kind, person, usage, level, settings, estimateMicros, minutes, running, countsAsDraft }) {
  const { free, budget } = settings
  if (!person.emailVerified) return 'unverified'
  if (person.freeStopped) return 'free-stopped'
  if (isCall(kind)) {
    if (level >= budget.pauseCallsAt) return 'calls-paused'
    if (kind === 'video' && level >= budget.videoToVoiceAt) return 'video-stage'
    const allowance = kind === 'video' ? videoAllowance(settings) : free.voiceMinutesPerMonth
    const used = kind === 'video' ? usage.videoMinutesMonth : usage.voiceMinutesMonth
    if ((used || 0) + minutes > allowance) return 'calls-month'
    // the daily ceiling bounds starting a call, never a call already running
    if (!running && (usage.freeMicrosToday || 0) + callMicros(kind, minutes) > free.perPersonMicrosPerDay) return 'calls-today'
    return null
  }
  if (level >= budget.pauseAiAt) return 'ai-paused'
  if (countsAsDraft !== false && kind === 'ai' && (usage.aiActionsToday || 0) >= aiActionsPerDay(settings, level)) return 'ai-today'
  if ((usage.aiMicrosMonth || 0) + estimateMicros > free.aiMicrosPerMonth) return 'ai-month'
  if ((usage.freeMicrosToday || 0) + estimateMicros > free.perPersonMicrosPerDay) return 'ai-today'
  return null
}

function balanceRoute({ kind, person, teamId, wallets, estimateMicros, minutes, settings }) {
  const need = isCall(kind) ? callMicros(kind, minutes) : estimateMicros
  const needWithMargin = Math.ceil(need * (100 + settings.marginPercent) / 100)
  let frozen = false
  for (const [type, id, wallet] of [['user', person.id, wallets.personal], ['org', teamId, wallets.team]]) {
    if (!id || !wallet) continue
    if (wallet.frozen) { frozen = true; continue }
    // a balance being refunded pays for nothing new
    if (wallet.refunding) continue
    // money from a top-up younger than the hold may not pay for video (fraud hold)
    const spendable = wallet.balanceMicros - (wallet.heldMicros || 0) - (kind === 'video' ? wallet.recentTopUpMicros || 0 : 0)
    if (spendable >= needWithMargin) return { ok: true, route: 'balance', payer: { type, id }, kind }
  }
  return frozen ? 'frozen' : null
}

const messagesOf = copy => Object.freeze({
  unverified: copy.unverified, 'ai-today': copy.aiToday, 'ai-month': copy.aiMonth, 'ai-paused': copy.aiPaused,
  'calls-today': copy.callsToday, 'calls-month': copy.callsMonth, 'calls-paused': copy.callsPaused, 'video-stage': copy.callsMonth,
  'presentations-today': copy.presentationsToday, frozen: copy.frozen, 'free-stopped': copy.freeStopped, balance: copy.balanceLow,
  pro: copy.getPro, 'pro-calls': copy.getProCalls, 'pro-images': copy.getProImages, 'pro-past-due': copy.proPastDue,
})
// The same refusals in Pro's words, for a person whose included amount is Slatebox Pro.
const proMessagesOf = copy => Object.freeze({
  'ai-today': copy.proAiToday, 'ai-month': copy.proAiMonth, 'calls-today': copy.proCallsToday, 'calls-month': copy.proCallsMonth,
  'video-stage': copy.proCallsMonth, 'free-stopped': copy.proStopped,
})
const MESSAGES = { cloud: messagesOf(COPY), own: messagesOf(WITH_OWN_KEYS) }
const PRO_MESSAGES = { cloud: proMessagesOf(COPY), own: proMessagesOf(WITH_OWN_KEYS) }
const wordsFor = settings => (settings?.ownKeys === true ? 'own' : 'cloud')
// The refusal for a code; `who.pro` (a decision or a person on Pro credits) words it as Pro;
// `settings.ownKeys` (a self-hosted meter) words it with own keys.
export const messageFor = (code, who = null, settings = null) => {
  const words = wordsFor(settings)
  return (who?.pro && PRO_MESSAGES[words][code]) || MESSAGES[words][code] || copyFor(settings).aiToday
}

// What Slatebox Pro is needed for when a person without it asks: which code, by kind.
const IMAGE_KINDS = new Set(['imageSearch', 'imageGeneration'])
function proCode(kind, person) {
  if (person.proPastDue) return 'pro-past-due'
  if (isCall(kind)) return 'pro-calls'
  if (IMAGE_KINDS.has(kind)) return 'pro-images'
  return 'pro'
}

// The AI uses open to a guest (on their own slate) and to an account whose email is not
// confirmed yet, from the free budget: the presentation plan, the core of Present.
const GUEST_FEATURES = new Set(['presentation'])
const guestUse = input => input.kind === 'ai' && GUEST_FEATURES.has(input.feature)

// The guest route: the free budget's limits, with its own daily count of plans.
function guestRoute(input, person) {
  const { settings, usage = {}, estimateMicros = 0 } = input
  const { free, budget } = settings
  const copy = copyFor(settings)
  const { level } = budgetLevel({ ...(input.global || {}), budget })
  if (person.freeStopped) return refuse('free-stopped', copy.freeStopped)
  if (level >= budget.pauseAiAt) return refuse('ai-paused', copy.aiPaused)
  // guestPresentationsPerDay: 0 turns the free presentation plan off for everyone
  if (!(free.guestPresentationsPerDay > 0)) return refuse('presentations-today', copy.presentationsToday)
  if ((usage.aiActionsToday || 0) >= free.guestPresentationsPerDay) return refuse('presentations-today', copy.presentationsToday)
  if ((usage.aiMicrosMonth || 0) + estimateMicros > free.aiMicrosPerMonth) return refuse('ai-month', copy.aiMonth)
  if ((usage.freeMicrosToday || 0) + estimateMicros > free.perPersonMicrosPerDay) return refuse('ai-today', copy.aiToday)
  return {
    ok: true, route: 'free', payer: { type: 'user', id: person.id }, kind: input.kind, level, guest: true,
    draftsPerDay: free.guestPresentationsPerDay, perAddressPerDay: free.guestPresentationsPerAddressPerDay,
  }
}

/**
 * route({ kind: 'ai'|'imageSearch'|'imageGeneration'|'voice'|'video', person, teamId, keys, usage, wallets, global,
 *         estimateMicros, minutes, running, countsAsDraft, feature, settings, now })
 * person: { id, anonymous, emailVerified, freeStopped, included?, pro?, proPastDue?, creditShare? }
 *   included: whether the monthly amount is theirs (Slatebox Pro, or anyone before
 *   settings.free.proRequiredFrom; left out means included). pro: on Slatebox Pro, so the shared
 *   budget's stages do not apply. proPastDue: Pro whose last payment failed. creditShare: the
 *   part of this month Pro covers (monthShare), when less than all of it: the month's allowances
 *   are cut to it, and an ok decision carries it for the hold (meter-core.mjs).
 * → { ok: true, route: 'byok'|'free'|'balance', payer, kind, keyOwner?, fellBackToVoice?, notice?,
 *     guest?, draftsPerDay?, perAddressPerDay?, pro?, creditShare? }  (guest… on the guest route: see guestRoute)
 * → { ok: false, code, message }
 * Order: own key, the included amount (Pro credits), balance. Video that cannot run falls back to voice.
 */
export function route(input) {
  const { kind, person, teamId = null, keys = {}, wallets = {}, now } = input
  // the month Pro starts or ends in gives only its share of the month's credits (monthShare)
  const share = person?.included !== false && typeof person?.creditShare === 'number' && person.creditShare < 1 ? person.creditShare : null
  const settings = creditsForShare(input.settings, share)
  const copy = copyFor(settings)
  const messages = MESSAGES[wordsFor(settings)]
  const usage = input.usage || {}
  const minutes = input.minutes ?? 10
  const estimateMicros = input.estimateMicros ?? 0
  if (person?.anonymous && guestUse(input)) return guestRoute(input, person)
  if (!person || person.anonymous) return refuse('guest', isCall(kind) ? copy.guestCall : copy.guestAI)

  // Own keys pay first, on a self-hosted server only (settings.ownKeys): on Slatebox Cloud a key
  // someone saved before is never used.
  const family = settings.ownKeys === true ? OWN_KEY_FAMILY[kind] : null
  if (family && keys.personal?.[family]) return { ok: true, route: 'byok', payer: { type: 'user', id: person.id }, kind, keyOwner: { type: 'user', id: person.id } }
  if (family && teamId && keys.team?.[family]) return { ok: true, route: 'byok', payer: { type: 'user', id: person.id }, kind, keyOwner: { type: 'org', id: teamId } }

  // Paying people are not paused by the shared budget: Pro credits skip its stages (level 0),
  // and each person's own day and month caps still hold.
  const pro = person.pro === true
  const level = pro ? 0 : budgetLevel({ ...(input.global || {}), budget: settings.budget }).level
  const args = { ...input, usage, minutes, estimateMicros, level, settings, now }

  // Without the included amount (no Pro once Pro is needed): the free presentation plan, then a
  // balance, else what Pro or a balance (or, self-hosted, an own key) would give.
  if (person.included === false) {
    if (guestUse(input)) {
      const plan = guestRoute(input, person)
      if (plan.ok) return plan
    }
    const paid = balanceRoute(args)
    if (paid?.ok) return paid
    if (kind === 'video') {
      const voice = route({ ...input, kind: 'voice' })
      return voice.ok ? { ...voice, fellBackToVoice: true, notice: copy.balanceVoiceOnly } : voice
    }
    if (paid === 'frozen') return refuse('frozen', copy.frozen)
    const code = proCode(kind, person)
    const hasSome = [wallets.personal, wallets.team].some(w => (w?.balanceMicros || 0) > 0)
    return refuse(code, hasSome ? `${messages[code]} ${copy.balanceTooLow}` : messages[code])
  }
  // An unconfirmed email has no free amount, except the presentation plan; its balance still pays.
  if (!person.emailVerified && guestUse(input)) {
    const plan = guestRoute(input, person)
    if (plan.ok) return plan
    const paid = balanceRoute(args)
    return paid?.ok ? paid : plan
  }
  const free = freeCheck(args)
  if (!free) return { ok: true, route: 'free', payer: { type: 'user', id: person.id }, kind, level, ...(pro && { pro: true }), ...(share !== null && { creditShare: share }) }
  const paid = balanceRoute(args)
  if (paid?.ok) return paid

  if (kind === 'video') {
    const voice = route({ ...input, kind: 'voice' })
    if (voice.ok) return { ...voice, fellBackToVoice: true, notice: copy.videoToVoice }
    return voice
  }
  const code = paid === 'frozen' && free !== 'unverified' && free !== 'free-stopped' ? 'frozen' : free
  return refuse(code, messageFor(code, { pro }, settings))
}

const hoursOfFour = minutes => Math.max(0, Math.floor(minutes / 4 / 60 * 2) / 2)
const halves = hours => (hours % 1 ? `${Math.floor(hours) || ''}½` : String(hours))
const hoursWords = hours => `about ${halves(hours)} ${hours === 1 ? 'hour' : 'hours'}`

/**
 * Pro credits in plain words, from the meter's own numbers: the profile, and the same figures the
 * site and the docs state. Drafts a month are counted at a workshop draft's estimate (the most a
 * draft is held for before it runs), so "about" is never more than the month's AI gives.
 */
export function proCreditsInWords(free = DEFAULT_METERING.free) {
  const drafts = Math.floor((free.aiMicrosPerMonth || 0) / ESTIMATES.workshop)
  // a round "about": down to tens, never more than the month's AI gives
  const draftsPerMonth = drafts >= 10 ? Math.floor(drafts / 10) * 10 : drafts
  const voiceHours = hoursOfFour(free.voiceMinutesPerMonth || 0)
  const videoHours = hoursOfFour(free.videoMinutesPerMonth || 0)
  return {
    costDollars: Math.round((free.creditCostMicrosPerMonth ?? fullUseMicros(free)) / 10_000) / 100,
    draftsPerDay: free.aiActionsPerDay,
    draftsPerMonth,
    voiceHours,
    videoHours,
    sentence: `Each month: about ${draftsPerMonth} AI drafts (up to ${free.aiActionsPerDay} a day), ${hoursWords(voiceHours)} of four-person voice calls and ${hoursWords(videoHours)} of four-person video calls.`,
  }
}

// What a refund of this wallet sends back to the card, in cents; anything with no card charge
// to go back to is closed by the refund (wallet-stripe.mjs refundWallet).
export const refundableCents = wallet => Math.floor(Math.max(0, Math.min(wallet?.refundableMicros || 0, wallet?.balanceMicros || 0)) / 10_000)

// What a person sees in Profile → Credits. Plain numbers only.
// included: whether the month's amount is theirs (Pro, or anyone before proRequiredFrom);
// pro: on Slatebox Pro; needsPro: Pro is needed now and they do not have it.
export function allowanceSummary({ person, usage = {}, wallets = {}, global = {}, settings, now, keys = {}, teamId = null }) {
  const pro = person?.pro === true
  const included = person?.included !== false
  // what Pro includes in a whole month, for the words; this month's allowances may be a share of it
  const wholeMonth = settings.free
  settings = creditsForShare(settings, included ? person?.creditShare : null)
  const { level } = pro ? { level: 0 } : budgetLevel({ ...global, budget: settings.budget })
  const perDay = aiActionsPerDay(settings, level)
  const monthUsedUp = (usage.aiMicrosMonth || 0) >= settings.free.aiMicrosPerMonth
  const todayUsedUp = (usage.freeMicrosToday || 0) >= settings.free.perPersonMicrosPerDay
  let stageNote = null
  if (included && !pro) {
    if (level >= settings.budget.pauseAiAt) stageNote = copyFor(settings).stagePaused
    else if (level >= settings.budget.pauseCallsAt) stageNote = copyFor(settings).callsPaused
  }
  // an unconfirmed or stopped account, or one without the included amount, has none to use, so none is shown as left
  const noFree = !included || !person?.emailVerified || person?.freeStopped === true
  const cents = micros => Math.floor((micros || 0) / 10_000)
  return {
    aiLeftToday: noFree || monthUsedUp || todayUsedUp || level >= settings.budget.pauseAiAt ? 0 : Math.max(0, perDay - (usage.aiActionsToday || 0)),
    aiPerDay: perDay,
    aiMonthUsedUp: monthUsedUp,
    voiceHoursLeft: noFree ? 0 : hoursOfFour(settings.free.voiceMinutesPerMonth - (usage.voiceMinutesMonth || 0)),
    videoHoursLeft: noFree ? 0 : hoursOfFour(videoAllowance(settings) - (usage.videoMinutesMonth || 0)),
    resetsOn: resetsOn(now),
    balanceCents: cents(wallets.personal?.balanceMicros),
    ...(teamId && wallets.team && { teamBalanceCents: cents(wallets.team.balanceMicros) }),
    keys: { ai: keys.ai ?? null, daily: keys.daily ?? null },
    stageNote,
    included,
    pro,
    needsPro: proNeeded(settings, now) && !pro,
    proRequiredFrom: settings.free.proRequiredFrom ?? PRO_SWITCH.never,
    credits: proCreditsInWords(wholeMonth),
  }
}
