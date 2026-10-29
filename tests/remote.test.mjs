import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Store } from '../server/store.ts'
import { defaultAnalyticsFilters, defaultRemoteFilters } from '../src/lib/analytics.ts'

const formats = { REMOTE: 'Удалённо', HYBRID: 'Гибрид', ON_SITE: 'На месте работодателя' }
function job(id, options = {}) {
  return {
    id: String(id), name: options.name || 'Python-разработчик',
    employer: { id: `company-${id}`, name: 'Компания' }, area: { id: '1', name: 'Москва' },
    role_ids: ['1'], published_at: new Date().toISOString(),
    description: 'Разработка и сопровождение программных продуктов. Работа с технической документацией и командой.', detail_fetched_at:new Date().toISOString(),
    experience: options.noExperience ? { id: 'noExperience', name: 'Нет опыта' } : { id: 'between1And3', name: 'От 1 года до 3 лет' },
    salary_range: { from: options.salary ?? 100000, to: null, currency: 'RUR', gross: false, mode: { id: 'MONTH', name: 'За месяц' } },
    work_format: (options.formats || ['REMOTE']).map(id => ({ id, name: formats[id] })),
    ...options.overrides,
  }
}
function database(t, jobs) {
  const store = new Store(':memory:')
  t.after(() => store.close())
  store.taxonomy({ roles: [{ id: '1', name: 'Разработчик', directionIds: ['category-1'] }], directions: [{ id: 'category-1', name: 'IT', roleIds: ['1'] }] })
  store.ingest({ items: jobs })
  return store
}

test('remote-only analytics exclude office, hybrid, mixed and unlabelled jobs from every metric', t => {
  const store = database(t, [
    job(1, { salary: 100000, noExperience: true }), job(2, { salary: 200000 }),
    job(3, { salary: 900000, formats: ['ON_SITE'] }), job(4, { salary: 800000, formats: ['HYBRID'] }),
    job(5, { salary: 700000, formats: ['REMOTE','HYBRID'] }),
    job(6, { name: 'Удалённый Python-разработчик', formats: [] }),
  ])
  const remote = store.analytics(defaultRemoteFilters)
  assert.equal(remote.totals.stored, 4)
  assert.equal(remote.totals.filtered, 2)
  assert.equal(remote.totals.employers, 2)
  assert.equal(remote.totals.medianLower, 150000)
  assert.equal(remote.remote.professions[0].salaryMedian, 150000)
  assert.equal(remote.remote.professions[0].noExperience, 1)
  assert.equal(remote.remote.professions[0].salaryCount, 2)
  assert.equal(remote.local.titleSkills[0].count, 2)
  assert.equal(remote.remote.titles[0].count, 2)
  assert.equal(remote.remote.mixedExcluded, 2)
  assert.equal(remote.remote.available, 2)
  assert.deepEqual(new Set(remote.recent.map(item => item.id)), new Set(['1','2']))
  assert.deepEqual(remote.market, { professions: [], directions: [] })
  const alternatives = store.analytics({ ...defaultRemoteFilters, workFormat: 'REMOTE' })
  assert.equal(alternatives.totals.filtered, 4)
  assert.equal(alternatives.remote.mixedExcluded, 0)
  assert.equal(store.analytics(defaultAnalyticsFilters).totals.filtered, 2)
})

test('profession, technology, exact job title, experience and salary filters intersect remote membership', t => {
  const store = database(t, [job(1, { noExperience: true }), job(2, { name: 'Java-разработчик' }), job(3, { formats: ['ON_SITE'] }), job(4, { name: 'Поддержка', overrides: { salary_range: null } })])
  assert.equal(store.analytics({ ...defaultRemoteFilters, technology: 'Python' }).totals.filtered, 1)
  assert.equal(store.analytics({ ...defaultRemoteFilters, title: 'Java-разработчик' }).totals.filtered, 1)
  assert.equal(store.analytics({ ...defaultRemoteFilters, title: 'java-разработчик' }).totals.filtered, 0)
  assert.equal(store.analytics({ ...defaultRemoteFilters, experience: 'noExperience' }).totals.filtered, 1)
  assert.equal(store.analytics({ ...defaultRemoteFilters, salary: 'specified' }).totals.filtered, 2)
  assert.equal(store.analytics({ ...defaultRemoteFilters, profession: '999' }).totals.filtered, 0)
  const empty = store.analytics({ ...defaultRemoteFilters, technology: 'C++' })
  assert.equal(empty.totals.filtered, 0)
  assert.equal(empty.totals.medianLower, null)
  assert.deepEqual(empty.remote.professions, [])
  assert.deepEqual(empty.recent, [])
})

test('remote pagination returns disjoint pages and clamps requests to the last available page', t => {
  const store = database(t, Array.from({ length: 25 }, (_, i) => job(i)))
  const first = store.analytics(defaultRemoteFilters)
  const second = store.analytics({ ...defaultRemoteFilters, page: '1' })
  assert.equal(first.recent.length, 20)
  assert.equal(second.recent.length, 5)
  assert.equal(first.remote.totalPages, 2)
  assert.equal(second.remote.page, 1)
  assert.equal(new Set([...first.recent, ...second.recent].map(item => item.id)).size, 25)
  assert.equal(store.analytics({ ...defaultRemoteFilters, page: '999' }).remote.page, 1)
})

test('remote view is read-only and preserves all pre-existing vacancy payloads and timestamps', t => {
  const store = database(t, [job(1), job(2, { formats: ['ON_SITE'] })])
  const before = store.db.prepare('SELECT * FROM vacancies ORDER BY id').all()
  const tasks = store.taskStats()
  store.db.exec('PRAGMA query_only=ON')
  for (const workFormat of ['REMOTE_ONLY','REMOTE']) store.analytics({ ...defaultRemoteFilters, workFormat })
  assert.deepEqual(store.db.prepare('SELECT * FROM vacancies ORDER BY id').all(), before)
  assert.deepEqual(store.taskStats(), tasks)
})
