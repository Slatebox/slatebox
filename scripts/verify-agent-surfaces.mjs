// Run from the app repo. Uses only a new, owned fixture on the named staging host.
// SLATEBOX_EXPECTED_APP_BUNDLE=<modern-js-sha1> node scripts/verify-agent-surfaces.mjs
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {randomUUID,randomBytes} from 'node:crypto'
import {spawn} from 'node:child_process'
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js'

const origin='https://test.slatebox.com'
const stamp=process.env.SLATEBOX_EXPECTED_APP_BUNDLE
assert.match(stamp || '',/^[a-f0-9]{40}$/)
const requireEngine=createRequire(new URL('../../slateboxjs-v2/package.json',import.meta.url))
const {chromium,expect}=requireEngine('@playwright/test')
// Set SLATEBOX_AGENT_TOOLS_DIR to the installed package to verify the release archive.
const toolsDir=process.env.SLATEBOX_AGENT_TOOLS_DIR || fileURLToPath(new URL('../packages/slatebox-mcp/',import.meta.url))
const binary=name=>join(toolsDir,'src',name)
const env=token=>({PATH:process.env.PATH,SLATEBOX_API_TOKEN:token,SLATEBOX_BASE_URL:origin})
const plan=label=>({message:'Add '+label,operations:[{kind:'add_nodes',count:1,shape:'rectangle',text:label}]})
const browser=await chromium.launch({channel:'chrome'})
// Optional operator-issued ordinary member pair from the isolated staging team fixture.
const teamDir=process.env.SLATEBOX_TEST_TEAM_STATES
async function actor(role) {
  if(!teamDir)return browser.newPage()
  const context=await browser.newContext({storageState:join(teamDir,role+'.json')})
  return context.newPage()
}
const page=await actor('owner')
const peer=teamDir ? await actor('peer') : null
page.setDefaultTimeout(20000)
peer?.setDefaultTimeout(20000)
const email='agent-surface-'+randomUUID()+'@qa.slatebox.invalid'
let owner, share, mcp, docId, team, peerId
const tokens=[]

async function issue(name,scopes,actorPage=page) {
  const issued=await actorPage.evaluate(({name,scopes})=>window.Meteor.callAsync('apiTokens.create',{name,scopes}),{name,scopes})
  assert(issued.id && issued.token)
  tokens.push({...issued,actorPage})
  return issued.token
}
async function request(token,op,key,preview=false) {
  const url=origin+'/api/v1/slates/'+share+(op?'/operations':'?include=full')
  const headers={authorization:'Bearer '+token}
  if(op){headers['content-type']='application/json';headers['idempotency-key']=key}
  // Every edit names the revision it was made on: read it first, as an agent does.
  const expectedRevision=op?(await (await fetch(origin+'/api/v1/slates/'+share,{headers:{authorization:'Bearer '+token},redirect:'error'})).json()).revision:undefined
  const response=await fetch(url,{headers,method:op?'POST':'GET',redirect:'error',
    body:op?JSON.stringify({plan:op,expectedRevision,...(preview&&{mode:'preview'})}):undefined})
  return {status:response.status,value:await response.json()}
}
async function shell(token,args,input) {
  const child=spawn(process.execPath,[binary('cli.js'),...args],{env:env(token),stdio:['pipe','pipe','pipe']})
  let out=''
  child.stdout.on('data',chunk=>out+=chunk)
  child.stderr.resume()
  const exit=new Promise((ok,fail)=>{child.once('error',fail);child.once('close',ok)})
  child.stdin.end(input)
  assert.equal(await exit,0,'CLI command failed')
  return JSON.parse(out)
}
try {
  if(teamDir) {
    const identity=async(p,role)=>{
      await p.goto(origin+'/profile')
      await p.waitForFunction(()=>window.Meteor?.status().connected && !window.Meteor.loggingIn())
      await p.evaluate(()=>new Promise((ok,no)=>window.Meteor.subscribe('me',{onReady:ok,onStop:no})))
      await p.waitForFunction(()=>window.Meteor?.user()?.emails?.length)
      const u=await p.evaluate(()=>{const m=window.Meteor.user();return {id:m._id,org:m.orgId,email:m.emails[0].address,guest:m.isAnonymous}})
      assert(/^workshop-e2e-[a-f0-9-]{36}$/.test(u.org) && !u.guest && u.email===role+'-'+u.org.slice('workshop-e2e-'.length)+'@example.test','Invalid synthetic team identity')
      return u
    }
    team=await identity(page,'owner')
    const other=await identity(peer,'peer')
    assert(other.org===team.org && other.id!==team.id)
    peerId=other.id
    console.log('Verified two distinct existing fixture principals in the same isolated staging team.')
  }
  await page.goto(origin+'/new/sign-in-outage')
  await page.waitForURL(/\/canvas\/[a-f0-9]{10}$/)
  share=new URL(page.url()).pathname.split('/').pop()
  owner=await page.evaluate(()=>window.Meteor.userId())
  assert(owner)
  console.log('New native slate opened.')
  await expect(page.locator('script[src*="/'+stamp+'.js"]')).toHaveCount(1)
  if(!teamDir) {
  await page.goto(origin+'/profile')
  const claim=page.getByTestId('guest-account-claim')
  await claim.getByLabel('Email address').fill(email)
  await claim.locator('input[type=password]').fill(randomBytes(24).toString('base64url'))
  await claim.getByRole('button',{name:'Save my Slatebox'}).click()
  await page.waitForFunction(()=>window.Meteor?.user()?.isAnonymous===false)
  } else assert.equal(owner,team.id)
  await page.goto(origin+'/profile')
  await page.getByRole('tab',{name:'Developer',exact:true}).click()
  const token=await issue('Native integration proof',['slates:read','slates:write'])
  const reader=await issue('Read-only integration proof',['slates:read'])
  const first=await request(reader)
  assert.equal(first.status,200)
  // Restated (P07): the read is one flat object. Who owns the slate and who may see it are in
  // access; the stored row (and its _id) no longer leaves the server. Cleanup finds the row itself.
  assert(first.value.access.isOwner===true && first.value.access.visibility!=='public')
  let peerToken
  if(peer){
    peerToken=await issue('Agent proof teammate',['slates:read'],peer)
    assert([403,404].includes((await request(peerToken)).status),'Teammate already had access before grant')
  }
  const nodes=()=>request(reader).then(r=>r.value.document.nodes)
  const initial=await nodes()
  const denied=await request(reader,plan('Unused'),randomUUID())
  // A missing scope is 403 insufficient_scope since the action registry (P02); it was 401.
  assert.equal(denied.status,403)
  assert.equal(denied.value.error.code,'insufficient_scope')
  const httpPlan=plan('Review customer file')
  const httpKey=randomUUID()
  assert.equal((await request(token,httpPlan,httpKey,true)).value.mode,'preview')
  assert.deepEqual(await nodes(),initial)
  const committed=await request(token,httpPlan,httpKey)
  assert.equal(committed.status,201)
  const replay=await request(token,httpPlan,httpKey)
  assert.equal(replay.status,200)
  assert.deepEqual(replay.value,committed.value)
  console.log('Private HTTP GET, read-only scope denial, unchanged preview, committed write and identical retry passed.')
  mcp=new Client({name:'slatebox-staging-acceptance',version:'1.0.0'})
  await mcp.connect(new StdioClientTransport({command:process.execPath,args:[binary('cli.js')],env:env(token),stderr:'ignore'}))
  // Restated (exec): the MCP server's tools are exec and describe; each step is a script.
  assert.deepEqual((await mcp.listTools()).tools.map(tool=>tool.name),['exec','describe'])
  const exec=async(code,extra={})=>{
    const result=await mcp.callTool({name:'exec',arguments:{intent:'Staging acceptance',code,...extra}})
    assert(!result.isError && result.structuredContent.status==='completed','MCP exec did not complete')
    return result.structuredContent
  }
  const readFull=`return (await slatebox.slates.get({ shareId: ${JSON.stringify(share)}, include: "full" })).document`
  const call=async()=>({document:(await exec(readFull)).result})
  const afterHttp=await nodes()
  assert.equal((await call()).document.nodes.length,afterHttp.length)
  const save=`const { revision } = await slatebox.slates.get({ shareId: ${JSON.stringify(share)} })
return slatebox.slates.applyOperations({ shareId: ${JSON.stringify(share)}, expectedRevision: revision, plan: ${JSON.stringify(plan('Choose an owner'))}, userMessage: "Choose an owner" })`
  assert.equal((await exec(save,{mode:'preview'})).result.mode,'preview')
  assert.deepEqual(await nodes(),afterHttp)
  const key=randomUUID()
  const saved=await exec(save,{idempotencyKey:key})
  assert.equal(saved.result.mode,'save')
  // The same key replays the saved call instead of saving twice.
  const again=await exec(save,{idempotencyKey:key})
  assert.deepEqual(again.result,saved.result)
  assert.equal(again.calls[1].replayed,true) // calls[0] is the read of the revision
  console.log('Stdio MCP handshake, exec read, unchanged preview, commit and identical retry passed.')
  const labels=['Review customer file','Choose an owner']
  if(!process.argv.includes('--http-mcp-only')){
    const afterMcp=await nodes()
    assert.equal((await shell(token,['exec','-'],readFull)).nodes.length,afterMcp.length)
    const cliSave=`const { revision } = await slatebox.slates.get({ shareId: ${JSON.stringify(share)} })
return slatebox.slates.applyOperations({ shareId: ${JSON.stringify(share)}, expectedRevision: revision, plan: ${JSON.stringify(plan('Confirm the follow-up'))} })`
    assert.equal((await shell(token,['exec','-','--preview'],cliSave)).mode,'preview')
    assert.deepEqual(await nodes(),afterMcp)
    const args=['exec','-','--idempotency-key',randomUUID()]
    const applied=await shell(token,args,cliSave)
    assert.deepEqual(await shell(token,args,cliSave),applied)
    labels.push('Confirm the follow-up')
    console.log('Shell CLI exec read, unchanged stdin preview, commit and identical retry passed.')
  }
  const finalNodes=await nodes()
  assert.equal(finalNodes.length,initial.length+labels.length)
  await page.goto(origin+'/canvas/'+share)
  await page.reload()
  for(const label of labels){
    assert.equal(finalNodes.filter(n=>n.options.text===label).length,1)
    const id=finalNodes.find(n=>n.options.text===label).options.id
    const native=page.locator('#slateCanvas g[data-node-id="'+id+'"]').first()
    await expect(native).toHaveAttribute('aria-label',label,{timeout:20000})
    await expect.poll(async()=>(await native.locator('text').allTextContents()).join('').replace(/\s/g,''),{timeout:10000}).toBe(label.replace(/\s/g,''))
  }
  console.log('Native canvas reopened the same private slate with each committed label exactly once.')
  let editorPage=page
  if(peer){
    await page.getByRole('button',{name:'Share',exact:true}).click()
    const dialog=page.getByRole('dialog',{name:'Share this slate'})
    const section=dialog.getByRole('button',{name:/^Private/})
    if(await section.getAttribute('aria-expanded')!=='true')await section.click()
    const group=dialog.locator('input[name="slateAccessPermission-'+peerId+'"][value="EDIT"]')
    await group.click()
    await expect(group).toBeChecked()
    await expect.poll(async()=>(await request(peerToken)).status).toBe(200)
    await dialog.getByRole('button',{name:'Done',exact:true}).click()
    await peer.goto(origin+'/canvas/'+share)
    await expect(peer.locator('script[src*="/'+stamp+'.js"]')).toHaveCount(1)
    assert.equal(await peer.evaluate(()=>window.Meteor.userId()),peerId)
    editorPage=peer
    console.log('Independent member denied before grant, then admitted through explicit Private member edit.')
  }
  const lastLabel=labels.at(-1)
  const updated='Team signed off on the follow-up'
  const source=finalNodes.find(n=>n.options.text===lastLabel)
  const note=editorPage.locator('#slateCanvas g[data-node-id="'+source.options.id+'"]').first()
  const ok=editorPage.getByRole('dialog',{name:/welcome/i}).getByRole('button',{name:'OK',exact:true})
  if(await ok.waitFor({timeout:4000}).then(()=>true,()=>false))await ok.click()
  const cookies=editorPage.getByRole('button',{name:/^(Accept cookies|Got it)$/})
  if(await cookies.isVisible())await cookies.click()
  const fit=editorPage.getByTitle('Fit to screen',{exact:true}).first()
  if(await fit.isVisible())await fit.click()
  await note.dblclick()
  const editor=note.locator('[contenteditable="true"]')
  await expect(editor).toBeFocused()
  await editor.fill(updated)
  await editor.press('Enter')
  const fromMcp=async()=>(await call()).document.nodes.find(n=>n.options.id===source.options.id)?.options.text
  await expect.poll(fromMcp,{timeout:20000}).toBe(updated)
  if(!process.argv.includes('--http-mcp-only')){
    const fromCli=await shell(reader,['exec','-'],readFull)
    assert.equal(fromCli.nodes.find(n=>n.options.id===source.options.id)?.options.text,updated)
  }
  await editorPage.reload()
  await expect(note).toHaveAttribute('aria-label',updated)
  console.log('Same node ID: native inline rename saved, read back externally, and reopened in the editor.')
} finally {
  try {
    if(mcp)await mcp.close()
    if(owner){
      await page.goto(origin+'/profile')
      await page.waitForFunction(id=>window.Meteor?.user()?._id===id,owner)
      if(!teamDir) {
      const safe=await page.evaluate(async({owner,share,email})=>{
        const m=window.Meteor,u=m.user()
        const b=await m.callAsync('slates.get',{type:'mine',skip:0,limit:5,filterString:'',private:false})
        return u._id===owner && !u.orgId && (u.isAnonymous || u.emails?.[0]?.address===email) &&
          b.counts.total===1 && b.slates[0]?.shareId===share && b.slates[0]?.userId===owner
      },{owner,share,email})
      assert(safe,'Refuse cleanup outside exact owned fixture')
      } else {
        assert.equal(await page.evaluate(()=>window.Meteor.userId()),team.id)
        const owned=await page.evaluate(async share=>(await window.Meteor.callAsync('slates.get',{shareId:share})).slateBase,share)
        assert(owned?.shareId===share && owned.userId===team.id && (!docId || owned._id===docId),'Refuse cleanup outside exact synthetic team slate')
        docId=owned._id
      }
      for(const t of tokens){
        assert(await t.actorPage.evaluate(tokenId=>window.Meteor.callAsync('apiTokens.revoke',{tokenId}),t.id))
        assert.equal((await request(t.token)).status,401)
      }
      if(teamDir){
        await page.evaluate(id=>window.Meteor.callAsync('slates.remove',{slateIds:[id]}),docId)
        const gone=await page.evaluate(async key=>!(await window.Meteor.callAsync('slates.get',{shareId:key}))?.slateBase,share)
        assert(gone)
        console.log('This run’s tokens revoked and exact private slate removed. Both pre-existing fixture accounts retained.')
      } else {
        assert.equal(await page.evaluate(()=>window.Meteor.callAsync('users.delete')),true)
        console.log('All issued tokens revoked, revoked reads denied and sole fixture owner deleted.')
      }
    }
  } finally {await browser.close()}
}
