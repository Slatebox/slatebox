import {validateWorkshop,workshopLanePlaces} from 'slateboxjs/workshops/model'
import {noteRequest,noteRequestProblem} from './note-requests.mjs'
import {workshopOrigin} from './workshop-look.mjs'
import {slateBoards} from './slate-boards.mjs'
import {nativeBriefPaths,nativeSlateFromBrief} from './native-diagram-brief.mjs'
import {workshopFromTeamBrief} from './team-map-brief.mjs'

import {workshopFromLaneBrief} from './native-lane-brief.mjs'

const playWords = /\b(?:interactive|playable|play through)\b/i
const existing = /\b(?:this|these|existing|current|it|my (?:drawing|diagram))\b/i
// A launch plan, a sales pipeline or a budget, by its opener (the server reads the rest:
// business-board-brief.mjs).
const boardWords = /^(?:plan\s+a\s+launch|make\s+a\s+launch\s+plan|make\s+a\s+(?:sales\s+)?pipeline|make\s+a\s+budget|split\s+(?:a\s+|the\s+)?\S+\s+budget)\b/i
// The library (slateboxjs/catalog), once it has loaded: "Add a retro" is read from it, locally.
// The browser loads it on demand (library.mjs registers it here); the server loads it at start.
let library = null
export function useLibrary(reader) { library = reader }
export function libraryLoaded() { return library !== null }

export function nativeRequestKind(message) {
  if (library?.catalogAddRequest(String(message ?? '').trim())) return 'component'
  if (/^(?:make|create|build|start|add)\s+(?:an?\s+)?(?:interactive\s+)?(?:lane\s+)?workshop\b/i.test(message.trim())) return 'lanes'
  if (boardWords.test(message.trim())) return 'board'
  return playWords.test(message) ? 'play' : 'draw'
}
function noteText(node) { return String(node.options?.text || '').trim() }

// Whether a message is a request that has to be thought up (“add notes about our onboarding
// risks”, a question) rather than steps typed out or lines pasted in, which are drawn as they stand.
export function needsDrafting(message) {
  const words=typeof message==='string' ? message.trim():''
  if(!words || /[→\n]|->/.test(words) || noteRequest(words) || noteRequestProblem(words)) return false
  if(/^(?:draw|map|diagram|show|build|create)\s+(?:(?:a|the)\s+)?(?:flow(?:chart)?|diagram|path)\s+from\s+/i.test(words)) return false
  if(/,?\s+(?:then|followed by)\s+/i.test(words)) return false
  return /\?$/.test(words) || /^(?:can|could|would|will|please|add|make|create|draw|build|generate|write|give|put|show|help|list|brainstorm|suggest|fill|turn|summari[sz]e|explain|plan|i want|i need|i(?:'|’)?d like|let(?:'|’)?s|what|which|who|why|how|where|when)\b/i.test(words)
}

// Whether the direct path would draw the request itself as one note: a description of a board or a
// drawing ("A board where ideas go in piles of five") read as a single step. With no AI to draft it,
// that note is never what was asked for, so the person is told why it can't be drafted instead.
// A short label ("Review notes"), typed steps, pasted lines and notes asked for by name are drawn.
export function drawsRequestAsNote(message) {
  const words=typeof message==='string' ? message.trim():''
  if(!words || noteRequest(words) || noteRequestProblem(words)) return false
  const paths=nativeBriefPaths(words)
  if(paths.length!==1 || paths[0].length!==1) return false
  return words.split(/\s+/).length>=4
}

// What a request that needs drafting is told when this person cannot have it drafted. On Slatebox
// Cloud it is the meter's own reason (`meter`: sign in, no Slatebox Pro or own AI, today's or
// this month's included AI used up, a paused budget), with its code; on a self-hosted install it
// needs AI turned on, and where it is on, a member who has signed in.
// The refusals the pay sheet or the profile's Credits page answers (Get Pro, own AI, top up;
// imports/api/billing/pay-route.mjs says which pane).
export const CREDIT_REFUSALS = Object.freeze([
  'ai-today', 'ai-month', 'ai-paused', 'calls-today', 'calls-month', 'calls-paused', 'video-stage', 'balance',
  'unverified', 'frozen', 'free-stopped', 'pro', 'pro-images', 'pro-calls', 'pro-past-due',
])
export function draftingRefusal({selfHosted,aiOn=false,guest=false,meter=null}) {
  if(!selfHosted) {
    if(guest || meter?.code==='guest') return {error:'sign-in',reason:'Sign in to use AI.'}
    if(meter?.code && meter?.message) return {error:meter.code,reason:meter.message,...(meter.pay && {pay:meter.pay})}
    return {error:'ai-unavailable',reason:'AI drafting is not available just now. Try again in a moment.'}
  }
  if(aiOn && guest) return {error:'drafting-off',reason:'Drafting from a request is for signed-in members of this install. Sign in to use it.'}
  return {error:'drafting-off',reason:'Drafting from a request needs an AI model, and this install does not have one turned on. Ask your administrator to turn on AI drafting.'}
}

// The box a workshop on this slate fills, in world units, or null when it has none.
function workshopBox(board) {
  const workshop=board.creative?.model?.kind==='workshop' ? board.creative.model.workshop : null
  if(!workshop) return null
  try {
    const origin=workshopOrigin(board.options,board.nodes||[]), {width,height}=workshopLanePlaces(workshop)
    return {x:origin.x,y:origin.y,w:width,h:height}
  } catch {return null}
}
// Every board's box on a slate of many boards (its first board's as workshopBox has it): what new notes keep clear of.
function boardBoxes(board) {
  const boxes=[workshopBox(board)]
  for(const item of slateBoards(board).slice(1)) {
    if(!item.origin) continue
    try {const {width,height}=workshopLanePlaces(item.model.workshop);boxes.push({x:item.origin.x,y:item.origin.y,w:width,h:height})} catch {}
  }
  return boxes.filter(Boolean)
}

// Notes asked for by number or by name, side by side in a row below everything on the slate.
function notesDraft(board,labels,prefix) {
  const boxes=[...(board.nodes||[]).map(n=>frame(n.options)),...boardBoxes(board)].filter(Boolean)
  const left=boxes.length ? Math.min(...boxes.map(b=>b.x)):36
  let y=boxes.length ? Math.max(...boxes.map(b=>b.y+b.h))+48:32
  const nodes=labels.map((text,i)=>{
    const node=nativeSlateFromBrief('Note').nodes[0]
    const width=text.length>60 ? 292:218
    Object.assign(node.options,{id:prefix+(i+1),text,width,height:Math.max(76,Math.ceil(text.length/(width/12))*24+30),xPos:left+i*(width+48),yPos:y,backgroundColor:'#f2d695'})
    node.relationships={associations:[]}
    return node
  })
  return {mode:'draw',nodes,labels,...placed(board)}
}

// Where the workshop is, for a slate that has not recorded it yet: kept with the new notes, so the
// workshop stays where it is drawn now instead of moving beside them.
function placed(board) {
  const box=workshopBox(board)
  return box && !board.options?.workshopOrigin ? {workshopOrigin:{x:box.x,y:box.y}} : {}
}
// The same place for a drawing whose notes come from elsewhere (the conversation's model): null when
// the slate holds no workshop or has recorded where it is.
export function unrecordedWorkshopOrigin(board) {
  return placed(board).workshopOrigin ?? null
}

// The three starters a drawing's conversation offers, each a whole message it can preview as
// written. `select` is the part a person is most likely to replace (typed over in one gesture).
// The panel and every read of the slate take them from here, worked out from the notes as
// they are now.
const starter = (label, text, from = text.length) => ({ label, text, ...(from < text.length && { select: [from, text.length] }) })
export function canvasStarters(nodes = []) {
  const named = nodes.filter(node => !node?.options?.isComment)
    .map(node => String(node?.options?.text || '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  const last = named.at(-1)
  return [
    last && last.length <= 120 ? starter('Draw a flow', last + ' → Next step', last.length + 3) : starter('Draw a flow', 'Intake → Review → Send a reply', 0),
    starter('Build a workshop', 'Make a workshop with Now, Next and Later', 21),
    named.length ? starter('Add interactive behavior', 'Make this drawing interactive') : starter('Add interactive behavior', 'Make this interactive: Intake → Review', 23),
  ]
}
export function mapFromDrawing(nodes, title) {
  const edges=nodes.flatMap(n=>n.relationships?.associations || [])
  const attached=new Set(edges.flatMap(edge=>[edge.parentId,edge.childId]))
  const notes=nodes.filter(node=>noteText(node) && attached.has(node.options.id))
  if (notes.length<2 || notes.length>5) throw new Error('Give a path of two to five named steps, for example “Make this interactive: Intake → Review”.')
  const stations=new Map(notes.map((node,i)=>[node.options.id,'station-'+(i+1)]))
  const lanes=notes.map((node,i)=>{
    const next=new Set()
    for(const record of edges) {
      if (record.parentId===node.options.id && record.childId!==record.parentId && stations.has(record.childId)) next.add(stations.get(record.childId))
    }
    return {id:stations.get(node.options.id),label:noteText(node).slice(0,80),station:{
      column:i%3,row:Math.floor(i/3),next:[...next],outcome:noteText(node).slice(0,160)
    }}
  })
  if(!lanes.some(lane=>lane.station.next.length)) throw new Error('Connect two notes first, or give the route in the message using an arrow.')
  return validateWorkshop({version:1,title:(title || 'Interactive drawing').slice(0,120),lanes,
    cards:[{id:'token',label:'Progress',laneId:lanes.find(l=>l.station.next.length).id}]})
}

export function existingDrawingRequest(nodes,message) {
  return nativeRequestKind(message)==='play' && existing.test(message) && !/[:→]|->/.test(message) && nodes.some(n=>noteText(n))
}
const sameLabel=text=>String(text??'').replace(/\s+/g,' ').trim().toLowerCase()
const finite=value=>{const n=Number(value);return Number.isFinite(n) ? n:0}
const frame=o=>({x:finite(o?.xPos),y:finite(o?.yPos),w:finite(o?.width),h:finite(o?.height)})
const crowds=(a,b)=>a.x<b.x+b.w+24 && b.x<a.x+a.w+24 && a.y<b.y+b.h+24 && b.y<a.y+a.h+24
const line=(parentId,childId)=>JSON.stringify([parentId,childId])

// A step named after a note on the board is that note. Its arrows attach to the
// existing note. A new step written after it in a row sits beside it. Every
// other new step keeps its place past the right edge of the drawing.
function extendDrawing(nodes,words,prefix,edge,top) {
  const source=nativeSlateFromBrief(words)
  const steps=new Map(source.nodes.map(node=>[sameLabel(node.options.text),node.options.id]))
  const known=new Map()
  for(const node of nodes) {
    const key=sameLabel(node.options?.text)
    if(key && typeof node.options.id==='string' && node.options.id && !known.has(key)) known.set(key,node)
  }
  const reused=new Map(), fresh=new Map()
  for(const {options} of source.nodes) {
    const match=known.get(sameLabel(options.text))
    if(match) reused.set(options.id,match)
    else fresh.set(options.id,{...options,id:prefix+(fresh.size+1),xPos:options.xPos+(edge?edge+72:0),yPos:options.yPos+top})
  }
  const labels=[], named=new Set(), beside=new Map()
  for(const path of nativeBriefPaths(words)) {
    let anchor
    for(const label of path) {
      const step=steps.get(sameLabel(label)), match=reused.get(step), options=match?.options || fresh.get(step)
      if(!named.has(options.id)) {
        named.add(options.id)
        labels.push(match ? noteText(match).replace(/\s+/g,' ') : options.text)
        if(!match && anchor) beside.set(options,anchor)
      }
      anchor=match || beside.has(options) ? options : undefined
    }
  }
  const taken=[...nodes.map(node=>frame(node.options)),...[...fresh.values()].filter(options=>!beside.has(options)).map(frame)]
  for(const [options,anchor] of beside) {
    const from=frame(anchor), spot={...frame(options),x:from.x+from.w+96,y:from.y}, row=spot.h+48
    // Stored geometry is whatever an editor saved. Pass each note in the way in one
    // move, by whole rows, so a very tall note cannot hold the server in this loop.
    for(let wall;(wall=taken.find(other=>crowds(spot,other)));) {
      const clear=wall.y+wall.h+24
      spot.y=Math.max(clear,spot.y+row*Math.max(1,Math.ceil((clear-spot.y)/row)))
    }
    Object.assign(options,{xPos:spot.x,yPos:spot.y})
    taken.push(spot)
  }
  const real=id=>reused.get(id)?.options.id ?? fresh.get(id).id
  const drawn=new Set(nodes.flatMap(node=>(node.relationships?.associations||[]).map(a=>line(a.parentId??node.options?.id,a.childId))))
  const links=[], lines=new Map([...fresh.values()].map(options=>[options.id,[]]))
  for(const node of source.nodes) for(const a of node.relationships.associations) {
    const parentId=real(a.parentId), childId=real(a.childId)
    if(parentId===childId || drawn.has(line(parentId,childId))) continue
    drawn.add(line(parentId,childId))
    const association={...a,id:prefix+a.id,parentId,childId}
    if(reused.has(a.parentId)) links.push({parentId,association})
    else lines.get(parentId).push(association)
  }
  const additions=source.nodes.filter(node=>fresh.has(node.options.id)).map(node=>{
    const options=fresh.get(node.options.id)
    return {...node,options,relationships:{...node.relationships,associations:lines.get(options.id)}}
  })
  if(!additions.length && !links.length) throw new Error('Everything in that request is already on this slate. Name a new step or a new connection.')
  return {mode:'draw',nodes:additions,links,labels}
}
export function nativeCanvasDraft(board,message,requestId,generated,samples={}) {
  const words=typeof message==='string' ? message.trim():''
  if(!words || words.length>1200 || !/^[a-zA-Z0-9]{17}$/.test(requestId)) throw new Error('Describe the change in up to 1,200 characters.')
  const mode=nativeRequestKind(words)
  if(mode==='component') {
    // A library entry: its preset (lanes and rules, a decision path, or a business board's sample), named after the topic.
    const {id,topic}=library.catalogAddRequest(words)
    const workshop=validateWorkshop(library.catalogPreset(id,topic,samples))
    const format=workshop.lanes[0].station ? 'map' : workshop.kind || 'lanes'
    return {mode:'play',format,component:id,workshop}
  }
  const playable = generated && mode!=='draw' ? validateWorkshop(generated) : null
  const nodes=board.nodes || []
  if(mode==='board') {
    // The board the server read from the phrase (business-board-brief.mjs), through the same gate.
    if(!playable || !['launch-plan','pipeline','budget'].includes(playable.kind)) throw Error('Say what the board holds, like “Plan a launch for day 30: Design 5 days, Build 8 days after Design”.')
    return {mode:'play',format:playable.kind,workshop:playable}
  }
  if(mode==='lanes') {
    const workshop=playable || workshopFromLaneBrief(words)
    if(workshop.kind || workshop.lanes.some(lane=>lane.station)) throw Error('The proposal needs ordinary workshop lanes.')
    return {mode:'play',format:'lanes',workshop}
  }
  if(mode==='play') {
    const brief=words.replace(/^.*?(?:interactive|playable)(?:\s+(?:map|workflow|flow|diagram))?\s*:\s*/i,'')
    const map=existingDrawingRequest(nodes,words) ? mapFromDrawing(nodes,board.options?.name)
      : playable || workshopFromTeamBrief(brief)
    return {mode,workshop:map}
  }
  const prefix='chat-'+requestId+'-'
  const asked=noteRequest(words)
  if(asked) return notesDraft(board,asked.labels,prefix)
  // The boards on the slate are part of what new steps keep clear of.
  const edge=Math.max(nodes.reduce((max,n)=>Math.max(max,(Number(n.options?.xPos)||0)+(Number(n.options?.width)||0)),0),...boardBoxes(board).map(box=>box.x+box.w))
  const top=nodes.length ? Math.min(...nodes.map(n=>Number(n.options?.yPos)||0)) : 0
  // A drawing request with a model goes through exec (server/exec/conversation.mjs); this is
  // the direct path: typed steps and pasted lines.
  return {...extendDrawing(nodes,words,prefix,edge,top),...placed(board)}
}
