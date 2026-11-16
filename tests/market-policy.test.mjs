import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { Store } from '../server/store.ts'
import { classifyMarket } from '../src/lib/market-policy.ts'
import { rejectionFor } from '../server/selection.ts'
import { defaultRemoteFilters } from '../src/lib/analytics.ts'
import { parseSource } from '../server/source-adapters.ts'
import { sourceDefinitions } from '../src/lib/sources.ts'

const russian = 'Разработка интерфейсов на React и TypeScript. Работа с командой, документацией и API. Удалённый формат, согласование задач с менеджером.'
const english = 'Build React web interfaces, collaborate with our product team and improve application accessibility. This role is fully remote and has no office requirements.'
const job = (body = russian, extra = {}) => ({
  id: '101', name: 'Frontend developer', description: body, detail_fetched_at: new Date().toISOString(),
  published_at: new Date().toISOString(), alternate_url: `https://hh.ru/vacancy/${extra.id || '101'}`, employer: { name: 'Компания' }, area: { id: '1', name: 'Москва' },
  key_skills: ['React', 'TypeScript'], work_format: [{ id: 'REMOTE', name: 'Удалённо' }], ...extra,
})
const decision = (text, extra) => classifyMarket(job(text, extra))

test('Russian descriptions and Russian working environments qualify; a Russian title, city or platform alone does not', () => {
  assert.equal(decision(russian).eligible, true)
  assert.equal(decision(`${english} Russian-speaking team.`).eligible, true)
  assert.equal(decision(`${english} Our working language is Russian.`).eligible, true)
  assert.equal(decision(`${english} Fluent Russian required.`).eligible, true)
  for (const extra of [{}, { name: 'Разработчик интерфейсов' }, { employer: { name: 'Русская компания' } }, { area: { id: '1', name: 'Москва' } }]) assert.equal(decision(english, extra).reason, 'communication')
  assert.equal(rejectionFor(job(english), false), null, 'Search snippets wait for full description verification')
  assert.equal(rejectionFor(job(english), true), 'communication')
})

test('foreign working communication is rejected while English documentation skills and negated requirements are allowed', () => {
  for (const text of [
    `${russian} Рабочий язык — английский.`,
    `${russian} Язык общения: английский.`,
    `${russian} Ежедневная коммуникация на английском.`,
    `${russian} Общение с командой на английском.`,
    `${english} English-speaking team and Russian-speaking clients.`,
  ]) assert.equal(decision(text).reason, 'communication', text)
  for (const text of [
    `${russian} Английский B2 для чтения документации.`,
    `${russian} Знание английского будет плюсом.`,
    `${russian} Не требуется общение с командой на английском.`,
    `${russian} Команда общается на русском, документация на английском.`,
  ]) assert.equal(decision(text).eligible, true, text)
  assert.equal(decision(`${english} No Russian required.`).reason, 'communication')
  assert.equal(decision(`${english} Native Russian is not required.`).reason, 'communication')
})

test('explicit restrictions on Russia override Russian language and worldwide remote claims', () => {
  for (const text of [
    'Работать из России нельзя.', 'Работа из РФ невозможна.', 'Не рассматриваем кандидатов из РФ.',
    'Удалённо из любой страны, кроме России.', 'Нужно находиться вне РФ.',
    'Сотрудник должен проживать за пределами России.', 'Мы не работаем с кандидатами из России.',
    'Remote worldwide except Russia.', 'Worldwide, except for Russia.', 'Must be based outside Russia.',
    'We cannot hire from Russia.', 'Russia is not supported.',
  ]) assert.equal(decision(`${russian}\n${text}`).reason, 'russia_restricted', text)
})

test('required foreign residence and country whitelists exclude jobs without confusing markets or headquarters with candidate location', () => {
  for (const text of [
    'Локация: Польша.', 'География: EU only.', 'Работа только из Германии.',
    'Обязательно проживание в Сербии.', 'Кандидаты только из Армении.',
    'You must be based in the United States.', 'Remote only within UK.',
    'Только резиденты ЕС.', 'Проживание в Германии обязательно.',
    'Обязательная релокация в Сербию.', 'Работа только за рубежом.',
    'Локация: EU, работа по московскому времени.',
  ]) assert.equal(decision(`${russian}\n${text}`).reason, 'russia_restricted', text)
  for (const text of [
    'Локация: любая; работа по московскому времени.', 'Локация: Удмуртская Республика.',
    'Локация: БЦ Сидней Сити, ул. Шмитовский проезд, Москва.',
    'Работа исключительно в чатах с готовой базой.', 'Работа только с клиентами США.',
    'Наша компания находится в Сербии. Работать можно из России.',
    'Наши продукты востребованы за пределами России.', 'Наши клиенты находятся вне России.',
    'Работа на территории РФ, так как отправка украшений за пределы РФ не предусмотрена.',
    'Не требуется находиться за пределами РФ.', 'Нет необходимости находиться за пределами России.',
    'Требуется нахождение в часовом поясе UTC+3.',
    'Не обязательно проживание в ЕС.', 'Релокация в Сербию не требуется.',
    'Удалённый формат, в том числе возможность работать за пределами России.',
    'Возможность удалённой работы вне РФ.', 'Мы масштабируем бизнес в том числе за пределами РФ.',
    'Уже 40% наших сотрудников работает за пределами РФ.',
  ]) assert.equal(decision(`${russian}\n${text}`).eligible, true, text)
})

test('structured applicant countries are enforced, but country of an employer or timezone alone is not a ban', () => {
  for (const applicant_locations of [['US'], ['United States', 'Canada'], ['EU', 'EEA'], ['Poland'], ['Worldwide except Russia']]) assert.equal(decision(russian, { applicant_locations }).reason, 'russia_restricted', applicant_locations.join(','))
  for (const applicant_locations of [[], ['Russia'], ['RU', 'Germany'], ['Worldwide'], ['СНГ'], ['EMEA'], ['Europe'], ['UTC+3']]) assert.equal(decision(russian, { applicant_locations }).eligible, true, applicant_locations.join(','))
  assert.equal(decision(russian, { applicant_locations: ['Worldwide'], excluded_locations: ['RU'] }).reason, 'russia_restricted')
  assert.equal(decision(russian, { area: { id: 'external', name: 'Ереван' } }).eligible, true)
  assert.equal(decision(russian, { source: { id: 'remotive' }, area: { id: 'external', name: 'United States' } }).reason, 'russia_restricted', 'Legacy public API locations still apply')
})

test('all ingestion paths reject new ineligible vacancies before saving full payloads', t => {
  const store = new Store(':memory:'); t.after(() => store.close())
  store.ingest({ items: [job(english), job(`${russian} Работа только из Германии.`, { id: '102' }), job(russian, { id: '103' })] })
  assert.deepEqual(store.db.prepare('SELECT id FROM vacancies').all().map(row => row.id), ['103'])
  const accept = items => store.ingest({ items })
  const result = store.sources.accept('ashby', [job(english, { id: '104' }), job(`${english} Russian-speaking team.`, { id: '105', applicant_locations: ['US'] }), job(`${english} Russian-speaking team.`, { id: '106', applicant_locations: ['Russia'] })], accept)
  assert.deepEqual(result, { saved: 1, rejected: 2, duplicates: 0 })
  assert.equal(store.analytics(defaultRemoteFilters).totals.filtered, 2)
})

test('migration hides legacy jobs from every active view and metric without changing jobs, discovery dates, skills or personal history', t => {
  const directory = mkdtempSync(join(tmpdir(), 'jobfinder-market-')), path = join(directory, 'test.sqlite')
  t.after(() => rmSync(directory, { recursive: true }))
  let store = new Store(path)
  const items = [job(russian, { id: '1' }), job(russian, { id: '2', employer: { name: 'Foreign employer' }, key_skills: ['Docker'], salary_range: { from: 999999, to: null, gross: false, currency: 'RUR', mode: { id: 'MONTH', name: 'За месяц' } } }), job(russian, { id: '3' })]
  store.ingest({ items }); store.workspace.mark('3', true)
  // Simulate the previous collector's already saved full English announcement.
  const legacy = JSON.parse(store.db.prepare("SELECT payload FROM vacancies WHERE id='2'").get().payload)
  legacy.description = english
  store.db.prepare("UPDATE vacancies SET payload=? WHERE id='2'").run(JSON.stringify(legacy))
  store.db.exec("DELETE FROM vacancy_market; DELETE FROM meta WHERE key='marketPolicyVersion'")
  const snapshot = () => ['vacancies', 'vacancy_skills', 'vacancy_groups', 'vacancy_formats', 'vacancy_actions'].map(table => store.db.prepare(`SELECT * FROM ${table}`).all())
  const before = snapshot()
  store.close(); store = new Store(path)
  try {
    assert.deepEqual(snapshot(), before)
    for (const patch of [{}, { priority: 'any' }, { priority: 'web' }, { recommendation: 'development' }]) {
      const result = store.analytics({ ...defaultRemoteFilters, ...patch })
      assert.deepEqual(result.recent.map(item => item.id), ['1'])
      assert.equal(result.totals.filtered, 1)
      assert.equal(result.remote.available, 1)
      assert.equal(result.totals.salaryCount, 0)
      assert.equal(result.local.tools.some(item => item.name === 'Docker'), false)
      assert.equal(result.marketPolicy.hidden, 1)
      assert.equal(result.totals.stored, 3)
    }
    assert.equal(store.workspace.list().total, 1)
    assert.deepEqual(snapshot(), before)
    // A subsequent denial still cannot erase the legacy payload or its skills.
    store.ingest({ items: [job(english, { id: '2' })] })
    assert.deepEqual(snapshot(), before)
  } finally { store.close() }
})

test('source refreshes can hide and later re-enable the same vacancy while preserving processed marks and stable identity', t => {
  const store = new Store(':memory:'); t.after(() => store.close())
  const accept = items => store.ingest({ items })
  store.sources.accept('habr', [job(russian)], accept)
  store.workspace.mark('101', true)
  const before = store.db.prepare('SELECT * FROM vacancies').all()
  store.sources.accept('habr', [job(`${russian} Работа только из Германии.`)], accept)
  assert.deepEqual(store.db.prepare('SELECT * FROM vacancies').all(), before)
  assert.equal(store.marketPolicy.stats().hidden, 1)
  store.marketPolicy.refresh(true)
  assert.equal(store.marketPolicy.stats().hidden, 1, 'An old preserved payload must not undo a fresh denial during migration')
  store.sources.accept('habr', [job(russian)], accept)
  assert.equal(store.marketPolicy.stats().included, 1)
  assert.equal(store.workspace.list().total, 1)
  assert.equal(store.analytics(defaultRemoteFilters).totals.filtered, 0)
})

test('merging a Russian duplicate cannot erase known country restrictions from the original job', t => {
  const store = new Store(':memory:'); t.after(() => store.close())
  store.ingest({ items: [job(russian, { source: { id: 'ashby', name: 'Ashby', url: 'https://jobs.ashbyhq.com/example/123' }, applicant_locations: ['Russia'] })] })
  // A legacy/full update identifies that the role was limited to the US.
  const previous = JSON.parse(store.db.prepare('SELECT payload FROM vacancies').get().payload)
  previous.applicant_locations = ['US']
  store.db.prepare('UPDATE vacancies SET payload=?').run(JSON.stringify(previous)); store.marketPolicy.refresh(true)
  store.ingest({ items: [job(russian)] })
  assert.equal(store.marketPolicy.stats().hidden, 1)
  assert.equal(store.analytics(defaultRemoteFilters).totals.filtered, 0)
  assert.equal(store.count('SELECT count(*) count FROM vacancies'), 1)
})

test('API and JSON-LD adapters preserve explicit candidate geography separately from a company city', () => {
  const source = sourceDefinitions.find(item => item.id === 'himalayas')
  const out = parseSource(source, JSON.stringify({ jobs: [{ title: 'Frontend developer', description: russian, guid: 'https://himalayas.app/companies/example/jobs/frontend', companyName: 'Example', locationRestrictions: ['United States'], timezoneRestrictions: ['UTC-5'] }] }), { id: 1, kind: 'feed', url: source.url, context: {} })
  assert.deepEqual(out.jobs[0].applicant_locations, ['United States'])
  assert.equal(classifyMarket(out.jobs[0]).reason, 'russia_restricted')
  const habr = sourceDefinitions.find(item => item.id === 'habr')
  const body = `<script type="application/ld+json">${JSON.stringify({ '@type': 'JobPosting', title: 'Frontend developer', description: russian, jobLocationType: 'TELECOMMUTE', applicantLocationRequirements: [{ '@type': 'Country', name: 'Germany' }] })}</script>`
  const html = parseSource(habr, body, { kind: 'detail', url: 'https://career.habr.com/vacancies/100', context: {} })
  assert.deepEqual(html.jobs[0].applicant_locations, ['Germany'])
  assert.equal(classifyMarket(html.jobs[0]).reason, 'russia_restricted')
})

test('manual data recheck preserves a fresh geographic denial over an older archived payload', t => {
  const directory = mkdtempSync(join(tmpdir(), 'jobfinder-market-recheck-')), path = join(directory, 'test.sqlite')
  const store = new Store(path)
  t.after(() => { store.close(); rmSync(directory, { recursive: true }) })
  store.set('enabled', false)
  store.ingest({ items: [job(russian)] }); store.workspace.mark('101', true)
  store.ingest({ items: [job(`${russian} Работа только из Германии.`)] })
  const firstSeen = store.db.prepare('SELECT first_seen FROM vacancies').get().first_seen
  const result = spawnSync(process.execPath, ['scripts/recheck-data.mjs'], { env: { ...process.env, JOBFINDER_DB: path }, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(store.marketPolicy.stats().hidden, 1)
  assert.equal(store.count('SELECT count(*) count FROM vacancies'), 1)
  assert.equal(store.db.prepare('SELECT first_seen FROM vacancies').get().first_seen, firstSeen)
  assert.equal(store.workspace.list().total, 1)
})
