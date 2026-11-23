import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createRequire} from 'node:module'
import {legacyWorkshopEntry,rememberLegacyWorkshop,readStoredWorkshop,storedWorkshopData} from '../web/app/imports/api/common/legacy-workshop-entry.mjs'
const require=createRequire(new URL('../web/app/package.json',import.meta.url))
const {createWorkshopMap,decodeWorkshopFragment}=require('slateboxjs/workshops/model')
const customerImport=require('./imports/ui/pages/customer-import-map.json')
const storage=()=>{const records=new Map();return {getItem:key=>records.get(key),setItem:(key,value)=>records.set(key,value)}}

test('new legacy entrances start native slates; the named sample keeps its original model',()=>{
  const args={storage:storage(),customerImport,userId:null}
  assert.equal(legacyWorkshopEntry({...args,format:'map'}).to,'/new/map')
  assert.equal(legacyWorkshopEntry({...args,format:'release-plan'}).to,'/new/map')
  assert.equal(legacyWorkshopEntry({...args,format:'lanes'}).to,'/new/workshop')
  const result=legacyWorkshopEntry({...args,format:'map',sample:'customer-import'})
  assert.deepEqual(decodeWorkshopFragment(result.to.slice('/new/workshop'.length)),customerImport)
})

test('recover exact session drafts for the current actor and return to the migrated slate without creating another',()=>{
  const board=createWorkshopMap();board.title='An existing private map'
  const s=storage(), args={storage:s,customerImport,userId:'owner',format:'map'}
  s.setItem('slatebox.map.v1.owner',JSON.stringify({draft:board,stage:'present'}))
  assert.equal(legacyWorkshopEntry({...args,userId:'other'}).to,'/new/map')
  const first=legacyWorkshopEntry(args);const data=first.state.localWorkshop
  assert.deepEqual(readStoredWorkshop(data),board)
  rememberLegacyWorkshop({source:first.state.legacyWorkshop,data,owner:'owner',shareId:'ddffeebb12',storage:s})
  assert.equal(legacyWorkshopEntry(args).to,'/canvas/ddffeebb12')
  assert.equal(legacyWorkshopEntry({...args,userId:'other'}).to,'/new/map')
  const guest=storage();guest.setItem('slatebox.map.v1.guest',JSON.stringify({draft:board}))
  const anon=legacyWorkshopEntry({...args,userId:null,storage:guest})
  rememberLegacyWorkshop({source:anon.state.legacyWorkshop,data,owner:'new-guest',shareId:'aaaaee9912',storage:guest})
  assert.equal(legacyWorkshopEntry({...args,userId:'new-guest',storage:guest}).to,'/canvas/aaaaee9912')
})

test('a valid local document can exceed the 64 KiB encoded-link ceiling',()=>{
  const board=createWorkshopMap()
  board.lanes=Array.from({length:5},(_,i)=>({id:'l'+i,label:'Station '+i,station:{column:i%3,row:Math.floor(i/3),next:i<4?['l'+(i+1)]:[],outcome:'海'.repeat(160)}}))
  board.cards=Array.from({length:24},(_,i)=>({id:'c'+i,label:'海'.repeat(80),laneId:'l0'}))
  board.signals=Array.from({length:24},(_,i)=>({id:'s'+i,label:'海'.repeat(80),cardId:'c'+i,laneId:'l0',whenPresent:'海'.repeat(160),whenAbsent:'海'.repeat(160)}))
  const {encodeWorkshopFragment}=require('slateboxjs/workshops/model')
  const data=storedWorkshopData(board)
  assert.throws(()=>encodeWorkshopFragment(board),/too large/)
  assert.deepEqual(readStoredWorkshop(data),board)
})
