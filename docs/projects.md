# Projects

A project is a drive of slates. Anyone can make one, nest folders in it, and share it the way you
share a drive: with people, with your team, or with anyone who has the link. Projects are part of
the MIT core, so every install has them, Cloud and self-hosted alike.

Code: `web/app/server/projects/` (the rules and the core), `web/app/server/actions/projects-*.mjs`
(the actions), `web/app/imports/ui/pages/Project.jsx` and `web/app/imports/ui/components/projects/`
(the pages).

## The model

| Record | Holds |
|---|---|
| `projects` | Drives and folders. A drive has `parentId: null` and `rootId === _id`. A folder has `rootId` set to its drive, and nests at most 3 levels below it. |
| `projectAccess` | Who may open a drive: one row per person (`kind: 'user'`), team (`kind: 'team'`) or link (`kind: 'link'`, with a 24-character `accessKey`). Folders have no access of their own; they inherit their drive's. |
| `slates.projectId` | The drive or folder a slate sits in, or `null`. A slate sits in at most one. |

Putting a slate in a project never changes who owns it. The owner keeps it in My slates, and its own
sharing still works on top of the project's.

## Roles

| Role | Slates in the project | Folders | Share the project | Delete the project |
|---|---|---|---|---|
| Owner | Edit all | Make, rename, move, delete | Yes | Yes |
| Manager | Edit all; move any slate within the project; give a slate back to its owner | Make, rename, move, delete empty ones | Yes, up to manager | No |
| Editor | Edit all; make slates here; move own slates in and out | Make, rename | No | No |
| Commenter | Comment on all | — | No | No |
| Viewer | Read all | — | No | No |

A team admin is a manager of the team's projects. Your role on a slate is the higher of your own
slate role and your project role (`resolveSlateRole` in `server/methods/slate-role.mjs`). Every
door that opens a slate goes through that one rule: the canvas, saves, the live room, API tokens
and the access link.

API tokens use person and team grants, never links, and never the team-admin manager rights.

## Sharing

- **People:** invite any Slatebox account, in any team. An address with no account gets a pending
  invite that becomes a grant when that person signs in with the address verified.
- **Your team:** everyone in it gets the role you pick.
- **The link:** viewer, commenter or editor. The address is `/p/<accessKey>`. "Make a new link"
  rotates the key, and the old address stops working. Someone with no account who opens the link
  gets viewer at most.

Every change is recorded in the activity log (`project.access_changed`, `project.link_changed`).

## Moving and deleting

- **Move a slate in or out:** the slate's owner, if they are an editor of the target. A manager may
  move any slate within their project. Moving out returns the slate to My slates.
- **Delete a folder:** empty, or with its contents moved to its parent (or another folder).
- **Delete a project** (owner only): slates the owner owns are deleted, slates others own go back to
  them, and every recipe in the project is removed. The dialog shows the counts first.
- **Leaving a team, or deleting an account:** that person's grants go; projects they own are
  deleted by the rule above.

## From an agent, a script or the CLI

The nine actions appear in `/api/v1`, the exec tool, the MCP server and the CLI:

| Action | HTTP | Scope |
|---|---|---|
| `projects.list` | `GET /projects` | `projects:read` |
| `projects.get` | `GET /projects/{projectId}` | `projects:read` |
| `projects.create` | `POST /projects` | `projects:write` |
| `projects.update` | `PATCH /projects/{projectId}` | `projects:write` |
| `projects.delete` | `DELETE /projects/{projectId}` (`mode: preview` counts first) | `projects:write` |
| `projects.slates` | `GET /projects/{projectId}/slates` | `projects:read` |
| `projects.moveSlate` | `POST /slates/{shareId}/project` | `projects:write` |
| `projects.access` | `GET /projects/{projectId}/access` | `projects:share` |
| `projects.share` | `POST /projects/{projectId}/access` | `projects:share` |

`slates.create` and `slates.importMermaid` take an optional `projectId` to make the new slate in a
project. A script that widens who can open a project (`projects.share`) waits for the person to
agree, as every audience change does.

```sh
slatebox exec -e '
  const project = await slatebox.projects.create({ name: "Platform architecture" })
  await slatebox.slates.importMermaid({ projectId: project.projectId, name: "Service map", mermaid: "flowchart LR\n  api --> db" })
  return slatebox.projects.share({ projectId: project.projectId, email: "dev@acme.example", role: "editor" })
'
```

The share is held until you confirm it, as every change to who can open something is.

## Recipes

Where enterprise code runs and recipes are on, a project page has a Recipes tab: agents that keep
the project's slates up to date for the person who adds them. See [recipes.md](recipes.md).
