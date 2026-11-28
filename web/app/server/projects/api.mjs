// What enterprise code sees of projects (the loader hands it in as context.projects). Server-side,
// by account id: every call runs as that account would through a token (its own and its team's
// grants; never a drive link, never a team admin's manager rights), so a recipe can do in a project
// only what its owner's token could.
//
//   get(projectId) -> Project | null
//   roleFor(userId, projectId) -> 'owner'|'manager'|'editor'|'commenter'|'viewer'|null
//   listSlates(projectId, { folders = true }) -> [{ _id, shareId, name, userId, lastSaved, projectId }]
//   ensureFolder(userId, parentId, name) -> Project      idempotent by (parentId, name); needs editor
//   createSlate(userId, projectId, { name, source }) -> { slateId, shareId, revision }
//   moveSlate(userId, shareId, projectId) -> void
//   isRecipesPaused(projectId) -> boolean                 the drive's switch (folders read the drive)
//   setRecipesPaused(userId, projectId, paused) -> void   manager or above
//   onDeleted(fn(projectId)) -> void                      a drive was deleted
//   onAccessLost(fn({ projectId, userId, orgId })) -> void someone lost their role in a drive
const asAgent = (userId) => ({ kind: 'agent', userId, tokenId: null, scopes: ['projects:read', 'projects:write'] })

// core: the projects core (core.mjs), or a function returning it (bound once the Meteor side has
// made it, so enterprise code registered before then holds the same api). hooks: where onDeleted
// adds to (the core's own by default; host.mjs shares one list with a core made later).
export function createProjectsApi(core, { hooks = null } = {}) {
  const live = typeof core === 'function' ? core : () => core
  return Object.freeze({
    async get(projectId) {
      const { stores } = live()
      return typeof projectId === 'string' ? stores.projects.findOne({ _id: projectId }) : null
    },
    async roleFor(userId, projectId) {
      const c = live()
      const { stores } = c
      if (typeof userId !== 'string' || !userId) return null
      const user = await stores.users.findOne({ _id: userId }, { projection: { _id: 1, orgId: 1 } })
      if (!user) return null
      return c.access.roleFor(user, projectId, { token: true })
    },
    async listSlates(projectId, { folders = true } = {}) {
      const c = live()
      const { stores } = c
      const ids = await c.folderIds(projectId, { nested: folders })
      if (!ids.length) return []
      const rows = await stores.slates.find({ projectId: { $in: ids } }, {
        projection: { _id: 1, shareId: 1, userId: 1, lastSaved: 1, projectId: 1, 'options.name': 1 },
        sort: { lastSaved: -1 },
      }).toArray()
      return rows.map((row) => ({ _id: row._id, shareId: row.shareId, name: row.options?.name || '', userId: row.userId, lastSaved: row.lastSaved, projectId: row.projectId }))
    },
    ensureFolder: (userId, parentId, name) => live().ensureFolder(asAgent(userId), parentId, name),
    createSlate: (userId, projectId, options = {}) => live().createSlate(asAgent(userId), projectId, options),
    async moveSlate(userId, shareId, projectId) {
      await live().moveSlate(asAgent(userId), shareId, projectId)
    },
    async isRecipesPaused(projectId) {
      const drive = await live().access.driveOf(projectId)
      return Boolean(drive?.recipesPaused)
    },
    async setRecipesPaused(userId, projectId, paused) {
      await live().setRecipesPaused(asAgent(userId), projectId, paused)
    },
    onDeleted(fn) {
      if (typeof fn !== 'function') throw new Error('projects.onDeleted takes a function')
      const list = hooks || live().hooks
      list.deleted.push(fn)
    },
    // Beyond the frozen interface: someone lost their role in a drive (unshared, lowered below
    // editor, removed from the team, account deleted): fn({ projectId, userId, orgId }).
    onAccessLost(fn) {
      if (typeof fn !== 'function') throw new Error('projects.onAccessLost takes a function')
      const list = hooks || live().hooks
      list.accessLost.push(fn)
    },
  })
}
