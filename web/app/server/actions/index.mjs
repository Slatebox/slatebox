// Every action the app serves. A package adds its actions here, one file per action.
import { createRegistry } from './registry.mjs'
import { slateComponents } from './slate-schemas.mjs'
import { API_TOKEN_SCOPES } from '../api-token-core.mjs'
import slatesGet from './slate-get.mjs'
import slatesLive from './slate-live.mjs'
import slatesCreate from './slate-create.mjs'
import slatesApplyOperations from './slate-operations.mjs'
import slatesIssueInvite from './slate-invite-issue.mjs'
import slatesRevokeInvite from './slate-invite-revoke.mjs'
import slatesUpdateSettings from './slate-update-settings.mjs'
import slatesCopy from './slate-copy.mjs'
import slatesExportMermaid from './slate-mermaid-export.mjs'
import slatesImportMermaid from './slate-mermaid-import.mjs'
import apiTokensList from './api-tokens-list.mjs'
import apiTokensCreate from './api-tokens-create.mjs'
import apiTokensRevoke from './api-tokens-revoke.mjs'
import instanceDescribe from './instance-describe.mjs'
import accountGet from './account-get.mjs'
import execRun from './exec-run.mjs'
import execGet from './exec-get.mjs'
import aiGet from './ai-get.mjs'
import aiUpdate from './ai-update.mjs'
import aiCheck from './ai-check.mjs'
import aiControlActions from './ai-control-get.mjs'
import aiAuditList from './ai-control-audit.mjs'
import aiControlReset from './ai-control-reset.mjs'
import aiProviderActions from './ai-providers.mjs'
import aiKeyActions from './ai-keys.mjs'
import aiModelActions from './ai-models.mjs'
import aiBindingActions from './ai-bindings.mjs'
import aiPromptActions from './ai-prompts.mjs'
import aiControlSetGlobal from './ai-control-set-global.mjs'
import presencePlan from './presence-plan.mjs'
import presenceStep from './presence-step.mjs'
import componentsList, { componentsGet } from './components-list.mjs'
import slatesCheckMove from './slate-check-move.mjs'
import { slatesUndo, slatesRedo } from './slate-undo.mjs'
import teamTransfer from './team-transfer.mjs'
import teamScimActions from './team-scim.mjs'
import shapeActions from './shapes.mjs'
import presentationActions from './presentations.mjs'
import slatesList from './slate-list.mjs'
import slatesDelete from './slate-delete.mjs'
import commentActions from './comments.mjs'
import agentTaskActions from './agent-tasks.mjs'
import agentSuggestionActions from './agent-suggestions.mjs'
import mediaActions from './media.mjs'
import photoActions from './photos.mjs'
import libraryRead from './library-read.mjs'
import libraryAuthor from './library-author.mjs'
import libraryReview from './library-review.mjs'
import profileActions from './profile.mjs'
import personalActions from './personal.mjs'
import startTileActions from './start-tiles.mjs'
import auditActions from './audit.mjs'
import { ACTION_AUDIT } from '../audit/action-specs.mjs'
import teamSsoActions from './team-sso.mjs'

export const actions = [
  slatesGet,
  slatesLive,
  slatesCreate,
  slatesApplyOperations,
  slatesIssueInvite,
  slatesRevokeInvite,
  slatesUpdateSettings,
  slatesCopy,
  slatesExportMermaid,
  slatesImportMermaid,
  apiTokensList,
  apiTokensCreate,
  apiTokensRevoke,
  instanceDescribe,
  accountGet,
  execRun,
  execGet,
  aiGet,
  aiUpdate,
  aiCheck,
  ...aiControlActions,
  aiAuditList,
  aiControlReset,
  ...aiProviderActions,
  ...aiKeyActions,
  ...aiModelActions,
  ...aiBindingActions,
  ...aiPromptActions,
  aiControlSetGlobal,
  presencePlan,
  presenceStep,
  componentsList,
  componentsGet,
  slatesCheckMove,
  slatesUndo,
  slatesRedo,
  ...teamTransfer,
  // SCIM for a team admin: tokens, groups mapped to roles, the departing members' recipient (server/scim)
  ...teamScimActions,
  ...shapeActions,
  ...presentationActions,
  slatesList,
  slatesDelete,
  ...commentActions,
  ...agentTaskActions,
  ...agentSuggestionActions,
  ...mediaActions,
  // photos from the phone app (slates.addPhoto)
  ...photoActions,
  // The review routes and the more specific reads first: Express matches /library/{itemId} last.
  ...libraryReview,
  ...libraryAuthor,
  ...libraryRead,
  ...profileActions,
  // For you: ideas made for the person, from About you (server/personal)
  ...personalActions,
  // the start page's tiles, made by its use-case interview (server/start)
  ...startTileActions,
  // the activity log: the team page, the server admin's page and a SIEM's pull (server/audit)
  ...auditActions,
  // a team's single sign-on (Team settings > Sign-in & security; server/sso)
  ...teamSsoActions,
]

export const components = { ...slateComponents }

// extraActions: the enterprise actions (server/enterprise-loader.mjs), empty where enterprise code is locked.
export const createAppRegistry = ({ extraActions = [], ...options } = {}) =>
  createRegistry({ actions: [...actions, ...extraActions], components, scopes: API_TOKEN_SCOPES, auditSpecs: ACTION_AUDIT, ...options })
