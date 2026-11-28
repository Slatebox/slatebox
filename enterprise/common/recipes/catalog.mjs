// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The built-in recipes' manifests, for the catalog the UI shows (manifests only, so this stays
// browser-safe). Each recipe adds one line here and one in enterprise/server/recipes/index.mjs
// (RECIPE_MODULES), which carries its run.
import { manifest as githubArchitecture } from '../../recipes/github-architecture/manifest.mjs'
import { manifest as githubPrImpact } from '../../recipes/github-pr-impact/manifest.mjs'
import { manifest as githubMermaidSync } from '../../recipes/github-mermaid-sync/manifest.mjs'
import { manifest as slackDecisionLog } from '../../recipes/slack-decision-log/manifest.mjs'
import { manifest as slackTimeline } from '../../recipes/slack-timeline/manifest.mjs'
import { manifest as slackConcepts } from '../../recipes/slack-concepts/manifest.mjs'
import { manifest as slackDigest } from '../../recipes/slack-digest/manifest.mjs'
import { manifest as googleSheetBoard } from '../../recipes/google-sheet-board/manifest.mjs'
import { manifest as googleDesignDoc } from '../../recipes/google-design-doc/manifest.mjs'
import { manifest as webhookRender } from '../../recipes/webhook-render/manifest.mjs'
import { manifest as projectIndex } from '../../recipes/project-index/manifest.mjs'
import { manifest as linearRoadmap } from '../../recipes/linear-roadmap/manifest.mjs'
import { manifest as linearCycleBoard } from '../../recipes/linear-cycle-board/manifest.mjs'
import { manifest as linearReleaseMap } from '../../recipes/linear-release-map/manifest.mjs'

export const CATALOG = Object.freeze([
  githubArchitecture, githubPrImpact, githubMermaidSync,
  linearRoadmap, linearCycleBoard, linearReleaseMap,
  slackDecisionLog, slackTimeline, slackConcepts, slackDigest,
  googleSheetBoard, googleDesignDoc,
  webhookRender, projectIndex,
])

export const manifestFor = (id) => CATALOG.find((m) => m.id === id) || null
