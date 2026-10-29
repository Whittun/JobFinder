// Optional smoke check against an isolated local Chromium CDP instance.
import assert from 'node:assert/strict'
import { mkdirSync,writeFileSync } from 'node:fs'
const root=process.env.JOBFINDER_URL||'http://127.0.0.1:5174'
const target=await fetch('http://127.0.0.1:9236/json/new?about:blank',{method:'PUT'}).then(response=>response.json())
const socket=new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true})})
let sequence=0
const pending=new Map(),exceptions=[]
socket.addEventListener('message',event=>{
  const message=JSON.parse(event.data)
  if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails.text)
  const entry=pending.get(message.id)
  if(entry){pending.delete(message.id);clearTimeout(entry.timer);message.error?entry.reject(new Error(message.error.message)):entry.resolve(message.result)}
})
const send=(method,params={})=>new Promise((resolve,reject)=>{
  const id=++sequence,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timed out: ${method}`))},15000)
  pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}))
})
const evaluate=async expression=>{
  const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
  if(result.exceptionDetails)throw new Error(result.exceptionDetails.text)
  return result.result.value
}
async function until(expression){
  const deadline=Date.now()+30000
  while(Date.now()<deadline){if(await evaluate(expression))return;await new Promise(resolve=>setTimeout(resolve,200))}
  throw new Error(`UI condition failed: ${expression}`)
}
mkdirSync('data/screenshots',{recursive:true})
try{
  await send('Page.enable');await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url:root})
  await until('document.querySelectorAll(".remote-professions tbody tr").length>0')
  assert.equal(await evaluate('document.querySelector(".remote-toggles input").checked'),false,'Hybrid must be off by default')
  assert.ok(await evaluate('document.querySelector(".collector-strategy")?.textContent.includes("Удалёнка:")'),'Collector strategy should show the optimized queue')
  assert.equal(await evaluate('document.querySelectorAll(".remote-vacancies .mixed-row-badge").length'),0)
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Desktop overflow')
  writeFileSync('data/screenshots/curated.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await evaluate('document.querySelector(".remote-professions .profession-button").click()')
  await until('!!document.querySelector(".remote-active-filters")&&document.querySelectorAll(".remote-professions tbody tr").length===1')
  assert.ok(await evaluate('document.querySelectorAll(".remote-vacancies tbody tr").length>0'))
  await evaluate('document.querySelector(".vacancy-details summary").click()')
  assert.ok(await evaluate('document.querySelector(".description-text").textContent.length>=40'))
  await evaluate('document.querySelector(".remote-toggles .text-button").click()')
  await until('!document.querySelector(".remote-active-filters")&&!!document.querySelector(".remote-results")')
  if(await evaluate('document.querySelectorAll(".technology-chips button").length>0')){
    await evaluate('document.querySelector(".technology-chips button").click()')
    await until('!!document.querySelector(".technology-chips button.selected")&&!!document.querySelector(".remote-active-filters")')
    assert.ok(await evaluate('document.querySelectorAll(".remote-vacancies tbody tr").length>0'))
    await evaluate('document.querySelector(".remote-toggles .text-button").click()')
    await until('!document.querySelector(".remote-active-filters")&&!!document.querySelector(".remote-results")')
  }
  await evaluate('document.querySelector(".remote-toggles input").click()')
  await until('document.querySelector(".remote-toggles input").checked&&!!document.querySelector(".remote-results")')
  if(await evaluate('!document.querySelector(".remote-pagination button:last-child").disabled')){
    const first=await evaluate('[...document.querySelectorAll(".remote-vacancies tbody a")].map(a=>a.href)')
    await evaluate('document.querySelector(".remote-pagination button:last-child").click()')
    await until('document.querySelector(".remote-pagination")?.textContent.includes("Страница 2")')
    const second=await evaluate('[...document.querySelectorAll(".remote-vacancies tbody a")].map(a=>a.href)')
    assert.equal(second.some(link=>first.includes(link)),false,'Pages overlap')
  }
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await until('innerWidth===390')
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Mobile overflow')
  await evaluate('scrollTo(0,0)')
  writeFileSync('data/screenshots/mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url:`${root}/?view=priority`})
  await until('!!document.querySelector(".priority-results")')
  assert.equal(await evaluate('document.querySelectorAll(".priority-card").length'),8)
  assert.equal(await evaluate('document.querySelector(".remote-toggles input").checked'),false)
  assert.ok(await evaluate('document.querySelectorAll(".priority-job").length>0'))
  assert.equal(await evaluate('(()=>{const ids=[...document.querySelectorAll(".priority-job")].map(e=>e.dataset.jobId);return new Set(ids).size===ids.length})()'),true)
  await evaluate('document.querySelector(".priority-evidence summary").click()')
  assert.ok(await evaluate('document.querySelector(".priority-evidence[open] blockquote").textContent.length>10'))
  const category=await evaluate('document.querySelector(".priority-match-tags button").dataset.match')
  await evaluate(`document.querySelector('[data-direction="${category}"]').click()`)
  await until(`!!document.querySelector('.priority-results')&&document.querySelector('[data-direction="${category}"]').getAttribute('aria-pressed')==='true'`)
  assert.equal(await evaluate(`[...document.querySelectorAll('.priority-job')].every(job=>!!job.querySelector('[data-match="${category}"]'))`),true)
  await evaluate('document.querySelector(".priority-all").click()')
  await until('!!document.querySelector(".priority-results")&&document.querySelector(".priority-all").getAttribute("aria-pressed")==="true"')
  await evaluate(`(()=>{const input=document.querySelector('.remote-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'zzzz-no-job-match-3498');input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await evaluate('document.querySelector(".remote-search").requestSubmit()')
  await until('!!document.querySelector(".priority-empty")')
  assert.equal(await evaluate('document.querySelectorAll(".priority-job").length'),0)
  await evaluate('document.querySelector(".remote-toggles .text-button").click()')
  await until('!!document.querySelector(".priority-results")&&document.querySelectorAll(".priority-job").length>0')
  if(await evaluate('document.querySelectorAll(".priority-skills .technology-chips button").length>0')){
    await evaluate('document.querySelector(".priority-skills .technology-chips button").click()')
    await until('!!document.querySelector(".priority-results")&&!!document.querySelector(".remote-active-filters")')
    assert.ok(await evaluate('document.querySelectorAll(".priority-job").length>0'))
    await evaluate('document.querySelector(".remote-toggles .text-button").click()')
    await until('!!document.querySelector(".priority-results")&&!document.querySelector(".remote-active-filters")')
  }
  writeFileSync('data/screenshots/priorities.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
  await until('innerWidth===390')
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Priority mobile overflow')
  await evaluate('scrollTo(0,0)')
  writeFileSync('data/screenshots/priorities-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await evaluate(`document.querySelector('.view-navigation a[href="/?view=influence"]').click()`)
  await until('location.search==="?view=influence"&&!!document.querySelector(".priority-results")')
  assert.equal(await evaluate('document.querySelector("h1").textContent'),'Инфлюенс и блогеры.')
  assert.equal(await evaluate('document.querySelector(".view-navigation [aria-current=page]").textContent'),'Инфлюенс')
  assert.equal(await evaluate('document.querySelector(".remote-toggles input").checked'),false)
  assert.equal(await evaluate('document.querySelectorAll(".priority-card, .priority-all").length'),0)
  const checkInfluence=()=>evaluate('[...document.querySelectorAll(".priority-job")].every(job=>!!job.querySelector("[data-match=influence]"))')
  assert.equal(await checkInfluence(),true)
  await evaluate(`(()=>{const input=document.querySelector('.remote-search input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'zzzz-no-influence-3498');input.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await evaluate('document.querySelector(".remote-search").requestSubmit()')
  await until('!!document.querySelector(".priority-empty")')
  await evaluate('document.querySelector(".remote-toggles .text-button").click()')
  await until('!!document.querySelector(".priority-results")&&!document.querySelector(".remote-active-filters")&&!document.querySelector(".priority-empty")')
  assert.equal(await checkInfluence(),true,'Reset must stay in influence')
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true,'Influence mobile overflow')
  writeFileSync('data/screenshots/influence-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false})
  await until('innerWidth===1440')
  writeFileSync('data/screenshots/influence.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
  assert.deepEqual(exceptions,[])
  console.log('UI passed: remote, priority and influence tabs, evidence, direction/skill/search filters, empty results, influence stays scoped after reset, hybrid off, pagination when available, desktop/mobile, no uncaught exceptions.')
}finally{
  for(const entry of pending.values())clearTimeout(entry.timer)
  socket.close()
  await fetch(`http://127.0.0.1:9236/json/close/${target.id}`).catch(()=>{})
}
