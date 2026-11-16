import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../server/store.ts'
import { SourceRunner } from '../server/source-runner.ts'
import { parseSource } from '../server/source-adapters.ts'
import { sourceDefinitions } from '../src/lib/sources.ts'

const source = id => sourceDefinitions.find(item => item.id === id)
const description = 'Разрабатывать веб-интерфейсы на React и TypeScript. Русскоязычная команда, полностью удалённая работа из России. Исправлять ошибки и улучшать приложения.'

test('Greenhouse schedules relevant details from a small index and decodes their complete HTML', () => {
  const definition = source('greenhouse'), task = { kind: 'board', url: definition.url, context: { board: 'gitlab' } }
  const out = parseSource(definition, JSON.stringify({ jobs: [
    { id: 11, title: 'Frontend developer' }, { id: 12, title: 'Senior Frontend Engineer' },
    { id: 13, title: 'Sales manager' }, { id: 14, title: 'Backend Engineer' },
  ] }), task)
  assert.equal(out.jobs.length, 0)
  assert.deepEqual(out.links.map(link => link.url), [definition.url + '/11', definition.url + '/14'])
  const detail = parseSource(definition, JSON.stringify({ id: 11, title: 'Frontend developer', company_name: 'Example', absolute_url: 'https://job-boards.greenhouse.io/gitlab/jobs/11', content: `&lt;p&gt;${description}&lt;/p&gt;&lt;p&gt;HTML &amp;amp; CSS&lt;/p&gt;`, location: { name: 'Remote' } }), { ...out.links[0], url: out.links[0].url })
  assert.equal(detail.jobs.length, 1)
  assert.ok(detail.jobs[0].description.includes(description))
  assert.ok(detail.jobs[0].description.includes('HTML & CSS'))
  assert.ok(!detail.jobs[0].description.includes('<p>'))
  assert.equal(detail.jobs[0].work_format[0].id, 'REMOTE')
  assert.equal(detail.jobs[0].employer.name, 'Example')
  assert.throws(() => parseSource(definition, '{}', { kind: 'detail', url: out.links[0].url, context: {} }), /полное описание/)
})

test('Lever pages preserve board context, recur independently and stop at an empty page or safety bound', () => {
  const definition = source('lever'), task = { kind: 'board', url: definition.url, context: { board: 'example', recurring: true } }
  const body = JSON.stringify([{ id: 'one', text: 'Frontend developer', description, hostedUrl: 'https://jobs.lever.co/example/one', workplaceType: 'remote' }])
  const out = parseSource(definition, body, task)
  assert.equal(out.jobs.length, 1)
  assert.equal(new URL(out.links[0].url).searchParams.get('skip'), '1')
  assert.deepEqual(out.links[0].context, { board: 'example', recurring: true })
  assert.equal(parseSource(definition, '[]', { ...task, url: out.links[0].url }).links.length, 0)
  assert.equal(parseSource(definition, body, { ...task, url: definition.url.replace('skip=0', 'skip=999') }).links.length, 0)
})

test('startup retires removed workers without deleting vacancies, marks, or provenance', () => {
  const directory = mkdtempSync(join(tmpdir(), 'jobfinder-retirement-')), path = join(directory, 'test.sqlite')
  let store = new Store(path)
  try {
    store.ingest({ items: [{ id: '123', name: 'Frontend developer', description, employer: { name: 'Example' }, area: { id: '1', name: 'Россия' }, alternate_url: 'https://hh.ru/vacancy/123', published_at: new Date().toISOString(), detail_fetched_at: new Date().toISOString(), work_format: [{ id: 'REMOTE', name: 'Удалённо' }] }] })
    store.workspace.mark('123', true)
    const before = store.db.prepare('SELECT * FROM vacancies').all(), origins = store.db.prepare('SELECT * FROM vacancy_origins').all()
    store.db.exec("INSERT INTO source_state(id,lease_until) VALUES ('remotive',9999999999999); INSERT INTO source_tasks(source_id,url,kind) VALUES ('remotive','https://remotive.com/api/remote-jobs','feed'); INSERT INTO source_boards VALUES ('remotive','https://remotive.com','test')")
    store.close(); store = new Store(path)
    assert.deepEqual(store.db.prepare('SELECT * FROM vacancies').all(), before)
    assert.deepEqual(store.db.prepare('SELECT * FROM vacancy_origins').all(), origins)
    assert.equal(store.workspace.list().total, 1)
    assert.equal(store.db.prepare("SELECT enabled,lease_until FROM source_state WHERE id='remotive'").get().enabled, 0)
    assert.equal(store.db.prepare("SELECT status FROM source_tasks WHERE source_id='remotive'").get().status, 'retired')
    assert.equal(store.sources.claim('remotive', 'test'), null)
    assert.equal(store.sources.tracks().some(track => track.id === 'remotive'), false)
    store.sources.enqueue('remotive', 'https://remotive.com/other', 'feed')
    assert.equal(store.count("SELECT count(*) count FROM source_tasks WHERE source_id='remotive'"), 1)
    assert.equal(store.count("SELECT count(*) count FROM source_boards WHERE source_id='remotive'"), 0)
  } finally { store.close(); rmSync(directory, { recursive: true }) }
})

test('board migration retires bulk requests, deduplicates case aliases, and preserves cooldowns', async t => {
  const store = new Store(':memory:'), runner = new SourceRunner(store)
  t.after(async () => { await runner.close(); store.close() })
  store.set('enabled', false)
  store.db.exec("INSERT INTO source_boards VALUES ('ashby','https://api.ashbyhq.com/posting-api/job-board/PostHog','PostHog'); INSERT INTO source_boards VALUES ('greenhouse','https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true','gitlab')")
  store.sources.enqueue('greenhouse', 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true', 'board', { board: 'gitlab', recurring: true })
  store.sources.enqueue('ashby', 'https://api.ashbyhq.com/posting-api/job-board/PostHog', 'board', { board: 'PostHog', recurring: true })
  const later = Date.now() + 600000
  store.db.prepare("UPDATE source_state SET next_at=?,last_status=403,last_error='Forbidden' WHERE id='greenhouse'").run(later)
  runner.start()
  assert.equal(store.count("SELECT count(*) count FROM source_boards WHERE source_id='ashby'"), 1)
  assert.equal(store.count("SELECT count(*) count FROM source_tasks WHERE source_id='greenhouse' AND status='pending'"), 1)
  assert.equal(store.count("SELECT count(*) count FROM source_tasks WHERE source_id='ashby' AND status='pending'"), 1)
  assert.equal(store.db.prepare("SELECT next_at FROM source_state WHERE id='greenhouse'").get().next_at, later)
  assert.equal(store.count("SELECT count(*) count FROM source_tasks WHERE status='superseded'"), 2)
})
