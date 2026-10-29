import type { Cluster, Salary, Taxonomy, VacanciesResponse, Vacancy } from '../src/lib/hh.ts'

type ObjectValue = Record<string, unknown>
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const id = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const amount = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

const experienceNames: Record<string, string> = {
  noExperience: 'Нет опыта', between1And3: 'От 1 года до 3 лет',
  between3And6: 'От 3 до 6 лет', moreThan6: 'Более 6 лет',
}
const formatNames: Record<string, string> = {
  ON_SITE: 'На месте работодателя', REMOTE: 'Удалённо', HYBRID: 'Гибрид', FIELD_WORK: 'Разъездной',
}
const salaryModes: Record<string, string> = {
  MONTH: 'За месяц', YEAR: 'За год', HOUR: 'За час', SHIFT: 'За смену', DAY: 'За день', SERVICE: 'За услугу',
}

export class HhPageError extends Error {}

export function decodeEntities(value: string) {
  const named: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' }
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code: string) => {
    if (code[0] !== '#') return named[code.toLowerCase()] ?? entity
    const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
    return point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity
  })
}

export function parseState(html: string): ObjectValue {
  const match = /<template\b[^>]*\bid\s*=\s*["']HH-Lux-InitialState["'][^>]*>([\s\S]*?)<\/template\s*>/i.exec(html)
  if (!match) {
    if (/captcha|access denied|доступ ограничен|провер.{0,25}робот/i.test(html)) {
      throw new HhPageError('hh.ru запросил проверку доступа. Откройте поиск на hh.ru в браузере и повторите позже.')
    }
    throw new HhPageError('Не удалось найти данные поиска на странице hh.ru. Возможно, формат страницы изменился.')
  }
  // Some responses contain raw JSON, others HTML-escape the template contents.
  // Try raw JSON first to preserve literal entities inside job titles.
  for (const candidate of [match[1], decodeEntities(match[1])]) {
    try { return object(JSON.parse(candidate)) } catch { /* Try HTML-decoded JSON. */ }
  }
  throw new HhPageError('Данные поиска hh.ru не удалось прочитать. Возможно, формат страницы изменился.')
}

function parseSalary(raw: unknown): Salary | null {
  const salary = object(raw)
  // perMode* refers to the stated period; from/to may contain normalized values.
  const from = amount(salary.perModeFrom) ?? amount(salary.from)
  const to = amount(salary.perModeTo) ?? amount(salary.to)
  if (from == null && to == null) return null
  const mode = text(salary.mode)
  return {
    from, to, currency: text(salary.currencyCode) || 'Валюта не указана',
    gross: typeof salary.gross === 'boolean' ? salary.gross : null,
    mode: mode ? { id: mode, name: salaryModes[mode] || `Период: ${mode}` } : null,
  }
}

function parseVacancy(raw: unknown): Vacancy {
  const vacancy = object(raw)
  const vacancyId = id(vacancy.vacancyId)
  const name = text(vacancy.name)
  const date = text(object(vacancy.publicationTime).$)
  if (!/^\d+$/.test(vacancyId) || !name || !date || !Number.isFinite(Date.parse(date))) {
    throw new HhPageError('Формат карточек вакансий hh.ru изменился. Не удалось построить достоверную выборку.')
  }
  const company = object(vacancy.company)
  const area = object(vacancy.area)
  const experience = text(vacancy.workExperience)
  const formats = new Set<string>()
  if (Array.isArray(vacancy.workFormats)) {
    for (const entry of vacancy.workFormats) {
      const elements = object(entry).workFormatsElement
      if (Array.isArray(elements)) for (const element of elements) if (typeof element === 'string') formats.add(element)
    }
  }
  return {
    id: vacancyId, name, published_at: date,
    alternate_url: `https://hh.ru/vacancy/${vacancyId}`,
    employer: { id: id(company.id) || null, name: text(company.visibleName) || text(company.name) || 'Работодатель не указан' },
    area: { id: id(area['@id']), name: text(area.name) || 'Регион не указан' },
    experience: experience ? { id: experience, name: experienceNames[experience] || experience } : null,
    salary_range: parseSalary(vacancy.compensation),
    work_format: [...formats].map(format => ({ id: format, name: formatNames[format] || format })),
    role_ids: Array.isArray(vacancy.professionalRoleIds) ? [...new Set(vacancy.professionalRoleIds.flatMap(entry => {
      const values = object(entry).professionalRoleId
      return Array.isArray(values) ? values.map(id).filter(value => /^\d+$/.test(value)) : []
    }))] : [],
    area_path: text(area.path),
  }
}

function parseCluster(raw: unknown, clusterId: string, name: string): Cluster | null {
  const groups = object(object(raw).groups)
  const items = Object.values(groups).flatMap(value => {
    const group = object(value)
    const count = amount(group.count)
    const title = text(group.title)
    return title && count != null ? [{ id: id(group.id), name: title, count }] : []
  })
  return items.length ? { id: clusterId, name, items } : null
}

export function parseSearchPage(html: string, sourceUrl: string): VacanciesResponse {
  const state = parseState(html)
  const search = object(state.vacancySearchResult)
  const found = amount(search.totalResults)
  if (found == null || !Number.isInteger(found) || !Array.isArray(search.vacancies)) {
    throw new HhPageError('На странице hh.ru нет ожидаемых результатов поиска. Возможно, формат страницы изменился.')
  }
  const unique = new Map<string, Vacancy>()
  for (const raw of search.vacancies) {
    const vacancy = parseVacancy(raw)
    unique.set(vacancy.id, vacancy)
  }
  const items = [...unique.values()].sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))
  if (found > 0 && !items.length) {
    throw new HhPageError('hh.ru сообщил о найденных вакансиях, но не передал карточки объявлений. Повторите позже.')
  }
  if (found === 0 && items.length) {
    throw new HhPageError('hh.ru вернул противоречивые результаты поиска. Попробуйте уточнить запрос.')
  }
  const clusters = object(state.searchClusters)
  // Geography can contain the selected region, its ancestors and descendants.
  // Keep the region chart based on the loaded sample to avoid mixing scopes.
  const experience = parseCluster(clusters.experience, 'experience', 'Опыт работы')
  const workFormat = parseCluster(clusters.work_format, 'work_format', 'Формат работы')
  const roles = parseCluster(clusters.professional_role, 'professional_role', 'Профессии')
  const taxonomy: Taxonomy = { roles: [], directions: [] }
  const roleMap = new Map<string, Taxonomy['roles'][number]>()
  const categories = object(state.professionalRoleTree).items
  if (Array.isArray(categories)) for (const rawCategory of categories) {
    const category = object(rawCategory)
    if (!text(category.id) || !text(category.text) || !Array.isArray(category.items)) continue
    const direction = { id: text(category.id), name: text(category.text), roleIds: [] as string[] }
    for (const rawRole of category.items) {
      const role = object(rawRole)
      const roleId = id(role.id)
      if (!/^\d+$/.test(roleId) || !text(role.text)) continue
      direction.roleIds.push(roleId)
      const known = roleMap.get(roleId) || { id: roleId, name: text(role.text), directionIds: [] }
      if (!known.directionIds.includes(direction.id)) known.directionIds.push(direction.id)
      roleMap.set(roleId, known)
    }
    taxonomy.directions.push(direction)
  }
  taxonomy.roles = [...roleMap.values()]
  const criteria = object(search.criteria)
  return {
    found, items, clusters: [experience, workFormat, roles].filter((cluster): cluster is Cluster => cluster != null),
    taxonomy,
    appliedFilters: { dateFrom: text(criteria.date_from), dateTo: text(criteria.date_to), page: typeof criteria.page === 'number' ? criteria.page : 0, areas: Array.isArray(criteria.area) ? criteria.area.map(id) : [], workFormats: Array.isArray(criteria.work_format) ? criteria.work_format.map(id) : [], text: text(criteria.text) },
    sourceUrl, fetchedAt: new Date().toISOString(),
  }
}

