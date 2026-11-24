#!/usr/bin/env node
// The figures the app's meter and catalogues give Slatebox Pro and Slatebox Business, as one JSON
// document: the one source the marketing site and the docs state and test against.
//
//   node scripts/pro-figures.mjs            print the figures
//   node scripts/pro-figures.mjs --write    write them to web/app/imports/api/pro/pro-figures.json
//   ... --settings <file>                   read Slatebox Cloud's settings for businessCheckout
//
// business.businessCheckout says whether Slatebox Business is bought in the app: true only when the
// settings given name both Business prices (payments.business.monthly / .yearly). Without
// --settings it is false, which is what the committed file says until the owner has made the
// prices in Stripe and the lead regenerates with Cloud's settings. billingBuilt is the older name
// the site's and docs' guards read; it always equals businessCheckout.
//
// The site (data/pro-figures.json) and the docs (scripts/pro-figures.json) keep a copy of that file.
// Their pricing tests compare their pages with their copy, and their copy with figures() here when
// a checkout of the app is beside them (APP_DIR). scripts/pro-figures.test.mjs keeps the app's file
// equal to figures().
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DEFAULT_METERING, proCreditsInWords } from '../web/app/server/metering/policy.mjs'
import { PRO_PRICES } from '../web/app/imports/api/pro/catalog.mjs'
import { BUSINESS, BUSINESS_PRICES } from '../web/app/imports/api/business/catalog.mjs'
import { businessOnSale } from '../web/app/server/business-billing.mjs'

export const FIGURES_FILE = join(dirname(fileURLToPath(import.meta.url)), '../web/app/imports/api/pro/pro-figures.json')

/** Slatebox Pro and Business in the figures people read: prices in cents, credits in plain amounts. */
export function figures(free = DEFAULT_METERING.free, { settings = null } = {}) {
  const checkout = Boolean(settings) && businessOnSale(settings)
  const words = proCreditsInWords(free)
  const price = interval => PRO_PRICES.find(p => p.interval === interval).unitAmount
  const seat = interval => BUSINESS_PRICES.find(p => p.interval === interval).unitAmountPerSeat
  return {
    pro: {
      monthCents: price('month'),
      yearCents: price('year'),
      taxExclusive: true,
      credits: {
        // what full use may cost Slatebox a month, in dollars (policy.mjs sizeCredits)
        costDollars: words.costDollars,
        // separate allowances: each is its own amount, never "in any mix"
        draftsPerMonth: words.draftsPerMonth,
        draftsPerDay: words.draftsPerDay,
        voiceHours: words.voiceHours,
        videoHours: words.videoHours,
        voiceMinutes: free.voiceMinutesPerMonth,
        videoMinutes: free.videoMinutesPerMonth,
        sentence: words.sentence,
      },
    },
    business: {
      monthCentsPerSeat: seat('month'),
      yearCentsPerSeat: seat('year'),
      businessCheckout: checkout,
      billingBuilt: checkout,
      contactLabel: BUSINESS.contactLabel,
      contactUrl: BUSINESS.contactUrl,
    },
  }
}

export const figuresJson = (options = {}) => JSON.stringify(figures(DEFAULT_METERING.free, options), null, 2) + '\n'

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const at = process.argv.indexOf('--settings')
  const settings = at > 0 && process.argv[at + 1] ? JSON.parse(readFileSync(process.argv[at + 1], 'utf8')) : null
  if (process.argv.includes('--write')) writeFileSync(FIGURES_FILE, figuresJson({ settings }))
  else process.stdout.write(figuresJson({ settings }))
}
