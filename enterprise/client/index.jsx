// Copyright (c) 2026 Slatebox LLC. Licensed under the Slatebox Enterprise License (enterprise/LICENSE).
// Not MIT: see enterprise/README.md.
//
// The browser half of outside agent connections. Loaded with import() as its own chunk where the
// server says enterprise code is unlocked (web/app/client/enterprise.js). It fills the app's named slots
// (<EnterpriseSlot name="..."/>) through api.fill(name, Component).
// context: { edition, via, features, agentInvite }; the invite UI fills its slots unless the
// server's kill switch took invited agents away (agentInvite false).
import AgentsOnSlate, { InvitedAgentControls } from './AgentsOnSlate'
import IntegrationsPage from './IntegrationsPage'
import { GoogleExport, GoogleImport } from './GoogleIntegration'
import TeamAddressesAdmin from './TeamAddressesAdmin'
import ProjectRecipes, { AddRecipeButton, RecipesTab } from './recipes/ProjectRecipes'
import RecipesAdmin from './recipes/RecipesAdmin'
import TeamRecipes from './recipes/TeamRecipes'
import ProfileRecipes from './recipes/ProfileRecipes'
import CanvasRecipes from './recipes/CanvasRecipes'

export const manifest = Object.freeze({ name: 'slatebox-enterprise', features: ['agents.invite'] })

export function register(api, context) {
  // Admin tools › Team addresses: Slatebox Cloud only (the server refuses everywhere else too).
  if (context?.via === 'cloud') api.fill('admin.teamAddresses', TeamAddressesAdmin)
  // Recipes: agents that keep a project's slates up to date. Each piece shows only where the server
  // says recipes are on (a server admin sees the one switch where they are off).
  api.fill('project.recipesTab', RecipesTab)
  api.fill('project.recipes', ProjectRecipes)
  api.fill('project.addRecipe', AddRecipeButton)
  api.fill('canvas.recipes', CanvasRecipes)
  api.fill('admin.recipes', RecipesAdmin)
  api.fill('team.recipes', TeamRecipes)
  api.fill('profile.recipes', ProfileRecipes)
  if (!context?.agentInvite) return
  // The slate's invited agents: each one chip on the app's roster, "+ Invite agent" and the walkthrough.
  api.fill('canvas.agents', AgentsOnSlate)
  // Inside an invited agent's roster chip: its summary, Ask in chat (Ask Slatebox, replying to it), Sign in again, Remove.
  api.fill('agents.chip', InvitedAgentControls)
  // /integrations: everything a person connected once (agents and Google), and the standing rules.
  api.fill('integrations.page', IntegrationsPage)
  // Google: Save to Google Drive and Export to Google Docs in the export panel,
  // Import from Google Drive in the + menu.
  api.fill('slate.export.google', GoogleExport)
  api.fill('addmenu.import', GoogleImport)
}
