import React,{Suspense,lazy,useEffect,useRef,useState} from 'react'
import {Meteor} from 'meteor/meteor'
import {Box,Button,Typography} from '@mui/material'
import ConversationPanel,{ConversationComposer,focusMessageAfterReload} from './ConversationPanel'
import PayNotice, { isCreditRefusal } from './PayNotice'
import {canvasStarters,nativeRequestKind} from '../../api/common/native-canvas-conversation.mjs'
import {agentLabel,firstNameOf} from '../../api/common/agent-label.mjs'
import AddStrip,{AddShort} from './library/AddStrip'
import ChatTurn,{ChatThinking} from './ChatTurn'
import {keptReply} from '../../api/common/chat-words.mjs'
import {loadLibrary} from './library/libraryBus'
import BoardRules from './workshop/BoardRules'
import {previewKeepSentence} from '../../api/common/conversation-preview.mjs'
import {useAtom,useAtomValue,useSetAtom} from 'jotai'
import {askableAgentsAtom,openChatWithAtom} from '../jotai/atoms'
import {agentChatReply,agentErrorReply,agentOfTurn,routeMessage,sameAgentName} from '../../api/common/agent-mention.mjs'
import {openAgentAtom} from './AgentPresenceListener'

// The library (a view inside this conversation) and its cards: the library chunk, loaded on demand.
const LibraryView=lazy(loadLibrary)
const LibraryCards=lazy(()=>loadLibrary().then(m=>({default:m.LibraryCards})))
const FirstTurn=lazy(()=>loadLibrary().then(m=>({default:m.FirstTurn})))
const libraryModule=()=>import('../../api/common/library.mjs')
// Import from Excalidraw (the + menu): its own chunk, loaded when someone picks it.
const ImportExcalidraw=lazy(()=>import('./library/ImportExcalidraw'))

// Drawing requests run on exec (canvasConversation.*); workshop and interactive-route requests
// keep their own methods (nativeCanvas.*) until the registry has actions for them.
const methodsFor=message=>nativeRequestKind(message)==='draw' ? 'canvasConversation' : 'nativeCanvas'
const BOARD_FORMATS=['launch-plan','pipeline','budget']
const BOARD_NAMES={'launch-plan':'Launch plan',pipeline:'Sales pipeline',budget:'Budget'}
const WARNINGS={
  removes:count=>`This removes ${count===1?'a note or connection':(count||'some')+' notes or connections'}.`,
  rewrites_text:count=>`This rewrites the text of ${count} notes.`,
  others_notes:()=>'This changes notes someone else wrote.',
  widens_audience:()=>'This puts content where more people can see it.',
  widens_access:()=>'This gives more people access.',
  breaks_board_rule:(count,reason)=>`This moves ${count===1?'a card':(count||'some')+' cards'} past the board's rules: ${(reason?.rules||[]).join(' ')}`.trim(),
}

/**
 * Whether the slate's canvas holds no note, watched as its drawing changes (null until it is known).
 * The drawing is read for its notes only when a note's drawing comes or goes, so editing is not slowed.
 */
function useDrawnEmpty(liveNodes) {
  const [empty,setEmpty]=useState(null)
  const read=useRef(liveNodes)
  read.current=liveNodes
  useEffect(() => {
    const canvas=document.getElementById('slateCanvas')
    if (!canvas || typeof MutationObserver!=='function') return undefined
    let frame=0, drawn=null
    // Read again whenever the notes drawn change in number: a Keep drawn in place replaces the preview's
    // notes with the slate's own without the canvas ever being empty in between.
    const check=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
      const now=canvas.querySelectorAll('g[data-node-id]').length
      if (now===drawn) return
      drawn=now
      setEmpty(!now || !read.current().some(node=>!node?.options?.isComment))
    })}
    const observer=new MutationObserver(check)
    observer.observe(canvas,{childList:true,subtree:true})
    check()
    return () => {observer.disconnect();cancelAnimationFrame(frame)}
  }, [])
  return empty
}

export default function NativeCanvasConversation({shareId,board,onClose,onKeep,onKeeping=null,onPreview,readNodes,readSelection=null,about=null,library=null}) {
  // The library view, when it is open in place of the conversation (Back returns to the chat).
  const [view,setView]=useState(null)
  // Import from Excalidraw, open in place of the first turn until a drawing is previewed or Back.
  const [importing,setImporting]=useState(false)
  const [text,setText]=useState(''), [draft,setDraft]=useState(null), [error,setError]=useState('')
  // What is in flight: 'asking' while a preview is prepared, 'keeping' while it is saved.
  const [busy,setBusy]=useState(null)
  // A refusal the pay sheet answers (Get Pro, top up…), with the message it refused, to send again after.
  const [refusal,setRefusal]=useState(null)
  const inFlight=useRef(false), asked=useRef(0), before=useRef(''), input=useRef(null)
  const historyKey = 'slatebox:native-chat:' + Meteor.userId() + ':' + shareId
  const [history,setHistory] = useState(() => {
    try {
      const rows = JSON.parse(localStorage.getItem(historyKey) || '[]')
      return Array.isArray(rows) ? rows.filter(turn => typeof turn?.message === 'string' && typeof turn?.reply === 'string')
        .map(({id,message,reply,attach,agent,failed}) => ({id,message,reply,...(attach?.type==='catalog' && Array.isArray(attach.entries) && {attach:{type:'catalog',entries:attach.entries.filter(e=>typeof e==='string').slice(0,10)}}),...(agentOfTurn(agent) && {agent:agentOfTurn(agent)}),...(failed===true && {failed:true})})).slice(-6) : []
    } catch {return []}
  })
  const brief=board.options?.creationBrief
  // Invited agents on this slate (enterprise; none where it is locked): "@GitHub …" asks one here,
  // and only here (its chip shows what it did and opens this conversation, never a box of its own).
  const agents=useAtomValue(askableAgentsAtom)
  const openChip=useSetAtom(openAgentAtom)
  // Who the conversation is with: after "@GitHub", follow-ups go to GitHub until the person clears it
  // ("Replying to GitHub ×") or names someone else ("@Slatebox", "@Linear"). Kept per slate.
  const toKey=historyKey+':to'
  const [replyingTo,setReplyingToState]=useState(() => {try {return localStorage.getItem(toKey) || null} catch {return null}})
  const setReplyingTo=agentId => {setReplyingToState(agentId || null);try {agentId ? localStorage.setItem(toKey,agentId) : localStorage.removeItem(toKey)} catch {}}
  const replying=replyingTo ? agents.find(a=>a.agentId===replyingTo && a.canAsk) ?? null : null
  // "Ask in chat" on an agent's chip: replying to it, the box ready to type.
  const [chatWith,setChatWith]=useAtom(openChatWithAtom)
  useEffect(() => {
    if(!chatWith?.agentId) return
    setReplyingTo(chatWith.agentId)
    setChatWith(null)
    requestAnimationFrame(()=>input.current?.focus())
  }, [chatWith?.nonce])
  // What Slatebox's AI is told of the conversation: its own turns, and an agent's as a summary
  // ("GitHub: Added 2 notes …"), so "make notes about those" has something to point at.
  const aiHistory=()=>history.filter(turn=>!turn.pending && !turn.failed).map(({message,reply,agent})=>({message,reply:agent ? `${agent.name}: ${reply}`.slice(0,4000) : reply}))
  // An agent's own thread: its last turns, for a follow-up's context (sent as data).
  const agentHistory=name=>history.filter(turn=>!turn.pending && !turn.failed && turn.agent && sameAgentName(turn.agent.name,name)).slice(-3).map(({message,reply})=>({message:message.slice(0,1200),reply:reply.slice(0,1200)}))
  // A preview is made against the drawing as it was asked about. Once the drawing has moved on
  // (a note moved, renamed or deleted, by this person or a teammate) Keep would be refused, so it
  // is not offered, and the preview, drawn against the old drawing, leaves the canvas.
  const [stale,setStale]=useState(false)
  useEffect(() => {
    setStale(false)
    if(!draft) return undefined
    const check=()=>{try {if(readNodes()!==before.current) setStale(true)} catch {}}
    check()
    const timer=setInterval(check,600)
    return () => clearInterval(timer)
  }, [draft])
  // The draft is drawn on the canvas while it waits for Keep or Discard.
  useEffect(() => { onPreview?.(draft?.canvas && !stale ? {canvas:draft.canvas} : null) }, [draft,stale])
  useEffect(() => () => onPreview?.(null), [])
  // The conversation as shown, and as kept on this device (a turn still waiting is shown, never kept).
  const historyNow=useRef(history)
  historyNow.current=history
  function store(next) {
    historyNow.current=next
    setHistory(next)
    try {localStorage.setItem(historyKey,JSON.stringify(next.filter(turn=>!turn.pending).map(({next:_n,hint:_h,pending:_p,...turn})=>turn)))} catch {}
  }
  // A turn kept in the conversation (and on this device), with what it shows; it replaces a turn of the same id.
  function remember(entry) {
    const rows=historyNow.current
    const at=rows.findIndex(turn=>turn.id===entry.id)
    store(at>=0 ? rows.map(turn=>turn.id===entry.id ? entry : turn) : [...rows,entry].slice(-6))
  }
  const forget=id=>store(historyNow.current.filter(turn=>turn.id!==id))
  // "@name …": the invited agent of that name answers in this conversation, as itself (its name,
  // colour and mark), and what it suggests appears on the slate as one group to keep or discard there.
  // Only its inviter can ask it. A failure is its reply, with what to do next.
  async function askAgent({agent,request},message,turn,id) {
    const who=agentOfTurn(agent)
    const answer=(reply,extra={})=>remember({id,message,reply,agent:who,...extra})
    if(!agent.canAsk) return answer(agent.why || `Only ${agent.inviterName || 'the person who invited it'} can ask ${agent.name}.`)
    if(request.length<2) return answer(`What should ${agent.name} do? Write it after @${agent.name}.`)
    remember({id,message,reply:'',agent:who,pending:true})
    try {
      const result=await agent.ask(request,agentHistory(agent.name))
      if(turn!==asked.current) return
      answer(agentChatReply(agent.name,result))
    } catch(e) {
      if(turn!==asked.current) return
      const {text:reply,next}=agentErrorReply(agent.name,e)
      answer(reply,{failed:true,next:{kind:next,agentId:agent.agentId,refusal:next==='pay' ? {error:e.error,reason:e.reason,details:e.details,message} : null}})
    }
  }
  async function ask(message,{to=null,replace=null}={}) {
    if(inFlight.current || !message.trim()) return
    inFlight.current=true;setBusy('asking');setError('');setRefusal(null)
    const turn=++asked.current
    before.current=readNodes()
    // The person's message is in the conversation at once, whatever happens next.
    const id=replace || 'turn-'+Date.now()
    setText('')
    try {
      // Who it goes to: a named agent, the agent the conversation is with, or Slatebox (routeMessage).
      const route=routeMessage(message,{agents,replyingTo,to})
      setReplyingTo(route.replyingTo)
      if(route.kind==='agent') return await askAgent(route,message,turn,id)
      // A question only an invited agent can answer (Slatebox can't read GitHub): say so, and offer both.
      if(route.kind==='hint') {
        remember({id,message,reply:`Slatebox can't read ${route.agent.name}. ${route.agent.name} can answer that: ask @${route.agent.name}.`,hint:{agentId:route.agent.agentId,name:route.agent.name}})
        return
      }
      remember({id,message,reply:'',pending:true})
      // The library reads "Add a retro" and answers "what can I add?" here, with no AI call.
      const lib=await libraryModule().catch(()=>null)
      if(turn!==asked.current) return
      const local=lib?.libraryTurn(message)
      if(local) {
        remember({id,message,reply:local.all?'Here is everything you can add to this slate.':'These fit what you described.',attach:{type:'catalog',entries:local.entries}})
        return
      }
      const via=methodsFor(message)
      // The line selected on the canvas is what “this line” means.
      const selection=via==='canvasConversation' ? (readSelection?.() ?? null) : null
      const res=await Meteor.callAsync(via+'.preview',shareId,message,aiHistory(),...(selection ? [selection] : []))
      if(turn!==asked.current) return
      if(res.reply) {
        // A question answered in words: nothing to keep, so it joins the conversation.
        remember({id,message,reply:res.reply})
      } else {
        // A launch plan, pipeline or budget is previewed by its own rules, loaded only now.
        if(BOARD_FORMATS.includes(res.format)) await import('slateboxjs/workshops/rules')
        if(turn!==asked.current) return
        // The preview carries the message itself (Review the preview), so the waiting turn goes.
        forget(id)
        setDraft({...res,message,via})
      }
    } catch(e) {
      if(turn===asked.current) {
        // A refusal the pay sheet answers is said in the conversation, its ways on inside the message. Anything else is
        // said as Slatebox's reply, with what to do next: never red words under the box.
        const paying=isCreditRefusal(e.error) || Boolean(e.details?.pay)
        setRefusal(paying ? {error:e.error,reason:e.reason,details:e.details,message} : null)
        // The refused request is said once, in the refusal's own block: its waiting turn goes.
        if(paying) {forget(id);setText('')}
        else remember({id,message,reply:e.reason || e.message || 'That did not work.',failed:true,next:{kind:'retry'}})
      }
    }
    finally {if(turn===asked.current) {inFlight.current=false;setBusy(null)}}
  }
  // Leaving a preview that is still being prepared: its answer, when it comes, is dropped.
  function cancel() {
    asked.current++
    inFlight.current=false;setBusy(null)
  }
  async function keep() {
    if(inFlight.current) return
    if(readNodes()!==before.current) {setError('Your drawing changed. Discard this preview and ask again.');return}
    inFlight.current=true;setBusy('keeping');setError('')
    try {
      const keeping=Meteor.callAsync(draft.via+'.keep',shareId,draft.id)
      // The page hears of the Keep before it is saved: the change it saves is drawn here as its person's own step.
      onKeeping?.(keeping)
      const kept=await keeping
      // Said as a sentence ("Added a retro: Went well, Change and Try, up to three cards each."), naming
      // a library board the way its own add message does.
      const lib=draft.component ? await libraryModule().catch(()=>null) : null
      const reply = keptReply(draft,{addSay:lib?.catalogEntry(draft.component)?.addSay?.[0] ?? null})
      remember({id:draft.id,message:draft.message,reply})
      setText('')
      // A board kept here is drawn on this page as it is (no reload): the board's own chat takes over.
      if(draft.mode==='play' && kept?.kept) {
        setDraft(null);inFlight.current=false;setBusy(null)
        onKeep({board:true,origin:kept.origin,nativeConversationRevision:kept.nativeConversationRevision,...(kept.name && {name:kept.name})})
        return
      }
      // A drawing kept here is drawn on this page as the server saved it (no reload), as one step its person can undo.
      if(Array.isArray(kept?.revisions)) {
        setDraft(null);inFlight.current=false;setBusy(null)
        onKeep({revisions:kept.revisions,nativeConversationRevision:kept.nativeConversationRevision})
        requestAnimationFrame(()=>input.current?.focus())
        return
      }
      focusMessageAfterReload(shareId)
      onKeep(null)
    }
    catch(e){setError(e.reason || e.message);inFlight.current=false;setBusy(null)}
  }
  function discard() {setDraft(null);setError('')}
  // A starter fills the message with something that can be previewed as it stands. The part
  // a person is most likely to replace is selected, so typing over it is one gesture. The list
  // is the one every read of this slate returns, worked out from the drawing as it is now.
  const suggest = ({text:value, select=[value.length,value.length]}) => {
    setText(value)
    requestAnimationFrame(() => {input.current?.focus();input.current?.setSelectionRange(select[0],select[1])})
  }
  const liveNodes = () => {try {return JSON.parse(readNodes())} catch {return []}}
  // A change that removes anything waits for a yes, as an agent's held plan does: Yes keeps
  // exactly this preview (its id is the confirmation), No discards it.
  const removing = draft && !stale && busy!=='keeping' && draft.warnings?.find(w=>w.rule==='removes')
  const removeCount = draft?.removed?.length || removing?.count || 0
  const removeWhat = draft?.removed?.length ? (removeCount===1?'1 note':removeCount+' notes') : (removeCount===1?'a note or connection':(removeCount||'some')+' notes or connections')
  const waitingFor = busy==='asking' ? history.find(turn=>turn.pending && turn.agent) : null
  const asking = Boolean(waitingFor)
  const hold = asking ? {reason:`${waitingFor.agent.name} is working…`,actions:null}
    : busy==='asking' ? {reason:'Preparing the preview…',actions:<Button size="small" onClick={cancel}>Cancel</Button>}
    : removing ? {reason:agentLabel(firstNameOf(Meteor.user()))+' wants to remove '+removeWhat+'. Remove '+(removeCount===1?'it':'them')+'?',actions:<>
      <Button variant="contained" size="small" disabled={Boolean(busy)} onClick={keep}>Yes</Button>
      <Button size="small" disabled={Boolean(busy)} onClick={discard}>No</Button>
    </>}
    : draft ? {reason:busy==='keeping' ? 'Adding the preview to the slate…' : stale ? 'Your drawing changed after this preview. Discard it and ask again.' : 'Keep or discard the preview to write again.',actions:<>
      <Button variant="contained" size="small" disabled={Boolean(busy) || stale} onClick={keep}>Keep changes</Button>
      <Button size="small" disabled={Boolean(busy)} onClick={discard}>Discard preview</Button>
    </>} : null
  // An empty slate opens with the library's first turn ("What are you working on?") instead of starters.
  // Watched live: a new slate starts empty, and its first note (the welcome's, a double-click, an
  // agent's) turns the first turn into the usual starters without a reload; emptied, it comes back.
  const drawnEmpty = useDrawnEmpty(liveNodes)
  const empty = (drawnEmpty ?? !(board.nodes||[]).some(node=>!node?.options?.isComment)) && !brief
  const firstTurn = empty && !history.length && !draft && !view
  // Add from the library, the strip or the + menu: the entry's own add message, previewed, then kept.
  async function addEntry(entry) {
    const lib=await libraryModule()
    const found=typeof entry==='string' ? lib.catalogEntry(entry) : entry
    if(!found) return
    setView(null)
    ask(found.addSay[0])
  }
  const browse = (start={}) => setView({start})
  const say = value => { setView(null); suggest({text:value}) }
  useEffect(() => {
    if(!library) return
    if(library.import==='excalidraw') {setView(null);setImporting(true)}
    else if(library.add) addEntry(library.add)
    else browse(library.start ?? {})
  }, [library?.nonce])
  const composer = <ConversationComposer shareId={shareId} inputRef={input} value={text} onChange={setText} onSubmit={()=>ask(text)}
    hold={hold} canSubmit={Boolean(text.trim())} placeholder={replying ? `Reply to ${replying.name}, or @Slatebox` : empty ? (board.library?.mode==='build' ? 'Describe the board, or pick a shape' : 'What are you working on?') : agents.some(a=>a.canAsk) ? `Ask anything, or @${agents.find(a=>a.canAsk).name}` : 'Ask anything'} maxLength={1200} error={error}
    extra={!hold && <>
      {/* Who the next message goes to, after "@name": × hands the conversation back to Slatebox. */}
      {replying && <Box data-replying-to={replying.name} sx={{display:'inline-flex',alignItems:'center',gap:.5,px:1,py:.25,mb:.5,borderRadius:'12px',border:'1px solid',borderColor:replying.color,typography:'caption'}}>
        <span>Replying to <b style={{color:replying.color}}>{replying.name}</b></span>
        <Box component="button" type="button" aria-label={`Stop replying to ${replying.name}`} data-replying-clear="" onClick={()=>setReplyingTo(null)}
          sx={{border:0,background:'none',cursor:'pointer',p:0,lineHeight:1,font:'inherit',color:'text.secondary'}}>×</Box>
      </Box>}
      {/* One way to browse at a time: not under the library, nor under the first turn's own cards. */}
      {!view && !firstTurn && <AddStrip empty={empty} hasBoard={false} onAdd={addEntry} onBrowse={()=>browse()} compact={history.length>0 || Boolean(draft)} />}
    </>}
    prompt={empty ? null : 'What should happen on this slate?'}
    starters={!empty && <Box aria-label="Starter messages" sx={{display:'flex',flexWrap:'wrap',gap:.5,my:1}}>
      {canvasStarters(board.nodes).map(({label},i)=><Button key={label} size="small" onClick={()=>suggest(canvasStarters(liveNodes())[i])}>{label}</Button>)}
      {/* Your invited agents: "@GitHub " starts a message to one. */}
      {agents.filter(a=>a.canAsk).map(a=><Button key={'agent-'+a.agentId} size="small" data-mention-agent={a.name} sx={{color:a.color}} onClick={()=>{setReplyingTo(a.agentId);suggest({text:''})}}>@{a.name}</Button>)}
      <AddShort onBrowse={()=>browse()} />
    </Box>} />
  if(view) return <ConversationPanel anchor="top" onClose={onClose} composer={composer}>
    <Suspense fallback={<Typography variant="body2" sx={{my:2}}>Opening the library…</Typography>}>
      <LibraryView start={view.start} onBack={()=>setView(null)} onAdd={addEntry} onSay={say} onSend={value=>{setView(null);ask(value)}} />
    </Suspense>
  </ConversationPanel>
  return <ConversationPanel anchor={firstTurn ? 'top' : 'bottom'} onClose={onClose} composer={composer}>
    {about}
    {brief && <Box aria-label="Opening message" sx={{my:1}}>
      <ChatTurn who="you" as="div" after={!draft && !history.some(turn=>turn.message===brief) &&
        <Button size="small" disabled={Boolean(busy)} onClick={()=>ask(brief)}>Draft from this brief</Button>}>{brief}</ChatTurn></Box>}
    {importing && !draft && <Suspense fallback={<Typography variant="body2" sx={{my:2}}>Opening the import…</Typography>}>
      <ImportExcalidraw shareId={shareId} onBack={()=>setImporting(false)} onPreview={(res,message)=>{
        before.current=readNodes()
        setImporting(false)
        setDraft({...res,message,via:'canvasConversation',...(res.left && {said:null,importLeft:res.left})})
      }} />
    </Suspense>}
    {firstTurn && !importing && <Suspense fallback={null}><FirstTurn onAdd={addEntry} onOpen={entry=>browse({entry:entry.id})} onBrowse={browse} onGoal={value=>suggest({text:value})}
      build={board.library?.mode==='build' ? board.library : null} onSend={ask} /></Suspense>}
    {history.length>0 && <Box component="ol" aria-label="Kept conversation" sx={{listStyle:'none',p:0,my:1}}>
      {history.map(turn=><Box component="li" key={turn.id} data-turn-failed={turn.failed ? '' : undefined}>
        {turn.message!==brief && <ChatTurn who="you" as="div">{turn.message}</ChatTurn>}
        {turn.pending ? (turn.agent ? <ChatTurn who="agent" agent={turn.agent} as="div"><Typography variant="body2" color="text.secondary">Working on it…</Typography></ChatTurn> : <ChatThinking as="div" />)
          : <ChatTurn who={turn.agent ? 'agent' : 'slatebox'} agent={turn.agent ?? null} as="div" after={turn.attach?.type==='catalog' ? <Suspense fallback={null}><CatalogTurn ids={turn.attach.entries} onAdd={addEntry} onOpen={entry=>browse({entry:entry.id})} onBrowse={()=>browse()} /></Suspense>
            : turn.hint ? <Box sx={{display:'flex',flexWrap:'wrap',gap:.5}}>
              <Button size="small" variant="contained" data-hint-ask={turn.hint.name} disabled={Boolean(busy)} onClick={()=>ask(turn.message,{to:turn.hint.agentId,replace:turn.id})}>Ask @{turn.hint.name}</Button>
              <Button size="small" disabled={Boolean(busy)} onClick={()=>ask(turn.message,{to:'slatebox',replace:turn.id})}>Ask Slatebox anyway</Button>
            </Box>
            : turn.next?.kind==='pay' ? <PayNotice refusal={turn.next.refusal} from="draft" retry={() => ask(turn.message,{replace:turn.id})} inline />
            : turn.next?.kind==='signIn' || turn.next?.kind==='chip' ? <Button size="small" data-turn-next={turn.next.kind} onClick={()=>openChip(turn.next.agentId)}>{turn.next.kind==='signIn' ? 'Sign in again' : 'Open its chip'}</Button>
            : turn.next?.kind==='retry' ? <Button size="small" data-turn-next="retry" disabled={Boolean(busy)} onClick={()=>ask(turn.message,{replace:turn.id,to:turn.next.agentId || 'slatebox'})}>Try again</Button>
            : null}>{turn.reply}</ChatTurn>}
      </Box>)}
    </Box>}
    {/* The refused request and the refusal, with Pro or a balance as buttons in the message (the same pay sheet); it runs again once paid. */}
    {refusal && !busy && <Box aria-label="Refused request" sx={{my:1}}>
      <ChatTurn who="you" as="div">{refusal.message}</ChatTurn>
      <ChatTurn who="slatebox" as="div"><PayNotice refusal={refusal} from="draft" retry={() => ask(refusal.message)} inline /></ChatTurn>
    </Box>}
    {draft && <Box aria-label="Review the preview" aria-live="polite" sx={{my:1}}>
      <ChatTurn who="you" as="div">{draft.message}</ChatTurn>
      <ChatTurn who="slatebox" as="div"><Box sx={{typography:'body2','& ul':{my:.5,pl:2.5}}}>
      <Typography variant="body2" sx={{mb:.5,fontWeight:700}}>{draft.provider==='ai'?'AI preview':'Preview'} · {draft.component ? draft.title : BOARD_NAMES[draft.format] ?? (draft.format==='lanes'?'Workshop':draft.mode==='play'?'Interactive route':'Drawing')}{!draft.component && draft.format!=='lanes' && !BOARD_NAMES[draft.format] && ' · '+draft.links+' '+(draft.links===1?'connection':'connections')}</Typography>
      <Typography variant="body2">{stale ? 'Your drawing changed after this preview, so it is no longer shown. Discard it and ask again on the drawing as it is now.'
        : 'Shown on the canvas with dashed outlines. Nothing is added until you keep it.'}</Typography>
      <ul>{draft.labels.map((label,i)=><li key={i}>{label}</li>)}</ul>
      {draft.changes?.length>0 && <Box component="section" aria-label="Notes this rewrites">
        <Typography variant="body2">Rewrites {draft.changes.length===1?'1 note':draft.changes.length+' notes'}:</Typography>
        <ul>{draft.changes.map(c=><li key={c.id}><s>{c.before}</s> → {c.after}</li>)}</ul>
      </Box>}
      {draft.removed?.length>0 && <Box component="section" aria-label="Notes this removes">
        <Typography variant="body2">Removes {draft.removed.length===1?'1 note':draft.removed.length+' notes'}:</Typography>
        <ul>{draft.removed.map(r=><li key={r.id}>{r.text}</li>)}</ul>
      </Box>}
      {!draft.component && draft.capacities?.map(l=><Typography variant="body2" key={l.label}>{l.label} holds up to {l.capacity} cards.</Typography>)}
      {/* The board's rules as the chips it draws above itself on the canvas (boardLegend): the chat and the canvas say the same. */}
      {draft.canvas?.workshop && <BoardRules workshop={draft.canvas.workshop} />}
      {draft.format==='lanes' && !draft.component && <Typography variant="body2">Add your cards in the workshop after Keep.</Typography>}
      {draft.said && <Typography variant="body2">{draft.said.replace(/^Added /,'Keep this to add ')}.</Typography>}
      {draft.imported && <Typography variant="body2" data-import-summary="">Imported drawing: {draft.imported.notes} {draft.imported.notes===1?'note':'notes'}, {draft.imported.lines} {draft.imported.lines===1?'line':'lines'}. Keep it to add them to this slate.</Typography>}
      {draft.importLeft && <Typography variant="body2" color="text.secondary">{draft.importLeft}</Typography>}
      {/* What Keep does, in the board's own words: "play the route" is a map's only. */}
      {!draft.said && (draft.component || draft.mode==='play') && previewKeepSentence(draft) && <Typography variant="body2">{previewKeepSentence(draft)}</Typography>}
      {draft.warnings?.map(w=><Typography variant="body2" key={w.rule} role="note" color="warning.main">{WARNINGS[w.rule]?.(w.count,w)}</Typography>)}
      </Box></ChatTurn>
    </Box>}
  </ConversationPanel>
}

/** A catalogue turn: the entries the conversation answered with, as cards (the library chunk). */
function CatalogTurn({ids,onAdd,onOpen,onBrowse}) {
  const [entries,setEntries]=useState(null)
  useEffect(()=>{let gone=false;import('../../api/common/library.mjs').then(lib=>{if(!gone) setEntries(ids.map(lib.catalogEntry).filter(Boolean))});return()=>{gone=true}},[ids.join()])
  if(!entries) return null
  return <><LibraryCards entries={entries} onOpen={onOpen} onAdd={onAdd} />
    {entries.length<10 && <Button size="small" onClick={onBrowse}>See everything</Button>}</>
}
