// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The wave 1 recipes for Slack, Google and any system (recipes catalog, part B): the modules the
// runtime registers (enterprise/server/recipes/index.mjs adds them to its recipes list in one line).
import decisionLog from './slack-decision-log/index.mjs'
import timeline from './slack-timeline/index.mjs'
import concepts from './slack-concepts/index.mjs'
import digest from './slack-digest/index.mjs'
import sheetBoard from './google-sheet-board/index.mjs'
import designDoc from './google-design-doc/index.mjs'
import webhookRender from './webhook-render/index.mjs'
import projectIndex from './project-index/index.mjs'

export const SLACK_GOOGLE_RECIPES = Object.freeze([decisionLog, timeline, concepts, digest, sheetBoard, designDoc, webhookRender, projectIndex])
