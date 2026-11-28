// Admin › AI control › Integration apps › GitHub App, as words (pure, so it is tested without a
// browser). The view is connectors.githubApp.get's answer: ids, fingerprints, never a secret.
//
// "Create the GitHub App" posts GitHub's App manifest from the admin's browser (manifestFormFields);
// GitHub makes the App and sends the browser back to Slatebox with ?github=ready or ?github=failed.

export const ORG_PATTERN = /^[A-Za-z0-9-]{1,39}$/

/** The organization field's starting value: Cloud's App belongs to the Slatebox organization. */
export const defaultOrgOf = (view) => view?.makes?.defaultOrg || ''

/** '' (fine: blank is Cloud's Slatebox organization, or the admin's own account on a self-hosted install) or what is wrong. */
export function orgProblem(org) {
  const value = `${org ?? ''}`.trim()
  if (!value) return ''
  return ORG_PATTERN.test(value) ? '' : 'A GitHub organization name has only letters, numbers and dashes.'
}

/** The status lines the card shows. */
export function githubAppStatus(view) {
  if (!view) return { state: 'loading', title: 'Reading the GitHub App…', lines: [] }
  const makes = view.makes || { name: 'Slatebox', public: false }
  const kind = makes.public ? 'a public GitHub App any GitHub account can install' : 'a private GitHub App for this server'
  if (view.ready) {
    return {
      state: 'ready',
      title: `GitHub App ready: ${view.slug}`,
      lines: [
        `People connect GitHub for recipes in one click: GitHub's install screen for ${view.slug}, where they pick the repositories.`,
        `App id ${view.appId}${view.source === 'settings' ? ', from the settings file' : ''}.`,
      ],
      appUrl: view.appUrl || null,
      installUrl: view.installUrl || null,
    }
  }
  if (view.appId || view.slug) {
    return {
      state: 'partial',
      title: 'The GitHub App is only partly set up',
      lines: ['Some of its credentials are missing, so recipes cannot use GitHub yet. Create the App again, or clear it and start over.'],
      appUrl: view.appUrl || null,
      installUrl: null,
    }
  }
  return {
    state: 'none',
    title: 'No GitHub App yet',
    lines: [
      `Recipes read GitHub through a GitHub App. Create the GitHub App makes "${makes.name}", ${kind}, in one click on GitHub.`,
      'It asks for: metadata (read), contents (write, used only for the diagram pull requests a person allows per recipe), pull requests (write) and checks (write), and listens for pushes and pull requests.',
    ],
    appUrl: null,
    installUrl: null,
  }
}

/** The form fields the browser posts to GitHub: { action, fields: { manifest } }. */
export function manifestFormFields(answer) {
  if (!answer || typeof answer.action !== 'string' || !/^https:\/\/[\w.-]+\//.test(answer.action) || typeof answer.manifest !== 'string') return null
  return { action: answer.action, fields: { manifest: answer.manifest } }
}

/** What GitHub's return (?github=) means, for the alert after. */
export function returnedNote(search) {
  const status = new URLSearchParams(search || '').get('github')
  if (status === 'ready') return { severity: 'success', text: 'GitHub made the App and Slatebox stored its keys. People can connect GitHub for recipes now.' }
  if (status === 'failed') return { severity: 'warning', text: 'GitHub did not finish making the App, or the setup link expired. Create it again.' }
  return null
}
