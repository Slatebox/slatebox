// Projects in the browser (design A.7): the sidebar's Projects, the project page (slates, folders,
// share like a drive, move slates in and out), /p/<accessKey>, "Add a slate" carrying the project
// into the first save, and a phone that views projects read only. The rules are pure
// (projectsModel.mjs, pendingProject.mjs); the wiring is checked in the source.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  LINK_ROLES, MAX_FOLDER_DEPTH, NAME_MAX, ROLE_RANK, accessRows, breadcrumb, canMoveSlate, canNestUnder, childFolders, deleteDriveCopy,
  deleteFolderCopy, linkGrant, looksLikeEmail, moveTargets, newSlatePath, projectAbilities, projectEmptyState, projectErrorWords,
  projectLinkUrl, projectPath, shareRoleOptions, slatePathInProject, sortDrives, validateDescription, validateProjectName,
} from '../web/app/imports/ui/components/projects/projectsModel.mjs'
import {
  PENDING_PROJECT_KEY, PENDING_PROJECT_TTL_MS, claimProjectForSave, peekPendingProject, rememberProjectForNew,
} from '../web/app/imports/api/client/pendingProject.mjs'

const app = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const ui = (path) => app('imports/ui/' + path)
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m } }
const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }

test('what each project role may do matches the roles table (A.1)', () => {
  const o = projectAbilities('owner')
  assert.equal(o.deleteDrive, true)
  assert.equal(o.share, true)
  assert.equal(o.deleteFolder, true)
  const m = projectAbilities('manager')
  assert.deepEqual([m.share, m.rename, m.moveAnySlate, m.deleteFolder, m.moveFolder, m.deleteDrive], [true, true, true, true, true, false])
  const e = projectAbilities('editor')
  assert.deepEqual([e.addSlates, e.moveOwnSlates, e.createFolder, e.renameFolder], [true, true, true, true])
  assert.deepEqual([e.share, e.moveAnySlate, e.deleteFolder, e.deleteDrive], [false, false, false, false])
  for (const role of ['commenter', 'viewer']) {
    const a = projectAbilities(role)
    assert.equal(a.view, true)
    assert.equal(a.readOnly, true)
    assert.ok(Object.entries(a).filter(([k]) => !['view', 'readOnly'].includes(k)).every(([, v]) => v === false), role)
  }
  const none = projectAbilities(null)
  assert.equal(none.view, false)
})

test('a phone views a project: no control that changes it, whatever the role', () => {
  const a = projectAbilities('owner', { phone: true })
  assert.equal(a.view, true)
  assert.equal(a.readOnly, true)
  for (const [k, v] of Object.entries(a)) if (!['view', 'readOnly'].includes(k)) assert.equal(v, false, k)
  assert.equal(canMoveSlate({ slate: { userId: 'u' }, userId: 'u', targetDriveId: 'd', targetRole: 'owner', phone: true }), false)
})

test('owners and managers share up to manager; links stop at editor; nobody else shares', () => {
  assert.deepEqual(shareRoleOptions('owner'), ['viewer', 'commenter', 'editor', 'manager'])
  assert.deepEqual(shareRoleOptions('manager'), ['viewer', 'commenter', 'editor', 'manager'])
  assert.deepEqual(shareRoleOptions('editor'), [])
  assert.deepEqual(shareRoleOptions(null), [])
  assert.deepEqual([...LINK_ROLES], ['none', 'viewer', 'commenter', 'editor'])
  assert.ok(ROLE_RANK.owner > ROLE_RANK.manager && ROLE_RANK.manager > ROLE_RANK.editor && ROLE_RANK.editor > ROLE_RANK.commenter && ROLE_RANK.commenter > ROLE_RANK.viewer)
})

test('names are 1..120 characters and descriptions at most 2000', () => {
  assert.equal(validateProjectName('  Platform  ').value, 'Platform')
  assert.equal(validateProjectName('   ').ok, false)
  assert.equal(validateProjectName(undefined).ok, false)
  assert.equal(validateProjectName('x'.repeat(NAME_MAX)).ok, true)
  assert.equal(validateProjectName('x'.repeat(NAME_MAX + 1)).ok, false)
  assert.equal(validateDescription('').ok, true)
  assert.equal(validateDescription('x'.repeat(2001)).ok, false)
})

const drive = { _id: 'd1', rootId: 'd1', parentId: null, depth: 0, name: 'Platform', ownerId: 'ana', role: 'owner' }
const folders = [
  { _id: 'f1', rootId: 'd1', parentId: 'd1', depth: 1, name: 'Services', role: 'owner' },
  { _id: 'f2', rootId: 'd1', parentId: 'f1', depth: 2, name: 'Billing', role: 'owner' },
  { _id: 'f3', rootId: 'd1', parentId: 'f2', depth: 3, name: 'Old', role: 'owner' },
  { _id: 'f0', rootId: 'd1', parentId: 'd1', depth: 1, name: 'archive', role: 'owner' },
]

test('the breadcrumb walks a folder up to its drive, and stops at the drive on bad data', () => {
  assert.deepEqual(breadcrumb(drive, folders, null), [{ id: 'd1', name: 'Platform' }])
  assert.deepEqual(breadcrumb(drive, folders, 'f2').map((c) => c.name), ['Platform', 'Services', 'Billing'])
  assert.deepEqual(breadcrumb(drive, folders, 'f3').map((c) => c.id), ['d1', 'f1', 'f2', 'f3'])
  assert.deepEqual(breadcrumb(drive, folders, 'nope'), [{ id: 'd1', name: 'Platform' }])
  const loop = [{ _id: 'a', rootId: 'd1', parentId: 'b', name: 'A' }, { _id: 'b', rootId: 'd1', parentId: 'a', name: 'B' }]
  assert.deepEqual(breadcrumb(drive, loop, 'a'), [{ id: 'd1', name: 'Platform' }])
  const otherDrive = [{ _id: 'x', rootId: 'd9', parentId: 'd9', name: 'X' }]
  assert.deepEqual(breadcrumb(drive, otherDrive, 'x'), [{ id: 'd1', name: 'Platform' }])
})

test('folders list by name and nest at most 3 below the drive', () => {
  assert.deepEqual(childFolders(folders, 'd1').map((f) => f.name), ['archive', 'Services'])
  assert.equal(MAX_FOLDER_DEPTH, 3)
  assert.equal(canNestUnder(drive), true)
  assert.equal(canNestUnder(folders[1]), true)
  assert.equal(canNestUnder(folders[2]), false, 'a folder 3 deep takes no folder')
})

test('the sidebar lists the person’s own drives first, then shared ones, never folders', () => {
  const list = [
    { _id: 's', parentId: null, ownerId: 'bo', name: 'Alpha' },
    { _id: 'b', parentId: null, ownerId: 'ana', name: 'zeta' },
    { _id: 'a', parentId: null, ownerId: 'ana', name: 'Beta' },
    { _id: 'f', parentId: 'a', ownerId: 'ana', name: 'A folder' },
  ]
  const { owned, shared } = sortDrives(list, 'ana')
  assert.deepEqual(owned.map((d) => d._id), ['a', 'b'])
  assert.deepEqual(shared.map((d) => d._id), ['s'])
  assert.deepEqual(sortDrives(null, 'ana'), { owned: [], shared: [] })
})

test('paths: the project page, its link, and a slate opened through a link carries the key', () => {
  assert.equal(projectPath('d1'), '/projects/d1')
  assert.equal(projectPath('d1', 'd1'), '/projects/d1')
  assert.equal(projectPath('d1', 'f2'), '/projects/d1/f2')
  assert.equal(projectLinkUrl('https://app.slatebox.com', 'K'.repeat(24)), `https://app.slatebox.com/p/${'K'.repeat(24)}`)
  assert.equal(projectLinkUrl('https://app.slatebox.com', null), '')
  assert.equal(slatePathInProject('abc'), '/canvas/abc')
  assert.equal(slatePathInProject('abc', 'key1'), '/canvas/abc?p=key1')
  assert.equal(newSlatePath('f2'), '/new?empty=1&projectId=f2')
})

test('deleting a drive says how many of your slates go and how many go back to their owners', () => {
  const slates = [{ userId: 'ana' }, { userId: 'ana' }, { userId: 'bo' }, { userId: 'cy' }, { userId: 'cy' }, { userId: 'cy' }]
  const copy = deleteDriveCopy(slates, 'ana')
  assert.match(copy.body, /^2 of your slates will be deleted\. 4 slates owned by others go back to them\./)
  assert.equal(copy.mine, 2)
  assert.equal(copy.others, 4)
  assert.match(deleteDriveCopy([{ userId: 'bo' }], 'ana').body, /^1 slate owned by others goes back to its owner\./)
  assert.match(deleteDriveCopy([], 'ana').body, /^The project has no slates\./)
  assert.match(copy.body, /cannot be undone/)
})

test('deleting a folder moves what is in it up a level; an empty one just goes', () => {
  assert.equal(deleteFolderCopy({ slates: 0 }).moveContents, false)
  assert.equal(deleteFolderCopy({ slates: 0 }).body, 'It is empty.')
  assert.deepEqual([deleteFolderCopy({}).moveContents, deleteFolderCopy({}).body], [true, 'Anything in it moves to the project. No slate is deleted.'], 'unknown counts never claim it is empty')
  const c = deleteFolderCopy({ slates: 3, folders: 1, parentName: '“Platform”' })
  assert.equal(c.moveContents, true)
  assert.equal(c.body, 'Its 3 slates and 1 folder move to “Platform”. No slate is deleted.')
})

test('moving slates: owners move their own; managers tidy within their drive; others cannot', () => {
  const mine = { userId: 'ana' }
  const theirs = { userId: 'bo' }
  // into a drive the owner edits, from My slates
  assert.equal(canMoveSlate({ slate: mine, userId: 'ana', targetDriveId: 'd1', targetRole: 'editor' }), true)
  assert.equal(canMoveSlate({ slate: mine, userId: 'ana', targetDriveId: 'd1', targetRole: 'commenter' }), false)
  // out, any time, for the owner
  assert.equal(canMoveSlate({ slate: mine, userId: 'ana', sourceDriveId: 'd1', sourceRole: 'viewer', targetDriveId: null }), true)
  // between drives needs editor on both
  assert.equal(canMoveSlate({ slate: mine, userId: 'ana', sourceDriveId: 'd1', sourceRole: 'viewer', targetDriveId: 'd2', targetRole: 'editor' }), false)
  assert.equal(canMoveSlate({ slate: mine, userId: 'ana', sourceDriveId: 'd1', sourceRole: 'editor', targetDriveId: 'd2', targetRole: 'editor' }), true)
  // a manager moves someone else's slate within the drive, or out (back to its owner)
  assert.equal(canMoveSlate({ slate: theirs, userId: 'ana', sourceDriveId: 'd1', sourceRole: 'manager', targetDriveId: 'd1', targetRole: 'manager' }), true)
  assert.equal(canMoveSlate({ slate: theirs, userId: 'ana', sourceDriveId: 'd1', sourceRole: 'manager', targetDriveId: null }), true)
  assert.equal(canMoveSlate({ slate: theirs, userId: 'ana', sourceDriveId: 'd1', sourceRole: 'manager', targetDriveId: 'd2', targetRole: 'owner' }), false)
  assert.equal(canMoveSlate({ slate: theirs, userId: 'ana', sourceDriveId: 'd1', sourceRole: 'editor', targetDriveId: 'd1', targetRole: 'editor' }), false)
  assert.equal(canMoveSlate({ slate: theirs, userId: 'ana', targetDriveId: 'd1', targetRole: 'owner' }), false)
})

test('the Move dialog lists only places the slate can go, folders under their drive', () => {
  const projects = [
    drive, ...folders,
    { _id: 'd2', rootId: 'd2', parentId: null, depth: 0, name: 'Shared', ownerId: 'bo', role: 'viewer' },
    { _id: 'd3', rootId: 'd3', parentId: null, depth: 0, name: 'Design', ownerId: 'bo', role: 'editor' },
  ]
  const rows = moveTargets({ slate: { userId: 'ana' }, userId: 'ana', projects })
  assert.deepEqual(rows.map((r) => r.id), ['d1', 'f0', 'f1', 'f2', 'f3', 'd3'])
  assert.deepEqual(rows.map((r) => r.depth), [0, 1, 1, 2, 3, 0])
  assert.equal(rows.find((r) => r.id === 'd3').shared, true)
  const inside = moveTargets({ slate: { userId: 'ana', projectId: 'f1' }, userId: 'ana', projects, currentProjectId: 'f1' })
  assert.equal(inside[0].id, null)
  assert.equal(inside[0].label, 'Not in a project')
  assert.equal(inside.find((r) => r.id === 'f1').current, true)
  // a manager with someone else's slate sees only their own drive (and out)
  const managed = moveTargets({ slate: { userId: 'bo' }, userId: 'ana', projects, currentProjectId: 'f1' })
  assert.deepEqual(managed.map((r) => r.id), [null, 'd1', 'f0', 'f1', 'f2', 'f3'])
  assert.equal(managed[0].detail, 'Back to its owner’s My slates')
})

test('the share dialog lists the owner first, then by role; link and none grants are not people', () => {
  const grants = [
    { _id: 'link_d1', kind: 'link', role: 'viewer', accessKey: 'K' },
    { _id: 'user_bo_d1', kind: 'user', userId: 'bo', userName: 'Bo', role: 'viewer' },
    { _id: 'user_cy_d1', kind: 'user', userId: 'cy', userName: 'Cy', role: 'manager' },
    { _id: 'team_t_d1', kind: 'team', orgId: 't', orgName: 'Acme', role: 'editor' },
    { _id: 'user_x_d1', kind: 'user', email: 'new@acme.com', pending: true, role: 'commenter' },
    { _id: 'user_gone_d1', kind: 'user', userId: 'gone', role: 'none' },
  ]
  const rows = accessRows({ drive: { ownerName: 'Ana' }, grants })
  assert.deepEqual(rows.map((r) => r.name), ['Ana', 'Cy', 'Acme', 'new@acme.com', 'Bo'])
  assert.equal(rows[0].removable, false)
  assert.equal(rows[2].detail, 'Everyone in this team')
  assert.equal(rows[3].detail, 'Invited, not signed up yet')
  assert.deepEqual(linkGrant(grants), { role: 'viewer', accessKey: 'K' })
  assert.deepEqual(linkGrant([]), { role: 'none', accessKey: null })
  assert.equal(looksLikeEmail('a@b.co'), true)
  assert.equal(looksLikeEmail('nope'), false)
})

test('an empty project offers only what works for this person', () => {
  const editor = projectEmptyState({ abilities: projectAbilities('editor') })
  assert.deepEqual(editor.actions.map((a) => a.label), ['Add a slate', 'Move slates here'])
  assert.equal(editor.recipes, true)
  const viewer = projectEmptyState({ abilities: projectAbilities('viewer') })
  assert.deepEqual(viewer.actions, [])
  assert.equal(viewer.recipes, undefined)
  const phone = projectEmptyState({ abilities: projectAbilities('owner', { phone: true }) })
  assert.deepEqual(phone.actions, [])
  assert.match(projectEmptyState({ abilities: projectAbilities('owner'), folder: true }).title, /this folder/)
  assert.equal(projectEmptyState({ abilities: projectAbilities('owner'), filter: 'api' }).clear, true)
})

test('refusals read as sentences', () => {
  assert.match(projectErrorWords({ error: 'forbidden' }), /permission/)
  assert.equal(projectErrorWords({ error: 'odd', reason: 'Because.' }), 'Because.')
  assert.equal(projectErrorWords(null), 'That didn’t work. Try again.')
})

test('"Add a slate" waits for the new slate’s first save, once, and lapses after 15 minutes', () => {
  const s = memory()
  rememberProjectForNew(s, 'd1', 1000)
  assert.equal(peekPendingProject(s, 2000), 'd1')
  assert.equal(claimProjectForSave(s, 2000), 'd1')
  assert.equal(claimProjectForSave(s, 3000), null, 'claimed once')
  rememberProjectForNew(s, 'd1', 0)
  assert.equal(claimProjectForSave(s, PENDING_PROJECT_TTL_MS + 1), null, 'stale')
  assert.equal(s.m.has(PENDING_PROJECT_KEY), false, 'a stale choice is cleared too')
  rememberProjectForNew(s, 'd1', 0)
  rememberProjectForNew(s, null, 10)
  assert.equal(claimProjectForSave(s, 20), null, '/new without a project forgets it')
  rememberProjectForNew(s, '<script>', 0)
  assert.equal(claimProjectForSave(s, 1), null, 'only an id')
  assert.doesNotThrow(() => rememberProjectForNew(broken, 'd1'))
  assert.equal(claimProjectForSave(broken), null)
  assert.equal(claimProjectForSave(null), null)
})

test('the first save of a new slate carries the project; /new remembers it', () => {
  const create = app('imports/api/client/createSlate.js')
  assert.match(create, /claimProjectForSave\(sessionStore\(\)\)/)
  assert.match(create, /\.\.\.\(projectId && \{ projectId \}\)/)
  assert.match(app('imports/api/client/saveSlate.js'), /\.\.\.\(uopts\.projectId && \{ projectId: uopts\.projectId \}\)/)
  assert.match(app('client/main.jsx'), /rememberProjectForNew\(window\.sessionStorage, new URLSearchParams\(search\)\.get\('projectId'\)\)/)
})

test('routes: /projects, /projects/:projectId/:folderId? (signed in) and /p/:accessKey (anyone)', () => {
  const routes = ui('SBRoutes.jsx')
  assert.match(routes, /<Route path="\/projects" element=\{<PrivateRoute><Projects \/><\/PrivateRoute>\} \/>/)
  assert.match(routes, /<Route path="\/projects\/:projectId\/:folderId\?" element=\{<PrivateRoute><ProjectFor \/><\/PrivateRoute>\} \/>/)
  assert.match(routes, /<Route path="\/p\/:accessKey" element=\{<ProjectLink \/>\} \/>/)
  assert.match(routes, /lazy\(\(\) => import\('\.\/pages\/Project'\)\)/)
  const link = ui('pages/ProjectLink.jsx')
  assert.match(link, /createAnonymousUser\(\)/)
  assert.match(link, /projectsApi\.get\(\{ accessKey \}\)/)
  assert.match(link, /\?p=\$\{encodeURIComponent\(accessKey\)\}/)
})

test('the sidebar has Projects, expanding to the person’s drives and New project', () => {
  const main = ui('Main.jsx')
  assert.match(main, /title: 'Projects',\s*path: '\/projects'/)
  assert.match(main, /nested: \(onNavigate\) => <ProjectsNav/)
  assert.match(main, /item\.nested && !collapsed \? \[link, item\.nested\(onNavigate\)\] : link/)
  const nav = ui('components/projects/ProjectsNav.jsx')
  assert.match(nav, /sortDrives\(/)
  assert.match(nav, /\{!phone && \(/, 'no New project on a phone')
  assert.match(nav, /New project/)
})

test('the project page lists slates with the same cards, and its own header, folders, Share and Recipes slot', () => {
  const page = ui('pages/Project.jsx')
  assert.match(page, /<DisplaySlates [^>]*type="project" projectId=\{listId\} linkKey=\{linkKey\} projectRole=\{role\}/)
  assert.match(page, /projectAbilities\(role, \{ phone \}\)/)
  assert.match(page, /<EnterpriseSlot name="project\.recipes"/)
  assert.match(page, /<EnterpriseSlot name="project\.addRecipe"/)
  assert.match(page, /\{abilities\.share && <ProjectShareDialog/)
  const header = ui('components/projects/ProjectHeader.jsx')
  assert.match(header, /<EnterpriseSlot name="project\.recipesTab"/)
  assert.match(header, /\{abilities\.share && <Button[\s\S]{0,200}?>Share<\/Button>\}/)
  assert.match(header, /\{abilities\.addSlates && <Button/)
  assert.match(header, /role="tablist"/)
  const list = ui('components/DisplaySlates.jsx')
  assert.match(list, /\.\.\.\(type === 'project' && \{ projectId, \.\.\.\(linkKey && \{ linkKey \}\) \}\)/)
  assert.match(list, /showAdd=\{!phoneView && type !== 'project'\}/)
  assert.match(list, /slatePathInProject\(slate\.shareId, linkKey\)/)
  assert.match(list, /type === 'mine' && !phoneView && \(/, 'no select-and-delete on someone else’s project slates')
  assert.match(ui('components/Title.jsx'), /\{headerMessage && <Typography variant="h5" component="h1"/, 'no empty heading on a project page')
})

test('a slate’s menu moves it to a project; the library’s Add to a slate looks in projects too', () => {
  const menu = ui('components/SlateMenu.jsx')
  assert.match(menu, /Move to project…/)
  assert.match(menu, /<MoveToProjectDialog /)
  assert.match(menu, /ROLE_RANK\[projectRole\] \?\? 0\) >= ROLE_RANK\.manager/)
  const add = ui('components/library/gallery/AddToSlateDialog.jsx')
  assert.match(add, /type: 'project', projectId/)
  assert.match(add, />My slates</)
})

test('the projects client calls the nine projects.* actions by id', () => {
  const api = app('imports/api/client/projects.js')
  for (const id of ['list', 'get', 'create', 'update', 'delete', 'slates', 'moveSlate', 'access', 'share']) {
    assert.match(api, new RegExp(`call\\('projects\\.${id}'`), id)
  }
})

test('project copy is sentence case, says agent not AI, and uses US spelling', () => {
  const files = ['pages/Project.jsx', 'pages/Projects.jsx', 'pages/ProjectLink.jsx', 'components/projects/ProjectHeader.jsx',
    'components/projects/ProjectFolders.jsx', 'components/projects/ProjectShareDialog.jsx', 'components/projects/MoveToProjectDialog.jsx',
    'components/projects/MoveSlatesHereDialog.jsx', 'components/projects/NewProjectDialog.jsx', 'components/projects/ProjectsNav.jsx',
    'components/projects/projectsModel.mjs']
  for (const f of files) {
    const src = ui(f)
    assert.doesNotMatch(src, /\bAI\b/, f)
    assert.doesNotMatch(src, /colour|organis|behaviour|cancell?ed by|favourite/i, f)
    assert.doesNotMatch(src, />(New Project|Add A Slate|Move Slates Here|Make A New Link|Copy Link|Delete Project|New Folder)</, f)
  }
})
