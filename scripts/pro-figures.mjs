#!/usr/bin/env node
// The figures the app's meter and catalogues give Slatebox Pro and Slatebox Business, as one JSON
// document: the one source the marketing site and the docs state and test against.
//
//   node scripts/pro-figures.mjs            print the figures
//   node scripts/pro-figures.mjs --write    write them to web/app/imports/api/pro/pro-figures.json
//
// The site (data/pro-figures.json) and the docs (scripts/pro-figures.json) keep a copy of that file.
// Their pricing tests compare their pages with their copy, and their copy with figures() here when
// a checkout of the app is beside them (APP_DIR). scripts/pro-figures.test.mjs keeps the app's file
// equal to figures().
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { DEFAULT_METERING, proCreditsInWords } from '../web/app/server/metering/policy.mjs'
import { PRO_PRICES } from '../web/app/imports/api/pro/catalog.mjs'
import { BUSINESS, BUSINESS_PRICES } from '../web/app/imports/api/business/catalog.mjs'

export const FIGURES_FILE = join(dirname(fileURLToPath(import.meta.url)), '../web/app/imports/api/pro/pro-figures.json')

/** Slatebox Pro and Business in the figures people read: prices in cents, credits in plain amounts. */
export function figures(free = DEFAULT_METERING.free) {
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
      billingBuilt: BUSINESS.billingBuilt,
      contactLabel: BUSINESS.contactLabel,
      contactUrl: BUSINESS.contactUrl,
    },
  }
}

export const figuresJson = () => JSON.stringify(figures(), null, 2) + '\n'

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.includes('--write')) writeFileSync(FIGURES_FILE, figuresJson())
  else process.stdout.write(figuresJson())
}
