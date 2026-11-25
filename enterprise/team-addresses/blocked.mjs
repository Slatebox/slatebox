// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// Names a team address may never take, as data (names.mjs reads them). Matching is done on the
// name with hyphens removed and the look-alike digits folded (0→o 1→l 3→e 4→a 5→s 7→t), so
// "pay-pal", "paypa1" and "p4ypal" are all caught. Administrators add more at runtime
// (teamAddressBlocklist); this file is the reviewed floor.

// Brand impersonation and phishing words, matched anywhere in the name.
export const BRAND_SUBSTRINGS = Object.freeze([
  'paypal', 'icloud', 'google', 'gmail', 'microsoft', 'office365', 'outlook', 'azure', 'amazon',
  'facebook', 'instagram', 'whatsapp', 'netflix', 'wellsfargo', 'bankofamerica', 'citibank', 'coinbase',
  'binance', 'metamask', 'ledger', 'stripe', 'okta', 'github', 'gitlab', 'slack', 'zoom', 'dropbox', 'docusign',
  'cloudflare', 'anthropic', 'openai', 'bank', 'wallet', 'verify', 'securelogin', 'signin',
])

// Short brands that are also parts of ordinary words: matched as the whole name, or as a whole
// hyphen-separated part ("meta", "meta-login"; never "metal", "pineapple", "purchase" or "laws").
export const BRAND_PARTS = Object.freeze(['meta', 'apple', 'aws', 'chase', 'x', 'ibm', 'hsbc', 'usps', 'ups', 'dhl', 'fedex', 'irs', 'hmrc'])

// Offensive words, matched anywhere in the folded name. Kept short and plain on purpose: the
// runtime blocklist takes the rest, with a reason, without a release.
export const OFFENSIVE_SUBSTRINGS = Object.freeze([
  'fuck', 'shit', 'cunt', 'bitch', 'whore', 'slut', 'nigger', 'nigga', 'faggot', 'retard', 'rapist', 'nazi',
  'hitler', 'kike', 'chink', 'wetback', 'tranny', 'pedophil', 'porn', 'pussy', 'asshole',
  'bastard', 'motherf', 'jizz', 'kkk', 'killall', 'genocide',
])

// Whole-name matches only (too short or too common to match inside other words).
// ("spice", "peacock", "document", "crisis" and "torpedo" stay free.)
export const OFFENSIVE_EXACT = Object.freeze(['ass', 'sex', 'xxx', 'fag', 'hoe', 'nsfw', 'spic', 'cock', 'dick', 'cum', 'isis', 'pedo'])
