import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Store } from '../server/store.ts'
import { defaultRemoteFilters } from '../src/lib/analytics.ts'
import { recommendDevelopment } from '../src/lib/recommendations.ts'

const job = (name, description = 'Обязанности:\nРазработка пользовательских интерфейсов. Работа с документацией и командой.', skills = [], extra = {}) => ({
  id: '1', name, description, key_skills: skills, detail_fetched_at: new Date().toISOString(), published_at: new Date().toISOString(),
  employer: { id: '1', name: 'Компания' }, area: { id: '1', name: 'Москва' }, work_format: [{ id: 'REMOTE', name: 'Удалённо' }], ...extra,
})

test('development shortlist accepts the user stack, layout and entry-level JS roles', () => {
  const cases = [
    job('Frontend React developer', 'Требования:\nReact, TypeScript, Redux. Знание Git и REST API.'),
    job('Middle Fullstack developer', 'Требования:\nReact и TypeScript, Nest.js и PostgreSQL.'),
    job('Backend developer', 'Наш стек:\nNestJS, PostgreSQL.\nОбязанности:\nРазработка API на Nest.js.'),
    job('Верстальщик HTML/CSS'),
    job('Junior JavaScript developer', 'Требования:\nБазовое знание JS.\nОбязанности:\nРабота с веб-страницами.'),
    job('Начинающий веб-разработчик', 'Требования:\nHTML, CSS и основы JavaScript.'),
    job('TypeScript developer', undefined, ['TypeScript']),
    job('Frontend developer', undefined, ['React', 'Redux', 'RTK Query']),
    job('Frontend developer', 'Наш backend написан на Python.\nТребования:\nReact, TypeScript.'),
    job('Frontend developer', 'В команде работают senior инженеры.\nТребования:\nReact и TypeScript.'),
    job('Middle React developer', 'Требования:\nОпыт разработки от 3 лет. React и TypeScript.'),
    job('Frontend React developer в ведущей компании'),
    job('Fullstack developer (React / Vue)', 'Требования:\nReact или Vue. TypeScript, NestJS, PostgreSQL.', ['Vue.js', 'TypeScript']),
    job('Fullstack developer', 'Требования:\nNest.js, TypeScript, PostgreSQL / MySQL / MongoDB.', ['MySQL', 'MongoDB', 'PostgreSQL']),
  ]
  for (const sample of cases) { const decision = recommendDevelopment(sample); assert.equal(decision.matched, true, `${sample.name}: ${decision.excluded.join('; ')}`); assert.ok(decision.reasons.length) }
})

test('mandatory unfamiliar frameworks and languages exclude jobs even when React or TS are also mentioned', () => {
  const cases = [
    job('Frontend developer', 'Требования:\nОпыт разработки на Vue.js. JavaScript и TypeScript.'),
    job('Angular developer', 'Нужно знать TypeScript и Angular.'),
    job('Frontend developer', 'Требования:\nVue3 и TypeScript обязательны.'),
    job('React Native developer', 'Требования:\nReact, TypeScript, Redux.'),
    job('Fullstack developer (React + Go)', 'Требования:\nReact, PostgreSQL.'),
    job('Frontend developer', 'Требования:\nReact и Angular, оба обязательны.'),
    job('Frontend developer', 'Требования:\nReact / TypeScript и Vue обязательны.'),
    job('Fullstack developer', 'Требования:\nReact, NestJS, PostgreSQL и MongoDB.'),
    job('Frontend developer', 'Обязанности:\nРазработка интерфейсов на Vue.js.\nБудет плюсом:\nTypeScript и React.'),
    job('Fullstack developer', 'Требования:\nReact. Опыт Laravel обязателен.'),
    job('Frontend developer', 'Требования:\nReact, TypeScript, обязательное знание Next.js.'),
    job('Frontend developer', 'Требования:\nReact.\nБудет плюсом:\nVue.js.\nТребования:\nОпыт коммерческой разработки на Vue обязателен.'),
    job('Frontend developer', 'Требования:\nReact.\nБудет плюсом:\nAngular обязателен для работы над модулем.'),
    job('Frontend developer', undefined, ['React', 'Vue']),
    job('Python developer', 'Будет плюсом: React.\nТребования:\nPython и FastAPI.'),
    job('JavaScript developer', 'Требования:\nTypeScript, Svelte и SvelteKit.'),
    job('Unity / Cocos developer', 'Требования:\nTypeScript, Cocos Creator.'),
    job('Разработчик Bpmsoft', 'Обязательные требования:\nC# и .NET.\nБудет плюсом:\nReact.'),
    job('Fullstack developer', 'Обязательные требования:\nC# и .NET.\nБудет плюсом:\nReact.'),
    job('Веб-программист Drupal', 'Требования:\nГлубокое знание Drupal и HTML/CSS.'),
  ]
  for (const sample of cases) { const decision = recommendDevelopment(sample); assert.equal(decision.matched, false, sample.name + ': ' + sample.description); assert.ok(decision.excluded.length) }
})

test('clearly optional foreign stacks, negations and genuine alternatives do not reject basic JS or React jobs', () => {
  const cases = [
    job('Junior JS developer', 'Требования:\nБазовые знания JavaScript.\nБудет плюсом:\nVue.js, Angular.', ['JS', 'Vue', 'Angular']),
    job('Frontend developer', 'Требования:\nReact, TypeScript. Знание Vue необязательно.', ['React', 'Vue.js']),
    job('Junior JS developer', 'Требования:\nБазовый JavaScript.\nБудет плюсом:\nVue 3.', ['JS', 'Vue.js']),
    job('Frontend developer', 'Требования:\nReact. Angular не требуется.', ['React', 'Angular']),
    job('Frontend developer', 'Требования:\nReact.\nПлюсом будет:\nVue.js.', ['React', 'Vue']),
    job('Fullstack React developer', 'Требования:\nReact, TypeScript и PostgreSQL.\nБудет плюсом:\nОпыт React Native.', ['React', 'TypeScript', 'React Native']),
    job('Frontend developer', 'Требования:\nЗнание React или Vue.js.', ['React', 'Vue']),
    job('Frontend developer', 'Requirements:\nReact and TypeScript.\nNice to have:\nAngular and Python.', ['React', 'Angular', 'Python']),
    job('Junior JS developer', 'Требования:\nБазовый JavaScript; Vue будет плюсом.'),
  ]
  for (const sample of cases) assert.equal(recommendDevelopment(sample).matched, true, `${sample.name}: ${recommendDevelopment(sample).excluded.join('; ')}`)
})

test('senior titles and high explicit experience requirements are excluded, without rejecting mentors in company prose', () => {
  for (const title of ['Senior React developer', 'Sr. Frontend developer', 'Lead React engineer', 'Ведущий frontend-разработчик', 'Старший React-разработчик', 'Staff frontend engineer', 'Архитектор frontend', 'Middle+/Senior React developer']) assert.equal(recommendDevelopment(job(title)).matched, false, title)
  assert.equal(recommendDevelopment(job('Frontend developer', 'Требования:\nОпыт работы с React от 5 лет.')).matched, false)
  assert.equal(recommendDevelopment(job('Frontend developer', 'Требования:\nReact, 5+ years of development experience.')).matched, false)
  assert.equal(recommendDevelopment(job('Frontend developer', 'Требования:\nУровень Senior, знание React.')).matched, false)
  assert.equal(recommendDevelopment(job('Frontend developer', 'Ищем Lead React разработчика.\nТребования:\nReact.')).matched, false)
  assert.equal(recommendDevelopment(job('Frontend developer', undefined, ['React'], { experience: { id: 'moreThan6', name: 'Более 6 лет' } })).matched, false)
  assert.equal(recommendDevelopment(job('Junior React developer', 'В команде работают senior инженеры.\nТребования:\nБазовое знание React. Работа с наставником senior уровня.')).matched, true)
})

test('mentions of React do not recommend design, QA, recruiting, teaching or unrelated jobs', () => {
  for (const title of ['Product Designer (React)', 'QA engineer (React)', 'Инженер по тестированию ПО', 'Специалист по информационной безопасности (AppSec)', 'IT Recruiter frontend', 'Автор курсов React', 'Менеджер проектов React', 'Аналитик React', 'DevOps engineer', 'Кассир', 'Верстальщик-ретушёр']) assert.equal(recommendDevelopment(job(title, 'Требования:\nЗнание React и TypeScript.')).matched, false, title)
})

test('recommendation analytics are read-only, filter every metric and hide processed jobs', t => {
  const store = new Store(':memory:'); t.after(() => store.close())
  store.ingest({ items: [
    job('Frontend React developer', undefined, ['React']),
    job('Senior React developer', undefined, ['React'], { id: '2' }),
    job('Техническая поддержка веб-сервисов', undefined, [], { id: '3' }),
    job('Frontend developer', 'Требования:\nЗнать Vue.js, TypeScript, HTML и CSS.', ['Vue.js', 'TypeScript'], { id: '4' }),
  ] })
  const before = store.db.prepare('SELECT * FROM vacancies ORDER BY id').all()
  store.db.exec('PRAGMA query_only=ON')
  const dev = store.analytics({ ...defaultRemoteFilters, recommendation: 'development' })
  assert.deepEqual(dev.recent.map(job => job.id), ['1'])
  assert.equal(dev.totals.filtered, 1); assert.equal(dev.totals.stored, 3)
  assert.equal(dev.remote.groups.reduce((n, row) => n + row.count, 0), 1)
  assert.deepEqual(Object.keys(dev.recommendations), ['1'])
  assert.deepEqual(store.db.prepare('SELECT * FROM vacancies ORDER BY id').all(), before)
  store.db.exec('PRAGMA query_only=OFF')
  store.workspace.mark('1', true)
  assert.equal(store.analytics({ ...defaultRemoteFilters, recommendation: 'development' }).totals.filtered, 0)
  assert.equal(store.analytics({ ...defaultRemoteFilters, recommendation: 'development', text: 'нет совпадений' }).recent.length, 0)
})
