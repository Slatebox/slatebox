// The words for each token scope, shared by the token form in Profile → Developer and the
// consent page an MCP app sends a person to (/oauth/consent).
export const tokenPermissions = [
  { scope: 'slates:read', label: 'Read slates' },
  { scope: 'slates:write', label: 'Create and edit slates' },
  { scope: 'slates:share', label: 'Manage invitation links on slates I own' },
  { scope: 'ai:settings', label: 'Read, change and test my own AI connections' },
  { scope: 'ai:admin', label: 'Change and test my team\'s or this server\'s AI (team admins and administrators only)' },
  { scope: 'team:export', label: 'Export everything my team owns (team admins only)' },
  { scope: 'team:import', label: 'Import a team export as a new team, and confirm or discard it (administrators only)' },
]

export const permissionLabel = (scope) => tokenPermissions.find((item) => item.scope === scope)?.label || scope
