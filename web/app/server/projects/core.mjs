/* eslint-disable no-underscore-dangle */
// Projects: drives of slates that people create, nest folders in and share. All the logic is here,
// Meteor-free; the actions (server/actions/projects-*.mjs), the enterprise interface (api.mjs) and
// the Meteor hooks (meteor.js) are thin.
//
// A drive is a project whose rootId is its own _id; a folder is a project under it (parentId), at
// most MAX_FOLDER_DEPTH below. A slate sits in at most one (slate.projectId). Access is set on the
// drive (projectAccess rows) and folders inherit it. Putting a slate in a drive never changes who
// owns it: its owner keeps it in My slates, and its own sharing still works on top.
//
// stores: raw MongoDB driver collections (findOne, find().toArray(), insertOne, updateOne,
// updateMany, deleteOne, deleteMany, countDocuments), each call taking { session }:
//   projects, projectAccess, slates, users
// deps:
//   access            createProjectAccess(...) (project-access.mjs)
//   saveCore          the slate save core (create) for createSlate
//   audit             { record(entry) } (server/audit/recorder.mjs)
//   deleteOwnedSlate  (slate) => Promise   the Slates page's delete (methods/slates.js)
//   hooks             { deleted: [fn(projectId)], accessLost: [fn({ projectId, userId, orgId })] }
//   withTransaction   (fn(session)) => Promise
//   hasClaim          (userId, claimId) => Promise<boolean>   team claims (admin, canAddSlates)
//   newId, generateKey (24 characters), generateShareId, now, appOrigin, teamName(orgId)
import { createHash } from 'node:crypto'
import { problem } from '../actions/errors.mjs'
import {
  GRANTABLE_ROLES,
  LINK_ROLES,
  MAX_FOLDER_DEPTH,
  PROJECT_COLORS,
  PROJECT_DESCRIPTION_MAX,
  PROJECT_NAME_MAX,
  atLeast,
  projectCan,
} from '../../imports/api/common/project-roles.mjs'
import { privateSlateDocument } from '../private-slate-document.mjs'
import { checkPlacement, PROJECT_ID } from './place.mjs'

export const PROJECT_LIMITS = Object.freeze({ drivesPerOwner: 200, foldersPerDrive: 500, grantsPerDrive: 500, listMax: 200 })
const EMAIL = /^[^\s@<>()[\],;:"]{1,64}@[^\s@<>()[\],;:"]{1,255}\.[A-Za-z]{2,}$/

const notFound = () => problem(404, 'not_found', 'Project not found or unavailable.')
const forbidden = (message) => problem(403, 'forbidden', message)
const invalid = (message) => problem(400, 'invalid_request', message)
const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const hashOf = (text) => createHash('sha256').update(text).digest('hex').slice(0, 24)

export const accessIds = Object.freeze({
  link: (projectId) => `link_${projectId}`,
  user: (userId, projectId) => `user_${userId}_${projectId}`,
  team: (orgId, projectId) => `team_${orgId}_${projectId}`,
  // A person invited by an address with no account yet: claimed when they sign in with it verified.
  invite: (email, projectId) => `invite_${hashOf(email)}_${projectId}`,
})

const cleanName = (value, what = 'name') => {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  if (!name || name.length > PROJECT_NAME_MAX) throw invalid(`Give the ${what} a name of 1 to ${PROJECT_NAME_MAX} characters.`)
  return name
}
const cleanDescription = (value) => {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string' || value.length > PROJECT_DESCRIPTION_MAX) throw invalid(`A description is at most ${PROJECT_DESCRIPTION_MAX} characters.`)
  return value.trim()
}
const cleanColor = (value) => {
  if (value === undefined || value === null) return null
  if (!Number.isInteger(value) || value < 0 || value >= PROJECT_COLORS) throw invalid(`color is a palette index from 0 to ${PROJECT_COLORS - 1}.`)
  return value
}
export const normalizeEmail = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '')

const isDrive = (project) => Boolean(project) && project.rootId === project._id

/** What a caller sees of a project. */
export function projectView(project, role, { appOrigin } = {}) {
  return {
    projectId: project._id,
    kind: isDrive(project) ? 'drive' : 'folder',
    driveId: project.rootId,
    parentId: project.parentId ?? null,
    depth: project.depth ?? 0,
    name: project.name,
    description: project.description || '',
    color: project.color ?? null,
    ownerId: project.ownerId,
    orgId: project.orgId ?? null,
    role,
    recipesPaused: Boolean(project.recipesPaused),
    created: project.created ? new Date(project.created).toISOString() : null,
    updated: project.lastSaved ? new Date(project.lastSaved).toISOString() : null,
    ...(appOrigin && { url: new URL(isDrive(project) ? `/projects/${project._id}` : `/projects/${project.rootId}/${project._id}`, appOrigin).href }),
  }
}

export function createProjectsCore({
  stores,
  access,
  saveCore = null,
  audit = { record: async () => null },
  deleteOwnedSlate = async () => {},
  hooks = { deleted: [], accessLost: [] },
  withTransaction = (fn) => fn(undefined),
  hasClaim = async () => false,
  newId,
  generateKey,
  generateShareId = null,
  now = () => new Date(),
  appOrigin = () => 'http://localhost:3000',
  teamName = async () => '',
}) {
  const { projects, projectAccess, slates, users } = stores
  const record = (entry) => Promise.resolve(audit.record(entry)).catch(() => null)
  const target = (project) => ({ type: 'project', id: project._id, name: project.name })
  const orgOf = (project) => (project.orgId ? { orgId: project.orgId } : {})

  async function fire(list, ...args) {
    for (const fn of list || []) {
      try {
        await fn(...args)
      } catch (error) {
        console.error('[projects] hook failed', error?.message || error) // eslint-disable-line no-console
      }
    }
  }

  // Who calls: the account, and whether it is a token (an API token, a connected app, an agent or
  // a recipe), whose project role never uses a link and never a team admin's rights.
  async function caller(principal) {
    if (!principal?.userId) throw problem(401, 'unauthorized', 'Sign in to Slatebox to do this.')
    const user = await users.findOne({ _id: principal.userId }, { projection: { _id: 1, orgId: 1, isAnonymous: 1, profile: 1, emails: 1 } })
    if (!user) throw notFound()
    return { user, token: principal.kind === 'agent' }
  }
  const registered = (who) => {
    if (who.user.isAnonymous) throw problem(403, 'registration_required', 'Create an account to use projects.')
  }

  async function loadProject(projectId) {
    if (typeof projectId !== 'string' || !PROJECT_ID.test(projectId)) throw notFound()
    const project = await projects.findOne({ _id: projectId })
    if (!project) throw notFound()
    return project
  }

  // The project, its drive and the caller's role in it; refuses when the role is below `need`
  // (a capability from project-roles.mjs). No role at all answers as if it did not exist.
  async function withRole(who, projectId, need, linkKey = null) {
    const project = await loadProject(projectId)
    const drive = isDrive(project) ? project : await projects.findOne({ _id: project.rootId })
    if (!drive) throw notFound()
    const role = await access.roleFor(who.user, drive._id, { token: who.token, linkKey: who.token ? null : linkKey })
    if (!role) throw notFound()
    if (need && !projectCan(role, need)) throw forbidden(refusalWords[need] || 'Your role in this project does not allow that.')
    return { project, drive, role }
  }
  const refusalWords = {
    createFolder: 'Only an editor of this project can make folders.',
    renameFolder: 'Only an editor of this project can rename folders.',
    moveFolder: 'Only a manager of this project can move folders.',
    renameProject: 'Only a manager of this project can rename it.',
    share: 'Only a manager of this project can share it.',
    pauseRecipes: 'Only a manager of this project can pause its recipes.',
    deleteProject: 'Only the owner can delete this project.',
    deleteEmptyFolder: 'Only a manager of this project can delete folders.',
    deleteFolderWithContents: 'Only the owner can delete a folder that holds slates or folders. Empty it first.',
  }

  // Every project under a drive, with the descendants of one of them.
  async function driveTree(driveId, session) {
    return projects.find({ rootId: driveId }, { projection: { _id: 1, parentId: 1, depth: 1, name: 1, rootId: 1 }, session }).toArray()
  }
  function descendantsOf(tree, id) {
    const children = new Map()
    for (const row of tree) {
      if (!row.parentId) continue
      if (!children.has(row.parentId)) children.set(row.parentId, [])
      children.get(row.parentId).push(row)
    }
    const out = [id]
    for (let i = 0; i < out.length; i += 1) for (const child of children.get(out[i]) || []) out.push(child._id)
    return out
  }
  const subtreeHeight = (tree, id) => {
    const byParent = new Map()
    for (const row of tree) if (row.parentId) byParent.set(row.parentId, [...(byParent.get(row.parentId) || []), row._id])
    const height = (node) => Math.max(0, ...(byParent.get(node) || []).map((child) => 1 + height(child)))
    return height(id)
  }

  const folderIds = (projectId, options) => access.folderIds(projectId, options)

  async function nameOf(userId) {
    const user = userId && await users.findOne({ _id: userId }, { projection: { profile: 1, emails: 1 } })
    if (!user) return ''
    const full = `${user.profile?.firstName || ''} ${user.profile?.lastName || ''}`.trim()
    return full || user.emails?.[0]?.address?.split('@')[0] || ''
  }

  async function create(principal, input = {}) {
    const who = await caller(principal)
    registered(who)
    const name = cleanName(input.name, input.parentId ? 'folder' : 'project')
    const description = cleanDescription(input.description)
    const color = cleanColor(input.color)
    const at = now()
    if (input.parentId) {
      const { project: parent, drive, role } = await withRole(who, input.parentId, 'createFolder')
      const depth = (parent.depth || 0) + 1
      if (depth > MAX_FOLDER_DEPTH) throw invalid(`Folders go at most ${MAX_FOLDER_DEPTH} levels deep.`)
      if (await projects.countDocuments({ rootId: drive._id }) > PROJECT_LIMITS.foldersPerDrive) throw invalid(`A project holds at most ${PROJECT_LIMITS.foldersPerDrive} folders.`)
      const folder = {
        _id: newId(), ownerId: drive.ownerId, orgId: drive.orgId ?? null, rootId: drive._id, parentId: parent._id, depth,
        name, description, color, created: at, lastSaved: at, sharingRevision: 0, recipesPaused: false,
      }
      await projects.insertOne(folder)
      await record({ action: 'project.folder_created', target: target(folder), ...orgOf(drive), details: { projectId: drive._id } })
      return projectView(folder, role, { appOrigin: appOrigin() })
    }
    if (await projects.countDocuments({ ownerId: who.user._id, parentId: null }) >= PROJECT_LIMITS.drivesPerOwner) throw invalid(`You can own at most ${PROJECT_LIMITS.drivesPerOwner} projects.`)
    const id = newId()
    const drive = {
      _id: id, ownerId: who.user._id, orgId: who.user.orgId || null, rootId: id, parentId: null, depth: 0,
      name, description, color, created: at, lastSaved: at, sharingRevision: 0, recipesPaused: false,
    }
    await projects.insertOne(drive)
    await record({ action: 'project.created', target: target(drive), ...orgOf(drive) })
    return projectView(drive, 'owner', { appOrigin: appOrigin() })
  }

  async function get(principal, projectId, { linkKey = null } = {}) {
    const who = await caller(principal)
    const { project, drive, role } = await withRole(who, projectId, 'open', linkKey)
    const tree = await driveTree(drive._id)
    const byId = new Map(tree.map((row) => [row._id, row]))
    const path = []
    for (let at = project; at && at.parentId; at = byId.get(at.parentId)) path.unshift(at.parentId)
    const folders = tree.filter((row) => row.parentId === project._id).sort((a, b) => a.name.localeCompare(b.name))
    const slateCount = await slates.countDocuments({ projectId: project._id })
    return {
      ...projectView(project, role, { appOrigin: appOrigin() }),
      path: path.map((id) => ({ projectId: id, name: (byId.get(id) || drive).name })),
      folders: folders.map((row) => ({ projectId: row._id, name: row.name, depth: row.depth })),
      // every folder in the drive, so a page can draw the whole tree from one answer
      driveFolders: tree.filter((row) => row._id !== drive._id).map((row) => ({ projectId: row._id, parentId: row.parentId, name: row.name, depth: row.depth })),
      slateCount,
      ownerName: await nameOf(drive.ownerId),
    }
  }

  async function list(principal, { parentId = null } = {}) {
    const who = await caller(principal)
    if (parentId) {
      const { drive, role } = await withRole(who, parentId, 'open')
      const rows = await projects.find({ rootId: drive._id, parentId }).toArray()
      return rows.sort((a, b) => a.name.localeCompare(b.name)).map((row) => projectView(row, role, { appOrigin: appOrigin() }))
    }
    const ids = await access.readableDriveIds(who.user)
    if (!ids.length) return []
    const drives = await projects.find({ _id: { $in: ids }, parentId: null }).toArray()
    const out = []
    for (const drive of drives) {
      const role = await access.roleFor(who.user, drive._id, { token: who.token })
      if (role) out.push(projectView(drive, role, { appOrigin: appOrigin() }))
    }
    // Owned first, then shared, each by name.
    return out.sort((a, b) => Number(b.role === 'owner') - Number(a.role === 'owner') || a.name.localeCompare(b.name)).slice(0, PROJECT_LIMITS.listMax)
  }

  async function update(principal, projectId, patch = {}) {
    const who = await caller(principal)
    const project = await loadProject(projectId)
    const drive = isDrive(project)
    const set = {}
    if (patch.name !== undefined) set.name = cleanName(patch.name, drive ? 'project' : 'folder')
    if (patch.description !== undefined) set.description = cleanDescription(patch.description)
    if (patch.color !== undefined) set.color = cleanColor(patch.color)
    const moving = patch.parentId !== undefined && patch.parentId !== project.parentId
    if (moving && drive) throw invalid('A project is not moved into another. Move its slates instead.')
    const pausing = patch.recipesPaused !== undefined && Boolean(patch.recipesPaused) !== Boolean(project.recipesPaused)
    if (patch.recipesPaused !== undefined && !drive) throw invalid('Recipes are paused for the whole project, not one folder.')
    const needs = []
    if (Object.keys(set).length) needs.push(drive ? 'renameProject' : 'renameFolder')
    if (moving) needs.push('moveFolder')
    if (pausing) needs.push('pauseRecipes')
    if (!needs.length && patch.recipesPaused === undefined) throw invalid('Say what to change: name, description, color, parentId or recipesPaused.')
    let role = null
    for (const need of needs.length ? needs : ['open']) ({ role } = await withRole(who, projectId, need))
    if (pausing) set.recipesPaused = Boolean(patch.recipesPaused)
    if (moving) {
      if (!patch.parentId) throw invalid('A folder stays in its project: give it a parent folder or the project.')
      const parent = await loadProject(patch.parentId)
      if (parent.rootId !== project.rootId) throw invalid('A folder moves only within its own project.')
      const tree = await driveTree(project.rootId)
      if (descendantsOf(tree, project._id).includes(parent._id)) throw invalid('A folder cannot go inside itself.')
      const depth = (parent.depth || 0) + 1
      const height = subtreeHeight(tree, project._id)
      if (depth + height > MAX_FOLDER_DEPTH) throw invalid(`Folders go at most ${MAX_FOLDER_DEPTH} levels deep.`)
      set.parentId = parent._id
      set.depth = depth
      // its folders move down or up with it
      const shift = depth - (project.depth || 0)
      if (shift) {
        const below = descendantsOf(tree, project._id).slice(1)
        for (const id of below) {
          const row = tree.find((item) => item._id === id)
          await projects.updateOne({ _id: id }, { $set: { depth: (row.depth || 0) + shift } })
        }
      }
    }
    set.lastSaved = now()
    await projects.updateOne({ _id: project._id }, { $set: set })
    const after = { ...project, ...set }
    if (set.name !== undefined && set.name !== project.name)
      await record({ action: 'project.renamed', target: target(after), ...orgOf(project), details: { from: project.name, to: set.name } })
    if (pausing) await record({ action: 'project.recipes_paused', target: target(after), ...orgOf(project), details: { mode: set.recipesPaused ? 'paused' : 'resumed' } })
    return projectView(after, role, { appOrigin: appOrigin() })
  }

  // What deleting a drive does: the slates its owner owns are deleted; everyone else's go back to them.
  async function driveDeletion(drive) {
    const ids = (await driveTree(drive._id)).map((row) => row._id)
    const inside = await slates.find({ projectId: { $in: ids } }, { projection: { _id: 1, shareId: 1, userId: 1, orgId: 1, options: 1, 'creative.model.kind': 1 } }).toArray()
    const own = inside.filter((slate) => slate.userId === drive.ownerId)
    const others = inside.filter((slate) => slate.userId !== drive.ownerId)
    return { ids, own, others }
  }

  async function deleteDrive(drive) {
    const { ids, own, others } = await driveDeletion(drive)
    // The owner's slates first, each by the Slates page's delete (its sharing, comments and log entry).
    for (const slate of own) await deleteOwnedSlate(slate)
    await withTransaction(async (session) => {
      if (others.length) await slates.updateMany({ projectId: { $in: ids } }, { $set: { projectId: null }, $inc: { sharingRevision: 1 } }, { session })
      await projectAccess.deleteMany({ projectId: drive._id }, { session })
      await projects.deleteMany({ rootId: drive._id }, { session })
    })
    await fire(hooks.deleted, drive._id)
    return { deletedSlates: own.length, returnedSlates: others.length }
  }

  async function remove(principal, projectId, { moveContentsTo = null, preview = false } = {}) {
    const who = await caller(principal)
    const project = await loadProject(projectId)
    if (isDrive(project)) {
      const { drive } = await withRole(who, projectId, 'deleteProject')
      if (preview) {
        const { ids, own, others } = await driveDeletion(drive)
        return { projectId, deleted: false, folders: ids.length - 1, deletedSlates: own.length, returnedSlates: others.length }
      }
      const counts = await deleteDrive(drive)
      await record({ action: 'project.deleted', target: target(drive), ...orgOf(drive), details: { count: counts.deletedSlates } })
      return { projectId, deleted: true, folders: 0, ...counts }
    }
    // A folder: empty, or its contents move to moveContentsTo (its parent by default).
    const tree = await driveTree(project.rootId)
    const childFolders = tree.filter((row) => row.parentId === project._id)
    const childSlates = await slates.countDocuments({ projectId: project._id })
    const empty = !childFolders.length && !childSlates
    await withRole(who, projectId, empty ? 'deleteEmptyFolder' : 'deleteFolderWithContents')
    let destination = project.parentId
    if (!empty && moveContentsTo) {
      const into = await loadProject(moveContentsTo)
      if (into.rootId !== project.rootId) throw invalid('Contents move only within the same project.')
      if (descendantsOf(tree, project._id).includes(into._id)) throw invalid('Contents cannot move into the folder being deleted.')
      destination = into._id
    }
    if (preview) return { projectId, deleted: false, folders: childFolders.length, deletedSlates: 0, returnedSlates: 0, movedSlates: childSlates }
    if (!empty) {
      const into = tree.find((row) => row._id === destination) || (await projects.findOne({ _id: destination }))
      const depth = (into?.depth || 0) + 1
      for (const child of childFolders) {
        if (depth + subtreeHeight(tree, child._id) > MAX_FOLDER_DEPTH) throw invalid(`Moving these folders would nest them more than ${MAX_FOLDER_DEPTH} levels deep.`)
      }
      await withTransaction(async (session) => {
        await slates.updateMany({ projectId: project._id }, { $set: { projectId: destination } }, { session })
        for (const child of childFolders) {
          const shift = depth - (child.depth || 0)
          await projects.updateOne({ _id: child._id }, { $set: { parentId: destination, depth } }, { session })
          for (const id of descendantsOf(tree, child._id).slice(1)) {
            const row = tree.find((item) => item._id === id)
            await projects.updateOne({ _id: id }, { $set: { depth: (row.depth || 0) + shift } }, { session })
          }
        }
        await projects.deleteOne({ _id: project._id }, { session })
      })
    } else {
      await projects.deleteOne({ _id: project._id })
    }
    await record({ action: 'project.folder_deleted', target: target(project), ...orgOf(project), details: { projectId: project.rootId, count: childSlates } })
    return { projectId, deleted: true, folders: childFolders.length, deletedSlates: 0, returnedSlates: 0, movedSlates: childSlates }
  }

  // linkKey: a drive link's key (/p/<key>): its holder lists the drive's slates at the link's role,
  // as projects.get opens the drive for them (never for a token).
  async function listSlates(principal, projectId, { nested = true, limit = 50, q, linkKey = null } = {}) {
    const who = await caller(principal)
    await withRole(who, projectId, 'open', linkKey)
    const ids = await folderIds(projectId, { nested })
    const selector = { projectId: { $in: ids } }
    if (q) selector['options.name'] = { $regex: escapeRegex(q), $options: 'i' }
    const rows = await slates.find(selector, {
      projection: { _id: 1, shareId: 1, userId: 1, lastSaved: 1, projectId: 1, 'options.name': 1, 'options.description': 1, 'options.isPublic': 1, 'options.isUnlisted': 1 },
      sort: { lastSaved: -1 },
      limit: Math.min(Math.max(limit, 1), 100),
    }).toArray()
    return rows
  }

  async function moveSlate(principal, shareId, toProjectId) {
    const who = await caller(principal)
    registered(who)
    if (typeof shareId !== 'string' || !shareId) throw problem(404, 'not_found', 'Slate not found or unavailable.')
    const slate = await slates.findOne({ shareId }, { projection: { _id: 1, shareId: 1, userId: 1, orgId: 1, projectId: 1, 'options.name': 1 } })
    if (!slate) throw problem(404, 'not_found', 'Slate not found or unavailable.')
    const from = slate.projectId || null
    const to = toProjectId || null
    const isOwner = slate.userId === who.user._id
    const fromDrive = from ? await access.driveOf(from) : null
    const fromRole = fromDrive ? await access.roleFor(who.user, fromDrive._id, { token: who.token }) : null
    // Someone who neither owns the slate nor holds a role in its drive does not learn it exists.
    if (!isOwner && !fromRole) throw problem(404, 'not_found', 'Slate not found or unavailable.')
    if (from === to) return { shareId, projectId: to, moved: false }
    let toDrive = null
    let toRole = null
    if (to) {
      await loadProject(to)
      toDrive = await access.driveOf(to)
      toRole = toDrive ? await access.roleFor(who.user, toDrive._id, { token: who.token }) : null
      if (!toRole) throw notFound()
    }
    const sameDrive = Boolean(fromDrive && toDrive && fromDrive._id === toDrive._id)
    let allowed
    if (isOwner) {
      // The owner takes their slate out of any drive; into one they need to be an editor of it, and
      // from one drive to another an editor of both.
      allowed = !to || (atLeast(toRole, 'editor') && (!fromDrive || sameDrive || atLeast(fromRole, 'editor')))
    } else {
      // A manager tidies their drive: moves any slate within it, or gives it back to its owner.
      allowed = projectCan(fromRole, 'moveAnySlateWithin') && (!to || sameDrive)
    }
    if (!allowed) {
      throw forbidden(isOwner
        ? 'You need to be an editor of that project to put a slate in it.'
        : 'Only the slate\'s owner, or a manager of its project moving it within that project, can move it.')
    }
    const result = await slates.updateOne({ _id: slate._id, projectId: from }, { $set: { projectId: to }, $inc: { sharingRevision: 1 } })
    if (result && result.matchedCount === 0) throw problem(409, 'slate_changed', 'The slate moved while this was asked. Retry.')
    await record({
      action: 'project.slate_moved',
      target: { type: 'slate', id: slate.shareId, name: slate.options?.name || 'Untitled slate' },
      slateId: slate.shareId,
      ...((toDrive || fromDrive)?.orgId && { orgId: (toDrive || fromDrive).orgId }),
      details: {
        projectId: from || 'none',
        targetProjectId: to || 'none',
        mode: !to ? 'out of its project' : !from ? 'into a project' : sameDrive ? 'to another folder' : 'to another project',
      },
    })
    return { shareId, projectId: to, moved: true }
  }

  async function grantsOf(driveId) {
    return projectAccess.find({ projectId: driveId }).toArray()
  }

  async function accessView(drive) {
    const rows = await grantsOf(drive._id)
    const link = rows.find((row) => row.kind === 'link')
    const people = []
    for (const row of rows) {
      if (row.kind === 'link') continue
      people.push({
        kind: row.kind,
        role: row.role,
        userId: row.userId ?? null,
        orgId: row.orgId ?? null,
        email: row.kind === 'user' && !row.userId ? row.email : null,
        pending: row.kind === 'user' && !row.userId,
        name: row.kind === 'user' && row.userId ? await nameOf(row.userId) : row.kind === 'team' ? await teamName(row.orgId) : '',
        granted: row.granted ? new Date(row.granted).toISOString() : null,
      })
    }
    return {
      projectId: drive._id,
      owner: { userId: drive.ownerId, name: await nameOf(drive.ownerId) },
      link: link ? { role: link.role, url: new URL(`/p/${link.accessKey}`, appOrigin()).href } : { role: 'none', url: null },
      grants: people,
      sharingRevision: drive.sharingRevision || 0,
    }
  }

  async function getAccess(principal, projectId) {
    const who = await caller(principal)
    const { drive } = await withRole(who, projectId, 'share')
    return accessView(drive)
  }

  async function share(principal, projectId, input = {}) {
    const who = await caller(principal)
    registered(who)
    const { drive } = await withRole(who, projectId, 'share')
    const forms = ['userId', 'email', 'orgId', 'link'].filter((key) => input[key] !== undefined)
    if (forms.length !== 1) throw invalid('Share with one of: userId, email, orgId (a team), or link.')
    const at = now()
    let row = null
    let removeId = null
    let lost = null
    let action = 'project.access_changed'
    let details
    if (input.link !== undefined) {
      if (!LINK_ROLES.includes(input.link)) throw invalid(`link is one of ${LINK_ROLES.join(', ')}.`)
      action = 'project.link_changed'
      details = { role: input.link, mode: 'link' }
      const id = accessIds.link(drive._id)
      if (input.link === 'none') removeId = id
      else {
        const prior = await projectAccess.findOne({ _id: id })
        row = {
          _id: id, projectId: drive._id, kind: 'link', userId: null, orgId: null, role: input.link,
          accessKey: prior && !input.rotate ? prior.accessKey : generateKey(), grantedBy: who.user._id, granted: at,
        }
      }
    } else {
      const role = input.role
      if (!GRANTABLE_ROLES.includes(role)) throw invalid(`role is one of ${GRANTABLE_ROLES.join(', ')}.`)
      details = { role }
      if (input.orgId !== undefined) {
        if (typeof input.orgId !== 'string' || input.orgId !== who.user.orgId)
          throw forbidden('You can share a project only with your own team.')
        if (!(await hasClaim(who.user._id, 'admin')) && !(await hasClaim(who.user._id, 'canAddSlates')))
          throw forbidden('Only a team admin, or a member who may create team slates, can share with the whole team.')
        details.mode = 'team'
        const id = accessIds.team(input.orgId, drive._id)
        if (role === 'none') {
          removeId = id
          lost = { projectId: drive._id, userId: null, orgId: input.orgId }
        } else row = { _id: id, projectId: drive._id, kind: 'team', userId: null, orgId: input.orgId, role, accessKey: null, grantedBy: who.user._id, granted: at }
      } else {
        let userId = input.userId
        let email = null
        if (input.email !== undefined) {
          email = normalizeEmail(input.email)
          if (!EMAIL.test(email)) throw invalid('Give a valid email address.')
          const found = await users.findOne({ 'emails.address': { $regex: `^${escapeRegex(email)}$`, $options: 'i' } }, { projection: { _id: 1, isAnonymous: 1 } })
          userId = found && !found.isAnonymous ? found._id : null
        } else if (typeof userId !== 'string' || !userId) throw invalid('userId names a person.')
        if (userId) {
          const person = await users.findOne({ _id: userId }, { projection: { _id: 1, isAnonymous: 1 } })
          if (!person || person.isAnonymous) throw problem(404, 'not_found', 'There is no such person.')
          if (userId === drive.ownerId) throw invalid('The owner already has every right in their project.')
          details.mode = 'person'
          const id = accessIds.user(userId, drive._id)
          if (role === 'none') {
            removeId = id
            lost = { projectId: drive._id, userId, orgId: null }
          } else row = { _id: id, projectId: drive._id, kind: 'user', userId, orgId: null, role, accessKey: null, grantedBy: who.user._id, granted: at }
          // A pending invitation for the same address is replaced by the person's grant.
          if (email) await projectAccess.deleteOne({ _id: accessIds.invite(email, drive._id) })
        } else {
          details.mode = 'invite'
          const id = accessIds.invite(email, drive._id)
          if (role === 'none') removeId = id
          else row = { _id: id, projectId: drive._id, kind: 'user', userId: null, email, orgId: null, role, accessKey: null, grantedBy: who.user._id, granted: at }
        }
      }
    }
    if (row && await projectAccess.countDocuments({ projectId: drive._id }) >= PROJECT_LIMITS.grantsPerDrive && !(await projectAccess.findOne({ _id: row._id })))
      throw invalid(`A project is shared with at most ${PROJECT_LIMITS.grantsPerDrive} people and teams.`)
    if (row && ((row.kind === 'user' && row.userId) || row.kind === 'team')) {
      // Lowering someone's (or a team's) role is a loss of access too (recipes they own check it again).
      const prior = await projectAccess.findOne({ _id: row._id })
      if (prior && atLeast(prior.role, 'editor') && !atLeast(row.role, 'editor')) lost = { projectId: drive._id, userId: row.userId || null, orgId: row.orgId || null }
    }
    await withTransaction(async (session) => {
      if (removeId) await projectAccess.deleteOne({ _id: removeId }, { session })
      if (row) {
        const { _id, ...fields } = row
        await projectAccess.updateOne({ _id }, { $set: fields }, { upsert: true, session })
      }
      await projects.updateOne({ _id: drive._id }, { $inc: { sharingRevision: 1 }, $set: { lastSaved: at } }, { session })
    })
    await record({ action, target: target(drive), ...orgOf(drive), details: { ...details, projectId: drive._id } })
    if (lost) await fire(hooks.accessLost, lost)
    return accessView({ ...drive, sharingRevision: (drive.sharingRevision || 0) + 1 })
  }

  // A drive link (/p/<key>): which drive it opens, for the link route's redirect.
  async function resolveLink(linkKey) {
    if (typeof linkKey !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(linkKey)) return null
    const grant = await projectAccess.findOne({ kind: 'link', accessKey: linkKey })
    if (!grant || grant.role === 'none') return null
    const drive = await projects.findOne({ _id: grant.projectId }, { projection: { _id: 1, name: 1 } })
    return drive ? { projectId: drive._id, role: grant.role } : null
  }

  async function setRecipesPaused(principal, projectId, paused) {
    const who = await caller(principal)
    const { drive } = await withRole(who, projectId, 'pauseRecipes')
    await projects.updateOne({ _id: drive._id }, { $set: { recipesPaused: Boolean(paused), lastSaved: now() } })
    await record({ action: 'project.recipes_paused', target: target(drive), ...orgOf(drive), details: { mode: paused ? 'paused' : 'resumed' } })
    return { projectId: drive._id, recipesPaused: Boolean(paused) }
  }

  async function ensureFolder(principal, parentId, name) {
    const clean = cleanName(name, 'folder')
    const parent = await loadProject(parentId)
    const existing = await projects.findOne({ rootId: parent.rootId, parentId: parent._id, name: clean })
    if (existing) {
      const who = await caller(principal)
      await withRole(who, existing._id, 'open')
      return existing
    }
    const made = await create(principal, { name: clean, parentId })
    return projects.findOne({ _id: made.projectId })
  }

  async function createSlate(principal, projectId, { name, source = 'create', content = null } = {}) {
    const who = await caller(principal)
    registered(who)
    if (!saveCore || !generateShareId) throw new Error('projects: createSlate needs the save core')
    const placed = await checkPlacement({ access }, who.user, projectId, { token: who.token })
    const shareId = await generateShareId()
    const id = newId()
    const row = privateSlateDocument({
      content: { options: { name: cleanName(name || 'Untitled slate', 'slate'), description: '' }, nodes: [], ...(content || {}) },
      id,
      user: { _id: who.user._id, orgId: placed.orgId },
      shareId,
      now: Date.now(),
    })
    row.projectId = placed.projectId
    const made = await saveCore.create({ row, actor: principal, source })
    return { slateId: id, shareId, revision: made?.revision ?? 1 }
  }

  // A person invited by address signs in with it verified: their invitations become grants.
  async function claimInvites(user) {
    const verified = (user?.emails || []).filter((item) => item?.verified && typeof item.address === 'string').map((item) => normalizeEmail(item.address))
    if (!user?._id || user.isAnonymous || !verified.length) return 0
    const pending = await projectAccess.find({ kind: 'user', userId: null, email: { $in: verified } }).toArray()
    for (const invite of pending) {
      const id = accessIds.user(user._id, invite.projectId)
      const drive = await projects.findOne({ _id: invite.projectId }, { projection: { ownerId: 1 } })
      if (drive && drive.ownerId !== user._id) {
        const prior = await projectAccess.findOne({ _id: id })
        const role = prior && atLeast(prior.role, invite.role) ? prior.role : invite.role
        await projectAccess.updateOne({ _id: id }, { $set: { projectId: invite.projectId, kind: 'user', userId: user._id, orgId: null, role, accessKey: null, grantedBy: invite.grantedBy, granted: invite.granted } }, { upsert: true })
        await projects.updateOne({ _id: invite.projectId }, { $inc: { sharingRevision: 1 } })
      }
      await projectAccess.deleteOne({ _id: invite._id })
    }
    return pending.length
  }

  // A person leaves (account deleted, removed from their team): the drives they own go by the drive
  // rule, their grants go, and whatever ran on their behalf in other drives is told.
  async function personGone(userId) {
    if (typeof userId !== 'string' || !userId) return { drives: 0 }
    const owned = await projects.find({ ownerId: userId, parentId: null }).toArray()
    for (const drive of owned) {
      await deleteDrive(drive)
      await record({ action: 'project.deleted', target: target(drive), ...orgOf(drive), actor: { kind: 'system' }, details: { reason: 'owner left' } })
    }
    const grants = await projectAccess.find({ kind: 'user', userId }).toArray()
    await projectAccess.deleteMany({ kind: 'user', userId })
    for (const grant of grants) await fire(hooks.accessLost, { projectId: grant.projectId, userId, orgId: null })
    return { drives: owned.length }
  }

  // A team is made for someone (organizations.create): their drives move into it with their slates.
  async function ownerJoinedTeam(userId, orgId) {
    await projects.updateMany({ ownerId: userId, orgId: null }, { $set: { orgId } })
  }

  return Object.freeze({
    stores,
    access,
    create,
    get,
    list,
    update,
    remove,
    listSlates,
    moveSlate,
    getAccess,
    share,
    resolveLink,
    setRecipesPaused,
    ensureFolder,
    createSlate,
    claimInvites,
    personGone,
    ownerJoinedTeam,
    folderIds,
    hooks,
  })
}
