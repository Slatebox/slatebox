import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import fetch from 'node-fetch'
import { sdkChatRequest } from './sdk-chat.cjs'
import { localWorkshopRequest } from './workshop-provider.mjs'
import { AIAudit } from '../../../imports/api/common/models'
import { aiRequestGate, chargeProviderCall, currentAIAction } from '../../metering/context.mjs'
import { resolveRequestConnection } from './ai-settings'
import { connectionFetch } from './endpoint-policy.mjs'
import { connectionRequest } from './connection-request.mjs'
import { carriesImages, featureTitle, surfaceFor } from './connections.mjs'
import { requestOptionsFromBinding } from '../../ai-control/request-binding.mjs'
import { requestBreaker } from '../../ai-control/breaker.mjs'
import { chosenShapeAbort } from './shape-abort.mjs'
import utils from '../../../imports/api/common/utils'
import {
  AI_PROVIDERS,
  buildProviderBody,
  buildProviderHeaders,
  buildProviderTelemetry,
  getProviderApiKey,
  getProviderEndpoint,
  isAllowedPlainTextResponse,
  isRetryableProviderFailure,
  keepsFallbackAfterShapeExhaustion,
  normalizeProviderResponse,
  resolveAIModel,
  resolveAIProvider,
  resolveAIRequestTimeout,
  shouldFallbackToModel,
} from './provider.mjs'

const INFRA_RETRY_LIMIT = 2
// Max invalid-JSON responses per provider chain before the chain degrades.
// The old bound was `errs > 5` + throw, and the throw landed in the
// infra-failure catch below, so one dead-format chain legally burned
// 6 primary + 6 fallback calls (live audit 2026-10-30 share …427121: 11
// invalid calls, zero recovery). Three shape failures = model won't fix it.
const SHAPE_RETRY_LIMIT = 3
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let loadedLocalDeepInfraEnvironment = false

function loadLocalDeepInfraEnvironment() {
  if (loadedLocalDeepInfraEnvironment || !Meteor.isDevelopment) return
  loadedLocalDeepInfraEnvironment = true

  try {
    process.loadEnvFile?.('settings.local.json')
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.warn(
        'Unable to load local DeepInfra environment settings:',
        error.message
      )
    }
  }
}

async function recordProviderTelemetry({
  aiOpts,
  user,
  provider,
  model,
  status,
  duration = 0,
  responseStatus = null,
  usage,
  errCount = 0,
  error,
  invalidPayloadLength,
}) {
  const auditId = Random.id()
  try {
    await AIAudit.insertAsync({
      _id: auditId,
      aid: aiOpts?.aid,
      engine: model,
      ...buildProviderTelemetry({
        provider,
        model,
        feature: aiOpts?.feature,
        status,
        duration,
        responseStatus,
        usage,
        errCount,
        error,
        invalidPayloadLength,
        fallbackFromProvider: aiOpts?.fallbackFromProvider,
        fallbackReason: aiOpts?.fallbackReason,
      }),
      // which configuration served the call: the surface, the connection (a choice ref, or builtin)
      // and the place in the model chain (0 the primary, 1 its fallback)
      surface: aiOpts?.surface ?? surfaceFor(aiOpts?.feature) ?? null,
      connection: aiOpts?.connectionRef ?? null,
      attempt: aiOpts?.chainIndex ?? 0,
      ...(aiOpts?.bindingVersion && { bindingVersion: aiOpts.bindingVersion }),
      ...(aiOpts?.promptVersions && { promptVersions: aiOpts.promptVersions }),
      levelOfDetail: aiOpts?.detailLevel,
      wordsPerNode: aiOpts?.wordsPerNode,
      userId: user?._id ?? null,
      orgId: user?.orgId,
      created: Date.now(),
      slateShareId: aiOpts?.shareId,
    })
  } catch (auditError) {
    console.warn('Unable to record AI provider telemetry', auditError.message)
  }
  // A call on the person's own connection is theirs to pay (recorded, never charged outside an own-key request).
  if (aiOpts?.unpaid && currentAIAction()?.route !== 'byok') return { stop: false }
  // Every call that returned tokens cost money, whether or not its answer was usable.
  if (!usage || !(usage.totalTokens || usage.inputTokens || usage.outputTokens || usage.providerCostUsd)) return { stop: false }
  return chargeProviderCall({ ref: auditId, provider, model, usage })
}

// An attempt that was sent but got no usage back (timeout, dropped connection, 5xx) is
// charged the feature's estimate: providers usually bill the tokens they generated.
async function chargeUnansweredAttempt({ provider, model, unpaid }) {
  if (unpaid && currentAIAction()?.route !== 'byok') return { stop: false }
  return chargeProviderCall({ ref: 'attempt_' + Random.id(), provider, model, usage: null })
}

// Who the request is for: the caller's explicit userId (agents, exec and HTTP actions run
// outside any DDP method, where Meteor.userId() throws), else the metered action's, else the
// method's caller.
function requestUserId(aiOpts) {
  if (typeof aiOpts?.userId === 'string' && aiOpts.userId) return aiOpts.userId
  const running = currentAIAction()
  if (running?.userId) return running.userId
  try {
    return Meteor.userId()
  } catch {
    return null
  }
}

async function requestFromProvider({ prompts, system, maxSize, userId: askedFor, ...aiOpts }, operatorWorkshop) {
  let errs = aiOpts?.errorCount || 0
  let responseValidationErrors = 0
  // Whether the model answered with a tool call at all, and the last answer a feature's own check turned down: a
  // model that called the tool but proposed something the board refuses can call tools (2026-11-23: a decision
  // path's refused move was reported as "did not answer with a tool call ... may not support tool calls").
  let calledTool = false
  let lastRejection = null
  const callerId = requestUserId({ userId: askedFor })
  const user = callerId ? await Meteor.users.findOneAsync(callerId) : null
  // Fail closed: with the meter on, nothing is sent unless a counted action is running.
  const unmetered = aiRequestGate()
  if (unmetered) {
    await recordProviderTelemetry({ aiOpts, user, provider: aiOpts.provider, model: aiOpts.engine, status: 'unmetered', error: 'No metered action' })
    return unmetered
  }
  // An own key from the person or their team: this action is paid by them, not by Slatebox.
  const ownKey = currentAIAction()?.route === 'byok' ? currentAIAction().credentials : null
  // Which connection serves this feature for this person: their choice, their team's, the
  // operator's, or the built-in AI (no connection). Never another one behind their back.
  const withImages = carriesImages(prompts)
  // (req() resolves it once for the whole model chain and hands it in as route)
  const chosen = operatorWorkshop ? null : aiOpts.route !== undefined ? aiOpts.route : await resolveRequestConnection({ feature: aiOpts.feature, request: { images: withImages, tools: Boolean(aiOpts.functions?.length) }, userId: callerId })
  delete aiOpts.route
  // What an administrator's published binding sets (AI control): parameters, tools, which built-in model.
  const control = chosen?.control || null
  if (control) {
    const refused = applyControl(aiOpts, control)
    if (refused) {
      await recordProviderTelemetry({ aiOpts, user, provider: aiOpts.provider, model: aiOpts.engine, status: 'configuration_error', error: 'toolsNotAllowed' })
      return refused
    }
  }
  if (chosen?.builtin) {
    aiOpts.provider = chosen.builtin.provider
    aiOpts.engine = chosen.builtin.engine
  }
  const chosenConnection = chosen?.connection || null
  aiOpts.connectionRef = operatorWorkshop ? 'selfhost-workshop' : chosen?.ref ?? 'builtin'
  // the label a person may read: an operator's connection by its model, not its host
  const chosenLabel = chosenConnection ? chosen.label : null
  if (chosen?.gap || chosen?.error || (ownKey && !chosen?.own)) {
    const abortMessage = chosen?.gap?.message || chosen?.error ||
      `This request is paid by your own AI, but ${chosen?.feature ? featureTitle(chosen.feature).toLowerCase() : 'this feature'} is set to ${chosenLabel || 'the built-in AI'}. Choose your own model for it too in your AI settings.`
    await recordProviderTelemetry({ aiOpts, user, provider: chosenConnection?.type || aiOpts.provider, model: chosenConnection?.model || aiOpts.engine, status: chosen?.gap ? 'capability' : 'configuration_error', error: abortMessage })
    return { abort: true, abortMessage, fallbackBlocked: true, chosen: chosen?.ref, chosenLabel, ...(chosen?.gap ? { capability: chosen.gap.need } : { unusable: true }), failure: ownKey && !chosen?.own ? 'stop' : 'config' }
  }
  aiOpts.unpaid = Boolean(chosen?.own)
  // A DeepInfra key without a model of its own follows the feature's default model, as own keys always have.
  const ownDeepInfraKey = chosenConnection?.type === 'deepinfra' && !chosenConnection.model ? chosenConnection.apiKey : null
  const viaConnection = chosenConnection && !ownDeepInfraKey ? { ...connectionRequest(chosenConnection), fetcher: connectionFetch(chosenConnection.baseUrl, chosen.rules) } : null
  const anthropicConnection = viaConnection?.provider === 'anthropic' ? viaConnection : null
  // a person's endpoint on hosted Slatebox is reached only through a lookup that refuses private
  // addresses, a self-hosted one through the self-host rules (endpoint-policy.mjs connectionFetch)
  const localWorkshop = operatorWorkshop || (viaConnection && !anthropicConnection ? viaConnection : null)
  // This model's maximum context length is 4097 tokens. However, your messages resulted in 4121 tokens. Please reduce the length of the messages.
  // so prompts must be culled at times
  // rolling curation of the prompts

  async function invoke() {
    // always keep it at 18 or less -- this cuts off the oldest two sub ideas after the initial ideaPlan was received
    // and keeps this thing rolling
    // if (prompts.length >= 20) {
    //   console.log(
    //     'prompts were',
    //     prompts.length,
    //     JSON.stringify(prompts, null, 2)
    //   )
    //   prompts = [...prompts.slice(0, 3), ...prompts.slice(5, prompts.length)]
    //   // console.log(
    //   //   'prompts are now',
    //   //   prompts.length,
    //   //   JSON.stringify(prompts, null, 2)
    //   // )
    // }
    // console.log('current prompts are', prompts)
    const running = currentAIAction()
    if (running && running.route !== 'byok' && running.spentMicros >= running.ceilingMicros) {
      return { abort: true, abortMessage: 'This request grew too large. Try a shorter brief.', fallbackBlocked: true, provider: aiOpts.provider, model: aiOpts.engine }
    }
    // telemetry names a chosen connection 'connection' (its model is recorded beside it)
    const provider = viaConnection && !anthropicConnection ? 'connection' : localWorkshop ? 'selfhost-workshop' : anthropicConnection ? AI_PROVIDERS.anthropic : resolveAIProvider(aiOpts)
    const useDeepInfra = provider === AI_PROVIDERS.deepinfra
    const useClaude = provider === AI_PROVIDERS.anthropic
    if (useDeepInfra) loadLocalDeepInfraEnvironment()

    const model = localWorkshop?.model ?? anthropicConnection?.model ?? resolveAIModel({
      provider,
      engine: aiOpts.engine,
      settings: Meteor.settings,
      env: process.env,
    })
    if (ownDeepInfraKey && provider !== AI_PROVIDERS.deepinfra) {
      return { abort: true, abortMessage: 'Your own key works with DeepInfra models. This feature is set to another provider.', fallbackBlocked: true, provider, model, unusable: true, failure: 'stop' }
    }
    const apiKey = !localWorkshop && (anthropicConnection ? anthropicConnection.apiKey : ownDeepInfraKey || getProviderApiKey({
      provider,
      settings: Meteor.settings,
      env: process.env,
    }))
    if (!localWorkshop && !apiKey) {
      await recordProviderTelemetry({
        aiOpts,
        user,
        provider,
        model,
        status: 'configuration_error',
        error: `${provider} API key is missing`,
        errCount: errs,
      })
      return {
        abort: true,
        abortMessage: `${provider} is not configured for this AI request.`,
        provider,
        model,
        failure: 'config',
      }
    }

    const payload = {
      provider, model, prompts, system,
      functions: aiOpts.functions,
      functionCall: aiOpts.function_call,
      userId: callerId,
      ...(Number.isFinite(aiOpts.temperature) && { temperature: aiOpts.temperature }),
      ...(Number.isFinite(aiOpts.controlMaxTokens) && { controlMaxTokens: aiOpts.controlMaxTokens }),
    }
    if (anthropicConnection) payload.maxTokens = anthropicConnection.maxTokens
    // A feature's own cap on the answer (a presentation plan never needs more), within a connection's.
    if (aiOpts.maxTokens) payload.maxTokens = Math.min(payload.maxTokens || Infinity, aiOpts.maxTokens)
    const ai = localWorkshop ? localWorkshopRequest(localWorkshop, payload) : {
      method: 'POST',
      headers: buildProviderHeaders({ provider, apiKey }),
      body: JSON.stringify(buildProviderBody(payload)),
    }

    let response = null
    let responseStatus = null
    // A local stub provider for development runs only (never in a production build).
    const endpoint = localWorkshop?.endpoint ?? anthropicConnection?.endpoint ?? ((Meteor.isDevelopment && Meteor.settings.ai?.stubEndpoint) || getProviderEndpoint(provider))
    // every chosen connection goes through the AI SDK: tools, images inline, tool choice per endpoint
    const sdkPath = Boolean(aiOpts.sdkChat || aiOpts.feature === 'welcome' || viaConnection)
    let providerDetail = ''
    const timeoutMs = resolveAIRequestTimeout({
      requested: aiOpts.timeoutMs,
      settings: Meteor.settings,
    })
    const requestStartedAt = Date.now()
    const maxInfraRetries =
      aiOpts.infraRetries ?? Meteor.settings?.ai?.providerInfraRetries ?? INFRA_RETRY_LIMIT
    let attempt = 0
    // the previous key of a connection whose key was rotated, once it has been tried (spec 6.3)
    let previousKeyInUse = null

    while (true) {
      attempt += 1
      // A request with a deadline (aiOpts.deadline, epoch ms) is not sent, retried or waited on
      // past it: whoever asked has stopped waiting.
      const left = aiOpts.deadline ? aiOpts.deadline - Date.now() : Infinity
      if (left <= 0) return { abort: true, abortMessage: 'The request ran out of time.', fallbackBlocked: true, provider, model }
      const abortController = new AbortController()
      const timeout = setTimeout(() => abortController.abort(), Math.min(timeoutMs, left))
      try {
        if (sdkPath) {
          try {
            const fetcher = viaConnection?.fetcher || (localWorkshop?.agent && ((url, init) => fetch(url, { ...init, agent: localWorkshop.agent })))
            // during a key rotation's grace the previous key is tried once after a refusal (spec 6.3)
            const wire = previousKeyInUse ? connectionRequest({ ...chosenConnection, apiKey: previousKeyInUse }) : viaConnection
            response = await sdkChatRequest({ provider, endpoint, apiKey: previousKeyInUse ? wire.apiKey : (localWorkshop?.apiKey || apiKey),
              body: JSON.parse(ai.body), functions: aiOpts.functions, local: Boolean(localWorkshop || anthropicConnection), signal: abortController.signal,
              ...(fetcher && { fetcher }), ...(wire?.headers && { headers: wire.headers }), ...(wire?.queryParams && { queryParams: wire.queryParams }) })
            responseStatus = 200
          } catch (error) {
            if (!error.statusCode) throw error
            responseStatus = error.statusCode
            providerDetail = String(error.data?.error?.message || error.responseBody || '').slice(0, 500)
            response = { error: { message: 'Chat provider returned HTTP ' + responseStatus, code: error.data?.error?.code } }
          }
        } else {
          const fetchResponse = await fetch(endpoint, { ...ai, signal: abortController.signal })
          responseStatus = fetchResponse.status
          response = localWorkshop && !fetchResponse.ok
            ? { error: { message: 'Workshop provider returned HTTP ' + responseStatus } }
            : await fetchResponse.json()
        }
      } catch (err) {
        const message = chosenLabel ? `${chosenLabel} could not be reached` : localWorkshop ? 'Workshop provider request failed' : sdkPath ? 'Chat provider request failed' : err.message
        console.error('unable to invoke', message)
        const timedOut = err.name === 'AbortError'
        // a chosen model that timed out is not asked again: it would wait as long again
        const retryable =
          attempt <= maxInfraRetries &&
          !(chosenLabel && timedOut) &&
          (timedOut ||
            typeof responseStatus !== 'number' ||
            responseStatus === 408 ||
            responseStatus === 429 ||
            responseStatus >= 500)
        const charged = await chargeUnansweredAttempt({ provider, model, unpaid: aiOpts.unpaid })
        if (charged.stop) return { abort: true, abortMessage: charged.abortMessage, fallbackBlocked: true, provider, model }
        if (retryable) {
          console.warn(
            `AI provider ${provider} attempt ${attempt}/${maxInfraRetries + 1} failed (${message}); retrying after backoff`
          )
          await sleep(400 * attempt)
          response = null
          responseStatus = null
          continue
        }
        await recordProviderTelemetry({
          aiOpts,
          user,
          provider,
          model,
          status: timedOut ? 'timeout' : 'network_error',
          duration: Date.now() - requestStartedAt,
          responseStatus,
          errCount: errs,
          error:
            attempt > 1
              ? `${message} (after ${attempt} attempts)`
              : message,
        })
        return {
          abort: true,
          abortMessage: timedOut
            ? `Sorry, the AI request timed out after ${Math.round(
                timeoutMs / 1000
              )} seconds.`
            : `Sorry, I ran into a problem. ${message}.`,
          provider,
          model,
          failure: 'infra',
        }
      } finally {
        clearTimeout(timeout)
      }

      const responseError =
        response?.error || response?.detail?.error || response?.detail
      if (!responseError) break

      const errorCode = responseError.code
      // a rotated key the provider does not take yet: the previous one, still in its grace period, once
      if ((responseStatus === 401 || responseStatus === 403) && chosenConnection?.previousApiKey && !previousKeyInUse) {
        previousKeyInUse = chosenConnection.previousApiKey
        response = null
        responseStatus = null
        continue
      }
      // a 5xx (or no status) after the request went out may still have been billed
      if (typeof responseStatus !== 'number' || responseStatus >= 500) {
        const charged = await chargeUnansweredAttempt({ provider, model, unpaid: aiOpts.unpaid })
        if (charged.stop) return { abort: true, abortMessage: charged.abortMessage, fallbackBlocked: true, provider, model }
      }
      const errorMessage = chosenLabel
        ? `${chosenLabel} returned an error (HTTP ${responseStatus})`
        : localWorkshop
          ? 'Workshop provider returned an error (HTTP ' + responseStatus + ')'
          : responseError.message || String(responseError)
      if (
        attempt <= maxInfraRetries &&
        isRetryableProviderFailure(responseStatus, errorMessage)
      ) {
        console.warn(
          `AI provider ${provider} attempt ${attempt}/${maxInfraRetries + 1} got retryable ${responseStatus} (${errorMessage.slice(0, 120)}); retrying after backoff`
        )
        await sleep(400 * attempt)
        response = null
        responseStatus = null
        continue
      }

      await recordProviderTelemetry({
        aiOpts,
        user,
        provider,
        model,
        status: 'provider_error',
        duration: Date.now() - requestStartedAt,
        responseStatus,
        errCount: errs,
        error:
          attempt > 1
            ? `${errorMessage} (after ${attempt} attempts)`
            : errorMessage,
      })

      const refusedCapability = chosenLabel && responseStatus === 400 && (/tool|function/i.test(providerDetail) ? 'tools' : /image|vision|multimodal/i.test(providerDetail) ? 'vision' : null)
      if (refusedCapability) {
        const verb = refusedCapability === 'tools' ? 'call tools, which this feature needs' : 'read images'
        return { abort: true, abortMessage: `${chosenLabel} cannot ${verb}. Choose another model for ${featureTitle(chosen.feature).toLowerCase()} in your AI settings.`,
          fallbackBlocked: true, provider, model, capability: refusedCapability, failure: 'config' }
      }

      if (errorCode === 'context_length_exceeded') {
        return {
          abortMessage: `Sorry, that's all the data I can process on this slate. It's not you, it's me. Everyone has their limits. ${errorMessage}.`,
          abort: true,
          // Payload-size failure: the fallback model chokes on the same
          // context. Observed as 147s wasted fallback chains.
          fallbackBlocked: true,
          provider,
          model,
          failure: 'context',
        }
      }

      console.error(
        'unable to invoke AI provider',
        errorMessage,
        localWorkshop || sdkPath ? '' : 'BODY::' + ai.body.slice(0, 3000)
      )
      return {
        abort: true,
        abortMessage: `Sorry, I ran into a problem. ${errorMessage}.`,
        provider,
        model,
        // 5xx, 429, 408 or no answer: the service failed (a fallback for infra may answer)
        failure: typeof responseStatus !== 'number' || responseStatus >= 500 || responseStatus === 429 || responseStatus === 408 ? 'infra' : 'other',
      }
    }

    const normalized = normalizeProviderResponse({ provider, response: response || {} })
    const { message, toolCall, usage } = normalized
    if (toolCall) calledTool = true
    // a binding's allowed tools hold for what comes back too: a call to another tool is not used
    const allowed = control?.tools?.allow
    if (allowed && toolCall?.name && !allowed.includes(toolCall.name)) {
      await recordProviderTelemetry({ aiOpts, user, provider, model, status: 'invalid_response', duration: Date.now() - requestStartedAt, responseStatus, usage, errCount: errs, error: 'toolNotAllowed' })
      return { abort: true, abortMessage: 'The AI asked for a tool this feature may not use.', shape: true, fallbackBlocked: !keepsFallbackAfterShapeExhaustion(aiOpts.feature), provider, model }
    }
    const validationError = aiOpts.validateResponse?.({
      message,
      toolCall,
      normalized,
    })
    if (validationError) {
      const maxResponseValidationRetries =
        aiOpts.maxResponseValidationRetries ?? 1
      const charged = await recordProviderTelemetry({
        aiOpts,
        user,
        provider,
        model,
        status: 'invalid_response',
        duration: Date.now() - requestStartedAt,
        responseStatus,
        usage,
        errCount: responseValidationErrors,
        error: validationError.code || 'responseValidationFailed',
      })

      if (charged.stop) return { abort: true, abortMessage: charged.abortMessage, fallbackBlocked: true, provider, model }
      lastRejection = validationError
      if (responseValidationErrors >= maxResponseValidationRetries) {
        return {
          abort: true,
          abortMessage: 'The AI response did not meet Slatebox validation.',
          shape: true,
          // What the feature's check said of the last answer (its code, and a sentence for the person when it has one).
          rejected: { code: validationError.code || 'responseValidationFailed', ...(typeof validationError.reason === 'string' && { reason: validationError.reason }) },
          calledTool,
          // Shape-exhausted aborts must not re-burn the whole ladder on the
          // fallback model for welcome-layer features (telemetry: 3-call FB
          // chains ending in plain chat text; Nov 1 welcome-route burst: 6 FB
          // attempts, all dead). Generation/vision keep the fallback: it
          // demonstrably recovers content there.
          fallbackBlocked: !keepsFallbackAfterShapeExhaustion(aiOpts.feature),
          provider,
          model,
        }
      }

      responseValidationErrors += 1
      prompts.push({
        role: 'user',
        content:
          validationError.retryPrompt ||
          'The previous response failed validation. Please try again.',
      })
      return invoke()
    }

    if (
      isAllowedPlainTextResponse({
        allowPlainText: aiOpts.allowPlainText,
        message,
        toolCall,
      })
    ) {
      await recordProviderTelemetry({
        aiOpts,
        user,
        provider,
        model,
        status: 'success',
        duration: Date.now() - requestStartedAt,
        responseStatus,
        usage,
        errCount: errs,
      })

      return {
        json: { content: message.content },
        message,
        toolCall,
        provider,
        model,
        usage,
        errs,
      }
    }

    let jsonString = (localWorkshop || sdkPath) && toolCall ? toolCall.arguments : normalized.jsonCandidate
    if (!localWorkshop && !useClaude && message?.content && typeof jsonString === 'string' && jsonString.includes('{')) {
      jsonString = `{ ${jsonString.split('{')[1].trim()}`
      jsonString = `${jsonString.substring(0, jsonString.lastIndexOf('}'))} }`
    }

    if (!utils.isJSON(jsonString)) {
      const charged = await recordProviderTelemetry({
        aiOpts,
        user,
        provider,
        model,
        status: 'invalid_json',
        duration: Date.now() - requestStartedAt,
        responseStatus,
        usage,
        errCount: errs,
        error: 'invalidJSON',
        invalidPayloadLength:
          typeof jsonString === 'string' ? jsonString.length : undefined,
      })

      if (charged.stop) return { abort: true, abortMessage: charged.abortMessage, fallbackBlocked: true, provider, model }
      errs += 1
      console.log(
        'errs are ',
        // { fullResponse: response },
        // { jsonString },
        { errCount: errs }
      )
      if (errs >= (aiOpts.shapeRetries ?? SHAPE_RETRY_LIMIT)) {
        // Return (not throw): a throw here re-entered the infra-failure
        // catch, which classified shape exhaustion as a transient failure
        // and re-ran the FULL ladder against the fallback model. Degrade
        // instead, with the fallback gated per-feature (provider.mjs).
        return {
          abort: true,
          abortMessage:
            'Slatebox could not get a valid JSON response from the AI.',
          shape: true,
          fallbackBlocked: !keepsFallbackAfterShapeExhaustion(aiOpts.feature),
          provider,
          model,
        }
      }
      if (jsonString) {
        prompts.push(
          {
            role: 'assistant',
            content: jsonString,
          },
          {
            role: 'system',
            content: `The last message you sent is invalid JSON. Do not apologize or explain yourself. Please send it again, but only send valid JSON. Remember, all responses must be in JSON format and should not include any additional text or explanations.`,
          }
        )
      }
      return invoke()
    }

    const jObject =
      typeof jsonString === 'string' ? JSON.parse(jsonString) : jsonString

    const grace = 6
    if (
      maxSize &&
      (jObject.text.split(' ').length > maxSize + grace ||
        jObject.text.split(' ').length < maxSize - grace)
    ) {
      const charged = await recordProviderTelemetry({
        aiOpts, user, provider, model, status: 'invalid_length', duration: Date.now() - requestStartedAt, responseStatus, usage, errCount: errs,
      })
      if (charged.stop) return { abort: true, abortMessage: charged.abortMessage, fallbackBlocked: true, provider, model }
      prompts.push(
        {
          role: 'assistant',
          content: jsonString,
        },
        {
          role: 'system',
          content: `The last message you sent is ${
            jObject.text.split(' ').length
          } words but I asked for the rewritten text to be ${maxSize} words. Do not apologize or explain yourself. Please send it again using around ${maxSize} words. Remember, all responses must be in JSON format and should not include any additional text or explanations.`,
        }
      )
      return invoke()
    }

    // console.log('req return', {
    //   json: jObject,
    //   message,
    //   errs,
    // })

    await recordProviderTelemetry({
      aiOpts,
      user,
      provider,
      model,
      status: 'success',
      duration: Date.now() - requestStartedAt,
      responseStatus,
      usage,
      errCount: errs,
    })

    return {
      json: jObject,
      message,
      toolCall,
      provider,
      model,
      usage,
      errs,
    }
  }
  const result = await invoke()
  if (!chosen?.connection) return result
  // A chosen connection's answer is its own: it never falls back to another model, and when its
  // answers never took the shape a feature needs, the person is told which model and what to do.
  const named = { ...result, chosen: chosen.ref, chosenLabel }
  // Only a model that never called a tool is said to be unable to: one that called it with a change the feature
  // turned down is named with that reason, and keeps its capability (shape-abort.mjs).
  const said = chosenShapeAbort({ result, label: chosenLabel, feature: featureTitle(chosen.feature).toLowerCase(),
    tools: Boolean(aiOpts.functions?.length), calledTool, rejection: lastRejection })
  if (said) Object.assign(named, said)
  return named
}

// What a published binding sets on one request (AI control: ai-settings-core.mjs controlOf): the
// timeout, retries, temperature and answer size an administrator chose win over the call site's
// (an answer size only ever shrinks), and its allowed tools narrow the tools sent. → a refusal to
// return without sending, or null.
function applyControl(aiOpts, control) {
  const p = control.params || {}
  if (Number.isFinite(p.timeoutMs)) aiOpts.timeoutMs = p.timeoutMs
  if (Number.isInteger(p.infraRetries)) aiOpts.infraRetries = p.infraRetries
  if (Number.isInteger(p.shapeRetries)) aiOpts.shapeRetries = p.shapeRetries
  if (Number.isFinite(p.maxTokens)) {
    aiOpts.maxTokens = Math.min(aiOpts.maxTokens || Infinity, p.maxTokens)
    // a chosen connection's request keeps its own cap unless the binding's is lower
    aiOpts.controlMaxTokens = p.maxTokens
  }
  if (Number.isFinite(p.temperature)) aiOpts.temperature = p.temperature
  if (control.bindingVersion) aiOpts.bindingVersion = control.bindingVersion
  if (!aiOpts.surface && control.surface) aiOpts.surface = control.surface
  const { allow, mode } = control.tools || {}
  if (Array.isArray(allow) && aiOpts.functions?.length) {
    const kept = aiOpts.functions.filter((definition) => allow.includes(definition?.name))
    if (!kept.length) {
      return { abort: true, abortMessage: `${featureTitle(control.surface)} cannot use the tools this request needs: an administrator limited its tools.`, fallbackBlocked: true, failure: 'stop', provider: aiOpts.provider, model: aiOpts.engine }
    }
    aiOpts.functions = kept
    if (aiOpts.function_call?.name && !allow.includes(aiOpts.function_call.name)) aiOpts.function_call = undefined
  }
  if (mode === 'none') {
    aiOpts.functions = undefined
    aiOpts.function_call = undefined
  } else if (mode === 'auto') {
    aiOpts.function_call = undefined
  } else if (mode === 'forced' && !aiOpts.function_call?.name && aiOpts.functions?.length === 1) {
    aiOpts.function_call = { name: aiOpts.functions[0].name }
  }
  return null
}

// The class of a failed attempt, for the model chain (spec 2.1): infra (5xx, 429, timeout, no
// answer), shape (the answer never took the shape the feature needs), context (too long), config
// (the connection cannot be used: no key, turned off, a capability missing), other (any other
// refusal), or stop: a reason no other model changes (the budget, a deadline, own-key rules).
export function failureClass(result) {
  if (!result?.abort) return null
  if (result.failure) return result.failure
  if (result.shape) return 'shape'
  return result.fallbackBlocked ? 'stop' : 'other'
}

// A published binding's model chain (AI control): the primary, then each fallback whose `on`
// names the class of the last failure (or any). Each attempt writes its own aiAudit row with its
// place in the chain. The primary's outcome feeds this pod's circuit breaker for the surface.
async function walkChain(options, route) {
  const original = JSON.parse(JSON.stringify(options.prompts || []))
  const surface = route.control?.surface ?? null
  const bindingVersion = route.control?.bindingVersion ?? null
  let last = null
  let lastClass = null
  for (const [index, entry] of route.chain.entries()) {
    if (index > 0) {
      if (!lastClass || lastClass === 'stop') break
      if (!(entry.on || ['any']).some((on) => on === 'any' || on === lastClass)) continue
    }
    const attempt = {
      ...options,
      prompts: index === 0 ? options.prompts : JSON.parse(JSON.stringify(original)),
      fallback: undefined,
      route: { ...entry, control: route.control },
      chainIndex: index,
      ...(last && { fallbackFromProvider: last.provider, fallbackReason: last.abortMessage }),
    }
    let result
    try {
      result = await requestFromProvider(attempt)
    } catch (error) {
      if (index === route.chain.length - 1) throw error
      result = { abort: true, abortMessage: error.message, provider: options.provider, model: options.engine, failure: 'infra' }
    }
    if (index === 0) requestBreaker.record(surface, { failure: failureClass(result), bindingVersion })
    if (!result?.abort) {
      return last ? { ...result, fallbackFrom: { provider: last.provider, model: last.model, reason: last.abortMessage } } : result
    }
    last = result
    lastClass = failureClass(result)
  }
  return last
}

export default async function req(requested, localWorkshop) {
  // a resolved AI control binding (ai-control/resolve.mjs) fills in what the call site left out;
  // without one the options are used exactly as given
  const { options: given, refusal } = requestOptionsFromBinding(requested)
  if (refusal) return refusal
  if (localWorkshop) return requestFromProvider(given, localWorkshop)
  // Which connection serves this request, once: an administrator's binding may turn the surface
  // off, or give it a model chain. A lookup that fails leaves it to requestFromProvider, as before.
  let route
  try {
    route = await resolveRequestConnection({ feature: given.feature, request: { images: carriesImages(given.prompts), tools: Boolean(given.functions?.length) }, userId: requestUserId({ userId: given.userId }) })
  } catch {
    route = undefined
  }
  if (route?.disabled) {
    return { abort: true, abortMessage: route.message || 'This feature is turned off by your administrator.', fallbackBlocked: true, disabled: true, failure: 'stop', surface: route.control?.surface ?? null }
  }
  if (route?.chain?.length) return walkChain(given, route)
  const options = route === undefined ? given : { ...given, route }
  const { fallback } = options
  const originalPrompts = fallback
    ? JSON.parse(JSON.stringify(options.prompts || []))
    : null
  let primaryResponse
  try {
    primaryResponse = await requestFromProvider(options)
  } catch (error) {
    if (!fallback) throw error
    primaryResponse = {
      abort: true,
      abortMessage: error.message,
      provider: resolveAIProvider(options),
      model: options.engine,
    }
  }

  if (
    !primaryResponse?.abort ||
    !fallback ||
    primaryResponse.chosen ||
    !shouldFallbackToModel(primaryResponse)
  )
    return primaryResponse

  const fallbackResponse = await requestFromProvider({
    ...options,
    ...fallback,
    prompts: originalPrompts,
    fallback: undefined,
    chainIndex: 1,
    fallbackFromProvider: primaryResponse.provider,
    fallbackReason: primaryResponse.abortMessage,
  })
  return {
    ...fallbackResponse,
    fallbackFrom: {
      provider: primaryResponse.provider,
      model: primaryResponse.model,
      reason: primaryResponse.abortMessage,
    },
  }
}
