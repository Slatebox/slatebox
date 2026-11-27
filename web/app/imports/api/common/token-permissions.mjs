// The words for each token scope, shared by the token form in Profile → Developer and the
// consent page an MCP app sends a person to (/oauth/consent). explain: one plain sentence on what
// allowing it lets the app do, shown under the label.
export const tokenPermissions = [
  { scope: 'slates:read', label: 'Read slates', explain: 'See the slates you can open, their notes, comments and the agent tasks on them.' },
  { scope: 'slates:write', label: 'Create and edit slates', explain: 'Make slates, change notes, add and resolve comments, and ask or update agent tasks, as you.' },
  { scope: 'slates:add-photo', label: 'Add photos to slates I can edit', explain: 'Take a photo or pick one from your phone and add it to a slate as a picture note. It cannot change, move or delete anything else. The photo\'s location data is removed before it\'s saved.' },
  { scope: 'slates:share', label: 'Manage invitation links on slates I own, and submit my work to the library', explain: 'Make and turn off invitation links, which let more people open slates you own, and send your work to the library for review.' },
  { scope: 'slates:delete', label: 'Delete slates I own and remove comments', explain: 'Delete whole slates you own, and remove your comments (or the Slatebox agent\'s replies on slates you edit). Nothing else can delete.' },
  { scope: 'ai:settings', label: 'Read, change and test my own AI connections', explain: 'See and change which AI services your account uses, and check that they answer.' },
  { scope: 'ai:admin', label: 'Change and test my team\'s or this server\'s AI (team admins and administrators only)', explain: 'Change the AI that everyone on your team or this server uses. Only if you are an admin.' },
  { scope: 'ai:admin:read', label: 'Read this server\'s AI control: what answers each AI feature, its problems and its change history (administrators only)', explain: 'See which AI model answers each part of Slatebox, any problems with that set-up, and who changed it. It cannot change anything, and never sees a key. Only if you are an administrator.' },
  { scope: 'team:export', label: 'Export everything my team owns (team admins only)', explain: 'Download a copy of every slate and setting your team owns. Only if you are a team admin.' },
  { scope: 'team:import', label: 'Import a team export as a new team, and confirm or discard it (administrators only)', explain: 'Bring a team\'s exported copy into this server as a new team. Only for administrators.' },
  { scope: 'team:move', label: 'Move a team here from another Slatebox server, and confirm or discard the move (team owners, or people in no team yet)', explain: 'Bring your team\'s exported copy from another Slatebox server into this one, as your team. Only if you own your team here or are in no team yet.' },
  { scope: 'library:review', label: 'Review library submissions (administrators)', explain: 'Open, refine, publish and take down what people submit to the shared library. Only for administrators.' },
  { scope: 'profile:read', label: 'Read what Slatebox knows about me (About you)', explain: 'See the facts in your About you, such as your role, your tools and your goals, so the app can make things for your work.' },
  { scope: 'profile:write', label: 'Add to and change what Slatebox knows about me (About you)', explain: 'Add, change, hide and remove facts in your About you. It cannot turn personalization or its sources on or off.' },
]

export const permissionLabel = (scope) => tokenPermissions.find((item) => item.scope === scope)?.label || scope
