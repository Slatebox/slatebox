// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The same recipes' manifests only (browser-safe: no run code), for the catalog
// (enterprise/common/recipes/catalog.mjs adds them in one line) and the recipe UI.
import { manifest as decisionLog } from './slack-decision-log/manifest.mjs'
import { manifest as timeline } from './slack-timeline/manifest.mjs'
import { manifest as concepts } from './slack-concepts/manifest.mjs'
import { manifest as digest } from './slack-digest/manifest.mjs'
import { manifest as sheetBoard } from './google-sheet-board/manifest.mjs'
import { manifest as designDoc } from './google-design-doc/manifest.mjs'
import { manifest as webhookRender } from './webhook-render/manifest.mjs'
import { manifest as projectIndex } from './project-index/manifest.mjs'

export const SLACK_GOOGLE_MANIFESTS = Object.freeze([decisionLog, timeline, concepts, digest, sheetBoard, designDoc, webhookRender, projectIndex])
