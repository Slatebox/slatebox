/* eslint-disable no-underscore-dangle */
import React, { useEffect } from 'react'
import { Meteor } from 'meteor/meteor'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import Snackbar from '@mui/material/Snackbar'
import Alert from '@mui/material/Alert'
import Button from '@mui/material/Button'
import { usePayAction } from '../PayNotice'
import SlateAudioPlayer from '../SlateAudioPlayer'
import CONSTANTS from '../../../api/common/constants'
import initAIConversation from '../../../api/common/initAIConversation'
import { claimPrompt } from '../../common/promptLatch'
import executeSlateOperations from '../../../api/client/executeSlateOperations'
import { summarizeSlate as summarizeSlateForAI } from 'slateboxjs/operations'
import {
  createSlateWithAIContent,
  currentSlateAudioUrl,
  outstandingAIRequests,
  currentUploadedFiles,
  initialPrompt,
  slateBackgroundColorAtom,
} from '../../jotai/atoms'

// Runs the AI a person brought to this slate: the prompt they arrived with (`?prompt=`, the
// get-started page, /ai/...), its welcome turn, the plan the server answers with, and the voice
// the AI speaks in. It draws no window: the slate's one AI surface is the "Ask Slatebox" panel,
// and the work shows on the canvas. Its progress is announced to screen readers here.
export default function SlateAIRunner({
  slate,
  possibleInitialPrompt,
  onInitialPromptConsumed,
  onAIContextReady,
}) {
  const [currentAIContext, setAIContext] = useAtom(createSlateWithAIContent)
  const initialPromptValue = useAtomValue(initialPrompt)
  const [areAIRequestsOutstanding, setOutstandingAIRequests] = useAtom(
    outstandingAIRequests
  )
  const latestAudioUrl = useAtomValue(currentSlateAudioUrl)
  const [uploadedFiles, setUploadedFiles] = useAtom(currentUploadedFiles)
  const setSlateBackgroundColor = useSetAtom(slateBackgroundColorAtom)
  const [problem, setProblem] = React.useState('')
  const [problemAction, setProblemAction] = React.useState(null)
  const payAction = usePayAction()
  const [requestStatus, setRequestStatus] = React.useState(null)

  const handleWelcome = async (resp, userMessage = '') => {
    if (resp?.operationPlan) {
      try {
        setRequestStatus('Applying those changes…')
        // The whole plan is one step this person can undo.
        await executeSlateOperations({
          slate,
          plan: resp.operationPlan,
          userMessage,
          as: 'own',
        })
        await Meteor.callAsync(CONSTANTS.methods.openai.operationCompleted, {
          shareId: slate.shareId,
          operationRequestId: resp.operationRequestId,
        })
      } catch (operationError) {
        try {
          await Meteor.callAsync(CONSTANTS.methods.openai.operationCompleted, {
            shareId: slate.shareId,
            operationRequestId: resp.operationRequestId,
            status: 'error',
          })
        } catch (completionError) {
          // eslint-disable-next-line no-console
          console.error(
            'Failed to record Slatebox AI operation error',
            completionError
          )
        }
        throw operationError
      } finally {
        setOutstandingAIRequests(false)
        setRequestStatus(null)
      }
      return
    }
    if (resp?.intention) {
      let templateLoaded = true
      let templateLoadError = null
      if (resp.slateTemplateId) {
        // Await the template load: the kickoff below reads
        // slate.options.basedOnTemplate + the category set to build the
        // populate prompt. Unloaded = contentless kick (or clean abort after
        // iter 11); either way the template journey never had content.
        try {
          await loadTemplateIntoSlate(resp.slateTemplateId)
        } catch (loadErr) {
          // eslint-disable-next-line no-console
          console.error('[templateLoadFail]', resp.slateTemplateId, loadErr)
          templateLoaded = false
          templateLoadError =
            loadErr?.message || `${loadErr}` || 'unknown load error'
        }
      }

      const result = resp.intentionItems.reduce((acc, item) => {
        acc[item.key] = item.value
        acc[`${item.key}_unchecked`] = item.value
        return acc
      }, {})
      result.val = true
      result.dedicated = true
      result.instructions = resp.instructions
      result.technicalInstructions = resp.technicalInstructions
      result.baseColor = resp?.background?.baseColor || '#fff'
      result.template = resp.slateTemplateId // localAIContext.template

      if (resp.background && resp.applyBackground) {
        // apply the { baseColor, gradientLength, radialOrLinear } to the slate
        const { baseColor, gradientLength, radialOrLinear } = resp.background

        // build the pallette based on the colors
        const palette = await Meteor.callAsync(
          CONSTANTS.methods.colors.buildColorPalette,
          { type: 'shades', base: baseColor }
        )
        const payload = {
          color: baseColor,
          asGradient: true,
          gradientType: radialOrLinear,
          gradientColors: palette.slice(0, gradientLength),
          gradientStrategy: 'shades',
        }
        setSlateBackgroundColor(baseColor)
        slate?.collab.exe({
          type: 'onSlateBackgroundColorChanged',
          data: payload,
        })
      }

      setOutstandingAIRequests(true)
      const initResult = await initAIConversation({
        slate,
        intention: resp.intention,
        result: {
          ...result,
          intentionId: resp.intention._id,
        },
        aid: currentAIContext?.aid,
        uploadedFiles,
        // One-line transport probe: if a template journey aborts, this line
        // in the abort text says whether the template id survived the server
        // round-trip and whether the client load threw (and why).
        probe: `tpl=${resp.slateTemplateId || 'none'} loadOk=${templateLoaded}${templateLoadError ? ` err=${templateLoadError}` : ''}`,
      })
      if (initResult?.abort) {
        // No conversation could start (e.g. template content missing, or the meter refused it).
        // Tell the user instead of spinning forever on a contentless request; a refusal by the
        // meter offers its way on (Get Pro, top up) and asks again after.
        const text = initResult.abortMessage ||
            'Slatebox could not start this request. Try again from Ask Slatebox.'
        setProblem(text)
        setProblemAction(initResult.refusal ? payAction(initResult.refusal, { from: 'draft', retry: () => handleWelcome(resp, userMessage), reason: text }) : null)
        setOutstandingAIRequests(false)
        setRequestStatus(null)
        return
      }
      const { entireAIContext } = initResult
      // outstanding requqests will be set to false in AIContentListener.jsx
      setAIContext(entireAIContext)
      onAIContextReady?.(entireAIContext)
    } else if (resp.slateTemplateId) {
      // the user wants to see the template but maybe not use it yet...
      try {
        await loadTemplateIntoSlate(resp.slateTemplateId)
      } catch (loadErr) {
        // eslint-disable-next-line no-console
        console.error('[templateLoadFail]', resp.slateTemplateId, loadErr)
      }
      setOutstandingAIRequests(false)
      setRequestStatus(null)
    } else {
      // Plain conversation replies are already persisted by the server.
      setOutstandingAIRequests(false)
      setRequestStatus(null)
    }
  }

  useEffect(() => {
    if (!areAIRequestsOutstanding) setRequestStatus(null)
  }, [areAIRequestsOutstanding])

  const loadTemplateIntoSlate = async (templateId) => {
    // need to replace the existing slate with the template
    const getSlate = await Meteor.callAsync(CONSTANTS.methods.slates.get, {
      shareId: templateId,
    })
    if (!getSlate || !getSlate.slateBase) {
      // slates.get legitimately returns null when the guest has no access
      // path to the template; without this guard the kickoff died with an
      // opaque TypeError and the user saw nothing.
      throw new Error(`template fetch returned no slateBase for ${templateId}`)
    }
    // getSlate.slateBase.isEmbedded = isEmbedded
    getSlate.slateBase.options.id = slate.options.id
    getSlate.slateBase.options.shareId = slate.options.shareId
    getSlate.slateBase.options.createdViaIA = true
    getSlate.slateBase.options.isTemplate = false
    getSlate.slateBase.options.templateApproved = false
    getSlate.slateBase.options.basedOnTemplate = templateId
    getSlate.slateBase.options.templateName = getSlate.slateBase.options.name
    await slate.loadJSON(JSON.stringify(getSlate.slateBase))
  }

  useEffect(() => {
    async function initWelcome() {
      // No engine slate yet: nothing to run against. (Historically this
      // threw on null slate and the effect died; the real chain only fired
      // once slate existed.)
      if (!slate) return
      setUploadedFiles(
        slate?.options?.ai?.isConversation?.uploadedDocs ??
          slate?.options?.uploadedFiles ??
          []
      )
      // 'Empty ai' ({}) is the default shape on fresh canvas docs and is
      // TRUTHY — it must not read as "AI context already exists". Only skip
      // the initial prompt when a conversation context actually exists.
      // (v3 engine now mirrors loaded doc options onto the facade, which
      // exposed this guard to ai:{} and silently killed the wizard's
      // /canvas?prompt= auto-submit for every fresh canvas.)
      if (slate?.options?.ai?.isConversation) {
        return
      }
      // A slate that already had its welcome turn does not start again.
      if (slate.options.welcomeAid) return

      const usePrompt = possibleInitialPrompt || initialPromptValue

      if (usePrompt) {
        // ONE prompt dispatch per canvas+prompt for the page lifetime.
        // This effect can execute more than once (mount timing around
        // slate init + prop churn + remounts): live run 3f04265bdf proved
        // two full welcome chains and two kickoffs raced one submit and one
        // shared slate. The latch is page-scoped and survives remounts.
        if (!claimPrompt(`${slate.shareId}|${usePrompt}`)) {
          console.log(
            'initWelcome: duplicate auto-submit suppressed (prompt already claimed)'
          )
          if (possibleInitialPrompt) {
            onInitialPromptConsumed?.()
          }
          return
        }
        if (possibleInitialPrompt) {
          onInitialPromptConsumed?.()
        }
        setOutstandingAIRequests(true)
        setRequestStatus('Understanding your request…')

        const resp = await Meteor.callAsync(CONSTANTS.methods.openai.welcome, {
          templateId: slate.options.basedOnTemplate,
          shareId: slate.shareId,
          initialPrompt: usePrompt,
          currentSlate: summarizeSlateForAI(slate),
        })

        setOutstandingAIRequests(false)
        // setInitialPromptValue(null)

        if (slate.shareId && resp.slateAid) {
          await Meteor.callAsync('slates.updateSettings', {
            shareId: slate.shareId,
            welcomeAid: resp.slateAid,
          })
        }
        await handleWelcome(resp, usePrompt)
      }
    }
    initWelcome()
  }, [slate])

  useEffect(() => {
    async function updatedAttachedFiles() {
      // Only an editor's files are kept with the slate; the server answers no change with no write.
      // Opening a slate sends nothing: only a change of the attached files is saved.
      if (!slate?.shareId) return
      if (JSON.stringify(uploadedFiles) === JSON.stringify(slate.options?.uploadedFiles ?? [])) return
      await Meteor.callAsync('slates.updateSettings', {
        shareId: slate.shareId,
        uploadedFiles,
      }).catch(() => {})
    }
    updatedAttachedFiles()
  }, [slate, uploadedFiles])

  return (
    <>
      {requestStatus && (
        <span role="status" aria-live="polite" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>
          {requestStatus}
        </span>
      )}
      <Snackbar open={Boolean(problem)} onClose={() => setProblem('')} anchorOrigin={{ vertical: 'top', horizontal: 'center' }}>
        <Alert severity={problemAction ? 'warning' : 'error'} onClose={() => setProblem('')}
          action={problemAction ? <Button color="inherit" size="small" onClick={() => { setProblem(''); problemAction.run() }}>{problemAction.label}</Button> : undefined}>{problem}</Alert>
      </Snackbar>
      <SlateAudioPlayer src={latestAudioUrl} />
    </>
  )
}
