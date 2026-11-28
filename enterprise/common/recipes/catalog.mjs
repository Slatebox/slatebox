// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The built-in recipes' manifests, for the catalog the UI shows (manifests only, so this stays
// browser-safe). Each recipe adds one line here and one in enterprise/server/recipes/index.mjs
// (RECIPE_MODULES), which carries its run.
export const CATALOG = Object.freeze([
])

export const manifestFor = (id) => CATALOG.find((m) => m.id === id) || null
