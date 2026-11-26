// The realtime providers the relay speaks, by wire protocol (ai-control/providers.mjs
// REALTIME_PROTOCOLS). Each adapter is pure: connectInfo, setup, begin, audio, text, ptt, mode,
// played, cancel, toolResult and read (provider message → neutral events).
import * as gemini from './gemini.mjs'
import * as openai from './openai.mjs'

export const ADAPTERS = Object.freeze({ [gemini.PROTOCOL]: gemini, [openai.PROTOCOL]: openai })
export const adapterFor = (protocol) => (Object.hasOwn(ADAPTERS, protocol) ? ADAPTERS[protocol] : null)
