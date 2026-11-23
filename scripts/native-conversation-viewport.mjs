// node scripts/native-conversation-viewport.mjs http://localhost:3894
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
const app = new URL(process.argv[2] || 'http://localhost:3894')
assert.ok(['localhost','127.0.0.1','test.slatebox.com'].includes(app.hostname))
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || "chrome"})
const brief='Job reaches spend cap → Stop now → Notify on-call\nJob reaches spend cap → Save checkpoint → Ask owner to resume'
try {
 for(const width of [1280,390]){
  const page=await browser.newPage({viewport:{width,height:width===390?844:720},hasTouch:width===390})
  let owner
  try{
   const entry=new URL('/new',app)
   entry.hash=new URLSearchParams({brief})
   await page.goto(entry.href)
   await page.waitForURL(/\/canvas\/[a-f0-9]{10}$/)
   await page.waitForFunction(()=>window.Meteor?.userId())
   owner=await page.evaluate(()=>Meteor.userId())
   if (process.env.SLATEBOX_EXPECTED_APP_BUNDLE) {
     await expect(page.locator('script[src*="/'+process.env.SLATEBOX_EXPECTED_APP_BUNDLE+'.js"]')).toHaveCount(1)
   }
   const key=new URL(page.url()).pathname.split('/').pop()
   const note=page.locator('#slateCanvas g[data-node-id="step-5"]').first()
   const panel=page.getByRole('complementary',{name:'Ask Slatebox'})
   await expect(panel).toBeVisible()
   const welcome=page.getByRole('dialog',{name:/welcome/i}).getByRole('button',{name:'OK',exact:true})
   const cookies=page.getByRole('button',{name:'Accept cookies',exact:true})
   for(const button of [cookies,welcome])if(await button.isVisible())await button.click()
   const bounds=()=>page.evaluate(()=>{
    const canvas=document.getElementById('slateCanvas').getBoundingClientRect()
    const panel=document.querySelector('aside[aria-label="Ask Slatebox"]').getBoundingClientRect()
    return {canvasRight:canvas.right,panelLeft:panel.left,canvasBottom:canvas.bottom,panelTop:panel.top}
   })
   const frame=await bounds()
   assert.ok(width===390?frame.canvasBottom<=frame.panelTop+1:frame.canvasRight<=frame.panelLeft+1,JSON.stringify(frame))
   await note.click({timeout:4000})
   await page.keyboard.press('F2')
   const field=page.locator('.sb-inline-editor[contenteditable="true"]')
   await field.fill('Request owner approval')
   await field.press('Enter')
   await expect.poll(()=>page.evaluate(async key=>(await Meteor.callAsync('slates.get',{shareId:key})).slateBase.nodes.find(n=>n.options.id==='step-5').options.text,key)).toBe('Request owner approval')
   await page.reload()
   await expect(note).toHaveAttribute('aria-label','Request owner approval')
   const camera = () => page.evaluate(() => {
     const drawing = document.querySelector('#slateCanvas svg[viewBox]')
     const box = drawing.viewBox.baseVal
     return {x:box.x+box.width/2, y:box.y+box.height/2, unitsPerPixel:box.width/drawing.getBoundingClientRect().width}
   })
   // Even the outermost node must fit once the engine and chat have laid out.
   await expect.poll(() => note.evaluate(node => {
     const workspace = node.closest('#slateCanvas').getBoundingClientRect()
     const rect = node.getBoundingClientRect()
     return rect.left >= workspace.left && rect.right <= workspace.right &&
       rect.top >= workspace.top && rect.bottom <= workspace.bottom
   })).toBe(true)
   await note.click()
   const before = await camera()
   await panel.getByRole('button',{name:'Close conversation'}).click()
   await expect(panel).toHaveCount(0)
   await page.setViewportSize({width:width===390?480:1170,height:width===390?820:700})
   await page.getByRole('button',{name:'Ask Slatebox',exact:true}).click()
   await expect(panel).toBeVisible()
   await expect.poll(async () => {
     const after = await camera()
     return Math.abs(before.x-after.x)<1 && Math.abs(before.y-after.y)<1 &&
       Math.abs(before.unitsPerPixel-after.unitsPerPixel)<0.01
   }).toBe(true)
   await note.click({timeout:4000})
   console.log(width+'px: rename saved, note reachable after reopen and resize')
  }finally{
   if(owner){
    await page.goto(new URL('/templates',app).href)
    await page.waitForFunction(id=>window.Meteor?.userId()===id,owner)
    await page.evaluate(()=>new Promise((resolve,reject)=>Meteor.subscribe('me',{onReady:resolve,onStop:reject})))
    assert.equal(await page.evaluate(async id=>Meteor.userId()===id && Meteor.user()?.isAnonymous===true && await Meteor.callAsync('users.delete'),owner),true)
   }
   await page.close()
  }
 }
}finally{await browser.close()}
