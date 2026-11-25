/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import { check, Match } from 'meteor/check'
import { canEditSlate } from '../common/slate-access'
import { svgToPng, searchGoogleImages } from './images'
import { generateImagesFor } from './stabilityai'
import { fetchPublicImage } from '../common/safe-fetch.mjs'
import { Random } from 'meteor/random'
import { deleteStoredFile, storeFile, storedFileBase } from '../common/fileStore'
import { finishSnapshot, ownedSnapshotKey } from '../common/presentationSnapshot.mjs'
import { DEFAULT_PRESET_QUERY, currentLogo, defaultPreset } from '../../imports/api/common/brandSettings.mjs'
import CONSTANTS from '../../imports/api/common/constants'
import {
  SlatePresentations,
  SlatePresentationConversations,
  Slates,
  OrganizationSettings,
} from '../../imports/api/common/models'
import { PLAN_VERSION, isTrivialLayout, needsPlan, planFailureReason, planKey } from '../../imports/ui/components/presentations/presentationPlan.mjs'
import {
  EMPTY_SLATE, MAX_REFINEMENT_CHARS, TOO_MANY_NOTES,
  PLAN_OUTPUT_TOKENS, planEstimateMicros, planFunctions, planModels, planWithAI, presentationPrompts, reusableDeck, sanitizeLayout, singleFlight,
} from './presentationRequest.mjs'
import { FIXED_PRICES, actionCeilingMicros, aiPrice } from '../metering/prices.mjs'
import { workshopScenes } from '../../imports/ui/components/presentations/workshopScenes.mjs'
import req from './ai/req'
import { keepActionOpen, runAIAction } from '../metering/context.mjs'
import { resolveRequestConnection } from './ai/ai-settings'
import {
  LICENCE_FILTER, MAX_DECK_IMAGES, MAX_DECK_IMAGES_PER_DAY, deckRecord, imageEstimateMicros, ogCardReady, pictureChange, shareCardChange, pictureTime, playerSlateCopy,
  resolveDirectionImages, sanitizeBakedDeck, sanitizeDirectionShape, styleChange,
} from './presentationDeck.mjs'
import { carryImages, composeDeck, normalizeDirection, pendingImages } from '../../imports/ui/components/presentations/presentationCompose.mjs'
import { cleanStyleRef } from '../../imports/ui/components/presentations/presentationStyles.mjs'
import { storedSlateLayout } from './presentationLayout.mjs'
import { promptsKey } from '../ai-control/prompts/index.mjs'

// The largest slate copy a published deck keeps for its live player (characters of JSON).
const MAX_SLATE_JSON = 5_000_000
// The largest picture a deck copies into Slatebox's storage.
const MAX_PICTURE_BYTES = 6 * 1024 * 1024
const today = () => new Date().toISOString().slice(0, 10)

// A searched picture, copied into Slatebox's own storage: a published deck never hotlinks a
// stranger's server (their link may vanish, or count its viewers). Only a public https image
// within the size cap is fetched (safe-fetch.mjs). → url or null
// A published deck's look, made on the server: its direction checked against the layout its
// deck was planned for, its style, and the slate copy the player draws. → null without one.
async function publishedLook({ slateShareId, presentation, presentationData, direction, style, slateJSON: sent }) {
  if (!direction || typeof direction !== 'object' || !Array.isArray(direction.steps)) return null
  const { layout } = sanitizeLayout(presentation.presentationData ?? presentationData)
  if (!layout) return null
  const saved = await Slates.findOneAsync({ shareId: slateShareId }, { fields: { nodes: 1, 'options.name': 1, 'options.viewPort': 1 } })
  // The saved slate, when it has every note the deck shows; otherwise (an edit not saved yet) the
  // editor's own copy, cut down the same way to what the player draws.
  const wanted = []
  const walk = (nodes) => (nodes || []).forEach((node) => { wanted.push(String(node.nodeId)); walk(node.childrenNodes) })
  walk(layout.nodes)
  const covers = (copy) => {
    if (!copy) return false
    const ids = new Set(JSON.parse(copy).nodes.map((node) => String(node.options.id)))
    return wanted.every((id) => ids.has(id))
  }
  let slateJSON = playerSlateCopy(saved)
  if (!covers(slateJSON) && typeof sent === 'string' && sent.length <= MAX_SLATE_JSON) {
    try { slateJSON = playerSlateCopy(JSON.parse(sent)) } catch { slateJSON = null }
  }
  if (!covers(slateJSON) || slateJSON.length > MAX_SLATE_JSON) return null
  const ref = cleanStyleRef(style || direction.style)
  const checked = normalizeDirection(direction, layout, { name: saved?.options?.name || '' })
  return { direction: { ...checked, style: ref }, style: ref, slateJSON }
}

async function copyPicture(link, userId) {
  const image = await fetchPublicImage(link, { maxBytes: MAX_PICTURE_BYTES, timeoutMs: 4000 }).catch(() => null)
  if (!image?.bytes) return null
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[image.contentType] || 'img'
  const now = new Date()
  const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/presentation_${userId}_${Random.id()}.${ext}`
  return storeFile({ body: image.bytes, key, contentType: image.contentType }).catch(() => null)
}

// How many new pictures this person's decks of this slate found today (the daily cap).
async function picturesFoundToday(slateShareId, userId) {
  const rows = await SlatePresentations.find({ slateShareId, userId, imagesDay: today() }, { fields: { imagesFound: 1 } }).fetchAsync()
  return rows.reduce((sum, row) => sum + (Number(row.imagesFound) || 0), 0)
}

/**
 * The deck's pictures: those found before are reused (by query), the rest are searched (licensed
 * for reuse, copied into Slatebox's storage), else generated, within `timeLimitMs`. One counted
 * action covers them, pre-checked by the meter at what they may cost at most; a refusal (no
 * credits) or no image service leaves the style's own art. A picture that arrives late goes to
 * `onLate`. → { direction, found }
 */
async function deckPictures(direction, { user, slateShareId, earlier = [], timeLimitMs, onLate }) {
  const carried = carryImages(direction, earlier)
  const room = Math.min(MAX_DECK_IMAGES, MAX_DECK_IMAGES_PER_DAY - await picturesFoundToday(slateShareId, user._id))
  const wanted = Math.min(pendingImages(carried), Math.max(0, room))
  if (!wanted || !timeLimitMs) return { direction: carried, found: 0 }
  const estimateMicros = imageEstimateMicros(wanted, { prices: { search: FIXED_PRICES.imageSearch, generate: FIXED_PRICES.imageGeneration } })
  return runAIAction({ feature: 'image-search', kind: 'imageSearch', estimateMicros, userId: user._id }, () => resolveDirectionImages(carried, {
    timeLimitMs,
    max: wanted,
    search: (query) => searchGoogleImages({ query, limit: 5, filter: LICENCE_FILTER }),
    copy: (link) => copyPicture(link, user._id),
    generate: (prompt) => generateImagesFor(user, { prompts: [prompt], width: 768, height: 512 }),
    track: keepActionOpen,
    onLate,
  })).catch((error) => {
    console.warn('Presentation pictures were not found:', error?.reason || error?.message)
    return { direction: carried, found: 0 }
  })
}

// A picture that arrived after its deck was saved: kept in the deck (never an orphaned file).
async function keepLatePicture(presentationId, hit) {
  const row = await SlatePresentations.findOneAsync({ _id: presentationId }, { fields: { direction: 1, style: 1, presentationData: 1, imagesDay: 1, imagesFound: 1 } })
  if (!row?.direction?.steps) return
  const direction = carryImages(row.direction, [[hit]])
  if (JSON.stringify(direction) === JSON.stringify(row.direction)) return
  let layout = row.presentationData
  try { layout = typeof layout === 'string' ? JSON.parse(layout) : layout } catch { return }
  const viewpoints = composeDeck(layout, direction, { style: row.style }).steps
  const found = (row.imagesDay === today() ? Number(row.imagesFound) || 0 : 0) + 1
  await SlatePresentations.updateAsync({ _id: presentationId }, { $set: { direction, viewpoints, imagesDay: today(), imagesFound: found } })
}

const method = {}

const publicationChanged = () => new Meteor.Error('stale', 'The published version changed. Reopen this dialog to see the current version.')

// A presentation is made and published only by someone who may edit the slate it presents.
// A slate with a workshop is presented like any other: its lanes open the presentation.
async function guardPresentation(shareId, userId) {
  if (typeof shareId !== 'string' || !shareId) throw new Meteor.Error('invalid-presentation', 'Choose a slate to present.')
  const slate = await Slates.findOneAsync({ shareId }, { fields: { _id: 1, userId: 1, orgId: 1, shareId: 1, options: 1, 'creative.model': 1 } })
  if (!slate || !await canEditSlate(userId, slate)) throw new Meteor.Error('slate-denied', 'You do not have permission to present this slate.')
  return slate
}

const slateWorkshop = slate => slate?.creative?.model?.kind === 'workshop' ? slate.creative.model.workshop : null

// A presentation row is a deck: it has the viewpoints a presenter plays.
const deck = { viewpoints: { $type: 'array' } }

// Rows left by the removed workshop-only publication (`workshop-presentation-<shareId>`) hold no
// deck. They are removed once, at startup; until a deck is published, the slate's /present link
// says the presentation is unavailable.
Meteor.startup(async () => {
  try {
    await SlatePresentations.rawCollection().deleteMany({ _id: { $regex: '^workshop-presentation-' } })
  } catch {
    console.warn('Unable to remove the retired workshop publications')
  }
})

/** A presentation's bar colors: the team's one slate style (the default preset), whatever made the slate. */
function barColors(orgSettings) {
  const style = defaultPreset(orgSettings)?.value || {}
  return {
    presentationMenuBgColorKey: style.presentationMenuBgColorKey || null,
    presentationControlsColorKey: style.presentationControlsColorKey || null,
  }
}

method[CONSTANTS.methods.presentations.get] = async ({
  slateShareId,
  asPublished,
  forPlayback = false,
}) => {
  if (typeof slateShareId !== 'string' || !slateShareId) return null
  let presentationMenuBgColorKey = null
  let presentationControlsColorKey = null
  let logoUrl = null
  if (asPublished) {
    const slateDetails = await Slates.findOneAsync(
      { shareId: slateShareId },
      {
        fields: {
          lastSaved: 1,
          userId: 1,
          orgId: 1,
          shareId: 1,
          options: 1,
        },
      }
    )

    if (slateDetails?.userId) {
      const author = await Meteor.users.findOneAsync(slateDetails.userId, { fields: { orgId: 1 } })
      const orgId = author?.orgId
      // The team's one slate style for the bar colors, and the square logo in use: the newest one
      // not removed (brandSettings.mjs, the same pick as the brand kit page).
      const orgSettings = orgId ? await OrganizationSettings.find({
        orgId,
        $or: [
          { ...DEFAULT_PRESET_QUERY },
          { type: 'logo', 'value.logoType': 'squareLogo' },
        ],
      }).fetchAsync() : []
      const bar = barColors(orgSettings)
      presentationMenuBgColorKey = bar.presentationMenuBgColorKey
      presentationControlsColorKey = bar.presentationControlsColorKey
      logoUrl = currentLogo(orgSettings, 'squareLogo')?.value?.url || null
    }

    // The published presentation of a slate is one made by someone who may edit that slate.
    let presentation = null
    if (slateDetails?.userId) {
      const published = await SlatePresentations.find({
        slateShareId,
        isPublished: true,
        ...deck,
      }, { sort: { updated: -1, timestamp: -1 } }).fetchAsync()
      for (const row of published) {
        if (row.userId === slateDetails.userId || await canEditSlate(row.userId, slateDetails)) {
          presentation = row
          break
        }
      }
    }

    if (!presentation && forPlayback && Meteor.userId()) {
      presentation = await SlatePresentations.findOneAsync({ slateShareId, userId: Meteor.userId(), ...deck }, { sort: { version: -1 } })
    }

    const ret = {
      presentation,
      presentationMenuBgColorKey,
      presentationControlsColorKey,
      logoUrl,
    }

    return ret
  }

  const user = await Meteor.userAsync()
  if (!user) return null
  const presentations = await SlatePresentations.find(
    { slateShareId, userId: user._id, ...deck },
    { sort: { version: -1 } }
  ).fetchAsync()

  const slateDetails = await Slates.findOneAsync(
    { shareId: slateShareId },
    {
      fields: {
        lastSaved: 1,
      },
    }
  )

  const slateHasChangedSincePresentationWasCreated =
    presentations[0]?.timestamp <= slateDetails?.lastSaved

  if (user?.orgId) {
    const orgSettings = await OrganizationSettings.find({ orgId: user.orgId, ...DEFAULT_PRESET_QUERY }).fetchAsync()
    const bar = barColors(orgSettings)
    presentationMenuBgColorKey = bar.presentationMenuBgColorKey
    presentationControlsColorKey = bar.presentationControlsColorKey
  }

  return {
    presentations,
    presentationMenuBgColorKey,
    presentationControlsColorKey,
    slateHasChangedSincePresentationWasCreated,
  }
}

/**
 * The published deck's share card, rendered after the call that needs it: a styled deck's title
 * card in its style (its words as paths, its cover inlined: the renderer has no web fonts and
 * fetches nothing), else the slate's snapshot. It is kept only while `generation` is still the
 * version's (a newer publish or restyle wins); `replaces` (the card it takes the place of) is then
 * removed from storage.
 */
async function renderShareCard(presentationId, generation, { look = null, rawSVG = null } = {}, replaces = null) {
  try {
    const card = look ? await ogCardReady({ direction: look.direction, style: look.style, fetchImage: (url) => fetchPublicImage(url, { maxBytes: MAX_PICTURE_BYTES, timeoutMs: 4000 }) }) : null
    if (!card && !rawSVG) return
    let kept = false
    await finishSnapshot(
      () => svgToPng({
        svg: card || rawSVG,
        fileName: `present_${presentationId}_${generation}`,
        skipTimestamp: true,
        includeWidthHeight: true,
      }),
      async ({ url, width, height }) => {
        const changed = await SlatePresentations.updateAsync(
          { _id: presentationId, isPublished: true, snapshotGeneration: generation },
          { $set: { imageUrl: url, imageWidth: width, imageHeight: height } }
        )
        kept = changed > 0
        return changed
      },
      (url) => discardSnapshot({ _id: presentationId, snapshotGeneration: generation }, url)
    )
    if (kept && replaces?.url) await discardSnapshot({ _id: presentationId, snapshotGeneration: replaces.generation }, replaces.url)
  } catch {
    console.warn('Unable to finish a presentation snapshot')
  }
}

async function discardSnapshot(presentation, url) {
  const key = ownedSnapshotKey(url, storedFileBase(), presentation._id, presentation.snapshotGeneration)
  if (!key) return
  // A previously remixed presentation may still use the same image.
  if (await SlatePresentations.findOneAsync({ isPublished: true, imageUrl: url }, { fields: { _id: 1 } })) return
  try {
    await deleteStoredFile(key)
  } catch {
    // Viewer access is independent of the storage provider's availability.
    console.warn('Unable to remove a withdrawn presentation snapshot from storage')
  }
}

async function withdrawVersion(query) {
  // Atomically detach the image and invalidate every outstanding renderer for this version.
  const previous = await SlatePresentations.rawCollection().findOneAndUpdate(
    query,
    { $unset: { isPublished: '', snapshotGeneration: '', imageUrl: '', imageWidth: '', imageHeight: '' } },
    { returnDocument: 'before', includeResultMetadata: false }
  )
  if (previous?.imageUrl) await discardSnapshot(previous, previous.imageUrl)
}

method[CONSTANTS.methods.presentations.unpublish] = async ({ presentationId }) => {
  const user = await Meteor.userAsync()
  if (!user) return null
  if (typeof presentationId !== 'string') throw publicationChanged()
  await withdrawVersion({ _id: presentationId, userId: user._id, isPublished: true })
  return true
}

method[CONSTANTS.methods.presentations.publish] = async ({
  slateShareId,
  version,
  svg,
  rawSVG,
  background,
  orientData,
  presentationData,
  viewpoints,
  manualViewpointChanges,
  intentionId,
  direction,
  style,
  slateJSON,
}) => {
  const user = await Meteor.userAsync()
  if (!user) return null
  check(slateShareId, String)
  check(slateJSON, Match.Maybe(String))
  check(direction, Match.Maybe(Object))
  check(style, Match.Maybe(Match.OneOf(String, Object)))
  await guardPresentation(slateShareId, user._id)
  const presentation = await SlatePresentations.findOneAsync({
    slateShareId,
    version,
    userId: user._id,
  })
  // console.log('got prezi', presentation)
  if (!presentation) {
    throw new Meteor.Error('presentation-not-found', 'Presentation not found')
  }

  const previousVersions = await SlatePresentations.find(
    { slateShareId, userId: user._id, isPublished: true }, { fields: { _id: 1 } }
  ).fetchAsync()
  for (const previous of previousVersions) {
    await withdrawVersion({ _id: previous._id, userId: user._id, isPublished: true })
  }
  const snapshotGeneration = Random.id()
  const presentationUrl = `${Meteor.settings.public.baseUrl}/present/${slateShareId}`

  // The published deck plays on a live canvas for anyone with the link. What it plays is built
  // here, never taken as sent: the slate copy from the saved slate (only what the player needs),
  // the direction checked against the slate it was planned for (its notes, honest numbers and
  // quotes, safe picture links), and a known style.
  const look = await publishedLook({ slateShareId, presentation, presentationData, direction, style, slateJSON })

  // now set the isPublished flag on this one
  await SlatePresentations.updateAsync(
    { _id: presentation._id },
    {
      $unset: { imageUrl: '', imageWidth: '', imageHeight: '' },
      $set: {
        isPublished: true,
        snapshotGeneration,
        svg,
        intentionId,
        background,
        orientData,
        presentationData,
        viewpoints,
        ...(look ? { direction: look.direction, style: look.style, slateJSON: look.slateJSON } : {}),
        // A style worn on the slate plays its deck over the published slate (which carries the art).
        ...(look && presentation.deck?.version === 5 ? { deck: presentation.deck } : {}),
        url: presentationUrl,
        viewpointsManuallyChanged: manualViewpointChanges, // carry any changes forward
      },
    }
  )

  // Older withdrawn versions kept their image URL until the version was published again.
  if (!presentation.isPublished && presentation.imageUrl) {
    await discardSnapshot(presentation, presentation.imageUrl)
  }

  // async produce the image so it doesn't hold up the publish
  setTimeout(() => renderShareCard(presentation._id, snapshotGeneration, { look, rawSVG }), 100)

  return presentationUrl
}

// The deck Present opens for this person: the version asked for, else their published one, else
// their latest.
async function findDeck({ slate, selectVersion }, user) {
  const query = { slateShareId: slate.shareId, userId: user._id, ...deck }
  if (selectVersion) {
    query.version = selectVersion
  } else {
    query.isPublished = true
  }
  let existingPresentation = await SlatePresentations.findOneAsync(query)
  if (!existingPresentation && !selectVersion) {
    // no published versions yet, so we need to return the most recent version
    existingPresentation = await SlatePresentations.findOneAsync(
      { slateShareId: slate.shareId, userId: user._id, ...deck },
      {
        sort: { version: -1 },
      }
    )
  }
  return existingPresentation
}

async function loadPresentation({ slate, selectVersion }) {
  const user = await Meteor.userAsync()
  if (!user) return null
  const existingPresentation = await findDeck({ slate, selectVersion }, user)
  // Another editor's decks are theirs: this person has none to load yet.
  if (!existingPresentation) return null
  return {
    presentationId: existingPresentation._id,
    version: existingPresentation.version,
    viewpoints: existingPresentation.viewpoints,
    automatic: existingPresentation.automatic === true,
    // Its look: the art direction and style the presenter composes it in.
    direction: existingPresentation.direction ?? null,
    style: existingPresentation.style ?? null,
    // A worn style's deck (version 5): the camera over the slate's own notes and art. Without it
    // Present would compose the direction again over the styled slate, art and all.
    deck: existingPresentation.deck ?? null,
  }
}

method[CONSTANTS.methods.presentations.load] = async ({
  slate,
  selectVersion,
}) => {
  const user = await Meteor.userAsync()
  if (!user) return null
  return loadPresentation({ slate, selectVersion })
}

// The deck this person already has, when Present should open it as it is (a current AI plan of
// the slate as it is now, a published deck, one they edited): opening it runs no model, so it is
// not counted. Null when Present plans the slate (see needsPlan).
async function keptDeck(args, user, layout) {
  if (args?.refinementMessage) return null
  const current = await findDeck(args, user)
  return needsPlan(current, layout, { prompts: promptsKey('presentation') }) ? null : loadPresentation(args)
}

const userNameOf = (user) => {
  if (user?.isAnonymous) return 'Guest'
  const name = `${user?.profile?.firstName} ${user?.profile?.lastName}`.replace(/undefined/gi, '').trim()
  return name || user?.emails?.[0]?.address?.split('@')[0] || 'Someone'
}

// Plan the slate (or refine this person's plan) with the AI, and save the deck. `layout` is the
// kept layout (presentationRequest.mjs): it is what the AI is sent and what its plan is checked
// against. The AI's request is the only counted part (runAIAction): a plan it could not make is
// given back, and the person gets the grouped automatic plan with the reason. `counted(estimate)`
// is the method's runAIAction for that request. A plan made without a browser (presentations.create)
// may carry the person's `brief`, saves no layout key (the browser's layout of the same slate is
// measured from another origin, so Present keeps the deck while its notes are the slate's), and,
// with `persist` false (a preview), is returned without being saved or pictured.
async function analyzePresentation(args, user, stored, layout, counted, { brief = '', persist = true, keyed = true } = {}) {
  const started = Date.now()
  const {
    slate, refinementMessage, slateChanged, showNarrative, hideMenuOnPublish, autoplayOnPublish, isPublic = false,
  } = args
  const scenes = workshopScenes(slateWorkshop(stored))
  const refining = Boolean(refinementMessage)
  // This person's decks: a new plan is their next version (an automatic one replaces their
  // automatic deck, see reusableDeck).
  const latestDeck = await SlatePresentations.findOneAsync(
    { slateShareId: slate.shareId, userId: user._id, ...deck },
    { sort: { version: -1 }, fields: { version: 1, automatic: 1, isPublished: 1, viewpointsManuallyChanged: 1, direction: 1, imagesDay: 1, imagesFound: 1 } }
  )
  // A person's conversation with the model about their plan: a new plan starts a new one, a
  // refinement continues it. Another editor's conversation is theirs.
  const conversation = { slateShareId: slate.shareId, userId: user._id }
  const history = refining ? await SlatePresentationConversations.find(conversation).fetchAsync() : []

  const prompts = presentationPrompts({ layout, scenes, isTemplate: Boolean(slate.isTemplate) })
  const intention = prompts.settingsFor(slate.intentionId)
  // A conversation keeps the system text it was planned with, so a refinement is planned as the plan
  // was; a new plan takes the published prompts (server/ai-control/prompts/presentation.mjs), and
  // keeps which versions they were (systemPromptRef).
  const kept = history.find((row) => row.systemPrompt)
  const intentionArgs = { intentionId: slate.intentionId, isTemplate: Boolean(slate.isTemplate) }
  const systemPrompt = kept?.systemPrompt ?? prompts.systemFor(intentionArgs)
  const systemPromptRef = kept ? kept.systemPromptRef ?? null : prompts.systemRefFor(intentionArgs)
  const asked = String(brief || '').trim().slice(0, MAX_REFINEMENT_CHARS)
  const userText = asked ? prompts.withBrief(asked) : prompts.user
  const initPrompt = { role: 'user', content: [{ type: 'text', text: userText, cache_control: { type: 'ephemeral' } }] }
  const refinePrompt = refining && {
    role: 'user',
    content: [{
      type: 'text',
      text: prompts.refinement(String(refinementMessage).slice(0, MAX_REFINEMENT_CHARS), slateChanged),
    }],
  }
  const earlier = history.filter((row) => row.prompt).map((row) => row.prompt)
  const promptsToSend = refining ? [...(earlier.length ? earlier : [initPrompt]), refinePrompt] : [initPrompt]

  // Priced at the model that will serve the plan: the presentation part's model in Admin → AI
  // control, or the person's own connection. A route that cannot be resolved is priced at the
  // dearest rate; req.js resolves it again and says what is wrong.
  const chosen = await resolveRequestConnection({ feature: 'presentation', request: { tools: true }, userId: user._id }).catch(() => null)
  const estimateMicros = planEstimateMicros(
    systemPrompt.length + JSON.stringify(promptsToSend).length,
    planModels({ chosen }).map((model) => aiPrice(model, chosen?.scope === 'server' ? { provider: chosen.provider } : null))
  )
  const tooLong = estimateMicros > actionCeilingMicros('presentation')
  if (tooLong && refining) {
    throw new Meteor.Error('presentation-too-long', 'This presentation\'s conversation is too long to refine. Close the presenter and press Present to plan it again.')
  }

  // One model, within the plan's time: no second model after the first (there is no time for
  // it), every attempt stopped at the deadline, and the answer capped at what a plan needs.
  const reqOpts = {
    system: systemPrompt,
    prompts: promptsToSend,
    functions: planFunctions(),
    function_call: { name: 'createPresentation' },
    feature: 'presentation',
    // Named, so a plan made outside a Meteor method (presentations.create) is the person's too.
    userId: user._id,
    maxTokens: PLAN_OUTPUT_TOKENS,
  }
  const planned = await planWithAI({
    run: tooLong
      ? async () => { throw new Error(TOO_MANY_NOTES) }
      : counted(estimateMicros),
    request: ({ deadline } = {}) => req({ ...reqOpts, deadline, timeoutMs: deadline ? Math.max(1000, deadline - Date.now()) : undefined }),
    layout,
    name: slate.name,
    scenes,
    refining,
  }).catch((error) => {
    throw new Meteor.Error(error.error || 'analyze-presentation-failed', planFailureReason(error), error.details)
  })

  const { automatic, plan } = planned
  if (!Array.isArray(plan?.viewpoints) || plan.viewpoints.length === 0) {
    throw new Meteor.Error('invalid-presentation-plan', 'There is nothing on this slate to present yet.')
  }
  // The deck: the AI's art direction (or the local one when the AI could not plan), the
  // workshop's lanes first, composed in its style. Its pictures are searched for, else generated,
  // within a few seconds; a picture neither finds is the style's own art (a guest, no credits, no
  // key, no network). The model and the image connections come from settings, never from here.
  // A workshop (its lanes are drawn by the host) and a slate of one or two notes play over the
  // slate's SVG: their plan is kept as planned, with no style.
  const styled = !scenes.length && !isTrivialLayout(layout)
  let record = styled
    ? deckRecord({ layout, direction: automatic ? null : plan.direction, name: slate.name, scenes })
    : { viewpoints: plan.viewpoints, direction: null, style: null }
  // Pictures for every styled deck a signed-in person makes, the AI's or Slatebox's own: the
  // pictures this person's last deck found are reused; the rest are found within the time left.
  const imageTime = pictureTime(Date.now() - started)
  let foundImages = 0
  const late = { id: null, hits: [] }
  if (persist && styled && record.direction && !user.isAnonymous) {
    const pictured = await deckPictures(record.direction, {
      user,
      slateShareId: slate.shareId,
      earlier: latestDeck?.direction ? [latestDeck.direction] : [],
      timeLimitMs: imageTime,
      onLate: (hit) => {
        late.hits.push(hit)
        if (late.id) keepLatePicture(late.id, hit).catch(() => {})
      },
    })
    foundImages = pictured.found
    record = { ...record, direction: pictured.direction, viewpoints: composeDeck(layout, pictured.direction, { style: record.style }).steps }
  }
  const { viewpoints, direction, style } = record
  const imagesFound = foundImages + (latestDeck?.imagesDay === today() ? Number(latestDeck.imagesFound) || 0 : 0)
  const name = String(plan?.name || '').trim() || `${slate.name || 'Slate'} presentation`
  const description = String(plan?.description || '').trim()
  const saveShowNarrative = showNarrative ?? intention.showNarrative ?? true
  const saveHideMenuOnPublish = hideMenuOnPublish ?? intention.hideMenuOnPublish ?? false
  const saveAutoplayOnPublish = autoplayOnPublish ?? intention.autoplayOnPublish ?? false
  const presentationData = JSON.stringify(layout)
  const now = new Date()
  const layoutKey = keyed ? planKey(layout) : null
  // the planning prompts' versions it was made with: a publish or rollback plans the slate again
  const promptsKeyNow = keyed ? promptsKey('presentation') : null
  if (!persist) {
    return { presentationId: null, version: null, name, description, viewpoints, direction, style, automatic,
      ...(automatic && { reason: planned.reason }), ...(planned.trivial && { trivial: true }) }
  }

  // Presses while the AI is unavailable replace the person's automatic deck instead of adding
  // versions; a plan the AI made is a new version.
  const replace = automatic ? reusableDeck(latestDeck) : null
  let presentationId
  let version
  if (replace) {
    presentationId = replace._id
    version = replace.version
    await SlatePresentations.updateAsync({ _id: replace._id }, {
      $set: { timestamp: Date.now(), presentationData, name, description, viewpoints, direction, style, automatic: true, planVersion: PLAN_VERSION, layoutKey, promptsKey: promptsKeyNow, updated: now, imagesDay: today(), imagesFound },
    })
  } else {
    version = (latestDeck?.version || 0) + 1
    presentationId = await SlatePresentations.insertAsync({
      slateShareId: slate.shareId,
      timestamp: Date.now(),
      version,
      showNarrative: saveShowNarrative,
      hideMenuOnPublish: saveHideMenuOnPublish,
      autoplayOnPublish: saveAutoplayOnPublish,
      isPublic: isPublic ?? false,
      playOnHover: false,
      presentationData,
      name,
      description,
      viewpoints,
      direction,
      style,
      imagesDay: today(),
      imagesFound: foundImages,
      // Made without the AI (no provider key, no allowance): the presenter rebuilds it from the
      // slate as it is, and Present plans the slate again next time.
      automatic,
      planVersion: PLAN_VERSION,
      // The slate this plan was made for: Present on the same slate opens it at once (needsPlan).
      layoutKey,
      promptsKey: promptsKeyNow,
      userId: user._id,
      orgId: user.orgId,
      author: userNameOf(user),
      created: now,
      updated: now,
    })
  }

  // Pictures that arrive after the deck was saved are kept in it.
  late.id = presentationId
  late.hits.forEach((hit) => keepLatePicture(presentationId, hit).catch(() => {}))

  // The conversation is kept only for a plan the AI made, so it can be refined.
  if (!automatic) {
    const { response, toolUse } = planned
    const answer = toolUse
      ? [
          { role: 'assistant', content: response.json.content },
          { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse.id, content: 'Viewpoints received.' }] },
        ]
      : [
          { role: 'assistant', content: JSON.stringify(plan) },
          { role: 'user', content: 'Viewpoints received.' },
        ]
    if (!refining) {
      await SlatePresentationConversations.removeAsync(conversation)
      await SlatePresentationConversations.insertAsync({
        ...conversation, version, systemPrompt, systemPromptRef,
        showNarrative: saveShowNarrative, hideMenuOnPublish: saveHideMenuOnPublish, autoplayOnPublish: saveAutoplayOnPublish, playOnHover: false,
      })
    }
    // What was asked this time: the opening request, and the refinement when there is one.
    const sent = promptsToSend.slice(earlier.length)
    await SlatePresentationConversations.rawCollection().insertMany(
      [...sent, ...answer].map((prompt) => ({ ...conversation, version, prompt }))
    )
  }

  return {
    presentationId,
    version,
    name,
    description,
    viewpoints,
    direction,
    style,
    automatic,
    // a refusal by the meter says which, with the pay sheet's action (the banner offers it)
    ...(automatic && { reason: planned.reason, ...(planned.pay && { code: planned.code, pay: planned.pay }) }),
    ...(planned.trivial && { trivial: true }),
  }
}

// Present: the deck this person keeps, or a new plan. The layout is checked and capped before
// anything else (presentationRequest.mjs): an empty slate is not planned or counted, a slate too
// large for the AI gets the automatic plan, and two presses at once share one plan.
method[CONSTANTS.methods.presentations.analyze] = async (args) => {
  const user = await Meteor.userAsync()
  if (!user) return null
  check(args?.slate, Match.ObjectIncluding({ shareId: String }))
  check(args.refinementMessage, Match.Maybe(String))
  const stored = await guardPresentation(args.slate.shareId, user._id)
  const { layout, count, tooMany } = sanitizeLayout(args.presentationData)
  if (tooMany) return { automatic: true, viewpoints: [], reason: TOO_MANY_NOTES }
  if (!count) return { empty: true, automatic: true, viewpoints: [], reason: EMPTY_SLATE }
  const kept = await keptDeck(args, user, layout)
  if (kept) return kept
  // The AI's request is counted like any other (its estimate worked out from its prompt).
  const counted = (estimateMicros) => (fn) => runAIAction({ feature: 'presentation', estimateMicros }, fn)
  return singleFlight(`${user._id}:${args.slate.shareId}`, () => analyzePresentation(args, user, stored, layout, counted))
}

// presentations.create (the create_presentation tool, exec and the API): Present's plan, made on
// the server from the slate as it is stored, for someone who may edit it (the Present button's
// rule). The AI's request is counted like Present's, for the person behind the token. Always a
// new plan: the person asked for one. `style` and `palette` play it in that style (the AI's art
// direction composed again, as presentations.setStyle does). A preview plans and composes the
// deck and saves nothing. → { row, empty?, tooMany?, reason? }
export async function createPresentationFor({ userId, shareId, brief = '', style = null, palette = null, preview = false }) {
  const user = userId ? await Meteor.users.findOneAsync(userId) : null
  if (!user) throw new Meteor.Error('sign_in', 'Sign in to present this slate.')
  const stored = await guardPresentation(shareId, user._id)
  const slate = await Slates.findOneAsync({ _id: stored._id }, { fields: { _id: 1, shareId: 1, options: 1, nodes: 1, creative: 1, boards: 1 } })
  const { layout, count, tooMany } = sanitizeLayout(storedSlateLayout(slate))
  if (tooMany) return { tooMany: true, reason: TOO_MANY_NOTES }
  if (!count) return { empty: true, reason: EMPTY_SLATE }
  const args = {
    slate: {
      shareId: slate.shareId,
      intentionId: slate.options?.ai?.isConversation?.intentionInitialData?.intentionId,
      isTemplate: slate.options?.basedOnTemplate,
      name: slate.options?.name,
    },
  }
  const counted = (estimateMicros) => (fn) => runAIAction({ feature: 'presentation', estimateMicros, userId: user._id }, fn)
  const made = await singleFlight(`${user._id}:${slate.shareId}:create`, () =>
    analyzePresentation(args, user, stored, layout, counted, { brief, persist: !preview, keyed: false }))
  let row = { _id: made.presentationId, version: made.version, name: made.name, isPublished: false,
    viewpoints: made.viewpoints, direction: made.direction, style: made.style, presentationData: layout }
  if (style && row.direction?.steps) {
    const change = styleChange(row, palette ? { id: style, overrides: { palette } } : { id: style })
    if (change) {
      if (!preview) await SlatePresentations.updateAsync({ _id: row._id }, { $set: change })
      row = { ...row, ...change }
    }
  }
  return { row, automatic: made.automatic, trivial: Boolean(made.trivial), reason: made.reason || '' }
}

method[CONSTANTS.methods.presentations.update] = async ({
  presentationId,
  showNarrative,
  viewpoints,
  updatedViewpoint,
  deletedViewpoint,
  autoplayOnPublish,
  isEmbedded,
  playOnHover,
  isPublic,
  style,
  deck,
  direction,
  picture,
  revert,
}) => {
  const user = await Meteor.userAsync()
  if (!user) return null
  check(picture, Match.Maybe({ slot: Match.Integer, action: Match.OneOf('art', 'next') }))
  check(deck, Match.Maybe(Object))
  check(revert, Match.Maybe(Match.ObjectIncluding({ deck: Object })))
  if (revert && JSON.stringify(revert).length > 800_000) throw new Meteor.Error('presentation-deck', 'That presentation is too large to save.')
  check(direction, Match.Maybe(Object))
  if (deck && JSON.stringify(deck).length > 400_000) throw new Meteor.Error('presentation-deck', 'That presentation is too large to save.')

  // first check to see if any SlatePresentations exist for this slate
  const existingPresentation = await SlatePresentations.findOneAsync({
    _id: presentationId,
    userId: user._id,
  })

  if (!existingPresentation) {
    throw new Meteor.Error('presentation-not-found', 'Presentation not found')
  }

  const viewpointsManuallyChanged =
    existingPresentation.viewpointsManuallyChanged || {
      deleted: [],
      updated: [],
    }

  // console.log(
  //   'got presentation',
  //   JSON.stringify(existingPresentation, null, 2),
  //   viewpointsManuallyChanged
  // )

  if (updatedViewpoint) {
    // if the updatedviewpoint nodeIds matches what is already saved in the manually changed viewpoints,
    // then we should update the existing viewpoint
    const existingViewpoint = viewpointsManuallyChanged.updated.find((ee) =>
      ee.nodeIds.every((nodeId) => updatedViewpoint.nodeIds.includes(nodeId))
    )
    if (existingViewpoint) {
      existingViewpoint.duration = updatedViewpoint.duration
      existingViewpoint.narrative = updatedViewpoint.narrative
      if (Number.isFinite(updatedViewpoint.x)) {
        existingViewpoint.x = updatedViewpoint.x
      }
      if (Number.isFinite(updatedViewpoint.y)) {
        existingViewpoint.y = updatedViewpoint.y
      }
      if (updatedViewpoint.width) {
        existingViewpoint.width = updatedViewpoint.width
      }
      if (updatedViewpoint.height) {
        existingViewpoint.height = updatedViewpoint.height
      }
      console.log('existingViewpoint updated', { nodes: existingViewpoint.nodeIds?.length ?? 0, narrativeLength: existingViewpoint.narrative?.length ?? 0 })
    } else {
      const newViewpoint = {
        nodeIds: updatedViewpoint.nodeIds,
        duration: updatedViewpoint.duration,
        narrative: updatedViewpoint.narrative,
      }
      if (Number.isFinite(updatedViewpoint.x)) {
        newViewpoint.x = updatedViewpoint.x
      }
      if (Number.isFinite(updatedViewpoint.y)) {
        newViewpoint.y = updatedViewpoint.y
      }
      if (updatedViewpoint.width) {
        newViewpoint.width = updatedViewpoint.width
      }
      if (updatedViewpoint.height) {
        newViewpoint.height = updatedViewpoint.height
      }
      viewpointsManuallyChanged.updated.push(newViewpoint)
    }
  }
  if (deletedViewpoint) {
    // if the deletedViewpoint nodeIds matches what is already saved in the manually changed viewpoints,
    // then we should remove the existing viewpoint
    const viewpointAlreadyDeleted = viewpointsManuallyChanged.deleted.find(
      (ee) =>
        ee.nodeIds.every((nodeId) => deletedViewpoint.nodeIds.includes(nodeId))
    )
    if (!viewpointAlreadyDeleted) {
      viewpointsManuallyChanged.deleted.push({
        nodeIds: deletedViewpoint.nodeIds,
      })
    }
  }

  const updateFields = {}

  if (showNarrative != null) {
    updateFields.showNarrative = showNarrative
  }
  // A one-click style switch: the same direction composed in the new style. The steps stay the
  // same notes in the same order; no AI is asked and nothing is counted.
  // Worn on the slate ("Wear this style"): the browser put the style on the slate itself (one undo
  // step, saved with the slate) and sends the deck that plays it: camera steps over the slate's own
  // notes. Kept as sent, made safe; the direction is checked as any is.
  const worn = style != null && deck != null ? sanitizeBakedDeck(deck) : null
  if (style != null && deck != null && !worn) throw new Meteor.Error('presentation-deck', 'That presentation could not be saved. Choose the style again.')
  if (worn) {
    const shaped = sanitizeDirectionShape(direction)
    Object.assign(updateFields, {
      style: cleanStyleRef(style),
      deck: worn,
      ...(shaped ? { direction: { ...shaped, style: cleanStyleRef(style) } } : {}),
      viewpoints: worn.steps.map(({ nodeIds, narrative, duration }) => ({ nodeIds, narrative, duration })),
    })
  } else if (revert) {
    // "Revert to original": the slate went back to the original it kept when it first wore a style
    // (presentationBake.revertToOriginal), and the deck goes back to the one it played then: its
    // style (or none), its direction and the camera over the slate as it is again.
    const back = sanitizeBakedDeck(revert.deck)
    if (!back) throw new Meteor.Error('presentation-deck', 'That presentation could not be reverted. Try again.')
    const shaped = sanitizeDirectionShape(revert.direction)
    const was = revert.style && typeof revert.style === 'object' && typeof revert.style.id === 'string' ? cleanStyleRef(revert.style) : null
    Object.assign(updateFields, {
      style: was,
      deck: back,
      ...(shaped ? { direction: { ...shaped, ...(was ? { style: was } : {}) } } : {}),
      viewpoints: back.steps.map(({ nodeIds, narrative, duration }) => ({ nodeIds, narrative, duration })),
    })
  } else if (style != null) {
    const change = styleChange(existingPresentation, style)
    if (!change) throw new Meteor.Error('presentation-unstyled', 'This presentation has no art direction to restyle. Press Present to plan it again.')
    Object.assign(updateFields, change)
  }
  // A person's choice of a picture before publishing: the style's own art there, or another
  // picture for the same reason (a search, counted like any).
  let pictured = null
  if (picture) {
    const change = () => pictureChange(existingPresentation, picture, {
      search: (query, page) => searchGoogleImages({ query, limit: 5, page, filter: LICENCE_FILTER }),
      copy: (link) => copyPicture(link, user._id),
    })
    // Only another picture is searched for (and counted); drawn art costs nothing.
    pictured = picture.action === 'next' ? await runAIAction({ feature: 'image-search', kind: 'imageSearch' }, change) : await change()
    if (!pictured) throw new Meteor.Error('picture-unavailable', picture.action === 'next' ? 'No other picture was found for this step. Try drawn art instead.' : 'That picture is no longer in this presentation.')
    Object.assign(updateFields, pictured)
  }
  if (viewpoints) {
    updateFields.viewpoints = viewpoints
    // A sequence someone has edited is theirs, no longer the automatic one.
    updateFields.automatic = false
  }
  if (isEmbedded != null) {
    updateFields.isEmbedded = isEmbedded
  }
  if (playOnHover != null) {
    updateFields.playOnHover = playOnHover
  }
  if (autoplayOnPublish != null) {
    updateFields.autoplayOnPublish = autoplayOnPublish
  }
  if (isPublic != null) {
    updateFields.isPublic = isPublic
  }
  if (playOnHover != null) {
    updateFields.playOnHover = playOnHover
  }
  if (autoplayOnPublish != null) {
    updateFields.autoplayOnPublish = autoplayOnPublish
  }

  if (
    viewpointsManuallyChanged.deleted.length > 0 ||
    viewpointsManuallyChanged.updated.length > 0
  ) {
    updateFields.viewpointsManuallyChanged = viewpointsManuallyChanged
  }

  // A published version whose look changes (another style, another picture) gets a new share card:
  // a new generation, so a card still rendering for the old look is never kept.
  const recard = shareCardChange(existingPresentation, updateFields, Random.id())
  if (recard) updateFields.snapshotGeneration = recard.generation

  if (Object.keys(updateFields).length > 0) {
    await SlatePresentations.updateAsync(
      { _id: presentationId },
      { $set: updateFields }
    )
  }
  if (recard) setTimeout(() => renderShareCard(presentationId, recard.generation, { look: recard.look }, recard.replaces), 100)

  // A picture change gives back the deck's new direction for the presenter to play.
  return pictured ? { ...viewpointsManuallyChanged, direction: pictured.direction } : viewpointsManuallyChanged
}

Meteor.methods(method)
