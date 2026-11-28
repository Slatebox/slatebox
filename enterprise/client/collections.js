// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// What connectors.forSlate publishes to every screen on a slate: its invited agents
// (enterprise/server/meteor.js). Their suggestions are the app's own (agentSuggestions.forSlate).
import { Mongo } from 'meteor/mongo'

export const McpConnections = new Mongo.Collection('mcpConnections')

// Recipes (enterprise/server/recipes/meteor.js): recipes.forProject(projectId) publishes a project's
// recipe instances; recipes.runsFor(instanceId, limit) its latest runs, with their log lines.
export const RecipeInstances = new Mongo.Collection('recipeInstances')
export const RecipeRuns = new Mongo.Collection('recipeRuns')
