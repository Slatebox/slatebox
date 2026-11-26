// Own AI and call keys (a person's or team's own AI connections, and their call key) work on every
// Slatebox server (owner, 2026-11-26): on Slatebox Cloud (app.slatebox.com, test.slatebox.com)
// they are optional, and a request served by one spends no Slatebox credits and needs no Pro; on a
// self-hosted Slatebox they, or the keys its administrator adds, turn agent features on. An
// administrator's off switches (a part of Slatebox, all AI, or own AI for everyone) win on both.
//
// What still differs is which server this is, never the person: one signal, public.env, the same
// one the AI settings ("hosted") and the instance description read. Only 'selfhost' is
// self-hosted; every other env (prod, test, dev, a missing or misspelled one) is Cloud, so a
// settings mistake never opens what Cloud keeps shut: there an own connection must be a public
// https address (endpoint-policy.mjs), and private endpoints (SLATEBOX_AI_PRIVATE_ENDPOINTS) stay
// a self-hosted operator's choice.
//
// Shared by the server and the browser, so both sides read the same rule.

/** Whether this server is a self-hosted Slatebox (public.env 'selfhost'). */
export const selfHosted = (settings) => settings?.public?.env === 'selfhost'
