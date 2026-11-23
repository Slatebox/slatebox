// Top-up amounts and the card-fee setting, shared by the server (an allow-list on wallet.createTopUp)
// and the pay sheet (the amount chips). Pure.

// The amounts a person can choose. The server refuses any other (design §3.1), on top of the limits
// in ledger.mjs validateTopUp.
export const TOP_UP_AMOUNTS = Object.freeze([1000, 2500, 5000, 10000])

// topUp.cardFee in the metering settings (owner decision: 'included', the default):
// 'included' — "Top up $10" charges the price that nets $10 after card processing, one line
//              labelled "includes processing" (never a separate surcharge line);
// 'absorb'   — the person pays $10 and Slatebox pays the processing.
export const CARD_FEE_MODES = Object.freeze(['included', 'absorb'])
export const DEFAULT_CARD_FEE = 'included'
export const cardFeeMode = topUp => (CARD_FEE_MODES.includes(topUp?.cardFee) ? topUp.cardFee : DEFAULT_CARD_FEE)
