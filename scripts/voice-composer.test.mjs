// Voice in the conversations (source checks, as the other conversation tests read the source): the
// message box every conversation shares (ConversationComposer) carries the mic, so Ask Slatebox on
// every slate kind (NativeCanvasConversation, WorkshopConversation) and the interview (Interview)
// get voice; each passes its own submit, and "keep it" presses its own Keep. The session itself
// (useVoiceSession, voiceAudio, VoiceControl) loads only where voice is offered.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL('../web/app/' + path, import.meta.url), 'utf8')
const panel = read('imports/ui/components/ConversationPanel.jsx')
const native = read('imports/ui/components/NativeCanvasConversation.jsx')
const workshop = read('imports/ui/components/workshop/WorkshopConversation.jsx')
const interview = read('imports/ui/components/profile/Interview.jsx')
const control = read('imports/ui/voice/VoiceControl.jsx')
const session = read('imports/ui/voice/useVoiceSession.js')
const audio = read('imports/ui/voice/voiceAudio.js')
const available = read('imports/ui/voice/useVoiceAvailable.js')
const constants = read('imports/api/common/constants.js')
const client = read('imports/api/common/voice-client.mjs')
const answers = read('imports/api/common/voice-answers.mjs')
const voiceFiles = { control, session, audio, available, client, answers, worklet: read('public/voice/voice-worklet.js') }

test('the message box carries the mic: a voice prop, offered only where voice is, the session code in a chunk of its own', () => {
  assert.match(panel, /export function ConversationComposer\(\{[^)]*voice = null \}\)/)
  assert.match(panel, /const \{ available: voiceOn, status: voiceStatus \} = useVoiceAvailable\(voice\?\.surface \?\? null\)/)
  assert.match(panel, /const VoiceControl = lazy\(\(\) => import\('\.\.\/voice\/VoiceControl'\)\)/)
  assert.doesNotMatch(panel, /^import .*VoiceControl/m, 'never a static import: the first load stays small')
  assert.match(panel, /<VoiceControl surface=\{voice\.surface\} shareId=\{voice\.shareId \?\? null\} run=\{voice\.run\} status=\{voiceStatus\} \/>/)
  // it stays while the box is held, so a preview can be kept by saying yes
  assert.match(panel, /\(!held \|\| voiceOn\) && <Box/)
  assert.match(panel, /\{!held && <Button type="submit"/)
})

test('Ask Slatebox on a drawing slate: the mic goes through its own submit; yes keeps, no discards, a held box says why', () => {
  assert.match(native, /voice=\{\{surface:'voice\.chat',shareId,run:voiceRun\}\}/)
  const run = native.slice(native.indexOf('async function voiceRun'), native.indexOf('const composer ='))
  assert.match(run, /confirm==='keep'[\s\S]*await keep\(\)/)
  assert.match(run, /confirm==='discard'[\s\S]*discard\(\)/)
  assert.match(run, /if\(hold \|\| inFlight\.current\) return hold\?\.reason/)
  assert.match(run, /await ask\(said\)/)
  assert.match(run, /if\(typed\.trim\(\)\) setText\(typed\)/, 'what the person was typing stays in the box')
  // what the agent hears of a preview is what the screen shows under "Review the preview"
  assert.match(native, /return spokenPreview\(res\)/)
  assert.match(native, /previewAnswer\(\{heading:previewHeading\(d\)/)
})

test('Ask Slatebox on a board slate: the same, with Keep, Move anyway and the drawing beside the board', () => {
  assert.match(workshop, /voice=\{\{ surface: 'voice\.chat', shareId, run: voiceRun \}\}/)
  const run = workshop.slice(workshop.indexOf('async function voiceRun'), workshop.indexOf('const scenes ='))
  assert.match(run, /if \(drawing\) return drawingStale \? [^\n]*await keepDrawing\(\)/)
  assert.match(run, /if \(preview\) return stale \? [^\n]*await keepChanges\(\)/)
  assert.match(run, /if \(drawing\) return discardDrawing\(\)/)
  assert.match(run, /if \(preview\) return discard\(\)/)
  assert.match(run, /await submit\(said\)/)
  assert.match(run, /if \(typed\.trim\(\)\) setRequest\(typed\)/, 'what the person was typing stays in the box')
  assert.match(workshop, /if \(proposal\.drawing\) \{ setDrawing\(proposal\.drawing\); return spokenDrawing\(proposal\.drawing\) \}/)
})

test('the interview: the mic on its message box; empty words begin, words answer, yes keeps the open chips, no skips them', () => {
  assert.match(interview, /voice=\{\{ surface: 'voice\.interview', run: voiceRun \}\}/)
  const run = interview.slice(interview.indexOf('const voiceRun'), interview.indexOf('const composer ='))
  assert.match(run, /await keep\(fact\)/)
  assert.match(run, /openFacts\.forEach\(skip\)/)
  assert.match(run, /await start\(\)/)
  assert.match(run, /await send\(said\)/)
  assert.match(interview, /return interviewAnswer\(out\.reply, proposed/)
})

test('voice is hidden for guests, where an administrator turned it off, and where nothing is set up to talk with', () => {
  assert.match(available, /member: user\?\.isAnonymous === false/)
  assert.match(available, /useAISurface\(surface/)
  assert.match(available, /CONSTANTS\.methods\.voice\.status/)
  assert.match(available, /status\?\.available === true/)
  // asked again when the person's AI settings are saved, and when the tab comes back into view
  assert.match(available, /addEventListener\(AI_SETTINGS_EVENT, again\)/)
  assert.match(available, /visibilitychange/)
  assert.match(read('imports/ui/components/profile/AISettings.jsx'), /window\.dispatchEvent\(new Event\(AI_SETTINGS_EVENT\)\)/)
  assert.match(constants, /voice: \{\s*open: 'voice\.open',\s*status: 'voice\.status',\s*\}/)
})

test('the control: a labelled mic button, a one-time note, live state and captions, open mic or push to talk, Stop, plain errors, the pay notice', () => {
  assert.match(control, /aria-label=\{voice\.carryOn \? VOICE_WORDS\.carryOn : VOICE_WORDS\.start\}/)
  assert.match(control, /\{MIC_NOTE\}/)
  assert.match(control, /noteSeen\(globalThis\.localStorage\)/)
  assert.match(control, /role="status" aria-live="polite"/)
  assert.match(control, /aria-label="Captions"/)
  assert.match(control, /<ToggleButtonGroup[^>]*aria-label="How the mic listens"/)
  assert.match(control, /data-voice-stop/)
  assert.match(control, /event\.key === 'Escape' && active/)
  // push to talk held with Space or Enter as well as the pointer
  assert.match(control, /event\.key === ' ' \|\| event\.key === 'Enter'/)
  assert.match(control, /aria-pressed=\{state\.pressed\}/)
  assert.match(control, /isCreditRefusal\(error\.code\) \|\| Boolean\(error\.details\?\.pay\)/)
  assert.match(control, /<PayNotice refusal=[^\n]*from="voice"/)
  // a refusal voice.status already knows is said at the press: no mic note, no microphone prompt
  assert.match(control, /if \(knownRefusal && !voice\.carryOn\) \{ setRefusedFirst\(knownRefusal\); return \}/)
  // focus moves only when the person is on the voice controls
  assert.match(control, /document\.activeElement\?\.closest\?\.\('\[data-voice\]'\)/)
  // Escape closes the mic note too
  assert.match(control, /if \(asking\) \{ event\.stopPropagation\(\); dismissNote\(\); return \}/)
  // voice on while the conversation is hidden: a bar with Stop stays in view
  assert.match(control, /active && hidden && [^\n]*createPortal\(/)
  assert.match(control, /data-voice-chip-stop/)
  // a press button with one name: its pressed state says whether it talks
  assert.match(control, /aria-pressed=\{state\.pressed\} data-voice-hold=""[^\n]*\n[^\n]*\{VOICE_WORDS\.talk\}/)
  assert.match(control, /role="alert"/)
  // a session the meter stopped asks what a new one would be refused for, so the pay sheet can answer it
  assert.match(control, /reason === 'cap'[\s\S]*CONSTANTS\.methods\.voice\.status/)
})

test('the session: a ticket, the same-origin socket, hello, the tool through the surface\'s submit, reconnect when moving, a clean teardown', () => {
  assert.match(session, /Meteor\.callAsync\(M\.open, surface === 'voice\.chat' \? \{ surface, shareId \} : \{ surface \}\)/)
  assert.match(session, /new WebSocket\(socketUrl\(window\.location\)\)/)
  assert.match(session, /ws\.binaryType = 'arraybuffer'/)
  assert.match(session, /type: 'hello', ticket, v: VOICE_PROTOCOL_VERSION, mode: stateRef\.current\.mode/)
  assert.match(session, /outcome = await runRef\.current\(parseToolArgs\(msg\.args\)\)/)
  assert.match(session, /send\(s, toolResult\(msg\.id, outcome\)\)/)
  // a call canceled before it ran does not run; one canceled while it ran still answers (a late answer)
  assert.match(session, /if \(s\.gone \|\| s\.canceled\.has\(msg\.id\)\) return\n\s*let outcome/)
  assert.match(session, /msg\.reason === 'moving' && msg\.reconnect\?\.ticket/)
  // the reconnect ticket is tried again, with a growing wait, while it lasts
  assert.match(session, /if \(again && Date\.now\(\) < again\.until/)
  assert.match(session, /connect\(s, again\.ticket\)/)
  // a reload pauses: the ticket waits in sessionStorage, and the next press carries on with it
  assert.match(session, /send\(s, \{ type: 'pause' \}\)/)
  assert.match(session, /saveCarry\(store\('sessionStorage'\)/)
  assert.match(session, /const carried = takeCarry\(store\('sessionStorage'\)/)
  // push to talk: talking over the agent stops its audio here at once; the release sends the tail first
  assert.match(session, /s\.gate\.cut\(s\.agentTurn\)\s*\n\s*s\.audio\.flush\(s\.agentTurn\)/)
  assert.match(session, /s\.audio\.flushMic\(\)/)
  assert.match(session, /s\.gate\.cut\(msg\.turn\)\s*\n\s*s\.audio\.flush\(msg\.turn\)/)
  assert.match(session, /s\.audio\.end\(msg\.turn\)/)
  assert.match(session, /sendsMic\(stateRef\.current\)/)
  assert.match(session, /useEffect\(\(\) => \(\) => teardown\(\), \[teardown\]\)/)
  assert.match(session, /addEventListener\('pagehide', leave\)/)
  assert.match(session, /JSON\.stringify\(\{ type: 'end' \}\)/)
})

test('the audio: echo cancellation, noise suppression and auto gain on the mic; Chromium\'s loopback RTCPeerConnection for playback, Web Audio elsewhere', () => {
  assert.match(audio, /echoCancellation: true, noiseSuppression: true, autoGainControl: true/)
  assert.match(audio, /ctx\.audioWorklet\.addModule\(WORKLET_URL\)/)
  assert.match(audio, /new RTCPeerConnection\(\)/)
  assert.match(audio, /createMediaStreamDestination\(\)/)
  assert.match(audio, /if \(!loop\) playback\.connect\(ctx\.destination\)/)
  assert.match(audio, /getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/)
  assert.match(audio, /ctx\.close\(\)/)
})

test('no model, provider or voice is chosen in the browser, and no key or prompt is there: the binding decides, on the server', () => {
  for (const [name, source] of Object.entries(voiceFiles)) {
    assert.doesNotMatch(source, /\b(gemini-[0-9]|gpt-|gpt4|muse-ember|Kore|Puck|Charon|alloy|shimmer|verse|marin|cedar)\b/i, name)
    assert.doesNotMatch(source, /apiKey|API_KEY|x-goog-api-key|Authorization/, name)
    assert.doesNotMatch(source, /systemInstruction|instructions:/, name)
  }
})

test('a Keep that reloads the page lets voice say what was kept and carry on after it', () => {
  const reload = read('imports/ui/voice/voiceReload.js')
  assert.match(reload, /session\.pauseForReload\(\)\)\.catch\(\(\) => \{\}\)\.finally\(\(\) => window\.location\.reload\(\)\)/)
  assert.match(reload, /if \(!session\) \{\s*window\.location\.reload\(\)/)
  assert.match(read('imports/ui/pages/Canvas.jsx'), /reloadPage\(\) \}\} onPreview=\{setDrawingPreview\}/)
  assert.match(workshop, /setTimeout\(reloadPage, 50\)/)
  assert.doesNotMatch(workshop, /setTimeout\(\(\) => window\.location\.reload\(\), 50\)/)
})

test('an answer the screen has no words for is a code, never an empty answer or words written for the model in the browser', () => {
  for (const [name, source] of Object.entries({ native, workshop, interview })) {
    const run = source.slice(source.indexOf('voiceRun'), source.indexOf('const composer'))
    assert.doesNotMatch(run, /\?\? ''/, name)
    assert.doesNotMatch(run, /ANSWER_WORDS\.(noPreview|discarded|empty|nothingToKeep|skipped)/, name)
    assert.match(run, /ANSWER\.(none|busy|empty|discarded)/, name)
  }
  assert.doesNotMatch(workshop, /Checking editing access\. Try again in a moment\./)
})
