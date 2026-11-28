// The projects interface enterprise code is handed (context.projects) before the Meteor side has
// made the core: the loader runs at import time, ahead of server/projects/meteor.js. Calls wait on
// nothing; they reach the core once bound, and hooks added before then are kept in the one list the
// core reads. Pure.
import { createProjectsApi } from './api.mjs'

export function createProjectsHost() {
  const hooks = { deleted: [], accessLost: [] }
  let bound = null
  const live = () => {
    if (!bound) throw new Error('projects: the core is not ready yet (server/projects/meteor.js binds it at start)')
    return bound
  }
  return {
    hooks,
    api: createProjectsApi(live, { hooks }),
    bind(core) {
      bound = core
    },
    get bound() {
      return Boolean(bound)
    },
  }
}

// The server's one host: server/enterprise.js hands projectsHost.api to enterprise code;
// server/projects/meteor.js binds the core made with projectsHost.hooks.
export const projectsHost = createProjectsHost()
