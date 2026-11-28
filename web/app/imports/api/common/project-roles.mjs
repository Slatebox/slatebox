// What each role in a project (a drive of slates, with folders) may do. Pure: the server's rule
// (server/projects/project-role.mjs and core.mjs) and the project page read the same table, so the
// page never offers a control the server would refuse.
//
// A project is a drive: a person's (or their team's) shareable set of slates, with folders at most
// three deep. Access is set on the drive only; its folders inherit it. The owner is whoever holds
// the drive (drive.ownerId); everyone else holds a role the sharing names.

export const PROJECT_ROLES = Object.freeze(['viewer', 'commenter', 'editor', 'manager', 'owner'])
// The roles a grant can name (the owner is never granted; 'none' removes a grant).
export const GRANTABLE_ROLES = Object.freeze(['none', 'viewer', 'commenter', 'editor', 'manager'])
// A link to the drive never manages it.
export const LINK_ROLES = Object.freeze(['none', 'viewer', 'commenter', 'editor'])
export const PROJECT_ROLE_RANK = Object.freeze({ none: 0, viewer: 1, commenter: 2, editor: 3, manager: 4, owner: 5 })
// Folders nest at most this many levels below the drive.
export const MAX_FOLDER_DEPTH = 3
export const PROJECT_NAME_MAX = 120
export const PROJECT_DESCRIPTION_MAX = 2000
// The sidebar dot: an index into the app's palette.
export const PROJECT_COLORS = 12

export const PROJECT_ROLE_LABELS = Object.freeze({
  owner: 'Owner',
  manager: 'Manager',
  editor: 'Editor',
  commenter: 'Commenter',
  viewer: 'Viewer',
})

export const PROJECT_ROLE_WORDS = Object.freeze({
  manager: 'Can edit every slate, organize folders and share the project',
  editor: 'Can edit every slate, add slates and make folders',
  commenter: 'Can open and comment on every slate',
  viewer: 'Can open every slate',
})

/** Whether role a is at least role b. */
export const atLeast = (a, b) => (PROJECT_ROLE_RANK[a] || 0) >= (PROJECT_ROLE_RANK[b] || 0)

// What each capability needs, at least.
const NEEDS = Object.freeze({
  open: 'viewer',
  comment: 'commenter',
  editSlates: 'editor',
  addSlates: 'editor',
  moveOwnSlates: 'editor',
  createFolder: 'editor',
  renameFolder: 'editor',
  moveFolder: 'manager',
  deleteEmptyFolder: 'manager',
  deleteFolderWithContents: 'owner',
  moveAnySlateWithin: 'manager',
  removeOthersSlates: 'manager',
  renameProject: 'manager',
  share: 'manager',
  pauseRecipes: 'manager',
  snapshotSlates: 'manager',
  deleteProject: 'owner',
})
export const PROJECT_CAPABILITIES = Object.freeze(Object.keys(NEEDS))

/** Whether a person holding role may do what (one of PROJECT_CAPABILITIES). */
export function projectCan(role, what) {
  if (!Object.hasOwn(NEEDS, what)) throw new Error(`Unknown project capability ${what}`)
  return Boolean(role) && atLeast(role, NEEDS[what])
}

/** The highest role a person holding role may hand out (null: may not share). */
export function highestGrantable(role) {
  if (!projectCan(role, 'share')) return null
  return 'manager'
}

/** The slate role a project role gives on every slate in the drive. */
export function projectRoleToSlateRole(role) {
  if (role === 'owner' || role === 'manager' || role === 'editor') return 'EDIT'
  if (role === 'commenter') return 'COMMENT'
  if (role === 'viewer') return 'READ'
  return null
}
