import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyPriorities } from '../src/lib/priorities.ts'
import { defaultRemoteFilters } from '../src/lib/analytics.ts'
import { Store } from '../server/store.ts'

const categories = value => classifyPriorities(value).map(match => match.id)
test('priority dictionary identifies each area and explains matches using actual source text', () => {
  const samples = [
    ['web', { name: 'Frontend-разработчик', key_skills: ['React'] }],
    ['development', { name: 'Senior Backend Developer' }],
    ['influence', { name: 'Менеджер по работе с блогерами' }],
    ['influence', { name: 'Маркетолог', description: 'Задачи: поиск и подбор блогеров для рекламных интеграций.' }],
    ['security', { name: 'Инженер по информационной безопасности' }],
    ['security', { name: 'Инженер', description: 'Задачи: проведение тестирования на проникновение.' }],
    ['devops', { name: 'SRE / DevOps Engineer' }],
    ['devops', { name: 'Инженер', description: 'Настройка и поддержка кластеров Kubernetes.' }],
    ['testing', { name: 'QA engineer', key_skills: ['Playwright'] }],
    ['testing', { name: 'Инженер', description: 'Обязанности: функциональное тестирование API.' }],
    ['data', { name: 'Data Engineer' }],
    ['product-design', { name: 'UX/UI дизайнер' }],
  ]
  for (const [id, sample] of samples) {
    const match = classifyPriorities(sample).find(value => value.id === id)
    assert.ok(match, JSON.stringify(sample))
    assert.ok(match.reasons.length > 0)
    for (const reason of match.reasons) {
      const source = { title: sample.name, skills: sample.key_skills?.join(' '), description: sample.description }[reason.source]
      assert.ok(source?.includes(reason.keyword))
    }
  }
})

test('general marketing, HR, security boilerplate and incidental tech do not become priority jobs', () => {
  const samples = [
    { name: 'SMM-менеджер', description: 'Разработка контент-плана. Тестирование креативов и рекламных кампаний. Соблюдать информационную безопасность.' },
    { name: 'IT Recruiter', key_skills: ['React', 'Terraform'], description: 'Поиск разработчиков и QA инженеров.' },
    { name: 'Ассистент', description: 'Наша компания работает с блогерами. Подготовка документов и отчётов.' },
    { name: 'Контент-менеджер', description: 'Мы разрабатываем приложения. Вы будете наполнять каталог товаров.' },
    { name: 'Руководитель отдела риск-аналитики', description: 'Автоматизация и инфраструктура: развитие и автоматизация систем принятия решений.' },
    { name: 'Автор дисциплин по информационной безопасности', description: 'Разработка программного обеспечения — наша новая дисциплина.' },
    { name: 'Маркетолог', description: 'Не требуется разработка приложений. Работа с рекламными кампаниями.' },
    { name: 'Администратор', key_skills: ['Docker'], description: 'Базовое знание Docker и Linux будет плюсом.' },
    { name: 'Менеджер', description: 'Актуализация social-медиа. SOC не упоминается как рабочая задача.' },
  ]
  for (const sample of samples) assert.deepEqual(categories(sample), [], sample.name)
})

const job = (id, name, extra = {}) => ({
  id: String(id), name, employer: { id: String(id), name: `Компания ${id}` },
  area: { id: '1', name: 'Москва' }, published_at: new Date().toISOString(),
  description: 'Работа над задачами команды. Ведение документации, участие в обсуждении и планировании.',
  detail_fetched_at: new Date().toISOString(), work_format: [{ id: 'REMOTE', name: 'Удалённо' }],
  ...extra,
})
function database(t, jobs) {
  const store = new Store(':memory:')
  t.after(() => store.close())
  store.ingest({ items: jobs })
  return store
}
const filters = { ...defaultRemoteFilters, priority: 'any' }

test('priority overview counts overlapping directions but union, metrics and pages contain unique jobs', t => {
  const store = database(t, [job(1, 'Frontend-разработчик', { key_skills: ['React'] }), job(2, 'QA Engineer'), job(3, 'SMM-менеджер')])
  const result = store.analytics(filters)
  assert.equal(result.priority.candidates, 3)
  assert.equal(result.priority.total, 2)
  assert.equal(result.totals.filtered, 2)
  assert.equal(result.priority.directions.find(row => row.id === 'web').count, 1)
  assert.equal(result.priority.directions.find(row => row.id === 'development').count, 1)
  assert.equal(new Set(result.recent.map(item => item.id)).size, 2)
  assert.equal(result.totals.employers, 2)
  assert.equal(result.remote.groups.reduce((sum, row) => sum + row.count, 0), 2)
  const web = store.analytics({ ...filters, priority: 'web' })
  assert.equal(web.totals.filtered, 1)
  assert.equal(web.recent[0].id, '1')
  assert.deepEqual(Object.keys(web.priority.matches), ['1'])
  assert.equal(web.priority.directions.find(row => row.id === 'testing').count, 1)
  assert.equal(store.analytics({ ...filters, priority: 'devops' }).totals.filtered, 0)
  assert.equal(store.analytics(defaultRemoteFilters).totals.filtered, 3)
})

test('priority filters intersect remote format, skills, dates, title groups and search; new jobs appear automatically', t => {
  const store = database(t, [
    job(1, 'Frontend-разработчик', { key_skills: ['React'] }),
    job(2, 'Frontend-разработчик', { key_skills: ['Vue'], work_format: [{ id: 'HYBRID', name: 'Гибрид' }] }),
    job(3, 'Frontend-разработчик', { published_at: new Date(Date.now() - 45 * 86400000).toISOString() }),
  ])
  assert.equal(store.analytics(filters).totals.filtered, 1)
  assert.equal(store.analytics({ ...filters, workFormat: 'REMOTE' }).totals.filtered, 2)
  assert.equal(store.analytics({ ...filters, period: '90' }).totals.filtered, 2)
  assert.equal(store.analytics({ ...filters, technology: 'Vue' }).totals.filtered, 0)
  const empty = store.analytics({ ...filters, text: 'нет такой вакансии' })
  assert.equal(empty.priority.total, 0)
  assert.equal(empty.remote.totalPages, 0)
  assert.deepEqual(empty.priority.matches, {})
  const first = store.analytics(filters)
  assert.equal(store.analytics({ ...filters, group: first.remote.groups[0].id }).totals.filtered, 1)
  store.ingest({ items: [job(4, 'Менеджер по работе с блогерами')] })
  assert.equal(store.analytics({ ...filters, priority: 'influence' }).recent[0].id, '4')
})

test('priority pagination is disjoint and all classification reads preserve payloads and timestamps', t => {
  const store = database(t, Array.from({ length: 25 }, (_, i) => job(i, 'Frontend-разработчик')))
  const before = store.db.prepare('SELECT * FROM vacancies ORDER BY id').all()
  const tasks = store.taskStats()
  store.db.exec('PRAGMA query_only=ON')
  const first = store.analytics(filters), second = store.analytics({ ...filters, page: '1' })
  assert.equal(first.recent.length, 20)
  assert.equal(second.recent.length, 5)
  assert.equal(new Set([...first.recent, ...second.recent].map(item => item.id)).size, 25)
  assert.equal(Object.keys(second.priority.matches).length, 5)
  assert.equal(store.analytics({ ...filters, page: '999' }).remote.page, 1)
  assert.deepEqual(store.db.prepare('SELECT * FROM vacancies ORDER BY id').all(), before)
  assert.deepEqual(store.taskStats(), tasks)
})
