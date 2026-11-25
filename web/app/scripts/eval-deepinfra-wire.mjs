// What the live DeepInfra evaluations (scripts/eval-deepinfra-*.mjs, run by hand with a key in the
// environment) send to: DeepInfra's chat endpoint, its bearer header, and the model each evaluation
// tries (env DEEPINFRA_MODEL overrides). The app itself takes its providers, models and keys from
// Admin → AI control; these developer tools talk to DeepInfra directly.
export const DEEPINFRA_ENDPOINT = 'https://api.deepinfra.com/v1/openai/chat/completions'
export const deepinfraHeaders = (apiKey) => ({ 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` })
const MODELS = {
  generation: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
  welcome: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
  presentation: 'google/gemini-3.5-flash',
  layout: 'deepseek-ai/DeepSeek-V3',
}
/** { provider, engine, feature } for one evaluation, the model from DEEPINFRA_MODEL when set. */
export const evalFeature = (feature) => ({ provider: 'deepinfra', engine: process.env.DEEPINFRA_MODEL || MODELS[feature], feature })
