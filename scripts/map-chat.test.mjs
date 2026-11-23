import assert from 'node:assert/strict'
import test from 'node:test'
import { mapChangeTool, mapChatHistory, prepareMapReply } from '../web/app/server/methods/map-chat.mjs'
import { sdkChatRequest } from '../web/app/server/methods/ai/sdk-chat.cjs'
import { createRequire } from 'node:module'
const require = createRequire(new URL('../web/app/package.json', import.meta.url))
const { createWorkshopMap } = require('slateboxjs/workshops/model')
const start = createWorkshopMap()
start.lanes[0].station.image = {src:'https://example.org/image.jpg',alt:'Shoreline'}
start.presentationOrder = ['next','start']
const proposal = {reply:'Added a lookout.', edits:[{type:'addBranch',from:'start',label:'Lookout',outcome:'See the coast.'}]}
test('reviewing operations retains artwork, token, existing routes and authored playback order', () => {
  const {workshop}=prepareMapReply(proposal,start)
  assert.equal(start.lanes.length,2)
  assert.deepEqual(workshop.cards,start.cards)
  assert.deepEqual(workshop.lanes[0].station.image,start.lanes[0].station.image)
  assert.deepEqual(workshop.presentationOrder,['next','start','station-1'])
  assert.deepEqual(workshop.lanes[0].station.next,['next','station-1'])
  assert.throws(()=>prepareMapReply({...proposal,edits:[{type:'connect',from:'start',to:'missing'}]},start))
  assert.throws(()=>mapChatHistory([{role:'system',content:'untrusted'}]))
})
test('SDK 7 sends the bounded chat context to the operator model and returns its structured tool call', async () => {
  const endpoint='http://127.0.0.1:40199/v1/chat/completions'
  const response=await sdkChatRequest({provider:'selfhost-workshop',endpoint,local:true,body:{model:'fixture',
    messages:[{role:'system',content:'Map editor.'},{role:'user',content:'A coastal walk?'},{role:'assistant',content:'A headland?'},{role:'user',content:'Add a lookout.'}],
    tool_choice:'auto'},functions:[mapChangeTool],fetcher:async(url,init)=>{
      assert.equal(String(url),endpoint)
      assert.equal(init.redirect,'error')
      const request=JSON.parse(init.body)
      assert.deepEqual(request.messages.map(m=>m.role),['system','user','assistant','user'])
      assert.equal(request.tools[0].function.name,mapChangeTool.name)
      return Response.json({id:'r',created:1,model:'fixture',choices:[{index:0,finish_reason:'tool_calls',message:{
        role:'assistant',content:null,tool_calls:[{id:'t',type:'function',function:{name:mapChangeTool.name,arguments:JSON.stringify(proposal)}}]}}]})
    }})
  assert.deepEqual(JSON.parse(response.choices[0].message.tool_calls[0].function.arguments),proposal)
})
test('legacy canvas chat sends an Anthropic tool exchange and image through its original provider',async()=>{
  const response=await sdkChatRequest({provider:'anthropic',endpoint:'https://api.anthropic.com/v1/messages',apiKey:'fixture-only',
    functions:[],body:{model:'fixture',system:'Canvas',max_tokens:256,messages:[
      {role:'user',content:'Draw a tree'},{role:'assistant',content:[{type:'tool_use',id:'t',name:'draw',input:{}}]},
      {role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'Drawn.'},{type:'image',source:{type:'base64',media_type:'image/png',data:'aGVsbG8='}}]},
    ]},fetcher:async(url,init)=>{
      assert.equal(String(url),'https://api.anthropic.com/v1/messages')
      const request=JSON.parse(init.body)
      assert.equal(request.messages[1].content[0].id,'t')
      assert.equal(request.messages[2].content[0].tool_use_id,'t')
      assert.equal(request.messages[2].content[1].type,'image')
      return Response.json({id:'reply',type:'message',role:'assistant',model:'fixture',content:[{type:'text',text:'Done.'}],stop_reason:'end_turn',usage:{input_tokens:9,output_tokens:2}})
    }})
  assert.equal(response.content[0].text,'Done.')
})

test('the assistant can propose a scene sequence without changing the route or moving its token', () => {
  const edit = laneIds => prepareMapReply({reply:'Open with the starting point.', edits:[{type:'setPresentationOrder', laneIds}]}, start)
  assert.deepEqual(edit(['start','next']).workshop, {...start, presentationOrder:['start','next']})
  assert.deepEqual(start.presentationOrder, ['next','start'])
  for (const invalid of [undefined, ['start'], ['next','next'], ['start','unknown']]) assert.throws(() => edit(invalid))
})

test('provider object tools apply the same layout, capacity, image and travel constraints as direct conversations',()=>{
  const edits=[
    {type:'position',id:'next',column:1,row:2},{type:'capacity',id:'next',capacity:1},
    {type:'image',id:'next',src:'https://example.org/map.jpg',alt:'A path'},
    {type:'imageDescription',id:'next',text:'A dock path'},{type:'moveToken',id:'token',to:'next'}
  ]
  const {workshop} = prepareMapReply({reply:'Ready to review.',edits},start)
  assert.deepEqual(workshop.lanes[1].station.image,{src:'https://example.org/map.jpg',alt:'A dock path'})
  assert.equal(workshop.lanes[1].capacity,1)
  assert.equal(workshop.lanes[1].station.row,2)
  assert.equal(workshop.cards[0].laneId,'next')
  assert.equal(start.cards[0].laneId,'start')
  for(const edit of [{type:'position',id:'next',column:0,row:0},{type:'moveToken',id:'token',to:'missing'},{type:'capacity',id:'token',capacity:7}]) {
    assert.throws(()=>prepareMapReply({reply:'Review.',edits:[edit]},start))
  }
})

test('provider can prepare an additional map token at an existing station', () => {
  const source = createWorkshopMap()
  const {workshop} = prepareMapReply({reply:'Review the new token.',edits:[{type:'addToken',at:'next',label:'Dispatcher'}]},source)
  assert.deepEqual(workshop.cards[1],{id:'token-1',label:'Dispatcher',laneId:'next'})
  assert.equal(source.cards.length,1)
})
