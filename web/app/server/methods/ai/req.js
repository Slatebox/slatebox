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
import { chosenShapeAbort } from './shape-abort.mjs'
import utils from '../../../imports/api/common/utils'
import {
  AI_PROVIDERS,
  buildProviderBody,
  buildProviderTelemetry,
  isAllowedPlainTextResponse,
  isRetryableProviderFailure,
  keepsFallbackAfterShapeExhaustion,
  normalizeProviderResponse,
  resolveAIRequestTimeout,
} from './provider.mjs'
import { CODE_LIMITS } from '../../ai-control/resolve.mjs'

// Every request has one route: the part's model in Admin → AI control (or a person's own
// connection on a self-hosted server), with its key from the backend. No key is read from the
// settings file or the environment here.
const INFRA_RETRY_LIMIT = CODE_LIMITS.infraRetries
// Max invalid-JSON responses per provider chain before the chain degrades.
// The old bound was `errs > 5` + throw, and the throw landed in the
// infra-failure catch below, so one dead-format chain legally burned
// 6 primary + 6 fallback calls (live audit 2026-10-30 share …427121: 11
// invalid calls, zero recovery). Three shape failures = model won't fix it.
const SHAPE_RETRY_LIMIT = CODE_LIMITS.shapeRetries
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

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
      // which route served the call: the part, the provider (server:<provider>, or a person's own
      // connection) and the attempt (0 the part's model, 1 the default model after a failing service)
      surface: aiOpts?.surface ?? surfaceFor(aiOpts?.feature) ?? null,
      connection: aiOpts?.connectionRef ?? null,
      attempt: aiOpts?.chainIndex ?? 0,
      ...(aiOpts?.modelId && { modelId: aiOpts.modelId }),
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
  // the provider that served it: an administrator's price applies to that provider's model only
  return chargeProviderCall({ ref: auditId, provider: aiOpts?.priceProvider ?? provider, model, usage, connection: aiOpts?.connectionRef ?? null })
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
  const chosen = operatorWorkshop ? null : aiOpts.route !== undefined ? aiOpts.route : await resolveRequestConnection({ feature: aiOpts.feature, request: { images: withImages, tools: Boolean(aiOpts.functions?.length) }, userId: callerId, forRequest: true })
  delete aiOpts.route
  if (chosen?.disabled) {
    return { abort: true, abortMessage: chosen.message || 'This feature is turned off by your administrator.', fallbackBlocked: true, disabled: true, failure: 'stop', surface: chosen.surface ?? null }
  }
  const chosenConnection = chosen?.connection || null
  aiOpts.connectionRef = operatorWorkshop ? 'selfhost-workshop' : chosen?.ref ?? null
  if (chosen?.surface && !aiOpts.surface) aiOpts.surface = chosen.surface
  if (chosen?.modelId) aiOpts.modelId = chosen.modelId
  // the provider a server route's price is looked up under (models.mjs dbPriceFor)
  if (chosen?.scope === 'server' && chosen.provider) aiOpts.priceProvider = chosen.provider
  // the label a person may read: an operator's connection by its model, not its host
  const chosenLabel = chosenConnection ? chosen.label : null
  if (!operatorWorkshop && (!chosenConnection || chosen?.gap || chosen?.error || (ownKey && !chosen?.own))) {
    const abortMessage = chosen?.gap?.message || chosen?.error ||
      (ownKey && !chosen?.own
        ? `This request is paid by your own AI, but ${chosen?.feature ? featureTitle(chosen.feature).toLowerCase() : 'this feature'} is set to ${chosenLabel || 'this server\'s model'}. Choose your own model for it too in your AI settings.`
        : 'No model answers this part of Slatebox. An administrator chooses one in Admin → AI control.')
    await recordProviderTelemetry({ aiOpts, user, provider: chosenConnection?.type || chosen?.provider || null, model: chosenConnection?.model || null, status: chosen?.gap ? 'capability' : 'configuration_error', error: abortMessage })
    return { abort: true, abortMessage, fallbackBlocked: true, chosen: chosen?.ref, chosenLabel, ...(chosen?.gap ? { capability: chosen.gap.need } : { unusable: true }), failure: ownKey && !chosen?.own ? 'stop' : 'config' }
  }
  aiOpts.unpaid = Boolean(chosen?.own)
  const viaConnection = chosenConnection ? { ...connectionRequest(chosenConnection), fetcher: connectionFetch(chosenConnection.baseUrl, chosen.rules) } : null
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
      return { abort: true, abortMessage: 'This request grew too large. Try a shorter brief.', fallbackBlocked: true, provider: chosenConnection?.type ?? null, model: chosenConnection?.model ?? null }
    }
    // telemetry names a chosen connection 'connection' (its model and route are recorded beside it)
    const provider = viaConnection && !anthropicConnection ? 'connection' : localWorkshop ? 'selfhost-workshop' : AI_PROVIDERS.anthropic
    const useClaude = provider === AI_PROVIDERS.anthropic
    const model = localWorkshop?.model ?? anthropicConnection?.model
    const apiKey = anthropicConnection ? anthropicConnection.apiKey : null

    const payload = {
      provider, model, prompts, system,
      functions: aiOpts.functions,
      functionCall: aiOpts.function_call,
      userId: callerId,
      ...(Number.isFinite(aiOpts.temperature) && { temperature: aiOpts.temperature }),
    }
    if (anthropicConnection) payload.maxTokens = anthropicConnection.maxTokens
    // A feature's own cap on the answer (a presentation plan never needs more), within a connection's.
    if (aiOpts.maxTokens) payload.maxTokens = Math.min(payload.maxTokens || Infinity, aiOpts.maxTokens)
    const ai = localWorkshop ? localWorkshopRequest(localWorkshop, payload) : {
      method: 'POST',
      body: JSON.stringify(buildProviderBody(payload)),
    }

    let response = null
    let responseStatus = null
    const endpoint = localWorkshop?.endpoint ?? anthropicConnection?.endpoint
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
            const wire = viaConnection
            response = await sdkChatRequest({ provider, endpoint, apiKey: localWorkshop?.apiKey || apiKey,
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
        // what went wrong underneath (a reset, a refused lookup, a timeout), for whoever reads the server log
        console.error('unable to invoke', message, String(err?.cause?.code || err?.code || err?.name || '').slice(0, 60), String(err?.cause?.message || err?.message || '').slice(0, 200))
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

    // A call written as text is read only for a caller that opts in (textToolCalls: workshops.draft's lane boards and
    // components), whose own check validates the arguments; every other tool-offering caller is unchanged.
    const normalized = normalizeProviderResponse({ provider, response: response || {}, textTools: aiOpts.textToolCalls ? aiOpts.functions || [] : [] })
    const { message, toolCall, usage } = normalized
    if (toolCall) calledTool = true
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
          abortMessage: 'The agent’s answer could not be used. Try again, or say it another way.',
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

export default async function req(requested, localWorkshop) {
  if (localWorkshop) return requestFromProvider(requested, localWorkshop)
  // Which model serves this request, once: an administrator may have turned the part off.
  const forUser = requestUserId({ userId: requested.userId })
  const request = { images: carriesImages(requested.prompts), tools: Boolean(requested.functions?.length) }
  const route = await resolveRequestConnection({ feature: requested.feature, request, userId: forUser, forRequest: true })
  if (route?.disabled) {
    return { abort: true, abortMessage: route.message || 'This feature is turned off by your administrator.', fallbackBlocked: true, disabled: true, failure: 'stop', surface: route.surface ?? null }
  }
  const original = JSON.parse(JSON.stringify(requested.prompts || []))
  const first = await requestFromProvider({ ...requested, route })
  // The one built-in fallback: when the part's own server model fails as a service (5xx, 429,
  // timeout) after its retries, the default model is asked once, if it is another model.
  if (!first?.abort || first.failure !== 'infra' || route?.scope !== 'server' || !route.modelId) return first
  let fallback = null
  try {
    fallback = await resolveRequestConnection({ feature: requested.feature, request, userId: forUser, useDefault: true, forRequest: true })
  } catch {
    fallback = null
  }
  if (!fallback?.connection || fallback.modelId === route.modelId || fallback.error || fallback.gap) return first
  const second = await requestFromProvider({
    ...requested, prompts: original, route: fallback, chainIndex: 1,
    fallbackFromProvider: route.provider, fallbackReason: first.abortMessage,
  })
  return second?.abort ? first : { ...second, fallbackFrom: { provider: route.provider, model: first.model ?? route.connection?.model ?? null, reason: first.abortMessage } }
}
