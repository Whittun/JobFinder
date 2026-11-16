import assert from 'node:assert/strict'
import {writeFileSync,mkdirSync} from 'node:fs'
const target=await fetch('http://127.0.0.1:9236/json/new?about:blank',{method:'PUT'}).then(r=>r.json())
const ws=new WebSocket(target.webSocketDebuggerUrl)
await new Promise(r=>ws.addEventListener('open',r,{once:true}))
let id=0;const pending=new Map(),errors=[]
ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);clearTimeout(p.timer);m.error?p.reject(m.error):p.resolve(m.result)}})
const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject,timer:setTimeout(()=>reject(new Error(method)),15000)});ws.send(JSON.stringify({id:n,method,params}))})
const evalJS=async expression=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.text);return r.result.value}
async function until(expression){for(let i=0;i<100;i++){if(await evalJS(expression))return;await new Promise(r=>setTimeout(r,200))}throw new Error(expression)}
mkdirSync('data/screenshots',{recursive:true})
try{
 await send('Page.enable');await send('Runtime.enable')
 await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false})
 await send('Page.navigate',{url:'http://127.0.0.1:5173/'})
 await until('!!document.querySelector(".web-summary")')
 assert.equal(await evalJS('document.querySelectorAll("a[href*=influence],a[href*=priority],.priority-banner,.priority-directions").length'),0)
 assert.equal(await evalJS('document.querySelector(".remote-toggles input").checked'),false)
 assert.equal(await evalJS('document.documentElement.scrollWidth<=innerWidth'),true)
 await evalJS('document.querySelector(".web-analytics").open=true')
 assert.ok(await evalJS('document.querySelector(".web-analytics").textContent.includes("технологии")'))
 writeFileSync('data/screenshots/web-desktop.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
 await evalJS(`(()=>{const e=document.querySelector('input[type=search]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'zzzz-no-match-347');e.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('.remote-search').requestSubmit()})()`)
 await until('document.querySelector(".web-summary")?.textContent.startsWith("0 ")')
 assert.equal(await evalJS('document.querySelectorAll(".web-job").length'),0)
 await evalJS('document.querySelector(".remote-toggles .text-button").click()')
 await until('!!document.querySelector(".web-summary")&&!document.querySelector("input[type=search]").value')
 await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
 assert.equal(await evalJS('document.documentElement.scrollWidth<=innerWidth'),true)
 writeFileSync('data/screenshots/web-mobile.png',Buffer.from((await send('Page.captureScreenshot',{format:'png'})).data,'base64'))
 for(const view of ['processed','letters']){await send('Page.navigate',{url:`http://127.0.0.1:5173/?view=${view}`});await until('!!document.querySelector(".workspace-view")');assert.equal(await evalJS('document.querySelectorAll("a[href*=influence],a[href*=priority]").length'),0)}
 assert.deepEqual(errors,[])
 console.log('Web UI passed: simplified navigation, analytics, search, reset, hybrid off, history, letters, desktop/mobile, no runtime errors')
}finally{ws.close();await fetch(`http://127.0.0.1:9236/json/close/${target.id}`)}
