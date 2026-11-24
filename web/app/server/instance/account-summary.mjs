// The caller's own account: name, address, team, AI drafting access, what is included this month
// and Slatebox Pro, and where a person goes for what a token may not do (get Pro, top up, change
// the address, delete the account). One core behind GET /api/v1/me and the instance description.
//
// Slatebox is free; only AI and calls on Slatebox's own providers are metered (Slatebox Cloud).
// `ai.included` is the meter's own summary of this month (null on a server with no meter);
// `ai.pro` is the person's Slatebox Pro (null without one). Both are read-only: Pro and top-ups
// are bought by a person in the profile, never through a token (`links.pay` and `links.topUp` open
// the in-app pay sheet there).

export function displayName(user) {
  const full = [user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(' ').trim()
  return full || user.emails?.[0]?.address?.split('@')[0] || ''
}

function educationOf(user) {
  if (user.isEducationCertified) return 'certified'
  return user.requestingEducationCertification ? 'requested' : 'none'
}

// Which pane the account's pay link opens (imports/ui/components/billing/pay/pay-url.mjs reads it).
const payAction = (pro) => {
  if (pro?.pastDue) return 'card'
  return pro?.active ? 'manage' : 'pro'
}

export function createAccounts({
  settings,
  origin,
  findUser,
  findOrganization,
  listClaims,
  canGenerate,
  // What is included this month for this person (the meter's summary), or null with no meter.
  includedThisMonth = async () => null,
  // This person's Slatebox Pro (pro-billing.mjs proSummary), or null.
  proSummary = () => null,
  // Whether the meter runs here: the meter's own answer (metering/meteor.js meterOn), which is true
  // only on Slatebox Cloud by its Cloud key (cloud-lock.mjs). A self-hosted server whose settings
  // say metering.enabled has no meter, so no credits, pay or top-up links. Tests may leave it out.
  meterOn = () => settings.metering?.enabled === true,
}) {
  const selfHosted = settings.public?.env === 'selfhost'
  const link = (path) => origin.replace(/\/$/, '') + path

  async function summary(principal) {
    const metered = meterOn() === true
    const user = await findUser(principal.userId)
    if (!user || user.isAnonymous) return null
    const org = user.orgId ? await findOrganization(user.orgId) : null
    const [canDraft, claims, included] = await Promise.all([
      canGenerate(user),
      org ? listClaims(user._id) : [],
      metered ? includedThisMonth(user) : null,
    ])
    const pro = metered ? proSummary(user) ?? null : null
    return {
      id: user._id,
      name: displayName(user),
      email: user.emails?.[0]?.address ?? null,
      emailVerified: Boolean(user.emails?.[0]?.verified),
      team: org ? { id: org._id, name: org.name ?? '', owner: Boolean(user.isOrgOwner), claims } : null,
      education: selfHosted ? null : educationOf(user),
      ai: { canDraftWorkshops: Boolean(canDraft), included: included ?? null, pro },
      token: principal.kind === 'agent'
        ? { id: principal.tokenId, name: principal.tokenName, scopes: [...principal.scopes] }
        : null,
      links: {
        profile: link('/profile'),
        developer: link('/profile?tab=developer'),
        // Credits, and the in-app pay sheet opened on it (?pay=): Get Pro, or Your Pro once it is on,
        // or the card when its last payment failed; and a top-up. A person pays there, never a token.
        ...(metered && {
          credits: link('/profile?tab=credits'),
          pay: link(`/profile?tab=credits&pay=${payAction(pro)}`),
          topUp: link('/profile?tab=credits&pay=topup'),
        }),
      },
    }
  }

  return { summary }
}
