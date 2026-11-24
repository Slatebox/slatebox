// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What connectors.forSlate publishes to every screen on a slate: its invited agents
// (enterprise/server/meteor.js). Their suggestions are the app's own (agentSuggestions.forSlate).
import { Mongo } from 'meteor/mongo'

export const McpConnections = new Mongo.Collection('mcpConnections')
