// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
import { checkRenderInput } from './input.mjs'
import { manifest } from './manifest.mjs'
import run from './run.mjs'

// checkInput: the inbound hook and recipes.run check a payload with it before a run is queued, so a
// sender gets its 400 (with a JSON pointer) or 413 at once.
export default Object.freeze({ manifest, run, checkInput: checkRenderInput })
