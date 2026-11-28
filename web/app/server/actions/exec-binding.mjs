// Which registry actions become methods of the generated `slatebox` client that exec scripts
// call. An action is a client method if, and only if:
//   1. it has an HTTP mount (a token can call it), and
//   2. its principals include agent, and
//   3. its id is not in NEVER_BOUND.
//
// NEVER_BOUND, and why:
//   apiTokens.*        Tokens are credentials. A script must never mint, list or revoke them,
//                      so token management is unreachable from every script on every surface.
//   exec.run, exec.get A script does not start or read other scripts (no recursion).
//   teamMove.*         Moving a whole team onto this server is the person's own step, run from
//                      `npx slatebox migrate` / `slatebox import` or the API: it needs the archive's
//                      bytes uploaded, which no script can send, so a script gets nothing from it.
//   audit.*            The activity log is the team admin's record of what everyone did, read on
//                      the team page or pulled by a SIEM with an audit:read token. An agent at work
//                      has no use for it, and a script must not carry the whole team's activity
//                      into a model's context.
//   recipes.grant, recipes.revoke, recipes.decideWrite, recipes.admin.*
//                      A standing permission for a recipe to change things outside Slatebox, an
//                      approval of one such change, and the server's recipes switch: a signed-in
//                      person's own decisions in the app, never a script's or an agent's.
//   slates.addPhoto    A photo from the phone app, up to 8 MB: more than a script and its input
//                      (128 KiB) or an MCP call (128 KiB) can carry, so it is the app's and the
//                      API's door only. A script or a model adds a picture it has as a URL instead.
//
// For later packages that add actions: a bound write must declare idempotency 'optional' or
// 'required' (exec derives a key per call so a confirmed or retried script never saves twice),
// and an action's error `details` must carry ids and codes, never human text. Text a person
// wrote goes under a labelled field (details.content, with who wrote it); anything else is a
// channel for injected instructions into the agent reading the error.

export const NEVER_BOUND = Object.freeze([/^apiTokens\./, /^exec\.(run|get)$/, /^teamMove\./, /^slates\.addPhoto$/, /^audit\./, /^recipes\.(grant|revoke|decideWrite|pauseMine|team\.set|admin\.)/])

export const isNeverBound = (id) => NEVER_BOUND.some((rule) => rule.test(id))

export function boundActions(registry) {
  return registry
    .list()
    .filter((action) => action.mounts.http && action.principals.includes('agent') && !isNeverBound(action.id))
}

// The contract every bound action must meet. A failure names the action and stops the
// generator (and so the build), instead of shipping a client method that misbehaves.
export function checkBinding(registry, resolve) {
  for (const action of boundActions(registry)) {
    if (action.kind === 'write' && !['optional', 'required'].includes(action.idempotency))
      throw new Error(
        `Action ${action.id}: a write bound into the exec client must declare idempotency 'optional' or 'required'`
      )
    const output = resolve(action.output)
    const objectShape = (schema) => {
      const s = resolve(schema)
      return s?.type === 'object' && s.properties && typeof s.properties === 'object'
    }
    const ok = objectShape(output) || (Array.isArray(output?.oneOf) && output.oneOf.every(objectShape))
    if (!ok)
      throw new Error(
        `Action ${action.id}: a bound action's output must be an object schema with properties, or a oneOf of them`
      )
  }
  return boundActions(registry)
}
