// Every action the app serves. A package adds its actions here, one file per action.
import { createRegistry } from './registry.mjs'
import { slateComponents } from './slate-schemas.mjs'
import { API_TOKEN_SCOPES } from '../api-token-core.mjs'
import slatesGet from './slate-get.mjs'
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
import presencePlan from './presence-plan.mjs'
import presenceStep from './presence-step.mjs'
import componentsList, { componentsGet } from './components-list.mjs'
import slatesCheckMove from './slate-check-move.mjs'
import teamTransfer from './team-transfer.mjs'
import shapeActions from './shapes.mjs'
import presentationActions from './presentations.mjs'
import slatesList from './slate-list.mjs'
import slatesDelete from './slate-delete.mjs'
import commentActions from './comments.mjs'
import agentTaskActions from './agent-tasks.mjs'
import agentSuggestionActions from './agent-suggestions.mjs'

export const actions = [
  slatesGet,
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
  presencePlan,
  presenceStep,
  componentsList,
  componentsGet,
  slatesCheckMove,
  ...teamTransfer,
  ...shapeActions,
  ...presentationActions,
  slatesList,
  slatesDelete,
  ...commentActions,
  ...agentTaskActions,
  ...agentSuggestionActions,
]

export const components = { ...slateComponents }

// extraActions: the Cloud-only enterprise actions (server/enterprise-loader.mjs), empty on self-host.
export const createAppRegistry = ({ extraActions = [], ...options } = {}) =>
  createRegistry({ actions: [...actions, ...extraActions], components, scopes: API_TOKEN_SCOPES, ...options })
