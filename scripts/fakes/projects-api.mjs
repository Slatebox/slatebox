// A stand-in for the Projects interface enterprise code receives as context.projects
// (web/app/server/projects/api.mjs, design A.6), for the recipes runtime's tests (MIT, test support).
// Same methods, same answers, in memory:
//   get(projectId)  roleFor(userId, projectId)  listSlates(projectId, { folders })
//   ensureFolder(userId, parentId, name)  createSlate(userId, projectId, { name, source })
//   moveSlate(userId, shareId, projectId)  isRecipesPaused(projectId)  setRecipesPaused(userId, projectId, paused)
//   onDeleted(fn)
// Test helpers (not part of A.6): addDrive, share, unshare, deleteDrive, slates (the made slates).
const RANK = { none: 0, viewer: 1, commenter: 2, editor: 3, manager: 4, owner: 5 }

export function createFakeProjectsApi({ onSlateCreated = () => {} } = {}) {
  const projects = new Map()
  const roles = new Map() // `${userId}:${driveId}` → role
  const slates = new Map()
  const deleted = []
  let n = 0
  const refuse = (status, code, message) => Object.assign(new Error(message), { status, code })
  const driveOf = (projectId) => {
    const p = projects.get(projectId)
    return p ? projects.get(p.rootId) : null
  }
  async function roleFor(userId, projectId) {
    const drive = driveOf(projectId)
    if (!drive || !userId) return null
    if (drive.ownerId === userId) return 'owner'
    return roles.get(`${userId}:${drive._id}`) || null
  }
  const atLeast = async (userId, projectId, role) => RANK[(await roleFor(userId, projectId)) || 'none'] >= RANK[role]
  const api = Object.freeze({
    async get(projectId) {
      return projects.get(projectId) ? { ...projects.get(projectId) } : null
    },
    roleFor,
    async listSlates(projectId, { folders = true } = {}) {
      const ids = new Set([projectId])
      if (folders) for (const p of projects.values()) if (p.rootId === driveOf(projectId)?._id) ids.add(p._id)
      return [...slates.values()].filter((s) => ids.has(s.projectId)).map(({ _id, shareId, name, userId, lastSaved, projectId: pid }) => ({ _id, shareId, name, userId, lastSaved, projectId: pid }))
    },
    async ensureFolder(userId, parentId, name) {
      if (!(await atLeast(userId, parentId, 'editor'))) throw refuse(403, 'forbidden', 'You cannot add folders here.')
      const parent = projects.get(parentId)
      const found = [...projects.values()].find((p) => p.parentId === parentId && p.name === name)
      if (found) return { ...found }
      if (parent.depth >= 3) throw refuse(400, 'too_deep', 'Folders nest at most 3 deep.')
      const folder = { _id: `f${++n}`, ownerId: parent.ownerId, orgId: parent.orgId, rootId: parent.rootId, parentId, depth: parent.depth + 1, name, description: '', color: null, recipesPaused: false }
      projects.set(folder._id, folder)
      return { ...folder }
    },
    async createSlate(userId, projectId, { name, source }) {
      if (!(await atLeast(userId, projectId, 'editor'))) throw refuse(403, 'forbidden', 'You cannot add slates here.')
      const slate = { _id: `s${++n}`, shareId: `share${n}`, name, userId, projectId, source, lastSaved: new Date(), revision: 0, nodes: [] }
      slates.set(slate._id, slate)
      await onSlateCreated(slate)
      return { slateId: slate._id, shareId: slate.shareId, revision: 0 }
    },
    async moveSlate(userId, shareId, projectId) {
      const slate = [...slates.values()].find((s) => s.shareId === shareId)
      if (!slate) throw refuse(404, 'not_found', 'No such slate.')
      slate.projectId = projectId
    },
    async isRecipesPaused(projectId) {
      return Boolean(driveOf(projectId)?.recipesPaused)
    },
    async setRecipesPaused(userId, projectId, paused) {
      if (!(await atLeast(userId, projectId, 'manager'))) throw refuse(403, 'forbidden', 'Only a manager can pause recipes here.')
      driveOf(projectId).recipesPaused = Boolean(paused)
    },
    onDeleted(fn) {
      deleted.push(fn)
    },
  })
  return {
    api,
    slates,
    projects,
    addDrive({ ownerId, orgId = null, name = 'Drive' }) {
      const id = `p${++n}`
      projects.set(id, { _id: id, ownerId, orgId, rootId: id, parentId: null, depth: 0, name, description: '', color: null, recipesPaused: false, sharingRevision: 0 })
      return id
    },
    share(driveId, userId, role) {
      roles.set(`${userId}:${driveId}`, role)
    },
    unshare(driveId, userId) {
      roles.delete(`${userId}:${driveId}`)
    },
    async deleteDrive(driveId) {
      for (const fn of deleted) await fn(driveId)
      for (const [id, p] of projects) if (p.rootId === driveId) projects.delete(id)
    },
  }
}
