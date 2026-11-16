import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, unlinkSync, rmdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { Store, titleTerms } from '../server/store.ts'
import { Collector } from '../server/collector.ts'
import { expandTask, taskUrl, moscowDay, shiftDay } from '../server/crawl-plan.ts'
import { parseSearchPage } from '../server/hh-page.ts'
import { defaultAnalyticsFilters } from '../src/lib/analytics.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/hh-search.json', import.meta.url), 'utf8'))
const taxonomy = {
  roles: [{ id: '1', name: 'Разработчик', directionIds: ['category-1','category-2'] }, { id: '2', name: 'Тестировщик', directionIds: ['category-1'] }],
  directions: [{ id: 'category-1', name: 'IT', roleIds: ['1','2'] }, { id: 'category-2', name: 'Разработка', roleIds: ['1'] }],
}
function sample() {
  const state = structuredClone(fixture)
  const now = new Date().toISOString()
  state.vacancySearchResult.vacancies[0].name = 'Python-разработчик'
  state.vacancySearchResult.vacancies[0].professionalRoleIds = [{ professionalRoleId: [1,2] }]
  state.vacancySearchResult.vacancies[1].professionalRoleIds = [{ professionalRoleId: [2] }]
  for (const item of state.vacancySearchResult.vacancies) item.publicationTime = { $: now }
  const data = parseSearchPage(`<template id="HH-Lux-InitialState">${JSON.stringify(state)}</template>`, 'https://hh.ru/search/vacancy')
  for (const item of data.items) {
    item.work_format = [{id:'REMOTE',name:'Удалённо'}]
    item.description = 'Разработка и сопровождение веб-сервисов. Работа с технической документацией и командой.'
    item.detail_fetched_at = now
  }
  return data
}
const baseTask = { kind: 'profession', label: 'Разработчик', roles: ['1'], from: '2026-10-01', to: '2026-10-30', cycle: 'cycle' }

test('planner covers all days with disjoint partitions and uses website date syntax', () => {
  const result = expandTask(baseTask, 7000, [])
  assert.equal(result.tasks.length, 2)
  assert.equal(result.tasks[0].from, baseTask.from)
  assert.equal(result.tasks[1].to, baseTask.to)
  assert.equal(shiftDay(result.tasks[0].to, 1), result.tasks[1].from)
  const url = new URL(taskUrl({ ...baseTask, roles: ['1','2'], page: 3 }))
  assert.equal(url.searchParams.get('date_from'), '01.10.2026')
  assert.equal(url.searchParams.get('date_to'), '30.10.2026')
  assert.deepEqual(url.searchParams.getAll('professional_role'), ['1','2'])
  assert.equal(url.searchParams.get('page'), '3')
})

test('planner broadens high-volume one-day searches by regions, then experience, and exposes residual limits', () => {
  const singleDay = { ...baseTask, to: baseTask.from }
  const regions = [{ id: '1', name: 'Москва' }, { id: '2', name: 'Петербург' }]
  const geographic = expandTask(singleDay, 3000, regions)
  assert.deepEqual(geographic.tasks.map(task => task.area), ['1','2'])
  const experience = expandTask(geographic.tasks[0], 3000, regions)
  assert.equal(experience.tasks.length, 4)
  const limited = expandTask(experience.tasks[0], 3000, regions)
  assert.equal(limited.tasks.length, 19)
  assert.equal(limited.limited, true)
  assert.deepEqual(expandTask(baseTask, 100, []).tasks, [])
  assert.equal(expandTask(baseTask, 500, []).tasks.length, 4)
})

test('parser keeps profession IDs and taxonomy membership instead of guessing from job titles', () => {
  const state = structuredClone(fixture)
  state.professionalRoleTree = { items: taxonomy.directions.map(direction => ({ id: direction.id, text: direction.name, items: taxonomy.roles.filter(role => direction.roleIds.includes(role.id)).map(role => ({ id: role.id, text: role.name })) })) }
  state.vacancySearchResult.vacancies[0].professionalRoleIds = [{ professionalRoleId: [1,2] }]
  const data = parseSearchPage(`<template id="HH-Lux-InitialState">${JSON.stringify(state)}</template>`, 'https://hh.ru')
  assert.equal(data.taxonomy.roles.length, 2)
  assert.deepEqual(data.taxonomy.roles[0].directionIds, ['category-1','category-2'])
  assert.deepEqual(data.items.find(item => item.id === '101').role_ids, ['1','2'])
})

test('SQLite deduplicates updates, preserves first discovery, and never double-counts a direction', t => {
  const store = new Store(':memory:')
  t.after(() => store.close())
  store.taxonomy(taxonomy)
  const data = sample()
  store.ingest(data)
  const first = store.db.prepare('SELECT first_seen FROM vacancies WHERE id=?').get('101').first_seen
  store.ingest(data)
  const stats = store.analytics(defaultAnalyticsFilters)
  assert.equal(stats.totals.stored, 2)
  assert.equal(stats.local.directions.find(row => row.id === 'category-1').count, 2)
  assert.equal(stats.local.professions.find(row => row.id === '2').count, 2)
  assert.equal(stats.totals.medianLower, 100000)
  assert.equal(stats.totals.salaryCount, 1)
  assert.equal(stats.local.titleSkills.find(row => row.name === 'Python').count, 1)
  assert.equal(store.db.prepare('SELECT first_seen FROM vacancies WHERE id=?').get('101').first_seen, first)
  assert.equal(store.analytics({ ...defaultAnalyticsFilters, profession: '1' }).totals.filtered, 1)
  assert.equal(store.analytics({ ...defaultAnalyticsFilters, area: '2' }).totals.filtered, 1)
  assert.equal(store.analytics({ ...defaultAnalyticsFilters, text: '%' }).totals.filtered, 0)
  const changed = structuredClone(data)
  changed.items.find(item => item.id === '101').role_ids = ['2']
  store.ingest(changed)
  assert.equal(store.analytics({ ...defaultAnalyticsFilters, profession: '1' }).totals.filtered, 0)
})

test('saved records and crawl queue survive reopening; only one process owns the collector lease', t => {
  const directory = mkdtempSync(join(tmpdir(), 'jobfinder-tests-'))
  const file = join(directory, 'test.sqlite')
  t.after(() => { for (const suffix of ['', '-wal', '-shm']) if (existsSync(file + suffix)) unlinkSync(file + suffix); rmdirSync(directory) })
  const first = new Store(file)
  const second = new Store(file)
  try {
    first.ingest(sample())
    first.enqueue(baseTask); first.enqueue(baseTask)
    assert.equal(first.lease('one'), true)
    assert.equal(second.lease('two'), false)
    first.release('one')
    assert.equal(second.lease('two'), true)
    assert.equal(first.taskStats().pending, 1)
  } finally { first.close(); second.close() }
  const reopened = new Store(file)
  try { assert.equal(reopened.analytics(defaultAnalyticsFilters).totals.stored, 2); assert.equal(reopened.next().task.label, baseTask.label) }
  finally { reopened.close() }
})

test('title terms do not confuse Java with JavaScript or count arbitrary 1C substrings', () => {
  assert.deepEqual(titleTerms('JavaScript React разработчик'), ['JavaScript','React'])
  assert.deepEqual(titleTerms('Программист 1С'), ['1С'])
  assert.deepEqual(titleTerms('Java-разработчик'), ['Java'])
})

test('collector bootstraps the whole taxonomy, saves results and resumes without re-seeding duplicates', async t => {
  const collector = new Collector(':memory:')
  t.after(() => collector.close())
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('/areas/')) return Response.json({ areas: [{ id: '1', name: 'Москва' }] })
    const state = structuredClone(fixture)
    state.professionalRoleTree = { items: [{ id: 'category-1', text: 'IT', items: [{ id: '1', text: 'Разработчик' }] }] }
    state.vacancySearchResult.criteria = { date_from: shiftDay(moscowDay(), -29).split('-').reverse().join('.'), date_to: moscowDay().split('-').reverse().join('.') + ' 23:59:59', page: 0, area: [113],work_format:['REMOTE'] }
    return new Response(`<template id="HH-Lux-InitialState">${JSON.stringify(state)}</template>`)
  })
  await collector.tick()
  assert.equal(collector.store.taskStats().pending, 15) // Two web role formats, twelve keyword searches and one candidate.
  assert.equal(collector.store.taskStats().done, 1)
  assert.equal(collector.store.analytics(defaultAnalyticsFilters).totals.market, 40)
  collector.control(false)
  const requests = collector.store.get('requests', 0)
  await collector.tick()
  assert.equal(collector.store.get('requests', 0), requests)
})

test('collector applies global backoff on access refusal instead of continuing through the queue', async t => {
  const collector = new Collector(':memory:')
  t.after(() => collector.close())
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response('Forbidden', { status: 403 }))
  await collector.tick()
  assert.equal(collector.store.taskStats().pending, 1)
  assert.ok(collector.store.get('nextAt', 0) > Date.now())
  assert.match(collector.store.get('lastError', ''), /403/)
  await collector.tick()
  assert.equal(fetch.mock.callCount(), 1)
  const cooldown = collector.store.get('nextAt', 0)
  assert.ok(cooldown >= Date.now() + 4 * 60_000)
  collector.control(false); collector.control(true)
  assert.equal(collector.store.get('nextAt', 0), cooldown)
})
