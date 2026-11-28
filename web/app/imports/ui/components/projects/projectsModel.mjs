// Projects in the browser (MIT core): what a person may do in a project, how the sidebar orders
// drives, the folder breadcrumb, the share dialog's rows and the delete dialog's words. Pure, so the
// rules the project page follows are tested in node (scripts/projects-ui.test.mjs). The server
// decides every one of these again (server/projects/project-role.mjs, core.mjs): the page only
// hides what would be refused, so it never shows a control that does nothing.
//
// A project is a drive (parentId null, rootId === _id) or a folder inside one (at most 3 deep).
// Folders carry no access of their own: they inherit the drive's.

export const ROLE_RANK = Object.freeze({ none: 0, viewer: 1, commenter: 2, editor: 3, manager: 4, owner: 5 })
export const ROLE_WORDS = Object.freeze({
  owner: 'Owner', manager: 'Manager', editor: 'Editor', commenter: 'Commenter', viewer: 'Viewer', none: 'No access',
})
export const ROLE_HELP = Object.freeze({
  manager: 'Edits every slate, shares the project and tidies its folders',
  editor: 'Edits every slate and adds slates of their own',
  commenter: 'Comments on every slate',
  viewer: 'Views every slate',
})
export const LINK_WORDS = Object.freeze({
  none: 'Only people with access',
  viewer: 'Anyone with the link can view',
  commenter: 'Anyone with the link can comment',
  editor: 'Anyone with the link can edit',
})
export const NAME_MAX = 120
export const DESCRIPTION_MAX = 2000
export const MAX_FOLDER_DEPTH = 3
// The sidebar dot: palette indexes 0..7 (null shows the neutral dot).
export const PROJECT_COLORS = Object.freeze(['#2f6f4e', '#1f5f8b', '#8b4b9a', '#b3541e', '#a3842b', '#3d7d7a', '#b03a48', '#5b6470'])

const atLeast = (role, wanted) => (ROLE_RANK[role] ?? 0) >= ROLE_RANK[wanted]

/**
 * What the page offers someone with `role` on the drive. A phone views projects (phoneView.mjs):
 * everything but opening slates is off there.
 * @param {'owner'|'manager'|'editor'|'commenter'|'viewer'|null} role
 */
export function projectAbilities(role, { phone = false } = {}) {
  const view = atLeast(role, 'viewer')
  const edit = !phone && atLeast(role, 'editor')
  const manage = !phone && atLeast(role, 'manager')
  const own = !phone && role === 'owner'
  return Object.freeze({
    view,
    readOnly: !edit,
    addSlates: edit,
    moveOwnSlates: edit,
    moveAnySlate: manage,
    createFolder: edit,
    renameFolder: edit,
    moveFolder: manage,
    deleteFolder: manage,
    rename: manage,
    share: manage,
    deleteDrive: own,
    pauseRecipes: manage,
    addRecipes: edit,
  })
}

/** The roles someone may hand out: an owner and a manager share up to manager; nobody else shares. */
export function shareRoleOptions(role) {
  return atLeast(role, 'manager') ? ['viewer', 'commenter', 'editor', 'manager'] : []
}

/** A link never grants more than editor. */
export const LINK_ROLES = Object.freeze(['none', 'viewer', 'commenter', 'editor'])

export function validateProjectName(name) {
  const value = typeof name === 'string' ? name.trim() : ''
  if (!value) return { ok: false, value, error: 'Give it a name.' }
  if (value.length > NAME_MAX) return { ok: false, value, error: `Keep the name under ${NAME_MAX + 1} characters.` }
  return { ok: true, value, error: null }
}

export function validateDescription(text) {
  const value = typeof text === 'string' ? text.trim() : ''
  if (value.length > DESCRIPTION_MAX) return { ok: false, value, error: `Keep the description under ${DESCRIPTION_MAX + 1} characters.` }
  return { ok: true, value, error: null }
}

export const isDrive = (project) => Boolean(project) && !project.parentId
/** A folder may hold another folder until the cap: folders nest at most 3 below the drive. */
export const canNestUnder = (parent) => Boolean(parent) && (parent.depth ?? 0) < MAX_FOLDER_DEPTH

/**
 * The sidebar's drives: the person's own first, then those shared with them, each by name.
 * @param {Array<{_id: string, name: string, ownerId: string, parentId?: string|null}>} drives
 */
export function sortDrives(drives, userId) {
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
  const list = (Array.isArray(drives) ? drives : []).filter(isDrive)
  return {
    owned: list.filter((d) => d.ownerId === userId).sort(byName),
    shared: list.filter((d) => d.ownerId !== userId).sort(byName),
  }
}

/** The folders directly inside `parentId`, by name. */
export function childFolders(folders, parentId) {
  return (Array.isArray(folders) ? folders : [])
    .filter((f) => f.parentId === parentId)
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' }))
}

/**
 * The drive, then each folder down to `folderId`. A folder that is not in this drive, or a loop in
 * the data, ends the walk at the drive (the page then shows the drive itself).
 */
export function breadcrumb(drive, folders, folderId) {
  if (!drive) return []
  const head = { id: drive._id, name: drive.name }
  if (!folderId || folderId === drive._id) return [head]
  const byId = new Map((Array.isArray(folders) ? folders : []).map((f) => [f._id, f]))
  const chain = []
  const seen = new Set()
  let at = byId.get(folderId)
  while (at && !seen.has(at._id) && at.rootId === drive._id) {
    seen.add(at._id)
    chain.unshift({ id: at._id, name: at.name })
    if (at.parentId === drive._id) return [head, ...chain]
    at = byId.get(at.parentId)
  }
  return [head]
}

export function projectPath(driveId, folderId = null) {
  return `/projects/${encodeURIComponent(driveId)}${folderId && folderId !== driveId ? `/${encodeURIComponent(folderId)}` : ''}`
}

/** The invite link a drive's link grant gives (/p/<accessKey>). */
export function projectLinkUrl(origin, accessKey) {
  return accessKey ? new URL(`/p/${encodeURIComponent(accessKey)}`, origin).href : ''
}

/** A slate opened from a project reached by its link carries the key, so the canvas resolves the drive's link role. */
export function slatePathInProject(shareId, linkKey = null) {
  return `/canvas/${encodeURIComponent(shareId)}${linkKey ? `?p=${encodeURIComponent(linkKey)}` : ''}`
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

/**
 * The delete-project dialog's sentence. Slates the drive's owner owns are deleted; slates others own go back to them.
 * @param {Array<{userId: string}>} slates every slate in the drive and its folders
 */
export function deleteDriveCopy(slates, userId) {
  const list = Array.isArray(slates) ? slates : []
  const mine = list.filter((s) => s.userId === userId).length
  const others = list.length - mine
  const parts = []
  if (mine) parts.push(`${mine} of your slates will be deleted.`)
  if (others) parts.push(`${plural(others, 'slate owned by others goes', 'slates owned by others go')} back to ${others === 1 ? 'its owner' : 'them'}.`)
  if (!parts.length) parts.push('The project has no slates.')
  return {
    title: 'Delete this project?',
    body: `${parts.join(' ')} Its folders and sharing are removed. This cannot be undone.`,
    confirm: 'Delete project',
    mine,
    others,
  }
}

/**
 * A folder is deleted when empty; otherwise its slates and folders move up a level first. `slates`
 * undefined: the count is not known here (a folder you are not in), so the words cover either case.
 */
export function deleteFolderCopy({ slates, folders = 0, parentName = 'the project' } = {}) {
  if (slates === undefined) {
    return { title: 'Delete this folder?', body: `Anything in it moves to ${parentName}. No slate is deleted.`, confirm: 'Delete folder', moveContents: true }
  }
  if (!slates && !folders) return { title: 'Delete this folder?', body: 'It is empty.', confirm: 'Delete folder', moveContents: false }
  const what = [slates && plural(slates, 'slate', 'slates'), folders && plural(folders, 'folder', 'folders')].filter(Boolean).join(' and ')
  return { title: 'Delete this folder?', body: `Its ${what} move to ${parentName}. No slate is deleted.`, confirm: 'Move and delete', moveContents: true }
}

/**
 * Whether someone may move a slate from where it is to `target` (a drive or folder, or null for
 * "not in a project"). The slate's owner moves it anywhere they edit; a manager moves any slate
 * within their drive, and takes others' slates out (back to their owner's My slates).
 */
export function canMoveSlate({ slate, userId, sourceRole = null, targetRole = null, sourceDriveId = null, targetDriveId = null, phone = false }) {
  if (phone || !slate) return false
  if (slate.userId === userId) {
    // Their own slate: out of a project any time; into one they edit; between drives only when they edit both.
    if (targetDriveId === null) return sourceDriveId !== null
    if (!atLeast(targetRole, 'editor')) return false
    return sourceDriveId === null || sourceDriveId === targetDriveId || atLeast(sourceRole, 'editor')
  }
  if (!sourceDriveId || !atLeast(sourceRole, 'manager')) return false
  return targetDriveId === null || targetDriveId === sourceDriveId
}

/**
 * The places a slate can go from the Move dialog: "Not in a project" (its owner's My slates) and
 * every drive the person may put it in, with folders listed under their drive.
 * @param {Array<{_id, name, rootId, parentId, depth, role}>} projects drives and folders the person sees (folders inherit the drive's role)
 */
export function moveTargets({ slate, userId, projects, currentProjectId = null, phone = false }) {
  const list = Array.isArray(projects) ? projects : []
  const byId = new Map(list.map((p) => [p._id, p]))
  const driveOf = (id) => { const p = byId.get(id); return p ? (p.rootId || p._id) : null }
  const roleOf = (id) => { const d = byId.get(driveOf(id)); return d?.role ?? null }
  const sourceDriveId = currentProjectId ? driveOf(currentProjectId) : null
  const sourceRole = sourceDriveId ? roleOf(sourceDriveId) : null
  const rows = []
  if (currentProjectId && canMoveSlate({ slate, userId, sourceRole, sourceDriveId, targetDriveId: null, phone })) {
    rows.push({ id: null, label: 'Not in a project', detail: slate?.userId === userId ? 'Back to My slates' : 'Back to its owner’s My slates', depth: 0 })
  }
  const drives = sortDrives(list.filter(isDrive), userId)
  for (const drive of [...drives.owned, ...drives.shared]) {
    const targetRole = drive.role ?? null
    if (!canMoveSlate({ slate, userId, sourceRole, targetRole, sourceDriveId, targetDriveId: drive._id, phone })) continue
    const walk = (parentId, depth) => {
      for (const f of childFolders(list.filter((p) => p.rootId === drive._id && p._id !== drive._id), parentId)) {
        rows.push({ id: f._id, label: f.name, depth, current: f._id === currentProjectId })
        walk(f._id, depth + 1)
      }
    }
    rows.push({ id: drive._id, label: drive.name, depth: 0, current: drive._id === currentProjectId, shared: drive.ownerId !== userId })
    walk(drive._id, 1)
  }
  return rows
}

/** The share dialog's rows: the owner first, then people and teams by role (highest first), then by name. */
export function accessRows({ drive, grants }) {
  const rows = [{ key: 'owner', kind: 'owner', name: drive?.ownerName || 'Owner', detail: drive?.ownerEmail || '', role: 'owner', removable: false }]
  for (const g of Array.isArray(grants) ? grants : []) {
    if (g.kind === 'link' || g.role === 'none') continue
    rows.push({
      key: g._id,
      kind: g.kind,
      name: g.kind === 'team' ? (g.orgName || 'A team') : (g.userName || g.email || 'Someone'),
      detail: g.kind === 'team' ? 'Everyone in this team' : (g.pending ? 'Invited, not signed up yet' : (g.email || '')),
      role: g.role,
      userId: g.userId || null,
      orgId: g.orgId || null,
      email: g.email || null,
      removable: true,
    })
  }
  const [owner, ...rest] = rows
  rest.sort((a, b) => (ROLE_RANK[b.role] - ROLE_RANK[a.role]) || a.name.localeCompare(b.name))
  return [owner, ...rest]
}

/** The drive's link grant: its role ('none' when there is none) and key. */
export function linkGrant(grants) {
  const link = (Array.isArray(grants) ? grants : []).find((g) => g.kind === 'link')
  return { role: link?.role && link.role !== 'none' ? link.role : 'none', accessKey: link?.accessKey || null }
}

export const looksLikeEmail = (text) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text || '').trim())

/**
 * What an empty project offers, and only what works for this person: "Add a slate" and "Move
 * slates here" for editors, "Add a recipe" where recipes are on (enterprise code fills that one).
 */
export function projectEmptyState({ abilities, folder = false, filter = '' }) {
  const words = String(filter || '').trim()
  if (words) return { title: `No slates match “${words}”`, body: 'Try another word, or clear the filter.', actions: [], clear: true }
  const where = folder ? 'this folder' : 'this project'
  if (!abilities?.addSlates) {
    return { title: `Nothing in ${where} yet`, body: 'Slates added here show up for everyone the project is shared with.', actions: [] }
  }
  return {
    title: `Nothing in ${where} yet`,
    body: 'Add a slate, or move slates you already have. Everyone the project is shared with sees them.',
    actions: [
      { id: 'add', label: 'Add a slate' },
      { id: 'move', label: 'Move slates here' },
    ],
    recipes: Boolean(abilities.addRecipes),
  }
}

/** The address that opens a new slate in a project (/new carries it into the first save). */
export function newSlatePath(projectId) {
  return `/new?empty=1&projectId=${encodeURIComponent(projectId)}`
}

/** A refusal from a projects.* action, in words to show (the action's own reason when it gave one). */
export function projectErrorWords(error) {
  const code = error?.error || error?.code
  const words = {
    not_found: 'This project isn’t here any more, or it was not shared with you.',
    forbidden: 'You don’t have permission to do that in this project.',
    depth: `Folders go at most ${MAX_FOLDER_DEPTH} deep.`,
    not_empty: 'Move what is in the folder out first.',
    exec_confirm: 'Confirm it in the app first.',
  }
  return words[code] || error?.reason || 'That didn’t work. Try again.'
}
