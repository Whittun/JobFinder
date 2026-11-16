import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmdirSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { Store } from '../server/store.ts'
import { defaultRemoteFilters } from '../src/lib/analytics.ts'
import { workspaceApi } from '../server/workspace-api.ts'
import { coverLetters, recommendedLetter } from '../src/lib/cover-letters.ts'

const job = (id, name = 'Frontend developer') => ({
  id: String(id), name, published_at: new Date().toISOString(), alternate_url: `https://hh.ru/vacancy/${id}`,
  area: { id: '1', name: 'Москва' }, employer: { id: String(id), name: `Компания ${id}` },
  work_format: [{ id: 'REMOTE', name: 'Удалённо' }], key_skills: ['React'],
  description: 'Разработка и сопровождение интерфейсов веб-приложения. Работа с технической документацией и командой.',
  detail_fetched_at: new Date().toISOString(),
})
function database(t, jobs = [job(1), job(2, 'Инженер поддержки веб-сервисов')]) {
  const store = new Store(':memory:')
  t.after(() => store.close())
  store.ingest({ items: jobs })
  return store
}

test('marking a job hides it across all active views without deleting vacancy or derived data, and restore reverses it', t => {
  const store = database(t)
  const tables = ['vacancies', 'vacancy_skills', 'vacancy_groups', 'vacancy_formats', 'vacancy_terms']
  const snapshot = () => tables.map(table => store.db.prepare(`SELECT * FROM ${table}`).all())
  const before = snapshot()
  store.workspace.mark('1', true)
  assert.deepEqual(snapshot(), before)
  for (const priority of ['', 'any', 'web', 'development']) {
    const result = store.analytics({ ...defaultRemoteFilters, priority })
    assert.ok(result.recent.every(item => item.id !== '1'))
    assert.equal(result.processedTotal, 1)
    assert.equal(result.totals.stored, 2)
  }
  assert.equal(store.analytics(defaultRemoteFilters).remote.available, 1)
  assert.equal(store.workspace.list().items[0].vacancy.id, '1')
  const date = store.workspace.list().items[0].processedAt
  store.workspace.mark('1', true)
  assert.equal(store.workspace.list().total, 1)
  assert.equal(store.workspace.list().items[0].processedAt, date)
  store.workspace.mark('1', false)
  assert.equal(store.analytics(defaultRemoteFilters).totals.filtered, 2)
  assert.equal(store.workspace.list().total, 0)
})

test('collector updates keep manual marks and closed jobs retain their processed snapshots', t => {
  const store = database(t)
  store.workspace.mark('1', true)
  store.ingest({ items: [{ ...job(1), name: 'Middle Frontend developer' }] })
  assert.equal(store.analytics(defaultRemoteFilters).recent.some(item => item.id === '1'), false)
  assert.equal(store.workspace.list().items[0].vacancy.name, 'Middle Frontend developer')
  store.reject('1', 'closed')
  const saved = store.workspace.list().items[0]
  assert.equal(saved.vacancy.name, 'Frontend developer')
  assert.equal(saved.canRestore, false)
  assert.throws(() => store.workspace.mark('1', false), error => error.status === 409)
  assert.equal(store.workspace.list().total, 1)
  assert.equal(store.workspace.list('Компания 1').filtered, 1)
})

test('processed history is independent of publication windows, supports literal search and disjoint pagination', t => {
  const jobs = Array.from({ length: 25 }, (_, i) => job(i))
  const store = database(t, jobs)
  for (const item of jobs) store.workspace.mark(item.id, true)
  store.db.exec('UPDATE vacancies SET published=0')
  const first = store.workspace.list(), second = store.workspace.list('', 1)
  assert.equal(first.items.length, 20)
  assert.equal(second.items.length, 5)
  assert.equal(new Set([...first.items, ...second.items].map(item => item.vacancy.id)).size, 25)
  assert.equal(store.workspace.list('', 999).page, 1)
  assert.equal(store.workspace.list('%').filtered, 0)
  assert.equal(store.workspace.list('_').filtered, 0)
  assert.equal(store.workspace.list('компания 24').filtered, 1)
})

test('marks persist after reopening the database and two connections share the same state', t => {
  const directory = mkdtempSync(join(tmpdir(), 'jobfinder-workspace-'))
  const file = join(directory, 'test.sqlite')
  t.after(() => { for (const suffix of ['', '-wal', '-shm']) if (existsSync(file + suffix)) unlinkSync(file + suffix); rmdirSync(directory) })
  const first = new Store(file), second = new Store(file)
  try {
    first.ingest({ items: [job(1)] }); first.workspace.mark('1', true)
    assert.equal(second.workspace.list().total, 1)
    assert.equal(second.analytics(defaultRemoteFilters).totals.filtered, 0)
  } finally { first.close(); second.close() }
  const reopened = new Store(file)
  try { assert.equal(reopened.workspace.list().items[0].vacancy.id, '1') }
  finally { reopened.close() }
})

test('provided cover letter is preserved and auto-selected for web, frontend and fullstack only', () => {
  assert.equal(coverLetters.length, 1)
  assert.ok(coverLetters[0].text.includes('2 года коммерческого опыта'))
  assert.ok(coverLetters[0].text.includes('1+ год коммерческого опыта'))
  assert.ok(coverLetters[0].text.includes('https://okrate.app/'))
  assert.ok(coverLetters[0].text.includes('\n\nВ Okrate'))
  for (const title of ['Frontend developer', 'Fullstack-разработчик', 'Веб-разработчик', 'React developer', 'Разработчик на React', 'Верстальщик', 'TypeScript developer', 'WordPress developer']) assert.equal(recommendedLetter(job(1, title))?.id, coverLetters[0].id, title)
  for (const title of ['Менеджер по работе с блогерами', 'SMM-менеджер', 'React Native developer', 'QA frontend', 'Backend developer', 'IT recruiter frontend', 'Frontend project manager', 'Веб-дизайнер', 'DevOps']) assert.equal(recommendedLetter(job(1, title)), undefined, title)
})

async function request(state, path, { method = 'GET', body = '', headers = {} } = {}) {
  const req = Readable.from([Buffer.from(body)])
  req.method = method; req.headers = { host: 'localhost:5173', ...headers }
  const result = { headers: {} }
  const res = {
    setHeader(name, value) { result.headers[name] = value },
    writeHead(status) { result.status = status; return this },
    end(body) { result.body = JSON.parse(body) },
  }
  result.handled = await workspaceApi(req, res, new URL(path, 'http://localhost:5173'), state)
  return result
}

test('workspace API validates mutations, blocks foreign origins and exposes persistent processed history', async t => {
  const store = database(t), state = store.workspace
  const post = (body, headers = {}) => request(state, '/api/vacancy-state', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers } })
  assert.equal((await post({ id: '1', processed: true }, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await post({ id: '1', processed: true }, { origin: 'null' })).status, 403)
  assert.equal((await post({ id: '1', processed: 'true' })).status, 400)
  assert.equal((await post({ id: '../1', processed: true })).status, 400)
  assert.equal((await post(null)).status, 400)
  assert.equal((await post({ id: '999', processed: true })).status, 404)
  assert.equal((await post({ id: '1', processed: true }, { 'content-type': 'text/plain' })).status, 415)
  assert.equal((await post({ id: '1', processed: true, extra: 'a'.repeat(2048) })).status, 413)
  assert.equal(state.list().total, 0)
  assert.equal((await post({ id: '1', processed: true }, { origin: 'http://localhost:5173' })).status, 200)
  const get = await request(state, '/api/processed')
  assert.equal(get.body.total, 1)
  assert.equal(get.headers['Cache-Control'], 'no-store')
  assert.equal((await request(state, '/api/processed?page=-1')).status, 400)
  assert.equal((await request(state, '/api/processed', { method: 'POST' })).status, 405)
  assert.equal((await request(state, '/api/vacancy-state')).status, 405)
  assert.equal((await post({ id: '1', processed: false })).status, 200)
  assert.equal(state.list().total, 0)
})
