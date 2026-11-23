import test from 'node:test'
import assert from 'node:assert/strict'
import {proposeSceneChange} from '../web/app/imports/api/common/scene-conversation.mjs'
import {creativeSlates} from '../web/app/imports/api/common/creativeSlates.mjs'

const scene = kind => {
  const config = creativeSlates.get(kind)
  const source = config.initial(new URLSearchParams())
  return { source, ask:(message, selected, model=source) => proposeSceneChange(model, config, message, selected).model }
}

test('scene edits preview native recording names and handoff notes without moving the scene',()=>{
  const listening=scene('listening-room')
  const track=listening.ask('Set Left recording to Loons')
  assert.equal(track.leftLabel,'Loons')
  assert.deepEqual({...track,leftLabel:listening.source.leftLabel},listening.source)
  assert.throws(()=>listening.ask('Set Right recording to <script>'))
  const field=scene('offline-handoff')
  for(const [name,id] of [['Field test','fieldNote'],['Desk note','deskNote'],['Fallback instructions','fallback']]){
    assert.deepEqual(field.ask('Set '+name+' to Shift change'),{...field.source,[id]:'Shift change'})
  }
})
test('gallery conversations preserve real hanging rules and darkroom renames preserve focus behavior',()=>{
  const gallery=scene('moon-gallery')
  const renamed=gallery.ask('Rename Coast to Estuary')
  const required=gallery.ask('Hang Estuary after Dunes',null,renamed)
  assert.equal(required.panels[2].after,'dunes')
  assert.equal(gallery.ask('Let Estuary hang any time',null,required).panels[2].after,null)
  assert.throws(()=>gallery.ask('Hang Moon after Coast'))
  assert.deepEqual(required.hung,gallery.source.hung)
  const dark=scene('focus-darkroom')
  assert.deepEqual(dark.ask('Rename it to Silver dust','secondPrint'),{...dark.source,secondPrint:'Silver dust'})
  assert.equal(dark.ask('Rename Third print to River').thirdPrint,'River')
  assert.throws(()=>dark.ask('Rename Missing print to River'))
})
