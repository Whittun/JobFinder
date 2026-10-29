import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { formatSalary, summarize } from '../src/lib/hh.ts'
import { hhApi } from '../server/hh.ts'
import { parseSearchPage } from '../server/hh-page.ts'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/hh-search.json', import.meta.url), 'utf8'))
const page = state => `<html><template class="state" id="HH-Lux-InitialState">${JSON.stringify(state)}</template></html>`
const sourceUrl = 'https://hh.ru/search/vacancy?text=C%2B%2B'

test('public page maps salaries, dates, experience and multiple work formats without exposing raw state', () => {
  const result = parseSearchPage(page(fixture), sourceUrl)
  assert.equal(result.found, 40)
  assert.deepEqual(result.items.map(item => item.id), ['102', '101'])
  const vacancy = result.items[1]
  assert.equal(vacancy.name, 'Разработчик C++ & React')
  assert.equal(vacancy.employer.name, 'Компания & Co')
  assert.equal(vacancy.area.name, 'Москва')
  assert.equal(vacancy.experience.name, 'От 1 года до 3 лет')
  assert.deepEqual(vacancy.work_format.map(format => format.id), ['REMOTE', 'HYBRID'])
  assert.equal(result.items[0].salary_range.from, 1250)
  assert.match(formatSalary(result.items[0]), /за час.*до вычета налогов/)
  assert.equal(result.clusters.find(cluster => cluster.id === 'experience').items[0].count, 25)
  assert.equal(result.clusters.some(cluster => cluster.id === 'area'), false)
  assert.equal(result.sourceUrl, sourceUrl)
  assert.equal(JSON.stringify(result).includes('not-for-the-client'), false)
})

test('HTML entities are decoded once, raw JSON entities and Cyrillic remain intact', () => {
  const modified = structuredClone(fixture)
  modified.vacancySearchResult.vacancies[0].name = 'C++ & React &amp; «аналитика»'
  const raw = page(modified)
  const encoded = raw.replace(/(?<=<template[^>]*>)[\s\S]*(?=<\/template>)/, value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
  for (const html of [raw, encoded]) {
    assert.equal(parseSearchPage(html, sourceUrl).items[1].name, modified.vacancySearchResult.vacancies[0].name)
  }
})

test('empty search, missing optional fields and duplicated cards are handled separately', () => {
  const modified = structuredClone(fixture)
  const raw = modified.vacancySearchResult.vacancies[0]
  delete raw.compensation
  delete raw.workFormats
  delete raw.company
  modified.vacancySearchResult.vacancies.push(raw)
  const parsed = parseSearchPage(page(modified), sourceUrl)
  assert.equal(parsed.items.length, 2)
  assert.equal(parsed.items[1].salary_range, null)
  assert.deepEqual(parsed.items[1].work_format, [])
  assert.equal(parsed.items[1].employer.name, 'Работодатель не указан')
  assert.equal(parseSearchPage(page({ vacancySearchResult: { totalResults: 0, vacancies: [] } }), sourceUrl).found, 0)
})

test('captcha, changed schemas and inconsistent results never become empty successful data', () => {
  assert.throws(() => parseSearchPage('<html>captcha</html>', sourceUrl), /проверку доступа/)
  assert.throws(() => parseSearchPage('<html>new format</html>', sourceUrl), /формат страницы/)
  assert.throws(() => parseSearchPage(page({ vacancySearchResult: {} }), sourceUrl), /ожидаемых результатов/)
  assert.throws(() => parseSearchPage(page({ vacancySearchResult: { totalResults: 2, vacancies: [] } }), sourceUrl), /не передал карточки/)
  const modified = structuredClone(fixture)
  modified.vacancySearchResult.vacancies[0].publicationTime = {}
  assert.throws(() => parseSearchPage(page(modified), sourceUrl), /карточек вакансий/)
})

function vacancy(id, salary, modern = true, employer = '1') {
  return { id, employer: { id: employer, name: `Компания ${employer}` }, [modern ? 'salary_range' : 'salary']: salary }
}
const monthly = { from: 100_000, to: 150_000, currency: 'RUR', gross: false, mode: { id: 'MONTH', name: 'За месяц' } }

test('salary statistics exclude gross, other currencies, hourly and unknown periods', () => {
  const items = [
    vacancy('1', monthly), vacancy('2', { ...monthly, from: 200_000 }, true, '2'),
    vacancy('3', { ...monthly, gross: true }), vacancy('4', { ...monthly, currency: 'USD' }),
    vacancy('5', { ...monthly, mode: { id: 'HOUR', name: 'За час' } }),
    vacancy('6', { ...monthly, mode: undefined }), vacancy('7', { ...monthly, gross: null }),
    vacancy('8', null), vacancy('9', { ...monthly, from: null }),
  ]
  assert.deepEqual(summarize({ items, found: 10_000 }), { withSalary: 8, employers: 2, medianLower: 150_000, salaryCount: 2 })
  assert.equal(summarize({ items: [vacancy('10', { ...monthly, from: 0 }, false)] }).medianLower, 0)
  assert.equal(summarize({ items: [] }).medianLower, null)
  assert.equal(formatSalary(vacancy('11', null)), 'Зарплата не указана')
})

function endpoint() {
  let middleware
  hhApi().configureServer({ middlewares: { use(fn) { middleware = fn } } })
  return async (url = '/api/hh/vacancies', method = 'GET') => {
    const result = { headers: {}, next: false }
    const res = {
      setHeader(key, value) { result.headers[key] = value },
      writeHead(status) { result.status = status; return this },
      end(body) { result.body = JSON.parse(body) },
    }
    await middleware({ url, method }, res, () => { result.next = true })
    return result
  }
}

test('server uses public search without credentials, translates filters, deduplicates and caches requests', async t => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls++
    const target = new URL(url)
    assert.equal(target.origin, 'https://hh.ru')
    assert.equal(target.pathname, '/search/vacancy')
    assert.equal(target.searchParams.get('text'), 'C++ & React')
    assert.equal(target.searchParams.get('area'), '1')
    assert.equal(target.searchParams.get('search_period'), '7')
    assert.equal(target.searchParams.get('items_on_page'), '100')
    assert.equal(target.searchParams.get('order_by'), 'publication_time')
    assert.equal(options.headers.Authorization, undefined)
    assert.equal(options.headers.Cookie, undefined)
    return new Response(page(fixture))
  })
  const get = endpoint()
  const path = '/api/hh/vacancies?area=1&period=7&text=C%2B%2B+%26+React'
  const results = await Promise.all([get(path), get(path)])
  const cached = await get(path)
  assert.equal(calls, 1)
  assert.equal(cached.status, 200)
  assert.equal(cached.body.found, 40)
  assert.equal(cached.body.fetchedAt, results[0].body.fetchedAt)
})

test('access refusal and rate limit pause repeated requests without demanding an API token', async t => {
  for (const status of [403, 429]) {
    let calls = 0
    t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('private upstream details', { status }) })
    const get = endpoint()
    const result = await get()
    assert.equal(result.status, status)
    assert.equal(JSON.stringify(result).includes('private upstream details'), false)
    assert.equal(JSON.stringify(result).includes('HH_ACCESS_TOKEN'), false)
    await get()
    assert.equal(calls, 1)
  }
})

test('invalid filters and methods never call hh.ru', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected call') })
  const get = endpoint()
  assert.equal((await get('/api/hh/vacancies?area=https://example.com')).status, 400)
  assert.equal((await get('/api/hh/vacancies?period=500')).status, 400)
  assert.equal((await get('/api/hh/vacancies', 'POST')).status, 405)
  assert.equal((await get('/other')).next, true)
  assert.equal(fetch.mock.callCount(), 0)
})

test('network failures and changed pages are recoverable and are not cached as successful data', async t => {
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('network failed') })
  const get = endpoint()
  assert.match((await get()).body.message, /соединение/)
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>changed</html>'))
  const changed = await get()
  assert.equal(changed.status, 502)
  assert.match(changed.body.message, /формат страницы/)
  t.mock.method(globalThis, 'fetch', async () => new Response(page(fixture)))
  assert.equal((await get()).status, 200)
})
