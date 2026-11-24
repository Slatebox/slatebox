// req({ binding }): what a resolved binding (resolve.mjs) changes in a request's options. A call
// site that passes no binding is untouched (the same object comes back). With one:
//   - a surface turned off answers with the administrator's message and sends nothing;
//   - the request feature defaults to the binding's surface;
//   - a built-in primary names the provider and model, a built-in second entry the fallback,
//     unless the call site set its own (a call site that passes fallback: undefined keeps none);
//   - timeout, answer size and infrastructure retries apply when a published binding set them
//     (the settings-file and code values are what req() already reads).
// The chain walk by failure class over chosen connections arrives with editable bindings (S4).
// Pure.

const fromBinding = (binding, key) => String(binding.provenance?.[`params.${key}`] || '').startsWith('db:')

/** → { options } to send, or { refusal } (a surface turned off) to return without sending. */
export function requestOptionsFromBinding(options) {
  const binding = options?.binding
  if (!binding) return { options }
  const { binding: _binding, ...rest } = options
  if (binding.enabled === false) {
    return {
      refusal: {
        abort: true, abortMessage: binding.disabledMessage || 'This feature is turned off by your administrator.', fallbackBlocked: true, disabled: true,
        surface: binding.surface,
      },
    }
  }
  const out = { ...rest, feature: rest.feature ?? binding.surface, surface: binding.surface, bindingVersion: binding.bindingVersion ?? null }
  const [primary, second] = binding.chain || []
  if (primary?.connection === 'builtin' && rest.provider === undefined && rest.engine === undefined) {
    out.provider = primary.provider
    out.engine = primary.model
  }
  if (!('fallback' in rest) && second?.connection === 'builtin') out.fallback = { provider: second.provider, engine: second.model }
  if (rest.timeoutMs === undefined && fromBinding(binding, 'timeoutMs')) out.timeoutMs = binding.params.timeoutMs
  if (rest.maxTokens === undefined && fromBinding(binding, 'maxTokens')) out.maxTokens = binding.params.maxTokens
  if (rest.infraRetries === undefined && fromBinding(binding, 'infraRetries')) out.infraRetries = binding.params.infraRetries
  return { options: out }
}
