import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isWebVacancy, WEB_QUERIES } from '../server/web-scope.ts'
import { Store } from '../server/store.ts'
import { SourceRunner } from '../server/source-runner.ts'
import { sourceDefinitions } from '../src/lib/sources.ts'
import { parseSource } from '../server/source-adapters.ts'

test('web scope requires a technical role and web context, across developers, support, QA and infrastructure',()=>{
  for(const [name,description] of [['Frontend developer',''],['Верстальщик',''],['Инженер поддержки','Поддержка HTTP API веб-сервиса'],['QA инженер','Тестирование сайтов в браузере'],['DevOps','Развёртывание веб-сервисов и Nginx'],['Python developer','Разработка API на Django']]) assert.equal(isWebVacancy({name,description}),true,name)
  for(const [name,description] of [['SMM менеджер','Сайты React'],['Менеджер по работе с блогерами','Веб'],['Бухгалтер','Работа в браузере'],['React Native developer','React HTTP API'],['Разработчик 1С','Автоматизация учета'],['Инженер поддержки','Ремонт принтеров'],['Python developer','Обработка научных данных']]) assert.equal(isWebVacancy({name,description}),false,name)
  assert.ok(WEB_QUERIES.every(q=>!/блогер|influenc/iu.test(q)))
  assert.ok(sourceDefinitions.every(s=>!['vetka','tg-norm','tg-dnative','search'].includes(s.id)))
})

test('new storage enforces web scope in addition to remote, Russian language and geography',t=>{
  const store=new Store(':memory:');t.after(()=>store.close())
  const job=(id,name,description)=>({id,name,description,alternate_url:`https://hh.ru/vacancy/${id}`,published_at:new Date().toISOString(),employer:{name:'Компания'},area:{id:'1',name:'Москва'},work_format:[{id:'REMOTE',name:'Удалённо'}]})
  store.ingest({items:[job('1','Инженер поддержки','Задачи: работа с HTTP API, логами веб-сервиса и обращениями пользователей.'),job('2','SMM менеджер','Работа с веб-сайтами, публикация контента и рекламных интеграций.')]})
  assert.deepEqual(store.db.prepare('SELECT id FROM vacancies').all().map(r=>r.id),['1'])
})

test('listing filter retains generic detail links and discards only clearly unrelated job titles',()=>{
  const source=sourceDefinitions.find(s=>s.id==='geekjob')
  const result=parseSource(source,'<a href="/vacancy/abcdef123456">Подробнее</a><a href="/vacancy/abcdef123457">Frontend developer</a><a href="/vacancy/abcdef123458">SMM менеджер</a>',{kind:'index',url:source.url,context:{}})
  assert.equal(result.links.filter(l=>l.kind==='detail').length,2)
  assert.ok(!result.links.some(l=>l.url.endsWith('abcdef123458')))
})

test('conditional HTTP requests skip unchanged feeds without ingesting or downloading a body',async t=>{
  const store=new Store(':memory:'),runner=new SourceRunner(store)
  t.after(async()=>{await runner.close();store.close()})
  const source=sourceDefinitions.find(s=>s.id==='wwr')
  store.sources.enqueue(source.id,source.url,'feed',{recurring:true})
  store.db.prepare('INSERT INTO source_http_cache VALUES (?,?,?)').run(source.url,'"v1"',null)
  let calls=0
  t.mock.method(globalThis,'fetch',async(_url,options)=>{calls++;assert.equal(options.headers['If-None-Match'],'"v1"');return new Response(null,{status:304})})
  await runner.tick()
  for(let i=0;i<20&&!store.count('SELECT count(*) count FROM source_events');i++)await new Promise(r=>setImmediate(r))
  assert.equal(calls,1)
  assert.equal(store.count('SELECT count(*) count FROM vacancies'),0)
  assert.equal(store.db.prepare("SELECT last_status FROM source_state WHERE id='wwr'").get().last_status,304)
  assert.equal(store.db.prepare('SELECT status FROM source_tasks').get().status,'pending')
})
