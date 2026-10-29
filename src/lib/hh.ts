export type Named = { id: string; name: string }
export type Salary = {
  from: number | null
  to: number | null
  currency: string
  gross: boolean | null
  mode?: Named | null
}
export type Vacancy = {
  id: string
  name: string
  alternate_url: string | null
  published_at: string
  area: Named
  employer: { id?: string | null; name: string }
  experience?: Named | null
  salary?: Salary | null
  salary_range?: Salary | null
  work_format?: Named[]
  role_ids?: string[]
  area_path?: string
  description?: string
  key_skills?: string[]
  spoken_languages?: string[]
  detail_fetched_at?: string
  closed?: boolean
  normalized_title?: Named
  skill_mentions?: { name: string; category: string; source: string; evidence: string }[]
}
export type Cluster = { id: string; name: string; items: { id?: string; name: string; count: number }[] }
export type Taxonomy = { roles: (Named & { directionIds: string[] })[]; directions: (Named & { roleIds: string[] })[] }
export type VacanciesResponse = { found: number; items: Vacancy[]; clusters?: Cluster[] | null; fetchedAt: string; sourceUrl: string; taxonomy?: Taxonomy; appliedFilters?: { dateFrom: string; dateTo: string; page: number; areas: string[]; workFormats: string[]; text: string } }
export type Filters = { text: string; area: string; period: string }

export const regions = [
  { id: '113', name: 'Вся Россия' },
  { id: '1', name: 'Москва' },
  { id: '2', name: 'Санкт-Петербург' },
  { id: '4', name: 'Новосибирск' },
  { id: '3', name: 'Екатеринбург' },
  { id: '88', name: 'Казань' },
]

export const number = (value: number) => new Intl.NumberFormat('ru-RU').format(value)
export const percent = (value: number, total: number) => total ? `${Math.round(value / total * 100)}%` : '—'

export function searchUrlFor(filters: Filters) {
  const params = new URLSearchParams({ area: filters.area, search_period: filters.period, items_on_page: '100', order_by: 'publication_time', page: '0', no_magic: 'true' })
  if (filters.text.trim()) params.set('text', filters.text.trim())
  return `https://hh.ru/search/vacancy?${params}`
}

export async function loadVacancies(filters: Filters, signal: AbortSignal): Promise<VacanciesResponse> {
  const response = await fetch(`/api/hh/vacancies?${new URLSearchParams(filters)}`, { signal })
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'message' in body && typeof body.message === 'string' ? body.message : `Не удалось загрузить вакансии (${response.status}).`
    throw new Error(message)
  }
  if (!body || typeof body !== 'object' || !('items' in body) || !Array.isArray(body.items) || !('found' in body) || typeof body.found !== 'number' || !('fetchedAt' in body) || typeof body.fetchedAt !== 'string' || !('sourceUrl' in body) || typeof body.sourceUrl !== 'string') {
    throw new Error('Некорректный ответ сервера. Запустите приложение через npm run dev или npm run preview.')
  }
  return body as VacanciesResponse
}

export function salaryOf(vacancy: Vacancy) {
  return vacancy.salary_range ?? vacancy.salary
}

export function formatSalary(vacancy: Vacancy) {
  const salary = salaryOf(vacancy)
  if (!salary || (salary.from == null && salary.to == null)) return 'Зарплата не указана'
  const currency = salary.currency === 'RUR' ? '₽' : salary.currency
  const range = salary.from != null && salary.to != null
    ? `${number(salary.from)}–${number(salary.to)}`
    : salary.from != null ? `от ${number(salary.from)}` : `до ${number(salary.to!)}`
  const mode = salary.mode?.name || (vacancy.salary_range ? 'Период не указан' : 'За месяц')
  const tax = salary.gross === true ? 'до вычета налогов' : salary.gross === false ? 'на руки' : 'налоги не уточнены'
  return `${range} ${currency} · ${mode.toLowerCase()} · ${tax}`
}

export function median(values: number[]) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export function groupBy(items: Vacancy[], pick: (vacancy: Vacancy) => string) {
  const counts = new Map<string, number>()
  for (const vacancy of items) {
    const name = pick(vacancy)
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}

export function summarize(data: VacanciesResponse) {
  const items = data.items
  const withSalary = items.filter(v => {
    const salary = salaryOf(v)
    return salary && (salary.from != null || salary.to != null)
  }).length
  const lowerBounds = items.flatMap(v => {
    const salary = salaryOf(v)
    const monthly = v.salary_range ? salary?.mode?.id === 'MONTH' : true
    return salary && salary.currency === 'RUR' && salary.gross === false && monthly && salary.from != null ? [salary.from] : []
  })
  return {
    withSalary,
    employers: new Set(items.map(v => v.employer.id || v.employer.name)).size,
    medianLower: median(lowerBounds),
    salaryCount: lowerBounds.length,
  }
}
