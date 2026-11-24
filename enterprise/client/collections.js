// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What connectors.forSlate publishes to every screen on a slate: its invited agents and their
// suggestions (enterprise/server/meteor.js).
import { Mongo } from 'meteor/mongo'

export const McpConnections = new Mongo.Collection('mcpConnections')
export const AgentSuggestions = new Mongo.Collection('agentSuggestions')
