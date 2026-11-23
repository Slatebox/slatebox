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
const Themes = new Mongo.Collection('themes')
const PrivateThemes = new Mongo.Collection('privateThemes')
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
const CachedImageTiming = new Mongo.Collection('cachedImageTiming')
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
const ChatIntentions = new Mongo.Collection('chatIntentions')
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
  Themes,
  PrivateThemes,
  SlateSnapshots,
  StripeEvents,
  CachedImages,
  CachedImageTiming,
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
  ChatIntentions,
  SlatePresentations,
  SlatePresentationConversations,
  SlateApiTokens,
  SlateOperationRuns,
  AgentPresence,
  AgentTasks,
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
