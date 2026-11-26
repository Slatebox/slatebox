import { Mongo } from 'meteor/mongo'

const Organizations = new Mongo.Collection('organizations')
const Collaboration = new Mongo.Collection('collaboration')
const Slates = new Mongo.Collection('slates')
const Collaborators = new Mongo.Collection('collaborators')
const OrganizationSettings = new Mongo.Collection('organizationSettings')

// Audit
const Audit = new Mongo.Collection('audit')
const Messages = new Mongo.Collection('messages')
const Comments = new Mongo.Collection('comments')

const StripeEvents = new Mongo.Collection('stripeEvents')

const Claims = new Mongo.Collection('claims')
const SlateAccess = new Mongo.Collection('slateAccess')
const Permissions = new Mongo.Collection('permissions')
const FeaturedSlates = new Mongo.Collection('featuredSlates')
const SlateSnapshots = new Mongo.Collection('slateSnapshots')
const Tags = new Mongo.Collection('tags')

const NounProjectResults = new Mongo.Collection('nounProjectResults')
const NounProjectResultsMetaData = new Mongo.Collection(
  'nounProjectResultsMetaData'
)
const PricingTiers = new Mongo.Collection('pricingTiers')
const GuestViews = new Mongo.Collection('guestViews')
const OrgPreferences = new Mongo.Collection('orgPreferences')
const ArchivedSlates = new Mongo.Collection('archivedSlates')
const ApprovalRequests = new Mongo.Collection('approvalRequests')

const CachedImages = new Mongo.Collection('cachedImages')
const IconPacks = new Mongo.Collection('iconPacks')
const AIContent = new Mongo.Collection('aiContent')
const AIAudit = new Mongo.Collection('aiAudit')
const UnicornFodder = new Mongo.Collection('unicornFodder')
const SystemSettings = new Mongo.Collection('systemSettings')
const VideoHelpGuides = new Mongo.Collection('videoHelpGuides')
const UserPersonalities = new Mongo.Collection('userPersonalities')
const VideoHelpGuideLikes = new Mongo.Collection('videoHelpGuideLikes')
const LoginLinks = new Mongo.Collection('loginLinks')
const CodeRepositories = new Mongo.Collection('codeRepositories')
const APILinks = new Mongo.Collection('apiLinks')
const Transcripts = new Mongo.Collection('transcripts')
const SlatePresentations = new Mongo.Collection('slatePresentations')
const SlatePresentationConversations = new Mongo.Collection(
  'slatePresentationConversations'
)
const SlateApiTokens = new Mongo.Collection('slateApiTokens')
const SlateOperationRuns = new Mongo.Collection('slateOperationRuns')
// Agents on the canvas: one record per agent run and slate, written by the server only
// (server/presence/agentPresence.mjs) and published to whoever may read the slate.
const AgentPresence = new Mongo.Collection('agentPresence')
// Agent tasks: the work people and agents hand to agents on a slate (server/agents).
const AgentTasks = new Mongo.Collection('agentTasks')
// What agents suggest on a slate (server/agents/suggestions.mjs), as agentSuggestions.forSlate publishes it.
const AgentSuggestions = new Mongo.Collection('agentSuggestions')

export {
  Organizations,
  Collaboration,
  Slates,
  Collaborators,
  OrganizationSettings,
  Claims,
  Permissions,
  FeaturedSlates,
  NounProjectResults,
  NounProjectResultsMetaData,
  PricingTiers,
  Tags,
  Audit,
  Messages,
  SlateAccess,
  GuestViews,
  OrgPreferences,
  ArchivedSlates,
  Comments,
  ApprovalRequests,
  SlateSnapshots,
  StripeEvents,
  CachedImages,
  IconPacks,
  AIContent,
  AIAudit,
  UnicornFodder,
  SystemSettings,
  UserPersonalities,
  VideoHelpGuides,
  VideoHelpGuideLikes,
  LoginLinks,
  CodeRepositories,
  APILinks,
  Transcripts,
  SlatePresentations,
  SlatePresentationConversations,
  SlateApiTokens,
  SlateOperationRuns,
  AgentPresence,
  AgentTasks,
  AgentSuggestions,
}

// Metering, wallets, own keys and calls (server/metering). ProviderKeys is never published.
const MeterEvents = new Mongo.Collection('meterEvents')
const MeterTotals = new Mongo.Collection('meterTotals')
const Wallets = new Mongo.Collection('wallets')
const WalletLedger = new Mongo.Collection('walletLedger')
const ProviderKeys = new Mongo.Collection('providerKeys')
const HuddleCalls = new Mongo.Collection('huddleCalls')
// Which AI connection each feature uses, per person, team and server (server/methods/ai/ai-settings.js). Never published.
const AIChoices = new Mongo.Collection('aiChoices')

export { MeterEvents, MeterTotals, Wallets, WalletLedger, ProviderKeys, HuddleCalls, AIChoices }

// The shared library (server/library): items (smart components, slates, presentations), their
// immutable versions, and each item's thread and audit. Written by the server only; read through
// the library.* actions, never published as collections.
const LibraryItems = new Mongo.Collection('libraryItems')
const LibraryVersions = new Mongo.Collection('libraryVersions')
const LibraryEvents = new Mongo.Collection('libraryEvents')

export { LibraryItems, LibraryVersions, LibraryEvents }

// About you (server/profile): the facts a person keeps about themselves and their personalization
// switches. Each person's own; written and read through the profile.* actions only, never published.
const PersonalFacts = new Mongo.Collection('personalFacts')
const PersonalSettings = new Mongo.Collection('personalSettings')

export { PersonalFacts, PersonalSettings }

// AI control (server/ai-control): providers, models, the one choice per part of Slatebox, agents
// and prompts an administrator manages at runtime, the global switch, and the append-only audit
// trail of every change. The providers' keys are in providerKeys (kind 'key'). Never published to
// clients; server/ai-control/store.mjs is the only writer (keys.mjs for keys).
const AIProviders = new Mongo.Collection('aiProviders')
const AIModels = new Mongo.Collection('aiModels')
const AIBindings = new Mongo.Collection('aiBindings')
const AIAgents = new Mongo.Collection('aiAgents')
const AIPrompts = new Mongo.Collection('aiPrompts')
const AIPromptVersions = new Mongo.Collection('aiPromptVersions')
const AIControlState = new Mongo.Collection('aiControlState')
const AIControlAudit = new Mongo.Collection('aiControlAudit')

export {
  AIProviders, AIModels, AIBindings, AIAgents, AIPrompts, AIPromptVersions, AIControlState, AIControlAudit,
}
