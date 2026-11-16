import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import { Store } from '../server/store.ts'
import { SourceRunner } from '../server/source-runner.ts'
import { sourcesApi } from '../server/sources-api.ts'
import { digest, normalizeUrl, originalIdentity, boardFromUrl } from '../server/source-identity.ts'
import { parseSource, allowedSourceUrl, workFormats } from '../server/source-adapters.ts'
import { sourceDefinitions } from '../src/lib/sources.ts'
import { defaultRemoteFilters } from '../src/lib/analytics.ts'
import { formatSalary } from '../src/lib/hh.ts'
import { recommendDevelopment } from '../src/lib/recommendations.ts'
import { retiredSourceFixtures } from './fixtures/retired-sources.mjs'

const definition = id => sourceDefinitions.find(source => source.id === id) || retiredSourceFixtures.find(source => source.id === id)
const description = 'Develop React and TypeScript web interfaces. Collaborate with the product team, maintain existing applications and improve their accessibility. This position is fully remote. Russian-speaking team.'
const job = (id = '1', extra = {}) => ({
  id, name: 'Frontend developer', alternate_url: `https://hh.ru/vacancy/${id}`,
  published_at: new Date().toISOString(), employer: { name: 'Example company' }, area: { id: 'external', name: 'Worldwide' },
  work_format: [{ id: 'REMOTE', name: 'Удалённо' }], description, key_skills: ['React', 'TypeScript'],
  detail_fetched_at: new Date().toISOString(), ...extra,
})
function database(t) { const store = new Store(':memory:'); t.after(() => store.close()); return store }
const task = (id, extra = {}) => ({ id: 1, source: id, url: definition(id).url, kind: 'feed', attempts: 0, context: {}, ...extra })
const parse = (id, data, extra) => parseSource(definition(id), typeof data === 'string' ? data : JSON.stringify(data), task(id, extra))
const ingest = store => items => store.ingest({ items })

test('identity removes tracking and recognizes hh mirrors and ATS application URLs', () => {
  assert.equal(normalizeUrl('https://EXAMPLE.com/a/?utm_source=x&b=2&a=1#apply'), 'https://example.com/a?a=1&b=2')
  assert.equal(normalizeUrl('javascript:alert(1)'), null)
  assert.equal(normalizeUrl('https://user:secret@example.com/a'), null)
  assert.deepEqual(originalIdentity('https://spb.hh.ru/vacancy/123?from=search').key, 'hh:123')
  assert.equal(originalIdentity('https://hh.kz/vacancy/123?utm_source=jobboard').id, '123')
  assert.equal(originalIdentity('https://hh.ru.evil.example/vacancy/123'), null)
  const uuid = 'bb3445f0-3e00-4221-a001-dc250c8a8170'
  assert.equal(originalIdentity(`https://jobs.lever.co/example/${uuid}/apply`).key, `lever:${uuid}`)
  assert.equal(originalIdentity('https://job-boards.greenhouse.io/example/jobs/123').key, 'greenhouse:123')
})

test('board discovery and task fetching cannot recurse into hh, private hosts or arbitrary domains', () => {
  for (const url of ['http://127.0.0.1/jobs', 'https://localhost/', 'https://jobs.ashbyhq.com.evil.example/company', 'https://hh.ru/vacancy/123']) assert.equal(boardFromUrl(url), null)
  assert.equal(boardFromUrl('https://jobs.ashbyhq.com/example/abc?utm_source=google').url, 'https://api.ashbyhq.com/posting-api/job-board/example')
  assert.equal(boardFromUrl('https://job-boards.greenhouse.io/example/jobs/123').source, 'greenhouse')
  assert.equal(boardFromUrl('https://jobs.eu.lever.co/example').url, 'https://api.eu.lever.co/v0/postings/example?mode=json&limit=1&skip=0')
  for (const url of ['https://hh.ru/vacancy/1', 'https://api.ashbyhq.com.evil.example/x', 'http://api.ashbyhq.com/x', 'https://api.ashbyhq.com:444/x', 'https://user:secret@api.ashbyhq.com/x']) assert.equal(allowedSourceUrl(definition('ashby'), url), false)
})

test('an aggregator pointing to hh records provenance without overwriting the original or manual actions', t => {
  const store = database(t)
  store.ingest({ items: [job('123')] }); store.workspace.mark('123', true)
  const before = store.db.prepare('SELECT * FROM vacancies').all()
  const counts = store.sources.accept('geekjob', [job(`geekjob:${digest('abc')}`, {
    alternate_url: 'https://geekjob.ru/vacancy/abcabcabcabc',
    source: { id: 'geekjob', name: 'Geekjob', url: 'https://geekjob.ru/vacancy/abcabcabcabc', originalUrl: 'https://hh.ru/vacancy/123?utm_source=geekjob' },
  })], ingest(store))
  assert.deepEqual(counts, { saved: 0, duplicates: 1, rejected: 0 })
  assert.deepEqual(store.db.prepare('SELECT * FROM vacancies').all(), before)
  assert.equal(store.sources.origins('123').length, 2)
  assert.equal(store.workspace.list().items[0].vacancy.id, '123')
  assert.equal(store.analytics(defaultRemoteFilters).totals.filtered, 0)
})

test('a job discovered before its hh link keeps its stable ID and processed mark when hh arrives', t => {
  const store = database(t), id = `habr:${digest('a')}`
  const first = job(id, { alternate_url: 'https://career.habr.com/vacancies/100', source: { id: 'habr', name: 'Habr', url: 'https://career.habr.com/vacancies/100' } })
  store.sources.accept('habr', [first], ingest(store)); store.workspace.mark(id, true)
  store.sources.accept('habr', [{ ...first, source: { ...first.source, originalUrl: 'https://hh.ru/vacancy/456' } }], ingest(store))
  const fromHh = job('456')
  store.ingest({ items: [fromHh] })
  assert.equal(store.count('SELECT count(*) count FROM vacancies'), 1)
  assert.equal(store.db.prepare('SELECT id FROM vacancies').get().id, id)
  assert.equal(store.workspace.list().items[0].vacancy.id, id)
  assert.equal(store.analytics(defaultRemoteFilters).totals.filtered, 0)
  assert.equal(store.detailFresh(fromHh), true)
})

test('exact company/title/body copies merge, while similar titles and unknown companies do not', t => {
  const store = database(t)
  const native = (id, extra = {}) => job(`geekjob:${digest(id)}`, { alternate_url: `https://geekjob.ru/vacancy/${id}`, ...extra })
  assert.equal(store.sources.accept('geekjob', [native('abc')], ingest(store)).saved, 1)
  assert.equal(store.sources.accept('budu', [native('def')], ingest(store)).duplicates, 1)
  assert.equal(store.sources.accept('budu', [native('ghi', { description: `${description} Different product and responsibilities.` })], ingest(store)).saved, 1)
  assert.equal(store.sources.accept('budu', [native('jkl', { employer: { name: 'Different company' } })], ingest(store)).saved, 1)
  assert.equal(store.sources.accept('budu', [native('mno', { employer: { name: 'Работодатель не указан' } }), native('pqr', { employer: { name: 'Работодатель не указан' } })], ingest(store)).saved, 2)
})

test('all external sources use the common full-description/remote/exclusion rules and atomic writes', t => {
  const store = database(t)
  const counts = store.sources.accept('habr', [job('1', { name: 'Sales manager' }), job('2', { work_format: [] }), job('3', { description: 'Too short' }), job('4', { name: 'Frontend developer' })], ingest(store))
  assert.deepEqual(counts, { saved: 1, duplicates: 0, rejected: 3 })
  assert.throws(() => store.sources.accept('habr', [job('5')], () => { throw new Error('Write failure') }), /Write failure/)
  assert.equal(store.db.isTransaction, false)
  assert.equal(store.sources.resolve(job('5')), '5')
  assert.equal(store.count('SELECT count(*) count FROM vacancies'), 1)
})

test('JSON adapters read full records, geographic restrictions, dates and ATS workplace types', () => {
  const himalayas = parse('himalayas', { jobs: [{ title: 'Frontend developer', description, guid: 'https://himalayas.app/companies/example/jobs/react', companyName: 'Example', locationRestrictions: ['Europe'], pubDate: 1793000000 }], nextCursor: 'abc' })
  assert.equal(himalayas.jobs[0].area.name, 'Europe')
  assert.equal(himalayas.jobs[0].date_estimated, false)
  assert.equal(himalayas.links.length, 1)
  assert.equal(parse('himalayas', { jobs: [], nextCursor: 'abc' }, { context: { depth: 29 } }).links.length, 0)
  const ashby = parse('ashby', { jobs: [{ id: 'one', title: 'Frontend developer', descriptionHtml: description, jobUrl: 'https://jobs.ashbyhq.com/example/one', isRemote: true }, { id: 'two', title: 'Hidden', isListed: false }] }, { context: { board: 'example' } })
  assert.equal(ashby.jobs.length, 1)
  assert.equal(ashby.jobs[0].work_format[0].id, 'REMOTE')
  assert.equal(ashby.jobs[0].date_estimated, true)
  const lever = parse('lever', [{ id: 'one', text: 'Frontend developer', description, hostedUrl: 'https://jobs.lever.co/example/one', workplaceType: 'hybrid', categories: { location: 'London' } }])
  assert.equal(lever.jobs[0].work_format[0].id, 'HYBRID')
  assert.throws(() => parse('remotive', { error: 'Access denied' }), /массив jobs/)
})

test('RSS parses attributed vacancies and preserves a raw salary without inventing monthly net pay', () => {
  const out = parse('wwr', `<rss><channel><item><title>Example: React developer</title><link>https://weworkremotely.com/remote-jobs/example</link><description><![CDATA[<p>${description}</p>]]></description><pubDate>Tue, 27 Oct 2026 12:00:00 GMT</pubDate><region>Europe only</region></item></channel></rss>`)
  assert.equal(out.jobs[0].employer.name, 'Example')
  assert.equal(out.jobs[0].name, 'React developer')
  assert.equal(out.jobs[0].area.name, 'Europe only')
  assert.equal(out.jobs[0].source.id, 'wwr')
  assert.equal(formatSalary({ ...out.jobs[0], salary_text: '$80,000/year' }), '$80,000/year')
  assert.throws(() => parse('wwr', '<html>blocked</html>'), /RSS/)
})

test('HTML indexes have bounded pagination and never follow an aggregator into hh', () => {
  const out = parse('habr', '<a href="/vacancies/100">One</a><a href="/vacancies/100?utm_source=a">Copy</a><a href="https://hh.ru/vacancy/123">hh</a><a href="/vacancies?page=2">Next</a><a href="/vacancies?page=9">Far</a>', { kind: 'index' })
  assert.deepEqual(out.links.map(item => item.url), ['https://career.habr.com/vacancies/100', 'https://career.habr.com/vacancies?page=2'])
  assert.throws(() => parse('habr', '<title>Just a moment...</title>', { kind: 'index' }), /капчу/)
  assert.equal(parse('getmatch', '<html>No jobs</html>', { kind: 'index', url: 'https://getmatch.ru/vacancies' }).links[0].url, 'https://getmatch.ru/sitemap.xml')
  const sitemap = parse('getmatch', '<urlset><url><loc>https://getmatch.ru/vacancies/1-frontend</loc></url><url><loc>https://getmatch.ru/vacancies/3-backend</loc></url><url><loc>https://hh.ru/vacancy/123</loc></url><url><loc>https://getmatch.ru/companies/example</loc></url></urlset>')
  assert.deepEqual(sitemap.links.map(item => item.url), ['https://getmatch.ru/vacancies/3-backend', 'https://getmatch.ru/vacancies/1-frontend'])
})

test('JSON-LD details only use original links from job content or apply buttons, not unrelated recommendations', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Frontend developer', description, jobLocationType: 'TELECOMMUTE', hiringOrganization: { name: 'Example' }, baseSalary: { currency: 'USD', value: { minValue: 80000, unitText: 'YEAR' } } })}</script><aside><a href="https://hh.ru/vacancy/999">Other job</a></aside>`
  const first = parse('habr', html, { kind: 'detail', url: 'https://career.habr.com/vacancies/100' }).jobs[0]
  assert.equal(first.source.originalUrl, undefined)
  assert.equal(first.salary_range.mode.id, 'YEAR')
  assert.equal(first.salary_range.gross, null)
  const linked = parse('habr', html + '<a href="https://hh.ru/vacancy/123?utm_source=habr">Откликнуться</a>', { kind: 'detail', url: 'https://career.habr.com/vacancies/100' }).jobs[0]
  assert.equal(linked.id, '123')
  const closed = html.replace('"title":', '"validThrough":"2020-01-01","title":')
  assert.equal(parse('habr', closed, { kind: 'detail', url: 'https://career.habr.com/vacancies/100' }).jobs.length, 0)
})

test('source seniority is retained separately and excludes senior jobs with generic titles from the personal shortlist', () => {
  const body = `<h1>Frontend developer</h1><div>УровеньSeniorТребуемый опыт3+ лет</div><div class="b-vacancy-description">${description}</div>`
  const parsed = parse('getmatch', body, { kind: 'detail', url: 'https://getmatch.ru/vacancies/123-frontend' }).jobs[0]
  assert.equal(parsed.name, 'Frontend developer')
  assert.equal(parsed.professional_level, 'Senior')
  assert.equal(recommendDevelopment(parsed).matched, false)
  assert.equal(recommendDevelopment({ ...parsed, professional_level: 'Junior' }).matched, true)
})

test('same-source refresh updates metadata, preserves unknown publication dates and removes newly office-only jobs without deleting history', t => {
  const store = database(t), id = `habr:${digest('refresh')}`
  const first = job(id, { alternate_url: 'https://career.habr.com/vacancies/100', date_estimated: true })
  store.sources.accept('habr', [first], ingest(store)); store.workspace.mark(id, true)
  store.sources.accept('habr', [{ ...first, published_at: '2030-01-01T00:00:00Z', professional_level: 'Middle' }], ingest(store))
  const saved = JSON.parse(store.db.prepare('SELECT payload FROM vacancies WHERE id=?').get(id).payload)
  assert.equal(saved.professional_level, 'Middle')
  assert.equal(saved.published_at, first.published_at)
  store.sources.accept('habr', [{ ...first, work_format: [] }], ingest(store))
  assert.equal(store.count('SELECT count(*) count FROM vacancies'), 0)
  assert.equal(store.workspace.list().total, 1)
})

test('Telegram reads only public job posts, keeps original hh identity and requires explicit remote format', () => {
  const post = text => `<div class="tgme_widget_message"><div class="tgme_widget_message_text">${text}</div><a class="tgme_widget_message_date" href="https://t.me/job_react/123"><time datetime="2026-10-27T12:00:00Z"></time></a></div>`
  const out = parse('tg-react', post(`Вакансия: Frontend developer<br>Компания: Example<br>${description}<br><a href="https://hh.ru/vacancy/456">Вакансия</a>`))
  assert.equal(out.jobs[0].id, '456')
  assert.equal(out.jobs[0].source.url, 'https://t.me/job_react/123')
  const unknown = parse('tg-react', post('Вакансия: Frontend developer<br>Разрабатывать интерфейсы и поддерживать приложения на React. Формат не указан.'))
  assert.deepEqual(unknown.jobs[0].work_format, [])
  assert.equal(parse('tg-react', post('Стоимость размещения вакансии: пишите администратору.')).jobs.length, 0)
})

test('work format requires evidence and hybrid stays separate even when remote is also mentioned', () => {
  assert.deepEqual(workFormats('Office position in Berlin'), [])
  assert.deepEqual(workFormats('No remote, on-site only'), [])
  assert.equal(workFormats('Remote with hybrid office schedule')[0].id, 'HYBRID')
  assert.equal(workFormats('Полная удалёнка, приезжать в офис два раза в неделю')[0].id, 'HYBRID')
})

test('source leases are shared between processes, limited to three and paced by host', t => {
  const directory = mkdtempSync(join(tmpdir(), 'jobfinder-sources-'))
  const file = join(directory, 'test.sqlite'), first = new Store(file), second = new Store(file)
  t.after(() => { first.close(); second.close(); rmSync(directory, { recursive: true }) })
  for (const id of ['wwr', 'habr', 'geekjob', 'ashby']) first.sources.enqueue(id, definition(id).url, 'feed')
  assert.ok(first.sources.claim('wwr', 'one'))
  assert.equal(second.sources.claim('wwr', 'two'), null)
  assert.ok(second.sources.claim('habr', 'two'))
  assert.ok(first.sources.claim('geekjob', 'one'))
  assert.equal(second.sources.claim('ashby', 'two'), null)
  first.db.exec("UPDATE source_state SET lease_until=0; DELETE FROM source_hosts")
  first.sources.enqueue('ashby', 'https://api.ashbyhq.com/posting-api/job-board/another', 'board')
  assert.ok(first.sources.claim('ashby', 'one'))
  first.db.prepare("UPDATE source_state SET lease_until=0 WHERE id='ashby'").run()
  assert.equal(second.sources.claim('ashby', 'two'), null, 'A released lease must still respect the shared host pace')
})

test('rediscovery does not reset retries, and restarting preserves tasks, source pause and events', t => {
  const store = database(t), id = 'wwr', url = definition(id).url
  store.sources.enqueue(id, url, 'feed')
  store.db.prepare('UPDATE source_tasks SET due=?,attempts=3').run(Date.now() + 3600000)
  const before = store.db.prepare('SELECT due,attempts FROM source_tasks').get()
  store.sources.enqueue(id, url, 'feed')
  assert.deepEqual(store.db.prepare('SELECT due,attempts FROM source_tasks').get(), before)
  store.db.prepare('UPDATE source_state SET enabled=0 WHERE id=?').run(id)
  assert.equal(store.sources.claim(id, 'one'), null)
  assert.equal(store.sources.tracks().find(item => item.id === id).phase, 'paused')
  store.sources.event(id, 'Saved event')
  assert.equal(store.db.prepare('SELECT message FROM source_events').get().message, 'Saved event')
})

test('a blocked source backs off without stopping other sources, and global pause sends no requests', async t => {
  const store = new Store(':memory:'), runner = new SourceRunner(store)
  t.after(async () => { await runner.close(); store.close() })
  store.sources.enqueue('wwr', definition('wwr').url, 'feed')
  store.sources.enqueue('ashby', definition('ashby').url, 'board', { board: 'example' })
  const requests = []
  t.mock.method(globalThis, 'fetch', async url => {
    requests.push(url)
    return url.includes('weworkremotely') ? new Response('Limited', { status: 429, headers: { 'Retry-After': '1800' } }) : Response.json({ jobs: [] })
  })
  store.set('enabled', false); await runner.tick()
  assert.deepEqual(requests, [])
  store.set('enabled', true); await runner.tick()
  for (let i = 0; i < 20 && store.count('SELECT count(*) count FROM source_events') < 2; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests.length, 2)
  const limited = store.db.prepare("SELECT * FROM source_state WHERE id='wwr'").get()
  assert.equal(limited.last_status, 429)
  assert.ok(limited.next_at >= Date.now() + 1799000)
  assert.equal(store.db.prepare("SELECT last_error FROM source_state WHERE id='ashby'").get().last_error, null)
  assert.equal(store.get('blockedUntil', 0), 0, 'External failure must not block hh')
  assert.equal(store.count('SELECT count(*) count FROM source_state WHERE lease_until>0'), 0)
})

test('endpoint changes retry fixed HTTP 200 parse errors while preserving access and network cooldowns', async t => {
  const store = new Store(':memory:'), runner = new SourceRunner(store)
  t.after(async () => { await runner.close(); store.close() })
  store.set('enabled', false)
  const later = Date.now() + 3600000
  store.db.prepare("UPDATE source_state SET next_at=?,last_status=200,last_error='Old page schema' WHERE id='getmatch'").run(later)
  store.db.prepare("UPDATE source_state SET next_at=?,last_status=403,last_error='Access denied' WHERE id='wwr'").run(later)
  store.db.prepare("UPDATE source_state SET next_at=?,last_status=200,last_error='Источник запросил проверку доступа / капчу' WHERE id='habr'").run(later)
  runner.start()
  assert.equal(store.db.prepare("SELECT next_at FROM source_state WHERE id='getmatch'").get().next_at, 0)
  assert.equal(store.db.prepare("SELECT next_at FROM source_state WHERE id='wwr'").get().next_at, later)
  assert.equal(store.db.prepare("SELECT next_at FROM source_state WHERE id='habr'").get().next_at, later)
  store.db.prepare("UPDATE source_state SET next_at=? WHERE id='getmatch'").run(later)
  runner.start()
  assert.equal(store.db.prepare("SELECT next_at FROM source_state WHERE id='getmatch'").get().next_at, later, 'Unchanged endpoints must not reset pauses on restart')
})

test('source redirects into another website are stopped after one request without crawling hh', async t => {
  const store = new Store(':memory:'), runner = new SourceRunner(store)
  t.after(async () => { await runner.close(); store.close() })
  store.sources.enqueue('wwr', definition('wwr').url, 'feed')
  const requests = []
  t.mock.method(globalThis, 'fetch', async url => { requests.push(url); return new Response(null, { status: 302, headers: { Location: 'https://hh.ru/vacancy/123' } }) })
  await runner.tick()
  for (let i=0; i<20 && !store.count('SELECT count(*) count FROM source_events'); i++) await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(requests, [definition('wwr').url])
  assert.match(store.db.prepare("SELECT last_error FROM source_state WHERE id='wwr'").get().last_error, /другой источник/)
})

async function request(collector, path, { method = 'GET', body = '', headers = {} } = {}) {
  const req = Readable.from([Buffer.from(body)]); req.method = method; req.headers = { host: 'localhost:5173', ...headers }
  const result = { headers: {} }, res = { setHeader(key, value) { result.headers[key] = value }, writeHead(status) { result.status = status; return this }, end(body) { result.body = JSON.parse(body) } }
  await sourcesApi(req, res, new URL(path, 'http://localhost:5173'), collector)
  return result
}
test('sources API exposes real counters, independently pauses tracks and validates career board mutations', async t => {
  const store = database(t), collector = { store, sources: new SourceRunner(store) }
  t.after(() => collector.sources.close())
  const post = (path, data, headers = {}) => request(collector, path, { method: 'POST', body: JSON.stringify(data), headers: { 'content-type': 'application/json', ...headers } })
  const state = await request(collector, '/api/sources')
  assert.equal(state.body.tracks.length, sourceDefinitions.length + 1)
  assert.equal((await post('/api/sources/habr', { enabled: false })).status, 200)
  assert.equal(store.sources.tracks().find(item => item.id === 'habr').enabled, false)
  assert.equal(store.get('hhEnabled', true), true)
  assert.equal((await post('/api/sources/hh', { enabled: false })).status, 200)
  assert.equal(store.get('hhEnabled', true), false)
  assert.equal((await post('/api/sources/habr', { enabled: true }, { origin: 'https://evil.example' })).status, 403)
  assert.equal((await post('/api/sources/habr', { enabled: 'true' })).status, 400)
  assert.equal((await post('/api/sources/boards', { url: 'http://localhost/private' })).status, 400)
  assert.equal((await post('/api/sources/boards', { url: 'https://jobs.ashbyhq.com/example/123' })).status, 200)
  assert.equal(store.count('SELECT count(*) count FROM source_boards'), 1)
  assert.equal((await post('/api/sources/boards', { url: 'https://jobs.ashbyhq.com/example' })).status, 200)
  assert.equal(store.count('SELECT count(*) count FROM source_tasks'), 1)
})

test('explicit reset waits for external requests, preserves personal marks/boards and requeues recurring sources', t => {
  const directory = mkdtempSync(join(tmpdir(), 'jobfinder-source-reset-')), file = join(directory, 'test.sqlite')
  const store = new Store(file)
  t.after(() => { store.close(); rmSync(directory, { recursive: true }) })
  const id = `habr:${digest('marked')}`
  store.sources.accept('habr', [job(id, { alternate_url: 'https://career.habr.com/vacancies/100', source: { id: 'habr', name: 'Habr', url: 'https://career.habr.com/vacancies/100', originalUrl: 'https://hh.ru/vacancy/123' } })], ingest(store))
  const actualId = store.db.prepare('SELECT id FROM vacancies').get().id
  store.workspace.mark(actualId, true)
  store.ingest({ items: [job('999', { description: description + ' Another job.' })] })
  store.sources.enqueue('wwr', definition('wwr').url, 'feed', { recurring: true })
  store.sources.enqueue('habr', 'https://career.habr.com/vacancies/200', 'detail')
  store.db.exec("UPDATE source_tasks SET status='done'; INSERT INTO source_boards VALUES ('ashby','https://api.ashbyhq.com/posting-api/job-board/example','example')")
  store.db.prepare("UPDATE source_state SET lease_until=? WHERE id='wwr'").run(Date.now()+60000)
  const reset = () => spawnSync(process.execPath, ['scripts/reset-data.mjs', '--paused'], { env: { ...process.env, JOBFINDER_DB: file }, encoding: 'utf8' })
  assert.equal(reset().status, 1)
  assert.equal(store.count('SELECT count(*) count FROM vacancies'), 2)
  store.db.exec('UPDATE source_state SET lease_until=0')
  const result = reset()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(store.count('SELECT count(*) count FROM vacancies'), 0)
  assert.equal(store.workspace.list().total, 1)
  assert.equal(store.count('SELECT count(*) count FROM source_boards'), 1)
  assert.equal(store.count('SELECT count(*) count FROM source_tasks'), 1)
  assert.equal(store.db.prepare('SELECT status FROM source_tasks').get().status, 'pending')
  assert.equal(store.get('enabled', true), false)
  store.ingest({ items: [job('123')] })
  assert.equal(store.analytics(defaultRemoteFilters).totals.filtered, 0, 'Rediscovered processed jobs must stay hidden')
})
