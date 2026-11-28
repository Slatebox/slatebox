// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The Slack events route starts before the recipe runtime does, and runs without it when recipes are
// off. The runtime sets the Slack vendor's ingest here once it starts (enterprise/server/recipes/
// meteor.js); until then, and whenever recipes are off, the route hands recipe events to no one.
let current = null

/** Set (or clear, with null) the ingest the Slack events route hands message and reaction events to. */
export function setSlackRecipeIngest(ingest) {
  current = ingest && typeof ingest.handle === 'function' && typeof ingest.handles === 'function' ? ingest : null
}

/** The ingest, or null. */
export const slackRecipeIngest = () => current
