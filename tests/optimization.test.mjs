import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { Store } from '../server/store.ts'
import { Collector } from '../server/collector.ts'
import { expandTask, moscowDay, shiftDay, taskKey, taskUrl } from '../server/crawl-plan.ts'
import { candidateChanged, DETAIL_TTL, DISCOVERY_INTERVAL, MIN_INTERVAL, QUEUE_VERSION, responseDiagnostic, retryAfterMs, searchPlan } from '../server/collector-policy.ts'

const roles = [{ id: '1', name: 'Разработчик' }, { id: '2', name: 'Бухгалтер' }, { id: '3', name: 'Менеджер по продажам' }]
const base = { from: shiftDay(moscowDay(), -29), to: moscowDay(), cycle: 'first' }
const job = (id, name = 'Менеджер по работе с блогерами', format = 'REMOTE') => ({
  id: String(id), name, published_at: new Date().toISOString(), area: { id: '1', name: 'Москва' },
  employer: { id: '1', name: 'Компания' }, description: 'Ведение документации и работа над задачами команды. Планирование и обсуждение задач.',
  work_format: [{ id: format, name: format === 'REMOTE' ? 'Удалённо' : 'Гибрид' }],
  detail_fetched_at: new Date().toISOString(),
})
const detail = (candidate, extra = {}) => ({ ...base, kind: 'detail', label: `Описание: ${candidate.name}`, candidate, ...extra })
const database = t => { const store = new Store(':memory:'); t.after(() => store.close()); return store }
function collectorFor(t) {
  const collector = new Collector(':memory:')
  t.after(() => collector.close())
  collector.store.set('queueVersion', QUEUE_VERSION)
  collector.store.set('nextDiscovery', Date.now() + DISCOVERY_INTERVAL)
  return collector
}
const finish = (store, entry) => store.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(entry.id)
const allowNext = collector => { collector.store.set('nextAt', 0); collector.store.set('blockedUntil', 0) }
function fullPage(candidate) {
  const vacancy = { vacancyId: Number(candidate.id), name: candidate.name, description: candidate.description, workFormats: candidate.work_format.map(row => row.id), status: 'OPEN', keySkills: [] }
  return `<template id="HH-Lux-InitialState">${JSON.stringify({ vacancyView: { vacancyFull: { vacancy } } })}</template>`
}

test('separate format searches preserve focus keywords in partitions and filter out excluded roles', () => {
  const plan = searchPlan(roles, base)
  assert.equal(plan.length, 10)
  for (const format of ['REMOTE', 'HYBRID']) {
    assert.equal(plan.filter(task => task.format === format && task.kind === 'focus').length, 3)
    assert.equal(plan.filter(task => task.format === format && task.kind === 'profession').length, 2)
  }
  assert.equal(plan.some(task => task.roles?.includes('3')), false)
  for (const seed of plan) {
    const url = new URL(taskUrl(seed))
    assert.deepEqual(url.searchParams.getAll('work_format'), [seed.format])
    if (seed.text) {
      assert.equal(url.searchParams.get('text'), seed.text)
      for (const child of expandTask(seed, 5000, []).tasks) {
        assert.equal(new URL(taskUrl(child)).searchParams.get('text'), seed.text)
        assert.deepEqual(new URL(taskUrl(child)).searchParams.getAll('work_format'), [seed.format])
      }
    }
  }
})

test('queue fills remote influence and development before other remote jobs and hybrid, regardless of slot preference', t => {
  const store = database(t)
  store.enqueueMany([
    detail(job(1, 'Менеджер по работе с блогерами', 'HYBRID')),
    detail(job(2, 'Бухгалтер')), detail(job(3, 'Frontend developer')), detail(job(4)),
  ])
  const order = []
  for (const preferred of [false, true, false, true]) { const entry = store.next(preferred); order.push(entry.task.candidate.id); finish(store, entry) }
  assert.deepEqual(order, ['4', '3', '2', '1'])
  assert.equal(store.next(), null)
})

test('overlapping discoveries deduplicate details by ID, promote their priority and preserve retry attempts and deadlines', t => {
  const store = database(t), candidate = job(1, 'Маркетолог')
  store.enqueue(detail(candidate))
  store.db.prepare('UPDATE tasks SET due=?,attempts=3').run(Date.now() + 60000)
  const before = store.db.prepare('SELECT due,attempts,priority FROM tasks').get()
  store.enqueue(detail(candidate, { cycle: 'second', focus: true }))
  const after = store.db.prepare('SELECT due,attempts,priority FROM tasks').get()
  assert.equal(store.taskStats().pending, 1)
  assert.equal(after.due, before.due)
  assert.equal(after.attempts, 3)
  assert.ok(after.priority < before.priority)
  assert.equal(store.next(), null)
  assert.equal(taskKey(detail(candidate)), taskKey(detail(candidate, { cycle: 'third' })))
})

test('recent identical cards skip network work, but expiration and changed salary or format trigger a refresh', t => {
  const store = database(t), candidate = job(1)
  store.ingest({ items: [candidate] })
  store.enqueue(detail(candidate))
  assert.equal(store.taskStats().pending, 0)
  assert.equal(store.get('cacheSkipped', 0), 1)
  assert.equal(candidateChanged(candidate, { ...candidate, area: { name: 'Москва', id: '1' }, description: 'Other description' }), false)
  const salary = { ...candidate, salary: { from: 100000, to: null, currency: 'RUR', gross: false } }
  assert.equal(candidateChanged(candidate, salary), true)
  store.enqueue(detail(salary))
  assert.equal(store.taskStats().pending, 1)
  finish(store, store.next())
  const expired = { ...candidate, detail_fetched_at: new Date(Date.now() - DETAIL_TTL - 1000).toISOString() }
  store.db.prepare('UPDATE vacancies SET payload=? WHERE id=?').run(JSON.stringify(expired), candidate.id)
  store.enqueue(detail(candidate, { cycle: 'third' }))
  assert.equal(store.taskStats().pending, 1)
  assert.equal(candidateChanged(candidate, job(1, candidate.name, 'HYBRID')), true)
})

test('recent rejected IDs are cached temporarily and become eligible for rechecking later', t => {
  const store = database(t), candidate = job(1)
  store.reject(candidate.id, 'sales')
  store.enqueue(detail(candidate))
  assert.equal(store.taskStats().pending, 0)
  store.db.prepare('UPDATE rejected_ids SET updated_at=?').run(new Date(Date.now() - 2 * 86400000).toISOString())
  store.enqueue(detail(candidate))
  assert.equal(store.taskStats().pending, 1)
})

test('search tasks deduplicate across cycles and completed searches run again in a new cycle', t => {
  const store = database(t), task = searchPlan(roles, base)[0]
  store.enqueue(task); store.enqueue({ ...task, cycle: 'second' })
  assert.equal(store.taskStats().pending, 1)
  finish(store, store.next())
  store.enqueue({ ...task, cycle: 'second' })
  assert.equal(store.taskStats().pending, 0)
  store.enqueue({ ...task, cycle: 'third' })
  assert.equal(store.taskStats().pending, 1)
})

test('queue migration preserves all vacancy and skill data, deduplicates old tasks and keeps cooldowns', t => {
  const store = database(t), saved = job(1, 'React developer'), waiting = job(2)
  store.ingest({ items: [saved] })
  const insert = store.db.prepare('INSERT INTO tasks(task_key,payload,kind,priority) VALUES (?,?,?,?)')
  insert.run('old-detail-a', JSON.stringify(detail(waiting)), 'detail', 15)
  insert.run('old-detail-b', JSON.stringify(detail(waiting, { cycle: 'other' })), 'detail', 15)
  insert.run('old-saved-detail', JSON.stringify(detail(saved)), 'detail', 15)
  insert.run('old-search', JSON.stringify({ ...base, kind: 'profession', label: 'Бухгалтер' }), 'profession', 13)
  const tables = ['vacancies', 'vacancy_roles', 'vacancy_formats', 'vacancy_groups', 'vacancy_skills', 'vacancy_terms']
  const snapshot = () => tables.map(table => store.db.prepare(`SELECT * FROM ${table}`).all())
  const before = snapshot(), cooldown = Date.now() + 20 * 60000
  store.set('nextAt', cooldown); store.set('blockedUntil', cooldown)
  store.optimizeQueue(searchPlan(roles, base))
  assert.deepEqual(snapshot(), before)
  assert.equal(store.get('nextAt', 0), cooldown)
  assert.equal(store.get('blockedUntil', 0), cooldown)
  assert.equal(store.get('queueVersion', 0), QUEUE_VERSION)
  assert.equal(store.count("SELECT count(*) count FROM tasks WHERE kind='detail' AND status='pending'"), 1)
  assert.equal(store.count("SELECT count(*) count FROM tasks WHERE status='superseded'"), 2)
  const count = store.count('SELECT count(*) count FROM tasks')
  store.optimizeQueue(searchPlan(roles, base))
  assert.equal(store.count('SELECT count(*) count FROM tasks'), count)
})

test('incremental discovery runs during a long backlog, overlaps the previous date and respects an existing cooldown', async t => {
  const collector = collectorFor(t), store = collector.store
  store.taxonomy({ roles: roles.map(role => ({ ...role, directionIds: [] })), directions: [] })
  const previous = new Date(Date.now() - 86400000).toISOString()
  store.set('lastDiscovery', previous); store.set('nextDiscovery', 0)
  store.set('nextAt', Date.now() + 60000)
  store.enqueueMany(Array.from({ length: 25 }, (_, id) => detail(job(id, 'Бухгалтер'))))
  const fetch = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not request during cooldown') })
  await collector.tick()
  assert.equal(fetch.mock.callCount(), 0)
  assert.equal(store.taskStats().pending, 35)
  assert.deepEqual(store.get('discoveryWindow', {}), { from: shiftDay(moscowDay(Date.parse(previous)), -1), to: moscowDay() })
  assert.ok(store.get('nextDiscovery', 0) >= Date.now() + DISCOVERY_INTERVAL - 1000)
  await collector.tick()
  assert.equal(store.taskStats().pending, 35)
})

test('consecutive access refusals across different jobs increase global cooldown and preserve it on resume', async t => {
  const collector = collectorFor(t), store = collector.store
  store.enqueueMany([detail(job(1)), detail(job(2))])
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('<title>Access denied</title>', { status: 403 }))
  await collector.tick()
  assert.ok(store.get('nextAt', 0) >= Date.now() + 5 * 60000 - 1000)
  assert.equal(store.get('requestInterval', 0), 20000)
  await collector.tick()
  assert.equal(fetch.mock.callCount(), 1)
  allowNext(collector)
  await collector.tick()
  assert.equal(fetch.mock.callCount(), 2)
  assert.equal(store.get('blockStreak', 0), 2)
  assert.ok(store.get('nextAt', 0) >= Date.now() + 10 * 60000 - 1000)
  assert.equal(store.get('requestInterval', 0), 40000)
  assert.equal(store.get('lastFailure', {}).url, 'https://hh.ru/vacancy/2')
  assert.equal(store.get('lastFailure', {}).title, 'Access denied')
  const cooldown = store.get('nextAt', 0)
  collector.control(false); collector.control(true)
  assert.equal(store.get('nextAt', 0), cooldown)
})

test('429 honors a longer Retry-After and parses both numeric and HTTP date forms', async t => {
  const collector = collectorFor(t)
  collector.store.enqueue(detail(job(1)))
  t.mock.method(globalThis, 'fetch', async () => new Response('Too many requests', { status: 429, headers: { 'Retry-After': '3600' } }))
  await collector.tick()
  assert.ok(collector.store.get('nextAt', 0) >= Date.now() + 3600000 - 1000)
  assert.equal(retryAfterMs('garbage'), 0)
  assert.equal(retryAfterMs('120'), 120000)
  const now = 1760000000000
  assert.equal(retryAfterMs(new Date(now + 60000).toUTCString(), now), 60000)
})

test('captcha with HTTP 200 causes a global pause and never saves fake vacancy data', async t => {
  const collector = collectorFor(t), store = collector.store
  store.enqueue(detail(job(1)))
  t.mock.method(globalThis, 'fetch', async () => new Response('<title>Проверка доступа</title><form action="/captcha">Проверка робота</form>'))
  await collector.tick()
  assert.ok(store.get('blockedUntil', 0) >= Date.now() + 5 * 60000 - 1000)
  assert.equal(store.count('SELECT count(*) count FROM vacancies'), 0)
  assert.equal(store.get('lastFailure', {}).status, 200)
  assert.match(store.get('lastFailure', {}).reason, /капча/)
})

test('one broken card is postponed without stopping other jobs, and successful work gradually restores the interval', async t => {
  const collector = collectorFor(t), store = collector.store
  const second = job(2)
  store.enqueueMany([detail(job(1)), detail(second)])
  store.set('requestInterval', 20000); store.set('successStreak', 9)
  t.mock.method(globalThis, 'fetch', async url => new Response(url.endsWith('/1') ? '<html>Changed markup</html>' : fullPage(second)))
  await collector.tick()
  assert.ok(store.get('nextAt', 0) < Date.now() + 30000)
  assert.equal(store.get('blockedUntil', 0), 0)
  assert.ok(store.db.prepare('SELECT due FROM tasks WHERE task_key=?').get(taskKey(detail(job(1)))).due >= Date.now() + 59000)
  allowNext(collector)
  await collector.tick()
  assert.equal(store.count('SELECT count(*) count FROM vacancies'), 1)
  assert.equal(store.get('requestInterval', 0), 18000)
  assert.ok(store.get('requestInterval', 0) >= MIN_INTERVAL)
})

test('diagnostics keep only a short page title, status and public URL rather than the response body', () => {
  const info = responseDiagnostic(403, `<title>${'A'.repeat(500)}</title><script>private body</script>`, 'https://hh.ru/vacancy/1', null)
  assert.equal(info.title.length, 160)
  assert.equal(JSON.stringify(info).includes('private body'), false)
})

test('an unreadable 429 error body still enforces the global cooldown', async t => {
  const collector = collectorFor(t)
  collector.store.enqueue(detail(job(1)))
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error('broken response')) } }), { status: 429 }))
  await collector.tick()
  assert.ok(collector.store.get('blockedUntil', 0) >= Date.now() + 5 * 60000 - 1000)
  assert.equal(collector.store.get('lastFailure', {}).status, 429)
})

test('focus searches stage real candidates, verify applied text and format, then save only full validated cards', async t => {
  const collector = collectorFor(t), store = collector.store
  const task = searchPlan(roles, base)[0]
  store.enqueue(task)
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/hh-search.json', import.meta.url), 'utf8'))
  const candidate = job(101)
  fixture.vacancySearchResult.vacancies = [{
    ...fixture.vacancySearchResult.vacancies[0], name: candidate.name,
    publicationTime: { $: candidate.published_at }, workFormats: [{ workFormatsElement: ['REMOTE'] }],
  }]
  const applied = new URL(taskUrl(task)).searchParams
  fixture.vacancySearchResult.criteria = {
    date_from: applied.get('date_from'), date_to: applied.get('date_to'), area: [113],
    work_format: ['REMOTE'], page: 0, text: task.text,
  }
  t.mock.method(globalThis, 'fetch', async url => new Response(url.includes('/vacancy/101') ? fullPage(candidate) : `<template id="HH-Lux-InitialState">${JSON.stringify(fixture)}</template>`))
  await collector.tick()
  assert.equal(store.count('SELECT count(*) count FROM vacancies'), 0)
  assert.equal(store.taskStats().pending, 1)
  assert.equal(store.next(true).task.candidate.id, '101')
  allowNext(collector)
  await collector.tick()
  assert.equal(store.count('SELECT count(*) count FROM vacancies'), 1)
  assert.equal(store.taskStats().pending, 0)
  assert.equal(store.get('lastError', null), null)
})

test('an ignored text or work-format filter never schedules a false successful focus search', async t => {
  const collector = collectorFor(t), store = collector.store
  const task = searchPlan(roles, base)[0]
  store.enqueue(task)
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/hh-search.json', import.meta.url), 'utf8'))
  const applied = new URL(taskUrl(task)).searchParams
  fixture.vacancySearchResult.criteria = {
    date_from: applied.get('date_from'), date_to: applied.get('date_to'), area: [113],
    work_format: ['REMOTE'], page: 0, text: '',
  }
  t.mock.method(globalThis, 'fetch', async () => new Response(`<template id="HH-Lux-InitialState">${JSON.stringify(fixture)}</template>`))
  await collector.tick()
  assert.match(store.get('lastError', ''), /поисковый текст/)
  assert.equal(store.count("SELECT count(*) count FROM tasks WHERE kind='detail'"), 0)
  fixture.vacancySearchResult.criteria.text = task.text
  fixture.vacancySearchResult.criteria.work_format.push('HYBRID')
  store.db.exec('UPDATE tasks SET due=0'); allowNext(collector)
  await collector.tick()
  assert.match(store.get('lastError', ''), /формат работы/)
  assert.equal(store.taskStats().done, 0)
})
