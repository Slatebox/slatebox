import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import CONSTANTS from '../../api/common/constants'

export const siteLocale = atom('en-US')

export const isMobileOrTouchDevice = atom(false)

// The slate's one AI surface, "Ask Slatebox": whether this slate offers it, and whether it is open.
// The canvas page sets both; the header's toggle and the panel's close button change `conversationOpen`.
export const conversationAvailable = atom(false)
// Below 1000px wide, a note or card carried on the canvas minimises Ask Slatebox to the bar under the
// canvas (sheet-drag.mjs): still open (what it holds is kept, a board stays in focus), out of sight.
// Opening it in any way (the bar, "Ask about this", "Change this board", Review proposal) brings it back.
export const conversationMinimised = atom(false)
const conversationOpenBase = atom(false)
export const conversationOpen = atom((get) => get(conversationOpenBase), (get, set, next) => {
  set(conversationMinimised, false)
  set(conversationOpenBase, typeof next === 'function' ? next(get(conversationOpenBase)) : next)
})

export const isPresentOpen = atom(false)

export const callObj = atom(null)
export const canManageHuddleTranscription = atom(false)

export const isCanvasAICustomActionsOpen = atom({
  open: false,
  themes: [],
  templates: [],
})

export const listeningForTranscriptionMessages = atom(false)

export const isAIActivelySpeaking = atom(false)

export const outstandingAIRequests = atom(false)

export const currentUploadedFiles = atom([])


export const currentSlateAudioUrl = atom('')

// global registration
export const registrationDetails = atom({
  type: 'registration',
  registrationOpen: false,
  registrationMessage: 'Please register to continue using Slatebox.',
})

// global message
export const globalMessage = atom({
  visible: false,
  title: '',
  text: '',
  severity: 'info',
  autoHide: 10000,
})

// display slates
export const slateFiltering = atom({
  slatePage: 1,
  slateRecordsPerPage: 12,
  slateMinimumPerPage: 4,
  filterString: '',
  privateOnly: false,
  totalSlates: 0,
  type: 'mine',
})

export const currentPresentation = atom({
  isPlaying: false,
  currentView: -1,
  isAnalyzing: false,
  slateSVG: null,
  orientData: null,
  presentationData: null,
  presentationName: '',
  viewpoints: [],
  autoplayOnPublish: false,
  isEmbedded: false,
  playOnHover: false,
  isPublic: false,
  isFeatured: false,
  showNarrative: true,
  restartTrigger: -1,
})

export const slateRererender = atom(null)

// canvas
export const onCanvas = atom(false)

// slate drawer
export const isSlateDrawerOpen = atom(false)
// Export or Embed, opened from the slate menu: null, 'export' or 'embed'
export const slateOutputOpen = atom(null)

// The Mermaid dialog: null (closed), 'export' or 'import'.
export const mermaidDialog = atom(null)

// extensions drawer
export const isExtensionsDrawerOpen = atom(false)

export const whichSlatePanelIsExpanded = atom('settingsPanel')

// team invites
export const organizationInvites = atom([])

export const orgCreated = atom(null)

// mainDrawerOpen
export const mainDrawerOpen = atom(true)

export const currentSlate = atom(null)

export const currentSlateName = atom('')
// Why the name last typed for a slate was not taken (a workshop names its slate and has rules for the name).
export const slateNameProblem = atom('')

export const slateBackgroundColorAtom = atom('#ffffff')

export const slateHuddleType = atom('disabled')

export const huddleEnabled = atom(false)

export const slatePrivacy = atom({})

export const isSlateEmbedded = atom(false)

export const slateLastEmbedTemplate = atom(null)

export const slateEmbedSize = atom(600)

export const slateEmbedIsIFrame = atom(true)

export const canManageSlate = atom(false)

export const createSlateWithTheme = atom(null)

export const createSlateWithAIContent = atom(null)

export const autoPopulateTemplate = atom(null)

export const autoInvokeConversation = atom(null)

export const isShareDialogOpen = atom(false)

export const getSlateCheckmarks = atom([])

export const getSVGCheckmarks = atom([])

export const isSnapshotOpen = atom(false)

export const isHuddlePropertiesOpen = atom({
  open: false,
})

// What is included this month and Slatebox Pro (meter.summary), refreshed after AI runs.
export const allowance = atom(null)

export const isPersonaOpen = atom(false)

export const initialPrompt = atom(null)

export const currentAISettings = atom({
  layoutStrategy: CONSTANTS.ai.layoutStrategy.mindmap.name,
  tone: CONSTANTS.ai.tone.informative.name,
  templateId: '',
  url: '',
  levelOfDetail: 1,
  wordsPerNode: 5,
  themeId: '',
})

export const pulseCurrentHelpStatus = atomWithStorage({
  pulseCurrentPath: true,
})

export const aiSettingsModalOpen = atom(false)

export const videoGuideOpen = atom(false)

export const areTemplateDetailsOpen = atom({
  open: false,
})

export const nodeShapeDetails = atom({
  shapeItems: [],
  iconPackIconIds: [],
  searchShapeVal: '',
  searchLimit: 15,
  shapePage: 0,
  hasMoreShapes: false,
})

export const collaborationUsers = atom([])

// The style bar over a selection: colours used lately on each slate (per viewer), the style
// copied with More → Copy style, and the note(s) "Ask Slatebox" was opened about.
export const recentColoursBySlate = atom({})
export const copiedNoteStyle = atom(null)
export const askAboutNotes = atom(null)

