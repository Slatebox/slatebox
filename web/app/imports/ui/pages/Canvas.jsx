/* eslint-disable no-nested-ternary */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-restricted-syntax */
/* eslint-disable react/jsx-props-no-spreading */
/* eslint-disable no-underscore-dangle */
import { Meteor } from 'meteor/meteor'
import { Random } from 'meteor/random'
import { Tracker } from 'meteor/tracker'
import { flushSync } from 'react-dom'
import { useAtom, useSetAtom, useAtomValue } from 'jotai'
import { useTracker } from 'meteor/react-meteor-data'
import Cookies from 'js-cookie'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import Snackbar from '@mui/material/Snackbar'
import React, { useEffect } from 'react'
import Grid from '@mui/material/Grid2'
import cloneDeep from 'lodash.clonedeep'

import omit from 'lodash.omit'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { dailyCall } from '../components/huddle/daily-call.mjs'
import createSlate from '../../api/client/createSlate'
import saveSlateLite from '../../api/client/saveSlateLite'
import { watchCanvasKeys } from '../../api/client/canvasKeys'
import CONSTANTS from '../../api/common/constants'
import utils from '../../api/common/utils'
import {
  onCanvas,
  currentSlate,
  currentSlateName,
  slateNameProblem,
  canManageSlate,
  isExtensionsDrawerOpen,
  isSlateDrawerOpen,
  slateOutputOpen,
  isSlateEmbedded,
  createSlateWithTheme,
  huddleEnabled,
  slateHuddleType,
  slatePrivacy,
  isSnapshotOpen,
  createSlateWithAIContent,
  autoPopulateTemplate,
  autoInvokeConversation,
  currentSlateAudioUrl,
  conversationOpen,
  conversationArrival,
  conversationMinimised,
  conversationAvailable,
  globalMessage,
  collaborationUsers,
  askAboutNotes,
  slateBackgroundColorAtom,
  outstandingAIRequests,
  mermaidDialog,
} from '../jotai/atoms'

// global models
import { Comments } from '../../api/common/models'
import initAIConversation from '../../api/common/initAIConversation'
import { sheetBackAfterDrop, watchNoteDrag } from '../../api/common/sheet-drag.mjs'
import KeepNativeSlate from '../components/KeepNativeSlate'
import useCanvasTheme from '../common/useCanvasTheme'
import { withNativeInk } from '../common/canvasTheme.mjs'
// Ask Slatebox loads when the page is idle (or when it opens first): a page that never opens it never waits for it.
const loadNativeConversation = () => import('../components/NativeCanvasConversation')
const NativeCanvasConversation = React.lazy(loadNativeConversation)
import CreativeSlate from '../components/CreativeSlate'
import useWorkshopOnCanvas from '../components/workshop/useWorkshopOnCanvas'
import useConversationPreview from '../components/useConversationPreview'
// A board's conversation (its lane, rule and map sentences) loads only on a slate that holds a board.
const loadWorkshopConversation = () => import('../components/workshop/WorkshopConversation')
const WorkshopConversation = React.lazy(loadWorkshopConversation)
import { WorkshopOutcomes, WorkshopStatus } from '../components/workshop/WorkshopChrome'
import { workshopNamesSlate } from '../../api/common/workshop-notes.mjs'
import { MAX_BOARDS, slateBoards } from '../../api/common/slate-boards.mjs'
import CommentDrawer from '../components/CommentDrawer'
import SlateDrawer from '../components/SlateDrawer'
import SlateSharing from '../components/slate/SlateSharing'
import CollaborationUsers from '../components/CollaborationUsers'
import SlateAIRunner from '../components/ai/SlateAIRunner'
import CanvasBottomBar from '../components/CanvasBottomBar'
import QuickNodeActions from '../components/node/QuickNodeActions'
import { customShapePackage } from '../../api/common/note-style.mjs'
import { LIBRARY_EVENT } from '../components/library/libraryBus'
import StyleBar from '../components/stylebar/StyleBar'

// Packages about the view or who is present: they change nothing a style bar shows.
const BAR_VIEW_ONLY = new Set(['onZoom', 'onCanvasMove', 'onFollowMeChanged', 'onSlateFollowMeChanged',
  'onSlateHuddleChanged', 'onCursorMoved', 'onPresenceChanged', 'onMouseMoved', 'onCollaborationUserCustomDataChanged'])
import AddTools from '../components/stylebar/AddTools'
import AskAboutNote from '../components/stylebar/AskAboutNote'
import SlateSnapshots from '../components/slate/SlateSnapshots'
import AuthManager from '../../api/common/AuthManager'
import confirmService from '../common/confirm'
import AIContentListener from '../components/ai/AIContentListener'
import NeuralThinking from '../components/ai/NeuralThinking'
import AdHocAINodes from '../components/AdHocAINodes'
import PresentSlateDialogue from '../components/PresentSlateDialogue'
import SlateOperationListener from '../components/SlateOperationListener'
import LineToolStatus from '../components/stylebar/LineToolStatus'
import AgentPresenceListener from '../components/AgentPresenceListener'
import { CreativeStates, livePresentationTicket, NativePresentationStates } from '../../api/client/creativeSlateStates'
import { presentPeople } from '../../api/common/presence.mjs'
import { sidePanels } from '../../api/common/side-panels.mjs'
import SlateOutputDialog from '../components/slate/SlateOutputDialog'
import SlateWelcome from '../components/SlateWelcome'
import SlateLoading from '../components/SlateLoading'
import useMinimapWhenNeeded from '../common/useMinimapWhenNeeded'
import { useNoteOnDoubleClick } from '../common/newNote.mjs'
import '../common/main.css'
import { noteSelection } from '../../api/common/chat-selection.mjs'

// Viewport and presence packages can save a snapshot without changing the team's work.
const viewEvents = new Set(['onZoom', 'onCanvasMove', 'onMouseMoved', 'onCursorMoved', 'onPresenceChanged',
  'onFollowMeChanged', 'onSlateFollowMeChanged', 'onSlateHuddleChanged', 'onCollaborationUserCustomDataChanged',
  'onSlateChanged'])

// Mermaid's dialog (and the Mermaid code with it) loads only when someone opens it.
const MermaidDialog = React.lazy(() => import('../components/slate/MermaidDialog'))

export default function Canvas() {
  const history = useNavigate()
  const { id, asEmbed } = useParams()
  const [searchparams, setSearchParams] = useSearchParams()
  const [possibleInitialPrompt, setPossibleInitialPrompt] = React.useState(() =>
    searchparams.get('prompt')
  )
  const consumeInitialPrompt = React.useCallback(() => {
    setPossibleInitialPrompt(null)
    const nextSearchParams = new URLSearchParams(searchparams)
    nextSearchParams.delete('prompt')
    setSearchParams(nextSearchParams, { replace: true })
  }, [searchparams, setSearchParams])

  const theme = useTheme()
  const slate = React.useRef(null)
  const [nativeBoard,setNativeBoard] = React.useState(null)
  const [nativeChatOpen,setNativeChatOpen] = useAtom(conversationOpen)
  const [chatMinimised,setChatMinimised] = useAtom(conversationMinimised)
  // The + menu's "Boards and starters" row asks for the library: Ask Slatebox opens on it (or sends the add message).
  const [libraryRequest,setLibraryRequest] = React.useState(null)
  useEffect(() => {
    const go = () => { loadNativeConversation().catch(() => { /* Fetched again when it opens. */ }) }
    const idle = typeof window.requestIdleCallback === 'function' ? window.requestIdleCallback(go, { timeout: 3000 }) : setTimeout(go, 1500)
    return () => { if (typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle); else clearTimeout(idle) }
  }, [])
  useEffect(() => {
    const hear = event => { setNativeChatOpen(true); setLibraryRequest({ ...event.detail, nonce: Date.now() }) }
    window.addEventListener(LIBRARY_EVENT, hear)
    return () => window.removeEventListener(LIBRARY_EVENT, hear)
  }, [])
  const setConversationAvailable = useSetAtom(conversationAvailable)
  const setConversationArrival = useSetAtom(conversationArrival)
  const pendingConversationFit = React.useRef(null)
  const drawingState = useTracker(()=>{
    if(!nativeBoard || asEmbed || nativeBoard.creative && !nativeBoard.nativeCanvasDrawing) return null
    Meteor.subscribe('slates.presentationState',id)
    const state = NativePresentationStates.findOne(id, { fields: { nativeConversationRevision: 1, holdsBoard: 1, workshopOrigin: 1, boards: 1 } })
    return state ? { revision: state.nativeConversationRevision ?? 0, holdsBoard: Boolean(state.holdsBoard), origin: state.workshopOrigin ?? null,
      boards: Array.isArray(state.boards) ? state.boards.map(board => board.id) : null } : null
  },[id,nativeBoard,asEmbed])
  // A board added to this slate on another page (a teammate's Keep, an agent's add_component) is
  // drawn here live: adding a board changes no note, so the notes on this page are still the slate's
  // own. Anything more than that one change since (a drawing kept meanwhile) asks for a reload.
  // A further board added beside the ones this page draws is the same one change: the page draws it from its
  // own live record (useWorkshopOnCanvas) and its saves name the new revision.
  const anotherBoard = Boolean(nativeBoard?.creative && drawingState?.boards && drawingState.boards.some(board => !(nativeBoard.boardIds ?? ['main']).includes(board)))
  const boardArrived = Boolean(nativeBoard && (!nativeBoard.creative && drawingState?.holdsBoard || anotherBoard) &&
    drawingState.revision === (nativeBoard.nativeConversationRevision ?? 0) + 1)
  const newerDrawing = Boolean(nativeBoard && drawingState && !boardArrived && drawingState.revision > (nativeBoard.nativeConversationRevision ?? 0))
  useEffect(()=>{const open=()=>setNativeChatOpen(true);window.addEventListener('slatebox:open-canvas-conversation',open);return ()=>window.removeEventListener('slatebox:open-canvas-conversation',open)},[])
  const [creativeKind, setCreativeKind] = React.useState(null)
  // A board kept on this slate becomes part of the page as it is, with no reload: the slate's own
  // notes stay where they are and the board is drawn beside them (useWorkshopOnCanvas), at the place
  // the server stored. `nativeConversationRevision` is the revision the page's saves name from now on.
  const takeBoard = React.useCallback(({ origin = null, nativeConversationRevision, boardIds = null } = {}) => {
    const drawing = slate.current
    if (!drawing || !Number.isSafeInteger(nativeConversationRevision)) return false
    // A further board on a slate this page already draws boards on: only the revision its saves name moves.
    if (drawing.creativeKind === 'workshop') {
      drawing.nativeConversationRevision = nativeConversationRevision
      setNativeBoard(board => board && { ...board, nativeConversationRevision, ...(boardIds && { boardIds }) })
      return true
    }
    if (drawing.creativeKind) return false
    drawing.creativeKind = 'workshop'
    drawing.nativeConversationRevision = nativeConversationRevision
    const place = Number.isFinite(origin?.x) && Number.isFinite(origin?.y) ? { x: origin.x, y: origin.y } : null
    if (place) drawing.workshopOrigin = place
    setNativeBoard(board => board && { ...board, nativeCanvasDrawing: true, creative: { model: { kind: 'workshop' } }, nativeConversationRevision, boardIds: boardIds ?? ['main'],
      options: { ...board.options, ...(place && { workshopOrigin: place }) } })
    setCreativeKind('workshop')
    return true
  }, [])
  useEffect(() => { if (boardArrived) takeBoard({ origin: drawingState.origin, nativeConversationRevision: drawingState.revision, boardIds: drawingState.boards }) }, [boardArrived])
  const [guestEditLink, setGuestEditLink] = React.useState(null)
  const [keepOffer, setKeepOffer] = React.useState(null)
  const nativeProof = React.useRef(null)
  function editProof(create = false) {
    if (nativeProof.current?.key === id) return nativeProof.current.value
    let value
    try { value = sessionStorage.getItem('nativeEdit:' + id) } catch { /* private browsing */ }
    if (!value && create) {
      value = Random.hexString(48)
      try { sessionStorage.setItem('nativeEdit:' + id, value) } catch { /* keep in this session */ }
    }
    if (value) nativeProof.current = { key:id, value }
    return value
  }
  const accessLevel = React.useRef({
    isReadOnly: false,
    isCommentOnly: false,
    isEditable: false,
  })
  // What the slate's sharing grants this person, before a workshop's join rule is applied.
  const grantedReadOnly = React.useRef(false)
  const renameTimer = React.useRef(null)
  const collabRef = React.useRef()
  const collaborator = React.useRef()
  //   Collaborators.findOne({ shareId: id, userId: Meteor.userId() })
  // )
  const setGlobalMessage = useSetAtom(globalMessage)
  const [isOnCanvas, setOnCanvas] = useAtom(onCanvas)
  const [getCurrentSlate, setSlate] = useAtom(currentSlate)
  const [getCurrentSlateName, setSlateName] = useAtom(currentSlateName)
  const setNameProblem = useSetAtom(slateNameProblem)
  const [currentCollaborators, setCurrentCollaborators] =
    useAtom(collaborationUsers)
  const setAskAbout = useSetAtom(askAboutNotes)
  // What is selected on the canvas and where, from the engine (contextToolbar: 'host').
  const [selectionFrame, setSelectionFrame] = React.useState(null)
  // The line tool is drawing (see LineToolStatus).
  const [drawingLine, setDrawingLine] = React.useState(false)
  // Bumped by every change from someone else, so an open style bar reads its note again.
  const [barTick, setBarTick] = React.useState(0)
  const [getHuddleEnabled, setHuddleEnabled] = useAtom(huddleEnabled)
  const [getHuddleType, setHuddleType] = useAtom(slateHuddleType)
  const [snapshotOpen, setSnapshotOpen] = useAtom(isSnapshotOpen)
  const [getSlatePrivacy, setSlatePrivacy] = useAtom(slatePrivacy)
  const setSlateAudioURL = useSetAtom(currentSlateAudioUrl)
  const setSlateBackgroundColor = useSetAtom(slateBackgroundColorAtom)
  const setCanManageSlate = useSetAtom(canManageSlate)
  const [embeddedSlate, setEmbeddedSlate] = useAtom(isSlateEmbedded)
  const [extensionsDrawerOpen, setExtensionsDrawerOpened] = useAtom(
    isExtensionsDrawerOpen
  )
  const [createWithTheme, setCreateSlateWithTheme] =
    useAtom(createSlateWithTheme)
  const setOutstandingAIRequests = useSetAtom(outstandingAIRequests)


  const [slateDrawerOpen, setSlateDrawerOpen] = useAtom(isSlateDrawerOpen)
  const setSlateOutput = useSetAtom(slateOutputOpen)
  const [mermaidOpen, setMermaidOpen] = useAtom(mermaidDialog)
  // An import lands beside what the slate holds; once its notes are drawn (the operation runs
  // replay them here), the view widens to show them.
  const revealImported = (ids) => {
    const started = Date.now()
    const check = () => {
      const engine = slate.current?.v2 ?? slate.current
      if (!engine) return
      const drawn = ids.every((nid) => engine.nodes?.allNodes?.some((n) => n.options?.id === nid))
      if (drawn) engine.fitToContent?.()
      else if (Date.now() - started < 8000) setTimeout(check, 150)
    }
    check()
  }
  const [currentAIContext, setAIContext] = useAtom(createSlateWithAIContent)
  const [localAIContext, setLocalAIContext] = React.useState(null)
  const effectiveAIContext = localAIContext?.aid
    ? localAIContext
    : currentAIContext

  const [getAutoPopulateTemplate, setAutoPopulateTemplate] =
    useAtom(autoPopulateTemplate)

  const [getAutoInvokeConversation, setAutoInvokeConversation] = useAtom(
    autoInvokeConversation
  )

  const containerId = 'slateCanvas'

  const [commentDrawerOpts, setCommentDrawer] = React.useState({
    open: false,
    nodeId: null,
    slateId: null,
    slateName: null,
    orgId: null,
    cb: null,
  })
  const slateOrgId = React.useRef(null)

  // A control beside the canvas that has no use for the keyboard hands it back, so Delete after
  // a colour is picked still means the selected note (see canvasKeys.js).
  useEffect(() => watchCanvasKeys(() => document.getElementById(containerId)), [])
  // In dark mode the canvas is dark too, unless the slate has a background of its own (canvasTheme.mjs).
  // A reader's share link opens this same page, so it follows the same rule.
  const canvasRef = React.useRef(null)
  // The revision the canvas was drawn from: the agent runs it is sent are those saved after it.
  const loadedRevision = React.useRef(0)
  useCanvasTheme(canvasRef, () => (slate.current?.v2 ?? slate.current)?.options?.containerStyle)
  function openComments(node) {
    setCommentDrawer({
      nodeId: node.options.id,
      slateId: slate.current.options.id,
      slateName: slate.current.options.name,
      orgId: slateOrgId.current,
      open: true,
      closeDrawer: () => {
        setCommentDrawer({
          open: false,
          nodeId: null,
          slateId: null,
          slateName: null,
        })
      },
    })
  }

  function contextuallySetSlate({ userId, orgId, shareId }) {
    const exportSlate = JSON.parse(slate.current.exportJSON())
    exportSlate.userId = userId
    exportSlate.orgId = orgId
    exportSlate.shareId = shareId
    if (slate.current.creativeKind) exportSlate.creativeKind = slate.current.creativeKind
    if (slate.current.workshopTitled) exportSlate.workshopTitled = true
    setSlate(exportSlate)
  }

  const packageUp = (pkg, node) => {
    const ppkg = cloneDeep(pkg)
    if (ppkg.data.forEach) {
      ppkg.data.forEach((p) => {
        const pp = p
        pp.id = node.options.id
      })
    } else if (node) {
      // { type: "onNodeColorChanged", data: { attr: { fill: color, "fill-opacity": 1 }, color: color } }
      ppkg.data.id = node.options.id
    }
    // always attach the instanceId
    ppkg.instanceId = collaborator.current?.instanceId
    return ppkg
  }

  const onUpdateNode = (pkg, node) => {
    let packages = pkg
    if (!Array.isArray(packages)) {
      packages = [packageUp(pkg, node)]
    }
    // all local invocations go through collab
    slate?.current?.collab.invoke(packages)
    // saves the collab doc for other slates to observe
    slate?.current?.collab.send(packages)
  }

  // The style bar's changes. Each goes through packageUp (per note), collab.invoke (applied here
  // and put in undo history) and collab.send (shared and saved): the same path as every edit.
  // `pkgs` is a list of packages for every note, or a function from a note to its own list.
  function updateNode(pkgs, nodes) {
    const list = (nodes ?? []).filter(Boolean)
    if (!list.length) return
    const packages = list.flatMap((n) => (typeof pkgs === 'function' ? pkgs(n) : pkgs).map((pkg) => packageUp(pkg, n)))
    if (packages.length) onUpdateNode(packages)
  }
  function updateLine(pkg, line) {
    if (!line?.node) return
    onUpdateNode(pkg, line.node)
  }
  // Ask Slatebox from a bar: the conversation opens, with the note attached when it is a note.
  function askAbout(nodes, { card = false } = {}) {
    if (!card) setAskAbout({ ids: nodes.map((n) => n.id), text: nodes.length === 1 ? nodes[0].options?.text : '' })
    setNativeChatOpen(true)
  }
  // "Change this board" (the gear over a board, the bar of a selected lane, the chat's starter): the
  // conversation opens about the whole board, and the view is fitted to it once the panel has settled.
  // On a slate of many boards, the board the gear or bar is on: focus moves to it, unless a preview of
  // another board still waits for Keep or Discard (focus stays on the previewed board until then).
  function changeBoard(boardId = 'main') {
    setNativeChatOpen(true)
    const all = boardsRef.current ?? []
    const target = all.find(board => board.boardId === boardId) ?? workshopRef.current
    const held = all.find(board => board.focusLocked && board.focus)
    if (held && held !== target) return
    for (const board of all) if (board !== target && board.focus) board.leaveFocus?.()
    target?.focusBoard?.()
    try { localStorage.setItem('slatebox:last-board:' + id, target?.boardId ?? 'main') } catch { /* Storage is optional. */ }
  }

  let saveTimeout = null
  async function loadSlate(slateBase, isNew, isGuest) {
    const sBase = slateBase
    const savedPrivacy = !isNew && sBase.options && {
      isPrivate: sBase.options.isPrivate,
      isPublic: sBase.options.isPublic,
      isUnlisted: sBase.options.isUnlisted,
    }
    setSlatePrivacy(savedPrivacy || {})
    if (Meteor.user() && Meteor.user().orgId) {
      sBase.orgId = Meteor.user().orgId
    }

    let pendingEdit = null
    // attach events and collaboration
    const events = {
      onSlateChanged: async (pkg, collabUsers) => {
        // special handling of ai
        if (pkg.type === 'onNodeAITextChanged') {
          collabRef.current?.adhocAINodes([pkg])
          return
        }
        if (pkg.type === 'onSlateAISet') {
          collabRef.current?.potentiallySetAIContext(pkg.data)
        }

        // is slate initialized?
        if (!slate.current) {
          return
        }

        if (pkg.type && !viewEvents.has(pkg.type)) pendingEdit = pkg
        async function save() {
          // A pan can debounce a note edit into the same save. Clear only the edit this snapshot includes.
          const edit = pendingEdit
          const proof = edit && !asEmbed && !slateBase.creative && !slateBase.options.isEmbedded &&
            !Meteor.userId() && accessLevel.current.isEditable && id !== slateBase.shareId && id !== slateBase.options.url_name
            ? editProof(true) : null
          const result = await saveSlateLite({
            keepProof: proof,
            hasLocalEdit: Boolean(edit),
            routeKey: id,
            type: pkg.type,
            slate: slate.current,
            guestCollaboratorId: collaborator.current?.instanceId,
          })
          if (result?.canKeep) setKeepOffer({ key:id, proof, slateId:slateBase.options.id, visitor:collaborator.current?.instanceId })
          if (edit === pendingEdit) pendingEdit = null
          // auto save theme as well if need be
          if (slate.current.options.eligibleForThemeCompilation) {
            await Meteor.callAsync(
              CONSTANTS.methods.themes.parseSlateIntoTheme,
              {
                slateId: slate.options.id,
              }
            )
          }
        }
        clearTimeout(saveTimeout)
        // Text edits are committed on Enter/blur. Dispatch their snapshot while
        // the editor is still connected, even if they immediately close the tab.
        if (pkg.type === 'onNodeTextChanged') await save()
        // A save the server refuses (a teammate kept a drawing meanwhile, so this page is behind and says
        // "A teammate updated this drawing") is not a page error: the page's own notice takes it from there.
        else saveTimeout = setTimeout(() => save().catch(error => console.warn('This slate was not saved.', error?.error ?? error)), 500)
        // prior to getting here, the collab invoke function is called for the local slate in the onUpdateNode function here (in Canvas), and then...
        // saveSlate writes to Collaboration, and CollaborationUsers observes that and invokes the slate collab function for other slates
        if (pkg.type !== 'onMouseMoved') {
          contextuallySetSlate(slate.current)
        }

        const { isTemplate, templateApproved, isPublic, isPrivate, isUnlisted, isEmbedded } = slate.current.options
        const publishedTemplate = isTemplate && templateApproved && isPublic && !isPrivate && !isUnlisted

        // special handling of deleted comment node
        if (pkg.data.isComment && pkg.type === 'onNodeDeleted') {
          await Meteor.callAsync(CONSTANTS.methods.comments.remove, {
            nodeId: pkg.data.id,
            slateId: slate.current.options.id,
            orgId: Meteor.user().orgId,
          })
        }

        // special work for templates or embedded slates
        if (
          !['onMouseMoved', 'onCanvasMove'].includes(pkg.type) &&
          (publishedTemplate || isEmbedded)
        ) {
          slate.current.options.urlName = utils.safeForUrls(
            slate.current.options.name
          )
          if (!slate.current.savingTemplateImage) {
            slate.current.savingTemplateImage = true
            withNativeInk(() => slate.current.png({ base64: true }, async (base64) => {
              const urlDetails = await Meteor.callAsync(
                CONSTANTS.methods.utils.getCloudLink,
                slate?.current?.options.id,
                base64,
                false,
                publishedTemplate,
                slate?.current?.options?.isEmbedded
              )
              if (!urlDetails?.slateImageUrl) {
                slate.current.savingTemplateImage = false
                return
              }
              slate.current.options.staticImage = urlDetails.slateImageUrl
              slate.current.options.staticFrameImage =
                urlDetails.slateImageWithFrameUrl
              await saveSlateLite({
                routeKey: id,
                type: null,
                slate: slate.current,
                guestCollaboratorId: collaborator.current?.instanceId,
              })
              slate.current.savingTemplateImage = false
            }))
          }
        }
      },
      onCollaborationUsersChanged: (users) => {
        setCurrentCollaborators(presentPeople(users, collaborator.current?.personKey))
      },
      onCollaborationUsersRemoved: (users) => {
        setCurrentCollaborators(presentPeople(users, collaborator.current?.personKey))
      },
      onCollaboration: async (pkg) => {
        switch (pkg.type) {
          case 'onCollaborationUserCustomDataChanged': {
            break
          }
          case 'onSlateHuddleChanged': {
            break
          }
          default: {
            // A change someone else made to the slate (not where they are looking or pointing).
            if (!BAR_VIEW_ONLY.has(pkg?.type)) setBarTick((t) => t + 1)
            break
          }
        }
      },
      onInitCollaboration: async (clientID) => {
        let idx = clientID
        if (isGuest) {
          setGuestEditLink(null)
          if (!Cookies.get(CONSTANTS.guestCollaboratorCookieId)) {
            Cookies.set(CONSTANTS.guestCollaboratorCookieId, clientID, {
              expires: 1,
            }) // always a one day expiration
          }
          idx = Cookies.get(CONSTANTS.guestCollaboratorCookieId)
        }
        // Who this person is to their peers. If that fails, the visit is still recorded below
        // (organizations.trackGuest), or a visitor with no account could not save at all.
        let collaboratorDetails = {}
        try {
          collaboratorDetails = await Meteor.callAsync(
            CONSTANTS.methods.collaborators.init,
            {
              id: idx,
              shareId: slateBase.shareId,
            }
          )
        } catch (error) {
          // eslint-disable-next-line no-console
          console.warn('Collaboration details are unavailable; editing continues without them.', error?.reason ?? error)
        }

        collaborator.current = {
          // const collaborator = JSON.parse(JSON.stringify(opts))
          _id: idx,
          instanceId: idx,
          shareId: slateBase.shareId,
          userId: Meteor.userId(),
          created: Date.now(),
          isAnonymous: collaboratorDetails.isAnonymous,
          userName: collaboratorDetails.userName,
          color: collaboratorDetails.color,
          personKey: collaboratorDetails.personKey,
        }

        let trackGuest = null
        if (isGuest) {
          trackGuest = await Meteor.callAsync(
            CONSTANTS.methods.organizations.trackGuest,
            {
              slateOrgId: slateBase.orgId,
              slateId: slateBase.options.id,
              slateOwner: slateBase.userId,
              userId: Meteor.userId(),
              orgId: Meteor.user() ? Meteor.user().orgId || null : null,
              guestCollaboratorId: idx,
              isUnlisted: slateBase.options.isUnlisted,
              isPublic: slateBase.options.isPublic,
            }
          )
        }

        // if user doesn't exist here, we should log them as a guest -- they're viewing
        // the canvas of an unlisted slate
        let verb = ''
        if (accessLevel.current.isReadOnly) {
          verb = 'read-only'
        } else if (accessLevel.current.isCommentOnly) {
          verb = 'comment-only'
        } else if (accessLevel.current.isEditable) {
          verb = 'full'
        }

        if (isGuest && !trackGuest.allow) {
          await confirmService.show({
            theme,
            title: `Slate is inaccessible`,
            message: `This slate is not shared with you.`,
            actionItems: [{ label: 'OK', return: false }],
          })
          history('/')
          return
        }

        const invitedCreativeGuest = !asEmbed && !Meteor.userId() && slateBase.creative && accessLevel.current.isEditable && trackGuest?.allow
        if (invitedCreativeGuest) setGuestEditLink(id)
        if (!asEmbed && !slateBase.creative && !slateBase.options.isEmbedded && !Meteor.userId() && trackGuest?.allow &&
            accessLevel.current.isEditable && editProof()) {
          const proof = editProof()
          if (await Meteor.callAsync('slates.canKeepNativeEdit', id, proof).catch(() => false)) {
            setKeepOffer({ key:id, proof, slateId:slateBase.options.id, visitor:idx })
          }
        }
        // A returning follower has already accepted the invitation. Keep the
        // normal access and quota checks above; resume only this same live room.
        const live = slateBase.livePresentation
        const resuming = live?.expiresAt > Date.now() && livePresentationTicket(id)?.sessionId === live.sessionId
        // Interactive slates show the available action or viewing permission on the board.
        if (!resuming && !slateBase.creative && !asEmbed && !slateBase.options.isEmbedded &&
          !slateBase.options.basedOnTemplate && Meteor.userId() !== slateBase.userId &&
          (!isGuest || slateBase.options.isUnlisted || slateBase.options.isPublic)) {
          await confirmService.show({
            theme,
            title: 'Welcome to Slatebox!',
            message: isGuest
              ? `You have ${verb} access to this slate by ${trackGuest.slateOwnerUserName}.`
              : `You have ${verb} access to this slate.`,
            actionItems: [{ label: 'OK', return: true }],
          })
        }

        const userBaseData = {
          websocketUrl: collaboratorDetails.wsUrl,
          websocketParams: collaboratorDetails.wsParams,
          ...collaborator.current,
          x: 0,
          y: 0,
        }

        return userBaseData
      },
      onConfirmRequested: async (title, msg, cb) => {
        const res = await confirmService.show({
          theme,
          title,
          message: msg,
          actionItems: [
            { label: 'Cancel', return: false },
            { label: 'OK', return: true },
          ],
        })
        cb(res)
      },
      onTakeSnapshot: async (opts) => {
        // A workshop slate's history is its workshop's revisions; version history is not offered there.
        if (slate.current?.creativeKind === 'workshop') return
        await Meteor.callAsync(CONSTANTS.methods.slates.createSnapshot, {
          slateId: opts.slateId,
          snapshot: opts.snapshot,
        })
      },
      // A comment's text is edited in the comments drawer. Any other note asked for this
      // (a picture or a locked note, which are not edited on the canvas) is selected, so its
      // style bar is there.
      onTextPaneRequested: (node) => {
        setExtensionsDrawerOpened(false)
        setSlateDrawerOpen(false)
        if (node.options.isComment) openComments(node)
        else slate.current?.v2?.selectNodes?.([node.v2 ?? node])
      },
      onSelectionFrame: (frame) => setSelectionFrame(frame),
      onLineToolChanged: (on) => setDrawingLine(Boolean(on)),
      onBase64ImageRequested: (imgUrl, docType, cb) => {
        async function get() {
          try {
            const results = await Meteor.callAsync(
              CONSTANTS.methods.utils.base64StringFromRemoteUrl,
              { type: docType, url: imgUrl }
            )
            cb(null, results)
          } catch (err) {
            cb(err)
          }
        }
        get()
      },
      onOptimizeSVG: (svg, cb) => {
        async function get() {
          try {
            // console.log("optimizing", svg);
            const optimized = await Meteor.callAsync(
              CONSTANTS.methods.utils.optimizeSVG,
              svg
            )
            // console.log("optimized", optimized);
            cb(null, optimized)
          } catch (err) {
            cb(err)
          }
        }
        get()
      },
      isReadOnly: () => accessLevel.current.isReadOnly,
      isCommentOnly: () => accessLevel.current.isCommentOnly,
      onThemeRequired: (opts, cb) => {
        Meteor.call(
          CONSTANTS.methods.themes.getThemes,
          { themeId: opts.themeId },
          (err, res) => {
            cb(err, res)
          }
        )
      },
    }

    // Destroy any prior slate before creating a new one (a canvas switch that re-runs
    // loadSlate without a full Canvas unmount) — otherwise the old Slate leaks in
    // window.__slateboxInstances with its GLOBAL keyboard listeners, ResizeObserver, and
    // timers still live (they accumulate across navigations). destroy() is a no-op the
    // first time (slate.current is null) and best-effort/idempotent thereafter.
    slate.current?.destroy?.()

    loadedRevision.current = Number.isInteger(sBase.revision) ? sBase.revision : 0
    // create slate (the createWithTheme will inhibit the saving of the slate until the theme is applied)
    slate.current = await createSlate(
      sBase,
      events,
      isNew,
      isGuest,
      createWithTheme,
      currentAIContext
    )

    slate.current.nativeConversationRevision = sBase.nativeConversationRevision ?? 0
    slate.current.creativeKind = sBase.creative?.model?.kind
    slate.current.workshopTitled = workshopNamesSlate(sBase)
    setNativeBoard({...sBase, routeKey:id, boardIds:slateBoards(sBase).map(board=>board.id), canConverse:Boolean(Meteor.userId() && !asEmbed && !sBase.options?.isEmbedded &&
      (isNew || Meteor.userId()===sBase.userId || accessLevel.current.isEditable))})
    // A workshop's conversation starts open beside a wide canvas. On a phone the canvas keeps
    // the screen until the person asks, except for a map nobody has changed yet: that one is
    // authored through the conversation.
    const authored = sBase.creative?.model?.kind === 'workshop' ? sBase.creative.model.workshop : null
    const openConversation = authored ? window.innerWidth >= 1000 || Boolean(authored.lanes?.[0]?.station && !sBase.creative.revision)
      : !sBase.creative && Boolean(isNew || sBase.options?.creationBrief || sBase.nativeConversationRevision || !(sBase.nodes||[]).length)
    pendingConversationFit.current = openConversation && !sBase.creative ? slate.current : null
    setNativeChatOpen(openConversation)
    // Opened by the slate itself: its button opens it, not closes it, until it is in sight (conversation-toggle.mjs).
    setConversationArrival(openConversation ? { shownAt: null } : null)
    setCreativeKind(slate.current.creativeKind || null)

    // for outside access
    window.slate = slate.current
    window.slate.pngLinkSync = async ({ slateId }) => {
      const base64 = await withNativeInk(() => window.slate.pngSync({ base64: true }))
      const res = await Meteor.callAsync(
        CONSTANTS.methods.utils.getCloudLink,
        slateId,
        base64
      )
      return res
    }

    if (createWithTheme) {
      if (createWithTheme.styles.parent.opacity === 0) {
        slate.current.nodes.allNodes[0].options.text = 'Welcome'
      }
      // this applies the theme to the current slate using the collab.invoke
      // which stitches in the options to the slate, but does not
      // broadcast those (using send)
      slate.current.applyTheme(createWithTheme, true)
      // fix for init node
      // slate.nodes.allNodes[0].options.vectorPath = slate.nodes.allNodes[0].vect.attr("path");
      // if the opacity of the entry node is 0 then set some text
      // setCreateSlateWithTheme(null)

      // give it 1500 ms before saving
      // await utils.pause(1500)

      // saving the slate
      await saveSlateLite({
        routeKey: id,
        type: null,
        userId: sBase.userId, // Ensure correct user ID context
        orgId: sBase.orgId, // Ensure correct org ID context
        slate: slate.current,
      })

      setCreateSlateWithTheme(null)
    }

    // ensure the neural thinking background color is set
    setSlateBackgroundColor(
      slate.current.options.containerStyle.backgroundColor
    )

    // set slate name and always attach shareId, userId and orgId to the dispatched slate
    slate.current.shareId = sBase.shareId
    if (isNew && !asEmbed && Meteor.userId() && Meteor.userId()===sBase.userId && !createWithTheme) {
      await saveSlateLite({routeKey:id,userId:sBase.userId,orgId:sBase.orgId,slate:slate.current})
    }
    slate.current.userId = sBase.userId
    slate.current.orgId = sBase.orgId

    contextuallySetSlate(slate.current)

    // setSlate(cloneDeep(slate.current))
    // needs to happeen after the clone above because of a max callstack error
    // await slate.current.collab.init()
    setHuddleEnabled(false) // slate.current.options.huddleEnabled
    setHuddleType(slate.current.options.huddleType)
    // }
    setSlateName(slate.current?.options?.name)
    setSlatePrivacy(savedPrivacy || {
      isPublic: slate.current?.options?.isPublic,
      isUnlisted: slate.current?.options?.isUnlisted,
      isPrivate: slate.current?.options?.isPrivate,
    })

    if (slate.current?.options.ai) {
      setAIContext({
        ...slate.current?.options.ai,
      })
    }

    // flushSync(() => {
    //   setAIContext({
    //     ...slate.current?.options.ai,
    //   })
    //   console.log('set ai context onload', currentAIContext)
    // })

    return true
  } // loadSlate

  // useEffect(() => {
  //   if (slate.current?.options.ai?.aid) {
  //     flushSync(() => {
  //       setAIContext({
  //         ...slate.current?.options.ai,
  //       })
  //       console.log('set ai context onload', currentAIContext)
  //     })

  //     // setLocalAIContext({
  //     //   ...slate.current?.options.ai,
  //     // })
  //   }
  // }, [slate.current])

  // A note added from the tool dock (or "+ Add") is selected, so its style bar is there; text
  // is typed straight into a new text note.
  const handleNodeCreated = (node, shape) => {
    if (node.options.isComment) {
      openComments(node)
      return
    }
    const v2 = slate.current?.v2
    const added = node.v2 ?? node
    Promise.resolve(added?.ready).then(() => {
      v2?.selectNodes?.([added])
      if (shape?.key === 'addText') added.editor?.startInline?.()
    })
  }

  useTracker(() => {
    if (slate.current) {
      Meteor.subscribe(CONSTANTS.publications.comments, {
        slateId: slate.current.options.id,
      })
      // Count comments per target node (resolved vs unresolved). The old code did
      // `x += x` (always 0) and rendered the count by OVERWRITING the node's text +
      // color via the v1 editor/colorPicker API — undefined on v2 nodes, so `.set`
      // threw and crashed the whole Canvas render whenever a comment existed. Now we
      // count correctly and render a non-destructive corner badge via the v2
      // node.setCommentBadge() / node.clearCommentBadge().
      const counts = {}
      Comments.find({}).forEach((c) => {
        if (!counts[c.nodeId]) counts[c.nodeId] = { resolved: 0, unresolved: 0 }
        if (c.resolved) counts[c.nodeId].resolved += 1
        else counts[c.nodeId].unresolved += 1
      })
      slate.current.nodes.allNodes.forEach((node) => {
        // Badges go on the commented (target) nodes, not the comment markers.
        if (
          node.options.isComment ||
          typeof node.setCommentBadge !== 'function'
        ) {
          return
        }
        const c = counts[node.options.id]
        if (c && c.unresolved > 0) {
          // Any unresolved → red badge showing the total comment count.
          node.setCommentBadge(c.unresolved + c.resolved, 'unresolved')
        } else if (c && c.resolved > 0) {
          // All resolved → green badge.
          node.setCommentBadge(c.resolved, 'resolved')
        } else {
          node.clearCommentBadge?.()
        }
      })
    }
  })

  const onSlateUpdate = (pkg) => {
    const ppkg = pkg
    // invoke updates the local slate

    slate.current?.collab.invoke(ppkg)

    // always attach the instanceId
    // console.log("collab id is ", collaborator.current?.instanceId);
    ppkg.instanceId = collaborator.current?.instanceId
    // ppkg.shareId = slate?.shareId;

    // send updates any remote slates
    slate.current?.collab.send(ppkg)
  }

  // A slate this person may not open, on arrival or because access was taken away while it
  // was open: leave the page, so nothing of the slate stays on screen, and say why.
  async function leaveWithoutAccess() {
    history(Meteor.user() ? '/' : '/login')
    await confirmService.show({
      theme,
      title: `No Access`,
      message: `This slate is not accessible.`,
      actionItems: [{ label: 'OK', return: true }],
    })
  }

  useEffect(() => {
    let active = true
    async function prep() {
      let isNew = false
      let slateBase = null
      const getSlate = await Meteor.callAsync(CONSTANTS.methods.slates.get, {
        shareId: id,
      })
      if (!active) return
      accessLevel.current = {}
      if (getSlate?.exists === false) {
        isNew = true
        slateBase = {
          name: 'Untitled slate',
          userId: Meteor.userId(),
          shareId: id,
          options: {
            id: getSlate.id,
          },
        }
        if (Meteor.user().orgId) {
          slateBase.orgId = Meteor.user().orgId
        }
      } else if (getSlate?.accessLevel) {
        slateBase = getSlate.slateBase
        slateOrgId.current = getSlate.slateBase.orgId
        accessLevel.current = {
          isReadOnly:
            getSlate.accessLevel === CONSTANTS.slateAccessPermissions.read.id,
          isCommentOnly:
            getSlate.accessLevel ===
            CONSTANTS.slateAccessPermissions.comment.id,
          isEditable:
            getSlate.accessLevel === CONSTANTS.slateAccessPermissions.edit.id,
        }
      }
      accessLevel.current.isMU = getSlate?.isMU
      grantedReadOnly.current = Boolean(accessLevel.current.isReadOnly)
      // A workshop slate is read-only for a visitor until they have joined.
      if (slateBase?.creative?.model?.kind === 'workshop' && !Meteor.userId()) accessLevel.current.isReadOnly = true
      if (!slateBase) {
        await leaveWithoutAccess()
        return
      }
      setCanManageSlate(
        Meteor.userId() &&
          !accessLevel.current.isReadOnly &&
          !accessLevel.current.isCommentOnly
      )
      const requiresTracking =
        !Meteor.user() ||
        (!isNew && Meteor.user() && Meteor.user().orgId !== slateBase.orgId)

      await loadSlate(slateBase, isNew, requiresTracking)
    } // prep

    // A private deep link can mount before the stored account has resumed on DDP.
    const ready = Tracker.autorun(computation => {
      if (!Meteor.status().connected || Meteor.loggingIn() || (Meteor.userId() && !Meteor.user())) return
      computation.stop()
      prep()
    })

    if (asEmbed) {
      setEmbeddedSlate(true)
    }

    setOnCanvas(true)
    return () => {
      active = false
      ready.stop()
      setOnCanvas(false)
    }
  }, [])

  // hook for updating the slateName from outside the canvas -- via SlateSettings or Main
  useEffect(() => {
    if (slate.current) {
      if (
        getCurrentSlateName !== '' &&
        getCurrentSlateName !== slate.current.options.name
      ) {
        if (workshopTitled) {
          // The workshop's title is the slate's name. A new name is saved as the title, on the
          // workshop's revision, once the person stops typing.
          clearTimeout(renameTimer.current)
          renameTimer.current = setTimeout(() => workshopRef.current?.rename?.(getCurrentSlateName), 700)
        } else {
          onSlateUpdate({
            type: 'onSlateNameChanged',
            data: { name: getCurrentSlateName },
          })
        }
      }
      if (
        getHuddleEnabled != null &&
        getHuddleEnabled !== slate.current.options.huddleEnabled
      ) {
        onSlateUpdate({
          type: 'onSlateHuddleChanged',
          data: { huddleEnabled: getHuddleEnabled, huddleType: getHuddleType },
        })
      }
    }
  }, [getCurrentSlateName, getHuddleEnabled, getHuddleType])

  useEffect(() => {
    if (asEmbed || slate.current?.options?.isEmbedded) {
      slate.current?.controller.scaleToFitAndCenter()
      if (asEmbed) {
        slate.current?.disable(null, null, true)
      }
      // if (accessLevel.current?.isReadOnly) {
      //   slate.current?.disable(null, null, true)
      // }
    }
  }, [slate.current])

  // hook to autoinvoke conversation
  useEffect(() => {
    async function initConvo() {
      if (getAutoInvokeConversation && slate.current) {
        const { entireAIContext, openChat } = await initAIConversation({
          slate: slate.current,
          intention: cloneDeep(getAutoInvokeConversation.intention),
          result: cloneDeep(getAutoInvokeConversation.result),
          aid: currentAIContext?.aid,
          showWelcome: true,
        })
        setAIContext(entireAIContext)
        if (openChat) setNativeChatOpen(true)
        setAutoInvokeConversation(null)
      }
    }
    initConvo()
  }, [slate.current, getAutoInvokeConversation])

  // // hook to ensure currentAIContext gets updated on Canvas.jsx when
  // // it is changed
  // useEffect(() => {
  //   console.log('currentAIContext is now', currentAIContext)
  // }, [currentAIContext])

  // nullify the aiContext on exit of the canvas
  // for conversations to ensure no carry-over
  useEffect(
    () => () => {
      if (
        currentAIContext?.isConversation ||
        Object.keys(currentAIContext ?? {}).filter((k) => k != null).length <= 1
      ) {
        setAIContext(null)
      }

      // stop transcription (if it is running)
      if (getHuddleEnabled) {
        dailyCall()?.stopTranscription()
      }

      setSlateBackgroundColor('#ffffff')

      // always disable the huddle
      setHuddleEnabled(false)

      setSlateAudioURL(null)

      // Reset outstanding AI requests
      setOutstandingAIRequests(false)

      // always nullify and destroy collab on the currentSlate
      slate.current?.collab?.destroy()
      // full slate teardown on unmount — deregisters from window.__slateboxInstances,
      // unbinds GLOBAL keyboard listeners, disconnects the ResizeObserver, clears timers,
      // removes the SVG canvas. destroy()'s collab.disconnect is guarded, so the
      // double-call (collab torn down just above) is safe.
      slate.current?.destroy?.()
      slate.current = null
      setSlate(null)
      setSlateName('')
    },
    []
  )

  const gstyle = embeddedSlate
    ? { height: '100%' }
    : { height: 'calc(100% - 64px)' }

  // A slate whose creative model is a workshop is an ordinary slate with the workshop drawn on
  // its canvas. The other creative kinds still fill the page with their own board.
  const boardLoaded = nativeBoard?.routeKey === id
  const workshopSlate = boardLoaded && creativeKind === 'workshop'
  // Fetched as soon as the slate is known to hold a board, so its conversation opens at once.
  useEffect(() => { if (workshopSlate) loadWorkshopConversation().catch(() => { /* Fetched again when the conversation opens. */ }) }, [workshopSlate])
  const overlayKind = creativeKind && creativeKind !== 'workshop'
  const workshopTitled = workshopSlate && workshopNamesSlate(nativeBoard)
  // Every board on the slate (boards S4a): its first ("main") and the further ones whose live records the
  // first board's subscription brings, in the order they were added.
  const boardIds = useTracker(() => workshopSlate
    ? ['main', ...CreativeStates.find({ shareId: id, boardId: { $ne: 'main' } }, { fields: { boardId: 1 } }).map(record => record.boardId)
      .filter(boardId => typeof boardId === 'string').sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))].slice(0, MAX_BOARDS)
    : [], [workshopSlate, id])
  // One save queue for the page: the boards' saves go one after another, never racing each other.
  const saveQueue = React.useRef(Promise.resolve())
  const serial = React.useCallback(task => {
    const run = saveQueue.current.then(task, task)
    saveQueue.current = run.catch(() => {})
    return run
  }, [])
  // One view for the page: the board that frames it is the first, or the board last put in focus here.
  const framer = React.useMemo(() => {
    let last = null
    try { last = localStorage.getItem('slatebox:last-board:' + id) } catch { /* Storage is optional. */ }
    return last && boardIds.includes(last) ? last : 'main'
  }, [id, boardIds.join()])
  // The room every board keeps, by id: a board's notes put beside it go past the others.
  const rooms = React.useRef({})
  const avoidFor = React.useCallback(boardId => () => Object.entries(rooms.current).filter(([other, box]) => other !== boardId && box).map(([, box]) => box), [])
  const boardOptions = boardId => ({ engine: workshopSlate && boardId ? slate.current?.v2 : null, shareId: id, enabled: Boolean(workshopSlate && boardId),
    embedded: Boolean(asEmbed), guestAdmitted: guestEditLink === id, boardId: boardId ?? 'main', serial, avoid: avoidFor(boardId), frames: boardId === framer })
  const workshop = useWorkshopOnCanvas({
    ...boardOptions('main'),
    engine: workshopSlate ? slate.current?.v2 : null, shareId: id, enabled: workshopSlate, embedded: Boolean(asEmbed),
    guestAdmitted: guestEditLink === id, namesSlate: workshopTitled,
    // The place is saved with the slate's next save, so notes put beside the workshop stay beside it.
    origin: nativeBoard?.options?.workshopOrigin, onPlaced: origin => { if (slate.current) slate.current.workshopOrigin = origin },
    // With a `problem`, the saved title goes back over a name the workshop did not take, and
    // Board settings says why beside the field.
    onTitle: (title, problem) => {
      if (!slate.current || (!problem && slate.current.options.name === title)) return
      clearTimeout(renameTimer.current)
      slate.current.options.name = title
      if (slate.current.v2?.options) slate.current.v2.options.name = title
      setSlateName(title)
      if (problem) setNameProblem(problem)
    },
  })
  // The further boards: one hook each, in fixed slots (a slate holds up to 8 boards).
  const board2 = useWorkshopOnCanvas(boardOptions(boardIds[1]))
  const board3 = useWorkshopOnCanvas(boardOptions(boardIds[2]))
  const board4 = useWorkshopOnCanvas(boardOptions(boardIds[3]))
  const board5 = useWorkshopOnCanvas(boardOptions(boardIds[4]))
  const board6 = useWorkshopOnCanvas(boardOptions(boardIds[5]))
  const board7 = useWorkshopOnCanvas(boardOptions(boardIds[6]))
  const board8 = useWorkshopOnCanvas(boardOptions(boardIds[7]))
  const boards = workshopSlate ? [workshop, board2, board3, board4, board5, board6, board7, board8].filter((board, index) => boardIds[index] && board.active) : []
  for (const board of boards) rooms.current[board.boardId] = board.room
  const boardsRef = React.useRef(boards)
  boardsRef.current = boards
  // The board the page's chrome speaks for: the one in focus, or with a preview waiting, or with something
  // selected on it, or the first. Its status strip (saving, a refusal, Undo) and its outcomes.
  const current = boards.find(board => board.focus) ?? boards.find(board => board.preview) ?? boards.find(board => board.selection) ?? workshop
  // A board just added from this page's chat is brought into view once it is drawn.
  const [revealing, setRevealing] = React.useState(null)
  const arrived = revealing && boards.find(board => board.boardId === revealing && board.ready)
  React.useEffect(() => { if (arrived) { arrived.showBoard?.(); setRevealing(null) } }, [arrived])
  const workshopRef = React.useRef(workshop)
  workshopRef.current = workshop
  React.useEffect(() => () => clearTimeout(renameTimer.current), [id])
  // The workshop's publication has nothing for this person. If the server agrees that they may
  // no longer open the slate, the page leaves it as it would have on arrival: its name and its
  // notes do not stay on screen. (A moment with nothing published, while a guest signs in, is
  // not that: the server still answers with the slate.)
  const lostWorkshop = Boolean(workshopSlate && workshop.unavailable)
  React.useEffect(() => {
    if (!lostWorkshop) return undefined
    let active = true
    const timer = setTimeout(async () => {
      let found
      try { found = await Meteor.callAsync(CONSTANTS.methods.slates.get, { shareId: id }) } catch { return }
      if (active && !found?.slateBase) leaveWithoutAccess()
    }, 600)
    return () => { active = false; clearTimeout(timer) }
  }, [lostWorkshop, id])
  // Until a visitor has joined, a workshop slate is read-only for them: its cards and the notes beside it.
  if (workshopSlate) accessLevel.current.isReadOnly = Boolean(grantedReadOnly.current || !workshop.editable)
  // What the conversation proposes is drawn on the canvas until it is kept or discarded: a drawing's
  // draft in full, a workshop's proposal (drawn in place by the workshop) with the preview's caption.
  const [drawingPreview, setDrawingPreview] = React.useState(null)
  React.useEffect(() => { setDrawingPreview(null) }, [id])
  // A proposal is shown once it is drawn, so what it changes can be brought into view.
  const previewed = boards.find(board => board.previewing) ?? workshop
  const workshopFrame = workshopSlate && previewed.previewing && previewed.changed !== undefined ? previewed.frame : null
  const workshopFocus = workshopFrame ? previewed.changed : null
  const workshopPreview = React.useMemo(() => workshopFrame ? { frame: workshopFrame, focus: workshopFocus } : null,
    [workshopFrame?.x, workshopFrame?.y, workshopFrame?.width, workshopFrame?.height, JSON.stringify(workshopFocus)])
  useConversationPreview(boardLoaded ? slate.current?.v2 : null, drawingPreview ?? workshopPreview)
  const canShowConversation = boardLoaded && (workshopSlate ? Boolean(workshop.editable && workshop.ready) : !creativeKind && nativeBoard.canConverse)
  const phone = useMediaQuery('(max-width:599.95px)')
  // Below 1000px the header is one row and the slate's tools sit in a bar under the canvas.
  const narrow = useMediaQuery('(max-width:999.98px)')
  // There Ask Slatebox sits under the canvas too, and a note or card carried on the canvas minimises it to the
  // bar, so the drop has the room (sheet-drag.mjs). Minimised it is still open: mounted with what it holds, a
  // board kept in focus. Let go where the sheet won't cover it, the sheet comes back. Never while a proposal
  // waits for Keep or Discard: the board refuses moves then, and Keep stays in sight.
  const minimised = narrow && chatMinimised
  const conversationVisible = canShowConversation && nativeChatOpen && !minimised
  const proposing = Boolean(drawingPreview) || Boolean(workshopSlate && workshop.previewing)
  // A plain slate shows its minimap only while some of it is off screen (a workshop slate decides its own).
  useMinimapWhenNeeded(boardLoaded && !creativeKind && !asEmbed ? slate.current?.v2 : null, canvasRef.current, boardLoaded && !creativeKind && !asEmbed)
  // A double-click on empty canvas makes the note Add a note makes, open for typing.
  useNoteOnDoubleClick(boardLoaded && !creativeKind && !asEmbed ? slate.current : null, containerId)
  // Heard while the chat is open, minimised or not: the drop that may bring it back comes after it went down.
  const sheetOpen = canShowConversation && nativeChatOpen
  React.useEffect(() => {
    if (!narrow || !sheetOpen || proposing) return undefined
    const canvas = document.getElementById(containerId)
    if (!canvas) return undefined
    let sheetTop = null
    return watchNoteDrag(canvas, () => {
      sheetTop = document.querySelector('aside[aria-label="Ask Slatebox"]')?.getBoundingClientRect().top ?? null
      setChatMinimised(true)
    }, { moves: document, onDrop: (at) => { if (sheetBackAfterDrop(at, sheetTop)) setChatMinimised(false) } })
  }, [narrow, sheetOpen, proposing])
  // Beside the canvas (1000px and wider) and on another slate, nothing is minimised.
  React.useEffect(() => { if (!narrow) setChatMinimised(false) }, [narrow])
  React.useEffect(() => { setChatMinimised(false) }, [id])
  React.useEffect(() => { setConversationAvailable(canShowConversation) }, [canShowConversation])
  React.useEffect(() => () => {
    setConversationAvailable(false); setNativeChatOpen(false); setSlateDrawerOpen(false); setSlateOutput(null)
  }, [])
  // One side panel at a time: opening Ask Slatebox (from the header, the bar under a narrow canvas,
  // a note's style bar or anywhere else) closes the slate settings, and opening the settings closes
  // Ask Slatebox. Each takes the keyboard as it opens. The settings only cover Ask Slatebox: it stays
  // mounted, out of sight, with what it holds (a preview waiting for Keep, a request in flight, a
  // typed message), and is back when they close (side-panels.mjs). Closed by the person, it is gone.
  const panelsBefore = React.useRef({ ask: nativeChatOpen, settings: slateDrawerOpen })
  const askKeptNow = React.useRef(false)
  const [askKept, setAskKept] = React.useState(false)
  React.useEffect(() => {
    const was = panelsBefore.current
    panelsBefore.current = { ask: nativeChatOpen, settings: slateDrawerOpen }
    const next = sidePanels(was, panelsBefore.current, askKeptNow.current)
    askKeptNow.current = next.kept
    if (next.kept !== askKept) setAskKept(next.kept)
    if (next.ask !== nativeChatOpen) setNativeChatOpen(next.ask)
    if (next.settings !== slateDrawerOpen) setSlateDrawerOpen(next.settings)
  }, [nativeChatOpen, slateDrawerOpen])
  // Closing the chat (its ×, the header, the bar under a narrow canvas) leaves the board's focus,
  // unless a preview still waits for Keep or Discard. The settings covering it are not a close.
  React.useEffect(() => { if (!nativeChatOpen && !askKept) for (const board of boardsRef.current) board.leaveFocus?.() }, [nativeChatOpen, askKept, boards.some(board => board.focusLocked)])
  // Another slate: nothing is kept from this one.
  React.useEffect(() => { askKeptNow.current = false; setAskKept(false); setSlateOutput(null) }, [id])
  const showHuddle = Boolean(boardLoaded && !slate.current?.options?.eligibleForThemeCompilation && getHuddleType !== 'disabled')
  // Controls fixed to the canvas's corner (quick add) keep clear of the panel and the bar.
  const canvasArea = React.useRef(null)
  React.useLayoutEffect(() => {
    const area = canvasArea.current
    if (!area) return undefined
    const root = document.documentElement.style
    const place = () => {
      const box = area.getBoundingClientRect()
      root.setProperty('--sb-canvas-right', Math.max(0, Math.round(innerWidth - box.right)) + 'px')
      root.setProperty('--sb-canvas-bottom', Math.max(0, Math.round(innerHeight - box.bottom)) + 'px')
    }
    place()
    const watch = new ResizeObserver(place)
    watch.observe(area)
    addEventListener('resize', place)
    return () => { watch.disconnect(); removeEventListener('resize', place); root.removeProperty('--sb-canvas-right'); root.removeProperty('--sb-canvas-bottom') }
  }, [])
  // Ask Slatebox or the settings opening or closing changes the canvas's size in this same commit
  // (on a phone, closing the chat gives the board the screen back). The engine's view box takes the
  // new size now rather than on its ResizeObserver's next turn: the canvas is drawn with "slice",
  // so until then a taller canvas would crop the board's sides for anything that measures or paints.
  // The sheet minimising under a carried note, or coming back, grows or shrinks the canvas from its foot: the
  // view keeps its top rather than its centre (the engine's way), so the board stays still on screen and the
  // note under the finger.
  const sheetBefore = React.useRef({ open: nativeChatOpen, minimised })
  const keepBoardStill = (resize) => {
    const drawing = slate.current?.v2
    const top = drawing?.canvas?.viewbox?.()?.y
    resize()
    const was = sheetBefore.current
    const flipped = was.open && nativeChatOpen && was.minimised !== minimised
    const now = drawing?.canvas?.viewbox?.()?.y
    if (flipped && Number.isFinite(top) && Number.isFinite(now) && top !== now) drawing.panBy?.({ x: 0, y: top - now })
  }
  React.useLayoutEffect(() => { keepBoardStill(() => slate.current?.v2?.resizePanZoom?.()) }, [conversationVisible, slateDrawerOpen])
  React.useLayoutEffect(() => { sheetBefore.current = { open: nativeChatOpen, minimised } })
  // The style bar edits only for someone who may edit; the tool dock (on a phone, "+ Add") likewise.
  const barEditable = Boolean(!accessLevel.current.isReadOnly && !accessLevel.current.isCommentOnly && !asEmbed)
  // Custom Shape with notes selected shapes them (one change, one undo step); with none, adds a note.
  const selectedOwnNotes = () => {
    const v2 = slate.current?.v2
    if (!v2 || !barEditable || !['node', 'nodes'].includes(selectionFrame?.kind)) return []
    return (selectionFrame.ids || []).map((nid) => v2.getNode(nid)).filter((n) => n && !v2.governanceOf?.(n) && !n.options?.isLocked)
  }
  const shapeNotes = (notes, shape) => updateNode((n) => customShapePackage(shape, n.options), notes)
  const showTools = Boolean(boardLoaded && slate.current && !overlayKind && !accessLevel.current.isReadOnly &&
    !slate.current.options?.eligibleForThemeCompilation && !asEmbed && !slate.current.options?.isEmbedded)
  React.useLayoutEffect(() => {
    const drawing = slate.current
    if (!conversationVisible || !drawing || pendingConversationFit.current !== drawing) return
    // The engine initially loads against the full window, before the conversation
    // is known. Frame once against the final workspace; its ResizeObserver then
    // preserves the user's pan and zoom as the drawer or browser changes size.
    // ResizeObserver runs after animation-frame callbacks. Allow the engine to
    // apply its old camera to the new dimensions before fitting this first view.
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        drawing.controller.scaleToFitAndCenter()
        pendingConversationFit.current = null
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [conversationVisible, nativeBoard])

  return (
    <Grid container className={'sb-canvas-page' + (workshopSlate ? ' sb-workshop-page' : '')} style={{ ...gstyle, width: '100%' }}>
      <Grid size={12} sx={{ display: 'flex', height: '100%', minHeight: 0, flexDirection: 'column', '@media (min-width:1000px)': { flexDirection: 'row' } }}>
        <div ref={canvasArea} data-creative-revision={workshopSlate && workshop.ready ? workshop.revision : undefined}
          style={{ position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 0, display: 'flex' }}>
            <div id={containerId} ref={canvasRef} style={{ position: 'relative', flex: '1 1 0', minWidth: 0, minHeight: 0, overflow: 'hidden',
              ...(overlayKind && { visibility: 'hidden', pointerEvents: 'none' }) }} />
            {/* An empty slate's welcome, in the middle of the canvas, until its first note or board. */}
            <SlateWelcome slate={slate.current} canvasId={containerId} phone={phone} askOpen={conversationVisible} canPick={canShowConversation}
              active={Boolean(boardLoaded && slate.current && !creativeKind && !overlayKind && !asEmbed && !proposing &&
                !accessLevel.current.isReadOnly && !accessLevel.current.isCommentOnly)} />
            {/* While the slate opens (a new one, or one reopened), the same calm moment as /new, over the canvas. */}
            {!boardLoaded && !asEmbed && <SlateLoading fill={false} />}
            {/* The bar over the selection, inside the canvas's own area: never under the panel beside it. */}
            {boardLoaded && !overlayKind && !asEmbed && slate.current && (
              <StyleBar slate={slate.current} frame={selectionFrame} editable={barEditable}
                conversation={canShowConversation} author={Boolean(Meteor.userId() && Meteor.userId() === nativeBoard?.userId)}
                updateNode={updateNode} updateLine={updateLine} onAsk={askAbout} tick={barTick}
                workshop={workshopSlate ? boards.find(board => board.selection) ?? current : null} boards={boards}
                onChangeBoard={workshopSlate && canShowConversation ? changeBoard : null} />
            )}
            {drawingLine && !overlayKind && !asEmbed &&
              <LineToolStatus phone={phone} onCancel={() => slate.current?.v2?.cancelLineTool?.()} />}
            {workshopSlate && workshop.active && !phone &&
              <WorkshopStatus board={boards.find(board => board.error || board.saving || board.failure) ?? current} conversationOpen={conversationVisible} onReview={() => setNativeChatOpen(true)} />}
          </div>
          {/* On a phone the strip has a row of its own under the canvas, so it covers no card. */}
          {workshopSlate && workshop.active && phone &&
            <WorkshopStatus docked board={boards.find(board => board.error || board.saving || board.failure) ?? current} conversationOpen={conversationVisible} onReview={() => setNativeChatOpen(true)} />}
          {workshopSlate && current.ready && <WorkshopOutcomes workshop={current.visible} />}
          {/* A shaped note that became a card, or a card that is its shape again: said once, to the
              person who moved it. Screen readers already hear the engine's own sentence, which names the
              shape too ("It was a diamond: drag it off the board to get its diamond back."), so this one
              is for the eye only. On a phone it sits at the top, clear of the message box and zoom. */}
          {workshopSlate && (shaped => <Snackbar data-shape-notice key={shaped.shapeNotice?.key} open={Boolean(shaped.shapeNotice)} message={shaped.shapeNotice?.text}
            onClose={(_, reason) => { if (reason !== 'clickaway') shaped.clearShapeNotice?.() }} autoHideDuration={5000} aria-hidden="true"
            anchorOrigin={{ vertical: phone ? 'top' : 'bottom', horizontal: 'center' }} sx={phone ? { top: '64px !important' } : undefined} />)(boards.find(board => board.shapeNotice) ?? workshop)}
        </div>
        {canShowConversation && (nativeChatOpen || askKept) && <div style={{ display: nativeChatOpen && !minimised ? 'contents' : 'none' }}>{workshopSlate
          ? <React.Suspense fallback={null}><WorkshopConversation key={id} shareId={id} board={current} boards={boards} onChangeBoard={changeBoard} library={libraryRequest}
              onKept={kept => {
                if (kept?.nativeConversationRevision !== undefined) takeBoard({ ...kept, boardIds: [...new Set([...(nativeBoard?.boardIds ?? ['main']), kept.boardId].filter(Boolean))] })
                if (kept?.boardId) setRevealing(kept.boardId)
              }} onClose={()=>setNativeChatOpen(false)} onPreview={setDrawingPreview}
              readNodes={()=>JSON.stringify(JSON.parse(slate.current.exportJSON()).nodes)} /></React.Suspense>
          : <React.Suspense fallback={null}><NativeCanvasConversation key={id} shareId={id} board={nativeBoard} library={libraryRequest}
              about={<AskAboutNote send={(ids, pkg) => updateNode([pkg], ids.map((nid) => slate.current?.v2?.getNode(nid)))} />}
              onClose={()=>setNativeChatOpen(false)} onKeep={kept=>{
                if(kept?.board && (slate.current?.creativeKind==='workshop' || takeBoard(kept))) {
                  // On a phone the sheet gives the screen to the board just kept (as it opens after a reload).
                  if(window.innerWidth<600) setNativeChatOpen(false)
                  return
                }
                window.location.reload() }} onPreview={setDrawingPreview}
              readNodes={()=>JSON.stringify(JSON.parse(slate.current.exportJSON()).nodes)}
              readSelection={() => {
                const line = slate.current?.getSelectedLine?.()
                if (line?.association?.id) return { kind: 'line', id: line.association.id, label: String(line.association.label || '').slice(0, 120) }
                // Plain notes: "these notes" and "this note" are the ones selected (capped, chat-selection.mjs).
                return noteSelection(selectedOwnNotes().map((n) => n.options?.id))
              }} /></React.Suspense>}</div>}
        {slate.current && <SlateDrawer updateSlate={onSlateUpdate} slate={slate.current} />}
        {/* On a phone the tool dock folds into "+ Add", first in the bar under the canvas. */}
        {narrow && !asEmbed && !overlayKind && (canShowConversation || showHuddle || (phone && showTools)) &&
          <CanvasBottomBar conversation={canShowConversation} huddle={showHuddle}
            add={phone && showTools ? <AddTools slate={slate.current} onAdded={handleNodeCreated} selectedNotes={selectedOwnNotes} onShapeNotes={shapeNotes} commentOnly={accessLevel.current.isCommentOnly}
              canComment={Boolean(Meteor.user()?.orgId)} /> : null} />}
      </Grid>
      {overlayKind && <div style={{ position: 'fixed', inset: asEmbed ? '0' : '64px 0 0', zIndex: 2, display: 'flex', flexDirection: 'column', background: theme.palette.background.default }}>
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
          <CreativeSlate key={id} shareId={id} readOnly={Boolean(asEmbed)} guestAdmitted={guestEditLink === id} />
        </div>
      </div>}
      {newerDrawing && <div role="status" style={{position:'fixed',left:16,bottom:72,zIndex:6,background:theme.palette.background.paper,padding:8}}>A teammate updated this drawing. <button onClick={()=>window.location.reload()}>Reload drawing</button></div>}
      {!asEmbed && !creativeKind && keepOffer?.key === id &&
        <KeepNativeSlate key={id} routeKey={id} proof={keepOffer.proof} slateId={keepOffer.slateId} visitor={keepOffer.visitor} />}
      <NeuralThinking />
      {showTools && !phone && (
          <QuickNodeActions
            slate={slate?.current}
            onNodeCreated={handleNodeCreated}
            selectedNotes={selectedOwnNotes}
            onShapeNotes={shapeNotes}
            isMU={accessLevel.current.isMU}
            commentAccessOnly={accessLevel.current.isCommentOnly}
          />
        )}
      <CommentDrawer {...commentDrawerOpts} />
      {slate.current && (
        <>
          <AdHocAINodes
            ref={collabRef}
            slate={slate.current}
            collaborator={collaborator.current}
          />
          <SlateSharing slate={slate.current} />
          {mermaidOpen && (
            <React.Suspense fallback={null}>
              <MermaidDialog
                open
                initialTab={mermaidOpen}
                slate={slate.current}
                row={{
                  shareId: slate.current.shareId ?? id,
                  options: { name: getCurrentSlateName, isPublic: getSlatePrivacy?.isPublic === true },
                  creative: workshop?.model ? { model: { kind: 'workshop', workshop: workshop.model } } : undefined,
                }}
                canEdit={!accessLevel.current.isReadOnly && !accessLevel.current.isCommentOnly}
                onClose={(result) => {
                  setMermaidOpen(null)
                  if (result?.created?.length) revealImported(result.created)
                }}
              />
            </React.Suspense>
          )}
          <SlateOutputDialog
            onExport={(type, opts, cb) => {
              const s = slate.current
              // A copy holds the slate's own colours, not the ink lifted for the dark canvas. The SVG export is
              // the engine's (v2), which hands back the SVG text; the dialog reads it as { svg }.
              if (type === 'svg') withNativeInk(() => (s.v2 ?? s).svg(opts, (svg) => cb?.(typeof svg === 'string' ? { svg } : svg)))
              else withNativeInk(() => s[type](opts, cb))
            }}
            getOrientation={() => slate.current.getOrientation()}
            slate={slate.current}
          />
          {Meteor.userId() && !workshopSlate &&
            !accessLevel.current.isReadOnly &&
            !accessLevel.current.isCommentOnly && (
              <SlateAIRunner
                slate={slate.current}
                possibleInitialPrompt={possibleInitialPrompt}
                onInitialPromptConsumed={consumeInitialPrompt}
                onAIContextReady={setLocalAIContext}
              />
            )}
          {/* <CanvasAIIntentionsDialog slate={slate.current} />
          <CreatePersona /> */}
          <CollaborationUsers
            localCollaborator={collaborator.current}
            slate={slate.current}
            aiListening={Boolean(effectiveAIContext?.aid)}
            onSlateUpdate={onSlateUpdate}
          />
          <SlateSnapshots
            slate={slate.current}
            open={snapshotOpen}
            onDialogClosed={(e) => {
              setSnapshotOpen(false)
            }}
            applySnapshot={(json) => {
              // A version is the whole slate as it was; it never names another slate. The open
              // slate keeps its own id, share id, team and owner (a version made elsewhere, such
              // as one brought in by a team import, could name a different slate).
              const { current } = slate
              const kept = { id: current.options?.id, shareId: current.shareId, orgId: current.orgId, userId: current.userId }
              const snapSlate = JSON.parse(json)
              snapSlate.options = { ...(snapSlate.options || {}), id: kept.id }
              snapSlate.shareId = kept.shareId
              current.loadJSON(JSON.stringify(snapSlate))
              snapSlate.orgId = kept.orgId
              snapSlate.userId = kept.userId
              setSlate(snapSlate)
              setSnapshotOpen(false)
            }}
          />
          <PresentSlateDialogue slate={slate.current} />
        </>
      )}
      {effectiveAIContext?.aid && slate.current && (
        <>
          <AIContentListener
            slate={slate.current}
            collaboratorInstanceId={collaborator.current?.instanceId}
            aiContext={effectiveAIContext}
            onAIContextChange={setLocalAIContext}
          />
          {/* The AI listening to a huddle's call is in the huddle (HuddleIsland): Daily loads with the first huddle. */}
        </>
      )}
      {slate.current && <SlateOperationListener slate={slate.current} revision={loadedRevision.current} />}
      {slate.current && <AgentPresenceListener slate={slate.current} />}
      {/* {currentAIContext?.aid &&
        slate.current &&
        currentAIContext?.isConversation?.showWelcome && (
          <ConversationWelcomeDialogue
            shareId={slate.current.options.id}
            prompt={currentAIContext.isConversation.intentionInitialData.idea}
            intentionId={currentAIContext.isConversation.id}
            personaId={currentAIContext.isConversation.intentionInitialData.persona
              .replace(/ /gi, '-')
              .toLowerCase()}
          />
        )} */}
    </Grid>
  )
}
