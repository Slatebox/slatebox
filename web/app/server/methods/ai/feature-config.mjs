// Which provider and model each AI feature uses. The built-in defaults are data
// (server/config/ai-defaults.json); the operator's settings.ai.features override them.
import { aiDefaults } from '../../config/index.cjs'

// Notes in the file (keys starting with _) are not configuration; the rest is frozen.
function asConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.freeze(Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('_')).map(([key, inner]) => [key, asConfig(inner)])))
}

export const DEFAULT_AI_FEATURES = asConfig(aiDefaults)

// A feature the operator points at another provider does not inherit the built-in fallback of a
// different provider: the prompt would otherwise reach a provider the operator did not choose. The
// default fallback stays only when its provider matches; a configured `fallback` always wins.
export function resolveAIFeatureConfig(feature, settings = {}) {
  const defaults = DEFAULT_AI_FEATURES[feature] || {}
  const configured = settings.ai?.features?.[feature] || {}
  const resolved = {
    ...defaults,
    ...configured,
    feature,
  }
  if (!('fallback' in configured) && resolved.fallback && resolved.provider && resolved.fallback.provider !== resolved.provider) {
    delete resolved.fallback
  }
  return resolved
}
