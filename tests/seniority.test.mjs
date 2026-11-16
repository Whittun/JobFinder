import assert from 'node:assert/strict'
import { test } from 'node:test'
import { excludedSeniority } from '../src/lib/seniority.ts'
import { classifyMarket } from '../src/lib/market-policy.ts'
import { Store } from '../server/store.ts'
import { defaultRemoteFilters } from '../src/lib/analytics.ts'

const description='Разработка веб-интерфейсов на React. Работа с командой, API и технической документацией.'
const job=(id,name='Frontend developer',extra={})=>({id,name,description,alternate_url:`https://hh.ru/vacancy/${id}`,published_at:new Date().toISOString(),employer:{name:'Компания'},area:{id:'1',name:'Москва'},work_format:[{id:'REMOTE',name:'Удалённо'}],...extra})
test('senior, lead and leadership titles and structured grades are excluded globally',()=>{
 for(const name of ['Senior React developer','Sr. Frontend engineer','Middle/Senior разработчик','Сеньор-разработчик','Ведущий инженер поддержки','Старший тестировщик','Team Lead','Тимлид backend','Head of engineering','Staff engineer','Principal developer','Руководитель веб-проектов','Начальник отдела разработки','Engineering manager','Project manager','CTO'])assert.ok(excludedSeniority({name}),name)
 for(const grade of ['Senior','Lead','Middle/Senior'])assert.equal(classifyMarket(job('1','Разработчик',{professional_level:grade})).reason,'seniority')
 for(const name of ['Junior frontend developer','Middle backend developer','Инженер поддержки','Headless CMS developer'])assert.equal(excludedSeniority({name}),null,name)
})
test('required senior grade in a description is rejected; mentoring and growth mentions are allowed',()=>{
 for(const text of ['Уровень: Senior','Грейд — Lead','Мы ищем Senior React developer'])assert.ok(excludedSeniority({name:'Разработчик',description:text}),text)
 for(const text of ['Работа под руководством senior-разработчика','В команде есть senior и наставник','Рост до уровня senior','Не требуется уровень senior','Взаимодействие с руководителем команды'])assert.equal(excludedSeniority({name:'Junior developer',description:text}),null,text)
})
test('existing senior jobs disappear from all analytics without deleting history, new senior jobs never enter storage',t=>{
 const store=new Store(':memory:');t.after(()=>store.close())
 store.ingest({items:[job('1'),job('2'),job('4'),job('3','Senior frontend developer')]})
 assert.equal(store.count('SELECT count(*) count FROM vacancies'),3)
 store.workspace.mark('2',true)
 const legacy=JSON.parse(store.db.prepare('SELECT payload FROM vacancies WHERE id=?').get('2').payload)
 legacy.name='Head of engineering'
 store.db.prepare('UPDATE vacancies SET payload=? WHERE id=?').run(JSON.stringify(legacy),'2')
 const unprocessed={...job('4'),name:'Senior frontend developer'}
 store.db.prepare('UPDATE vacancies SET payload=? WHERE id=?').run(JSON.stringify(unprocessed),'4')
 store.marketPolicy.refresh(true)
 for(const filter of [{},{priority:'any'},{recommendation:'development'}]) assert.deepEqual(store.analytics({...defaultRemoteFilters,...filter}).recent.map(j=>j.id),['1'])
 assert.equal(store.marketPolicy.stats().hidden,2)
 assert.equal(store.workspace.list().total,1)
 assert.equal(store.count('SELECT count(*) count FROM vacancies'),3)
})
