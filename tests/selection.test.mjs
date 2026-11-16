import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { Store } from '../server/store.ts'
import { rejectionFor } from '../server/selection.ts'
import { extractSkills, normalizeJobTitle } from '../server/knowledge.ts'
import { parseVacancyDetail } from '../server/hh-detail.ts'
import { Collector } from '../server/collector.ts'
import { defaultRemoteFilters } from '../src/lib/analytics.ts'
import { taskUrl, moscowDay, shiftDay } from '../server/crawl-plan.ts'

const description='Разработка и сопровождение веб-сервисов. Работа с документацией, согласование задач с командой.'
const job=(name,body=description,format='REMOTE')=>({ id:'101',name,description:body,detail_fetched_at:new Date().toISOString(),published_at:new Date().toISOString(),employer:{id:'1',name:'Компания'},area:{id:'1',name:'Москва'},work_format:[{id:format,name:format==='HYBRID'?'Гибрид':'Удалённо'}],role_ids:['96'] })

test('selection rejects sales, outbound calls, call centers, teaching and pure office work',()=>{
  for(const title of ['Менеджер по продажам','Sales manager','SDR','Продавец-консультант','Оператор колл-центра','Телемаркетолог','Учитель английского','Онлайн-преподаватель','Репетитор','Куратор онлайн-курсов','Методист']) assert.notEqual(rejectionFor(job(title),true),null,title)
  assert.equal(rejectionFor(job('Разработчик',description,'ON_SITE'),true),'office')
  assert.equal(rejectionFor({...job('Разработчик'),description:''},true),'no_description')
})

test('full descriptions uncover disguised sales and calls without rejecting explicit negations',()=>{
  const support='Специалист технической поддержки'
  assert.equal(rejectionFor(job(support,'Предстоит совершать исходящие звонки и помогать клиентам настроить программу.'),true),'calls')
  assert.equal(rejectionFor(job(support,'В обязанности входит выполнение личного плана продаж услуг и работа с обращениями.'),true),'sales')
  assert.equal(rejectionFor(job(support,'Help users and perform outbound calls every day to prospective customers.'),true),'calls')
  for(const text of ['Работа без холодных звонков и без активных продаж. Помогаем пользователям настроить веб-сервис.','У нас нет исходящих звонков. Решаем технические вопросы веб-сервисов по входящим обращениям пользователей.','No cold calls. Help users configure web software and troubleshoot technical issues. Russian-speaking team.']) assert.equal(rejectionFor(job(support,text),true),null,text)
  assert.equal(rejectionFor(job('Ассистент','Предстоит проводить онлайн-занятия и проверять домашние задания по программированию.'),true),'teaching')
  assert.equal(rejectionFor(job('Аналитик', 'Мы анализируем воронку продаж и строим отчеты в SQL. Никаких звонков клиентам.'),true),'not_web')
  assert.equal(rejectionFor(job('Affiliate Manager','Навыки продаж: умеете выявлять потребность, презентовать предложение и работать с возражениями.'),true),'sales')
  assert.equal(rejectionFor(job('Менеджер по работе с клиентами','Обязанности:\nПродажа услуг и консультирование по тарифным планам.\nУсловия:\nУдалённая работа.'),true),'sales')
  assert.equal(rejectionFor(job('Наставник','Обязанности:\nПроведение индивидуальных онлайн-занятий. Проверка домашних заданий.\nУсловия:\nРабота из дома.'),true),'teaching')
  assert.equal(rejectionFor(job('Менеджер по персоналу','Вести подбор менеджеров по продажам. Знание коммерческого бизнеса поможет проводить интервью с кандидатами.'),true),'not_web')
  assert.equal(rejectionFor(job('Python-разработчик','Разрабатываем платформу, которая позволяет проводить онлайн-занятия. Обязанности:\nРазрабатывать веб API и исправлять ошибки в коде.'),true),null)
  assert.equal(rejectionFor(job('Backend developer','Наш сервис позволяет совершать исходящие звонки и поддерживает голосовых роботов.\nОбязанности:\nРазработка веб API на Python.\nТребования:\nЗнание SQL.'),true),null)
})

test('title dictionary merges synonyms and seniority but keeps distinct functions separate',()=>{
  const families=[['Frontend developer','Senior Frontend-разработчик (React)','Разработчик React'],['Python developer','Senior Python-разработчик','Разработчик на Python'],['Системный аналитик','Senior Systems Analyst'],['Специалист техподдержки','Technical Support Engineer'],['SMM-менеджер','SMM специалист']]
  for(const family of families){const ids=family.map(name=>normalizeJobTitle(name).id);assert.equal(new Set(ids).size,1,family.join(' / '))}
  assert.notEqual(normalizeJobTitle('Системный аналитик').id,normalizeJobTitle('Бизнес-аналитик').id)
  assert.notEqual(normalizeJobTitle('Frontend developer').id,normalizeJobTitle('Backend developer').id)
  assert.notEqual(normalizeJobTitle('QA Automation Engineer').id,normalizeJobTitle('Manual QA Engineer').id)
  assert.equal(normalizeJobTitle('Senior Инженер уникальной системы').id,normalizeJobTitle('инженер уникальной системы').id)
})

test('skill extraction uses structured skills and descriptions, canonicalizes aliases and records evidence',()=>{
  const found=extractSkills('Разработчик',['Postgres','JS','English'],'Нужны PostgreSQL, JavaScript, Python3, React, Docker, Figma, SQL и C++17. Go to the office.')
  for(const name of ['PostgreSQL','JavaScript','Английский','Python','React','Docker','Figma','SQL','C++'])assert.ok(found.some(item=>item.name===name),name)
  assert.equal(found.filter(item=>item.name==='PostgreSQL').length,1)
  assert.equal(found.find(item=>item.name==='PostgreSQL').source,'skills')
  assert.equal(found.find(item=>item.name==='Figma').category,'tool')
  assert.ok(found.find(item=>item.name==='Docker').evidence.includes('Docker'))
  assert.equal(found.some(item=>item.name==='Java'),false)
  assert.equal(found.some(item=>item.name==='Go'),false)
  assert.ok(extractSkills('Разработчик',[],'Пишем серверные приложения на Go и поддерживаем микросервисы.').some(item=>item.name==='Go'))
})

test('detail parser verifies IDs, strips HTML/scripts and retains skills and work formats',()=>{
  const full={vacancyId:101,name:'Python developer',description:'<p>Разработка сервисов на Python и FastAPI для пользователей.</p><script>JavaScript spam</script><p>Опыт работы с PostgreSQL.</p>',workFormats:['REMOTE','ON_SITE'],keySkills:['Python','PostgreSQL'],status:'OPEN',languages:[{id:'eng'}]}
  const html=`<template id="HH-Lux-InitialState">${JSON.stringify({vacancyView:{vacancyFull:{vacancy:full}}})}</template>`
  const detail=parseVacancyDetail(html,job('Разработчик'))
  assert.ok(detail.description.includes('FastAPI'))
  assert.equal(detail.description.includes('JavaScript spam'),false)
  assert.deepEqual(detail.key_skills,['Python','PostgreSQL'])
  assert.deepEqual(detail.spoken_languages,['Английский'])
  assert.deepEqual(detail.work_format.map(item=>item.id),['REMOTE','ON_SITE'])
  assert.throws(()=>parseVacancyDetail(html,{...job('Разработчик'),id:'102'}),/ID/)
})

test('storage enforces selection and grouped-title filters, updates skills and removes reclassified sales',t=>{
  const store=new Store(':memory:');t.after(()=>store.close())
  store.ingest({items:[job('Менеджер по продажам'),job('Frontend developer','Создание интерфейсов на React, JavaScript и TypeScript. Работа в команде и анализ требований.'),{...job('Middle Frontend-разработчик'),id:'102'}]})
  let stats=store.analytics(defaultRemoteFilters)
  assert.equal(stats.totals.stored,2)
  assert.equal(stats.remote.groups.length,1)
  assert.equal(stats.remote.groups[0].count,2)
  assert.equal(stats.remote.groups[0].variants,2)
  assert.equal(store.analytics({...defaultRemoteFilters,group:'frontend'}).totals.filtered,2)
  assert.equal(store.analytics({...defaultRemoteFilters,technology:'React'}).totals.filtered,1)
  assert.equal(store.analytics({...defaultRemoteFilters,text:'typescript'}).totals.filtered,1)
  store.ingest({items:[job('Менеджер по продажам')]})
  stats=store.analytics(defaultRemoteFilters)
  assert.equal(stats.totals.stored,1)
  assert.equal(stats.status.rejections.find(row=>row.id==='sales').count,1)
})

test('collector stages candidates without persisting them, then validates and enriches detail pages',async t=>{
  const collector=new Collector(':memory:');t.after(()=>collector.close())
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/hh-search.json',import.meta.url),'utf8'))
  fixture.professionalRoleTree={items:[{id:'category-1',text:'IT',items:[{id:'96',text:'Разработчик'}]}]}
  fixture.vacancySearchResult.criteria={date_from:shiftDay(moscowDay(),-29).split('-').reverse().join('.'),date_to:moscowDay().split('-').reverse().join('.')+' 23:59:59',area:[113],page:0,work_format:['REMOTE']}
  fixture.vacancySearchResult.vacancies=fixture.vacancySearchResult.vacancies.slice(0,1)
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.includes('/areas/'))return Response.json({areas:[]})
    if(url.includes('/vacancy/101'))return new Response(`<template id="HH-Lux-InitialState">${JSON.stringify({vacancyView:{vacancyFull:{vacancy:{vacancyId:101,name:'React developer',description:'Разработка интерфейсов на React и TypeScript. Работа с технической документацией и командой.',workFormats:['REMOTE'],keySkills:['React'],status:'OPEN'}}}})}</template>`)
    return new Response(`<template id="HH-Lux-InitialState">${JSON.stringify(fixture)}</template>`)
  })
  await collector.tick()
  assert.equal(collector.store.count('SELECT count(*) count FROM vacancies'),0)
  // This test isolates detail enrichment after discovery tasks have finished.
  collector.store.db.exec("UPDATE tasks SET status='done' WHERE kind<>'detail'")
  assert.ok(collector.store.next(true).task.kind==='detail')
  collector.store.set('nextAt',0)
  await collector.tick()
  const stats=collector.store.analytics(defaultRemoteFilters)
  assert.equal(stats.totals.stored,1)
  assert.ok(stats.local.technologies.some(row=>row.name==='React'))
  assert.ok(stats.recent[0].description)
  const url=new URL(taskUrl({kind:'market',label:'test',from:'2026-10-01',to:'2026-10-28',cycle:'test'}))
  assert.deepEqual(url.searchParams.getAll('work_format'),['REMOTE','HYBRID'])
})
