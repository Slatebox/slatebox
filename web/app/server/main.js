import { Meteor } from 'meteor/meteor'
// the in-app pay sheet's public settings, checked before any browser loads (pay-settings.mjs), and
// the Cloud lock: payments and the meter run only on Slatebox Cloud by its signed key (cloud-lock.mjs)
import './pay-settings-startup'
// The launch plan's, pipeline's and budget's rules, plugged into the workshop model's one gate
// before any method reads a board (the browser loads the same modules with the board kits).
import 'slateboxjs/workshops/rules'
// A board's rulebook (how it behaves, as data) and the library of what can be added, read by every
// method that reads a board or an add request ("Add a retro").
import 'slateboxjs/workshops/behaviour'
import '../imports/api/common/library.mjs'
import { engineIdentity } from './engine-identity.mjs'
import { WebApp } from 'meteor/webapp'
import { exitOnTerminate } from './shutdown.mjs'

// A rollout's SIGTERM stops this server promptly (node runs as PID 1 in the image, which ignores signals it does not handle).
// `meteor run` restarts its server the same way on every server edit: no drain wait there.
exitOnTerminate({ server: WebApp.httpServer, drainMs: Meteor.isProduction ? 1000 : 0 })

// Which engine build this server runs: the commit its dist was built from (dist/BUILD.json; Meteor resolves by path).
console.log(engineIdentity(() => require('slateboxjs/dist/BUILD.json')))

// refuse Mongo operators and unsafe field names in every method and publication argument
import './argument-guard'

// The enterprise/ code (outside agent connections: integrations, free everywhere), registered before
// any module builds the action registry: on every self-hosted install whose build carries it, and on
// Slatebox Cloud by Cloud's key (server/enterprise-loader.mjs).
import './enterprise'

// global methods
import './methods/users'
import './methods/slates'
import './methods/workshops'
import './methods/creative-slates'
import './methods/first-slate'
import './methods/native-conversation'
import './methods/canvas-conversation'
// the interview in About you: the agent gets to know the person's work (server/interview/core.mjs)
import './methods/interview'
// voice: talking with the agent, full duplex, through the relay at /voice/ws (server/voice)
import './voice/meteor'
// learning from a connected tool in About you (server/profile/sources-core.mjs)
import './methods/profile-sources'
import './methods/excalidraw-share'
import './agents/meteor'
import './agents/suggestions-meteor'
import './methods/workshop-rooms'
import './methods/colors'
import './methods/nounProject'
import './methods/collaborators'
import './methods/utils'
import './methods/organizations'
import './methods/team-member-slates'
import './methods/organizationSettings'
import './methods/slateAccess'
import './methods/chatWoot'
import './methods/comments'
import './methods/messages'
import './methods/wallet'
import './methods/business'
import './methods/cloudLinks'
import './methods/daily'
import './methods/iconPacks'
import './methods/openai'
import './methods/stabilityai'
import './methods/auth'
import './methods/videoHelpGuides'
import './methods/images'

// the meter for AI and calls, own keys and the shared budget
import './metering/meteor'
// Server admin: admin.status and the admin home's Overview (server/admin/meteor.js)
import './admin/meteor'
// The header's Move to Cloud on a self-hosted install: move the team to Slatebox Cloud
import './selfhost-options/meteor'
import './agent-reach/sov-meteor' // share of voice: the weekly job (Cloud) and its admin methods

// AI control: the snapshot of providers, models, bindings and prompts administrators manage at runtime
import './ai-control/index.mjs'

// stripe hooks (Slatebox Pro, top-ups, refunds, disputes; with them the Pro methods)
import './stripeHooks'

// user hooks (for embedding and API calls)
import './apiHooks'

// github hooks
// import './githubHooks'

// global models
import '../imports/api/common/models'

// global publications
import './publications'

// startup code
import './startup'

// permissions
import './permissions'

// sbimages
import './sbImages'

// manage heartbeats
import './heartbeats/manage'

// tts hooks for text to speech

// tts hooks for text to speech

// presentations methods
import './methods/presentations'
// Custom shapes: the AI feature `shape`, the shape library and its methods.
import './shapes/meteor'

// a self-hosted server's setup link: nobody signs up until its first admin exists (Cloud: off)
import './self-host-setup/meteor'
// Admin › Updates: update checks against the signed GitHub feed (self-hosted only)
import './updates/meteor'
// single sign-on (off unless settings.sso.enabled; see server/sso)
import './sso'
