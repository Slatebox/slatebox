import {Meteor} from 'meteor/meteor'
import {Random} from 'meteor/random'
import {previewCanvasOf} from '../../imports/api/common/conversation-preview.mjs'
import {createHash} from 'node:crypto'
import {resolvePresentationSlate} from './creative-slates'
import {sharedSaveConditions} from './native-slate-save.mjs'
import {existingDrawingRequest,nativeCanvasDraft,nativeRequestKind} from '../../imports/api/common/native-canvas-conversation.mjs'
import {noteRequest,noteRequestProblem} from '../../imports/api/common/note-requests.mjs'
import {workshopFromLaneBrief} from '../../imports/api/common/native-lane-brief.mjs'
import {businessBoardFromBrief,businessBoardSaid} from '../../imports/api/common/business-board-brief.mjs'
import {rememberInvitedEdit} from './joined-slates'
import 'slateboxjs/workshops/behaviour'
import '../../imports/api/common/library.mjs'
import {rulebook} from 'slateboxjs/workshops/model'
import {catalogSamples as samples} from 'slateboxjs/workshops/samples'
import {catalogFits} from 'slateboxjs/catalog'
import {boardNamesSlate,componentPlacing} from '../../imports/api/common/component-add.mjs'
import {MAX_BOARDS,slateBoards} from '../../imports/api/common/slate-boards.mjs'

import {slateSaveCore} from '../slate-save'

// The slate's boards are part of what a preview was made against: a board added meanwhile (here or by a
// teammate) moves where Keep would put this one, so it is asked again.
const digest = board => createHash('sha256').update(JSON.stringify([
  board.nodes || [], board.nativeConversationRevision || 0, board.creative?.model?.kind || null, slateBoards(board).map(item => item.id),
  board.options?.creationBrief || '', board.options?.name || ''
])).digest('hex')
const changed = () => new Meteor.Error('stale','The drawing changed. Preview the request again.')
async function resolve(shareId,uid) {
  if (!uid || typeof shareId!=='string' || !/^[A-Za-z0-9]{1,40}$/.test(shareId)) throw new Meteor.Error('unavailable')
  const access=await resolvePresentationSlate(shareId,uid)
  // A slate's drawing is the notes beside whatever it holds; a workshop is drawn on that same canvas.
  const creative=access?.slateBase.creative
  if (!access?.canEdit || creative && !access.slateBase.nativeCanvasDrawing && creative.model?.kind!=='workshop') throw new Meteor.Error('unavailable','Open a drawing you can edit.')
  return access.slateBase
}
// Drawing requests run on exec (canvasConversation.*, canvas-conversation.js). These methods
// keep the workshop and interactive-route requests until the registry has actions for them.
Meteor.methods({
  // `selection` is what is selected on the canvas (a workshop's card or lane, or the board in focus), given to drafting as context.
  async 'nativeCanvas.preview'(shareId,message,history=[],selection=null) {
    if(typeof message!=='string'||!message.trim()||message.length>1200) throw new Meteor.Error('invalid-turn','Write a request of up to 1,200 characters.')
    if(!Array.isArray(history)||history.length>6||history.some(turn=>!turn || typeof turn.message!=='string' || turn.message.length>1200 || typeof turn.reply!=='string'||turn.reply.length>4000)) throw new Meteor.Error('invalid-turn','Reload the conversation and try again.')
    if(selection!==null && (typeof selection!=='object' || !['card','lane','board'].includes(selection.kind) || typeof selection.label!=='string' || selection.label.length>120)) throw new Meteor.Error('invalid-turn','Reload the conversation and try again.')
    const kind=nativeRequestKind(message)
    if(kind==='draw') throw new Meteor.Error('invalid-turn','Drawing requests use canvasConversation.preview.')
    const board=await resolve(shareId,this.userId), base=digest(board), id=Random.id()
    // A library entry (Add a retro): any editor may add one, beside the boards the slate holds, up to 8
    // (library final.md §2.2, catalogFits); past that it opens on a new slate.
    const held=slateBoards(board).length
    if(kind==='component' && held>=MAX_BOARDS) throw new Meteor.Error('opens-new',catalogFits('retro',{hasBoard:true,many:true,boards:held}).reason)
    if(kind!=='component' && board.creative || (board.userId!==this.userId && kind!=='component')) throw new Meteor.Error('unavailable',board.creative?'Open the interactive view to edit its behavior.':'Only the owner can add interactive behavior to this drawing.')
    const ai=(await Meteor.callAsync('workshops.account')).canGenerate
    // Notes asked for by number or name are drawn as they stand. A request that has to be thought
    // up is drafted by AI, counted by the meter (or on an install with AI turned on).
    const direct=Boolean(noteRequest(message))
    // Too many notes at once, or markup in their words: say what to change.
    const problem=noteRequestProblem(message)
    if(problem) throw new Meteor.Error('invalid-turn',problem)
    let literalWorkshop=false
    if(kind==='lanes') {
      try {workshopFromLaneBrief(message);literalWorkshop=true} catch {}
    }
    let generated
    // A launch plan, a pipeline or a budget is read from the person's own words, never drafted.
    if(kind==='board') {
      try {generated=businessBoardFromBrief(message)} catch(e) {throw new Meteor.Error('invalid-turn',e.message)}
    }
    if(kind!=='board' && kind!=='component' && ai && !direct && !literalWorkshop && message.trim().length>=10 && !/[→]|->/.test(message) && !existingDrawingRequest(board.nodes||[],message)) {
      const tail=history.slice(-2).map(turn=>'Earlier request: '+turn.message.slice(0,120)+'\nKept: '+turn.reply.slice(0,180))
      const brief=board.options?.creationBrief
      if(brief && brief!==message) tail.unshift('Original brief: '+brief.slice(0,160))
      if(selection) tail.push('Selected on the canvas: the '+selection.kind+' “'+selection.label.replace(/[<>]/g,'')+'”')
      const room=1200-message.length-12
      const prompt=tail.length && room>40 ? tail.join('\n').slice(-room)+'\nRequest: '+message : message
      generated=await Meteor.callAsync('workshops.draft',prompt,kind==='lanes'?'lanes':'map',undefined,shareId)
    }
    let draft
    try {draft=nativeCanvasDraft(board,message,id,generated,samples)}
    catch(e){throw new Meteor.Error('invalid-turn',e.message)}
    // Beside the slate's boards: shown where Keep puts it (Keep places it again on the slate as it stands then).
    if(draft.component && held) draft={...draft,origin:componentPlacing(board,draft.workshop).origin}
    if(digest(await resolve(shareId,this.userId))!==base) throw changed()
    this.connection.slateboxNativeCanvasDraft={id,boardId:board._id,uid:this.userId,base,draft,until:Date.now()+600000}
    // `canvas` is what the page draws as the preview: what Keep would add, where it would add it.
    return {id,mode:draft.mode,format:draft.format || 'map',provider:generated && kind!=='board'?'ai':'direct',canvas:previewCanvasOf(draft),labels:draft.workshop.lanes.map(l=>l.label),
      ...(kind==='board' && {said:businessBoardSaid(draft.workshop)}),
      // A library entry: which one, and how it behaves (the lines of its "How this board behaves" note).
      ...(draft.component && {component:draft.component,title:draft.workshop.title,rules:draft.workshop.behaviour ? rulebook().lines(draft.workshop) : []}),
      capacities:draft.format==='lanes'?draft.workshop.lanes.filter(l=>l.capacity!==undefined).map(l=>({label:l.label,capacity:l.capacity})):[],
      links:draft.workshop.lanes.reduce((s,l)=>s+(l.station?.next?.length ?? 0),0)}
  },
  async 'nativeCanvas.keep'(shareId,id) {
    const board=await resolve(shareId,this.userId)
    if(typeof id!=='string'||!/^[A-Za-z0-9]{17}$/.test(id)) throw changed()
    if(board.lastNativeCanvasProposal?.id===id && board.lastNativeCanvasProposal.uid===this.userId) {
      const made=slateBoards(board).find(item=>item.id===(board.lastNativeCanvasProposal.boardId??'main'))
      return {kept:true,boardId:made?.id??'main',origin:made?.origin??board.options?.workshopOrigin??null,nativeConversationRevision:board.nativeConversationRevision??0}
    }
    const p=this.connection.slateboxNativeCanvasDraft
    if(!p || p.id!==id || p.uid!==this.userId || p.boardId!==board._id || p.until<Date.now() || digest(board)!==p.base) throw changed()
    const {draft}=p
    if(draft.mode!=='play' || (board.userId!==this.userId && !draft.component) || (board.creative && !draft.component)) throw changed()
    // The board sits beside the slate's notes and its other boards, covering none of them (where its preview
    // was shown), and the place is stored with it, so every page draws it there. The place and the board's id
    // are worked out on the slate as the write finds it (the save core fences it on the slate's revision).
    let made,named
    try {
      await slateSaveCore.save({slateId:board._id,actor:{kind:'person',userId:this.userId},source:'conversation',
        conditions:{userId:board.userId,
          'options.name':board.options?.name??null, 'options.creationBrief':board.options?.creationBrief??null, orgId:board.orgId??null,
          nodes:board.nodes ?? null, nativeConversationRevision:board.nativeConversationRevision??null,
          ...(!board.creative && {creative:null}), ...sharedSaveConditions(board,this.userId)},
        build:current=>{
          // The 8th board landed between the preview and Keep: said as the cap, not as a changed drawing.
          if(slateBoards(current).length>=MAX_BOARDS) throw Object.assign(new Error('full'),{code:'save_refused',full:slateBoards(current).length})
          made=componentPlacing(current,draft.workshop)
          // An untitled slate takes the kept board's title as its name; a name the person gave stays.
          named=boardNamesSlate(current,draft.workshop)['options.name']
          return {set:{lastNativeCanvasProposal:{id,uid:this.userId,boardId:made.boardId},...made.set,...(named && {'options.name':named})},inc:{nativeConversationRevision:1}}
        }})
    } catch(error) {
      if(error?.full) throw new Meteor.Error('opens-new',catalogFits('retro',{hasBoard:true,many:true,boards:error.full}).reason)
      if(error?.code==='save_refused') throw changed()
      throw error
    }
    const origin=made.origin
    this.connection.slateboxNativeCanvasDraft=null
    if (board.userId!==this.userId) await rememberInvitedEdit(this.userId,board,shareId).catch(()=>{})
    // The page takes the board live (no reload): where it sits, and the revision its saves now name.
    // `name`: the slate's new name, when the board named it (the page shows it, and its saves keep it).
    return {kept:true,boardId:made.boardId,origin,nativeConversationRevision:(board.nativeConversationRevision??0)+1,...(named && {name:named})}
  },
})
