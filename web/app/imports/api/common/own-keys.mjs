// Own AI and call keys (and a person's or team's own AI connections) are a self-hosted feature.
// On Slatebox Cloud (app.slatebox.com, test.slatebox.com) AI and calls come with Slatebox Pro
// credits and top-ups, so nobody brings their own key there. The rule is about which server this
// is, never about the person: one signal, public.env, the same one the AI settings ("hosted")
// and the instance description already read. Only 'selfhost' allows own keys; every other env
// (prod, test, dev, a missing or misspelled one) is Cloud, so a settings mistake never opens them.
//
// Shared by the server (meter, keys.*, ai.*, exec and the API) and the browser (Credits, the AI
// tab, team settings, the pay sheet), so both sides read the same rule.

/** Whether this server is a self-hosted Slatebox (public.env 'selfhost'). */
export const selfHosted = (settings) => settings?.public?.env === 'selfhost'

/** Whether people and teams may bring their own AI and call keys on this server. */
export const ownKeysAllowed = (settings) => selfHosted(settings)

/** The sentence a Cloud server answers an own-key write with. */
export const OWN_KEYS_CLOUD = 'Own AI and call keys are for self-hosted Slatebox. On Slatebox Cloud, AI and calls come with Slatebox Pro credits and top-ups.'
