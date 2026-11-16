import { load } from 'cheerio'
import type { Vacancy, Named, Salary } from '../src/lib/hh.ts'
import type { SourceDefinition } from '../src/lib/sources.ts'
import type { SourceTask } from './source-state.ts'
import { boardFromUrl, digest, normalizeUrl, originalIdentity } from './source-identity.ts'
import { isExcludedWebTitle, isWebCandidate } from './web-scope.ts'

type Obj = Record<string, unknown>
const object = (value: unknown): Obj => value && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {}
const str = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : ''
const array = (value: unknown) => Array.isArray(value) ? value : []
const named = (value: unknown) => str(object(value).name) || str(value)
export function plainText(html: string) {
  const $ = load(html)
  $('script,style,noscript,svg').remove()
  $('br').replaceWith('\n')
  $('p,li,div,h1,h2,h3,h4').each((_, item) => { $(item).append('\n') })
  return $.root().text().replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
export function workFormats(text: string, explicit?: unknown): Named[] {
  const value = `${str(explicit)}\n${text}`.replace(/ё/g, 'е')
  const remote = explicit === true || /telecommute|(?<![a-z])remote(?![a-z])|удаленн|удаленк|дистанционн|работ[аы] из дома|из любой точки/iu.test(value)
  const hybrid = /hybrid|гибрид|полуофис|(?:посещать|приезжать|выезжать|посещени[ея]|присутствие).{0,45}(?:офис|съемк|съёмк|встреч)|(?:[1-4]|один|два|три) дн[яей].{0,30}(?:офис|недел)/iu.test(value)
  const deniedRemote = /не (?:предусмотрен[а-я]*|рассматриваем|предлагаем|подходит).{0,25}(?:удален|remote)|удаленн[а-я ]{0,20}не(?: возмож| рассматрива)|no remote|on[ -]site only/iu.test(value)
  if (hybrid) return [{ id: 'HYBRID', name: 'Гибрид' }]
  if (remote && !deniedRemote) return [{ id: 'REMOTE', name: 'Удалённо' }]
  return []
}
function experience(text: string): Named | null {
  if (/без опыта|опыт не требуется|no experience/iu.test(text)) return { id: 'noExperience', name: 'Нет опыта' }
  const years = /(?:от|не менее|опыт.{0,20}|experience.{0,20})\s*([1-9])\s*(?:лет|год|years)/iu.exec(text)
  if (!years) return null
  const count = Number(years[1])
  return count >= 6 ? { id: 'moreThan6', name: 'Более 6 лет' } : count >= 3 ? { id: 'between3And6', name: 'От 3 до 6 лет' } : { id: 'between1And3', name: 'От 1 года до 3 лет' }
}
function structuredSalary(raw: unknown): Salary | null {
  const data = object(raw), value = object(data.value)
  const from = Number(value.minValue ?? value.value ?? data.minValue), to = Number(value.maxValue ?? data.maxValue)
  if ((!Number.isFinite(from) || from < 0) && (!Number.isFinite(to) || to < 0)) return null
  const currency = str(data.currency).toUpperCase().replace(/^RUB$/, 'RUR')
  if (!currency) return null
  const unit = str(value.unitText || data.unitText).toUpperCase()
  return { from: Number.isFinite(from) && from >= 0 ? from : null, to: Number.isFinite(to) && to >= 0 ? to : null, currency, gross: null, mode: ['MONTH','YEAR','HOUR','DAY'].includes(unit) ? { id: unit, name: { MONTH: 'За месяц', YEAR: 'За год', HOUR: 'За час', DAY: 'За день' }[unit]! } : null }
}
type JobInput = { title: string; description: string; url: string; nativeId?: string; company?: string; location?: string; applicantLocations?: string[]; excludedLocations?: string[]; date?: string; remote?: unknown; formatsText?: string; salary?: Salary | null; salaryText?: string; skills?: string[]; level?: string; originalUrl?: string; closed?: boolean }
function descriptionLinks(html: string) {
  const $ = load(html)
  return $('a[href]').map((_, node) => normalizeUrl($(node).attr('href')!)).get().filter((value): value is string => !!value)
}
function vacancy(source: SourceDefinition, input: JobInput): Vacancy | null {
  const url = normalizeUrl(input.url)
  if (!url || !input.title?.trim() || input.closed) return null
  const description = plainText(input.description)
  if (description.length < 40) return null
  const candidates = descriptionLinks(input.description).filter(value => originalIdentity(value))
  const uniqueIdentities = new Set(candidates.map(value => originalIdentity(value)!.key))
  const originalUrl = input.originalUrl ? normalizeUrl(input.originalUrl) : uniqueIdentities.size === 1 ? candidates[0] : null
  const original = originalUrl ? originalIdentity(originalUrl) : originalIdentity(url)
  const parsedDate = Date.parse(input.date || '')
  const formats = workFormats(`${input.formatsText || ''}\n${description}`, input.remote)
  return {
    id: original?.id || `${source.id}:${digest(input.nativeId || url)}`, name: plainText(input.title).slice(0, 500),
    alternate_url: original?.url || originalUrl || url,
    source: { id: source.id, name: source.name, url, ...(originalUrl ? { originalUrl } : {}) },
    published_at: Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : new Date().toISOString(), date_estimated: !Number.isFinite(parsedDate),
    employer: { name: input.company?.trim() || 'Работодатель не указан' }, area: { id: 'external', name: input.location || 'География не указана' },
    description, key_skills: [...new Set(input.skills || [])].filter(Boolean).slice(0, 100), detail_fetched_at: new Date().toISOString(),
    experience: experience(description), work_format: formats, salary_range: input.salary || null, salary_text: input.salaryText || undefined,
    professional_level: input.level || undefined,
    applicant_locations: input.applicantLocations?.filter(Boolean), excluded_locations: input.excludedLocations?.filter(Boolean),
  }
}
export type AdapterResult = { jobs: Vacancy[]; links: { url: string; kind: string; context?: Record<string, unknown> }[]; boards: string[]; message: string }
const result = (): AdapterResult => ({ jobs: [], links: [], boards: [], message: '' })

export function allowedSourceUrl(source: SourceDefinition, value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false
    const hosts = source.kind === 'ashby' ? ['api.ashbyhq.com'] : source.kind === 'greenhouse' ? ['boards-api.greenhouse.io'] : source.kind === 'lever' ? ['api.lever.co', 'api.eu.lever.co'] : [new URL(source.url).hostname]
    return hosts.includes(url.hostname)
  } catch { return false }
}
function parseJson(source: SourceDefinition, body: string, task: SourceTask): AdapterResult {
  const out = result(), json: unknown = JSON.parse(body), root = object(json)
  let jobs: unknown[]
  if (source.kind === 'greenhouse' && task.kind === 'detail') { if (!root.id || typeof root.content !== 'string') throw new Error('В карточке Greenhouse отсутствует полное описание'); jobs = [root] }
  else if (source.id === 'remoteok' || source.kind === 'lever') { if (!Array.isArray(json)) throw new Error('Изменилась схема JSON-ленты'); jobs = json }
  else { if (!Array.isArray(root.jobs)) throw new Error('В JSON-ответе отсутствует массив jobs'); jobs = root.jobs }
  for (const raw of jobs) {
    const item = object(raw)
    if (source.kind === 'greenhouse' && task.kind !== 'detail' && !item.content) {
      const title = str(item.title)
      if (/^\d+$/.test(str(item.id)) && !isExcludedWebTitle(title) && isWebCandidate({ name: title })) {
        const url = new URL(task.url); url.search = ''; url.pathname += `/${item.id}`
        out.links.push({ url: url.href, kind: 'detail', context: { board: task.context.board } })
      }
      continue
    }
    let input: JobInput | null = null
    if (source.id === 'himalayas') input = { title: str(item.title), description: str(item.description), url: str(item.guid || item.applicationLink), originalUrl: str(item.applicationLink) || undefined, nativeId: str(item.id || item.guid), company: str(item.companyName), location: [...array(item.locationRestrictions), ...array(item.timezoneRestrictions)].map(str).join(', ') || 'Worldwide', date: str(item.pubDate) ? new Date(Number(item.pubDate)*1000).toISOString() : str(item.publishedAt), remote: true, salaryText: str(item.salary), skills: [...array(item.categories), ...array(item.seniority)].map(str) }
    else if (source.id === 'remotive') input = { title: str(item.title), description: str(item.description), url: str(item.url), nativeId: str(item.id), company: str(item.company_name), location: str(item.candidate_required_location), date: str(item.publication_date), remote: true, salaryText: str(item.salary), skills: array(item.tags).map(str) }
    else if (source.id === 'remoteok' && item.id) input = { title: str(item.position), description: str(item.description), url: str(item.url), nativeId: str(item.id), company: str(item.company), location: str(item.location) || 'География — в описании', date: str(item.date), remote: true, salaryText: item.salary_min ? `${item.salary_min}–${item.salary_max || '…'} ${str(item.salary_currency)} (период — в оригинале)` : '', skills: array(item.tags).map(str) }
    else if (source.kind === 'ashby' && item.isListed !== false) input = { title: str(item.title), description: str(item.descriptionHtml || item.descriptionPlain), url: str(item.jobUrl), originalUrl: str(item.applyUrl) || undefined, nativeId: str(item.id), company: str(task.context.board || new URL(task.url).pathname.split('/').at(-1)), location: [str(item.location), str(object(object(item.address).postalAddress).addressCountry)].filter(Boolean).join(' · '), date: str(item.publishedAt), remote: item.isRemote === true || item.workplaceType === 'Remote' ? true : str(item.workplaceType) }
    else if (source.kind === 'greenhouse') {
      const content = str(item.content)
      input = { title: str(item.title), description: /&lt;\/?(?:p|div|h[1-6]|ul|li|br|strong)\b/iu.test(content) ? load(content).root().text() : content, url: str(item.absolute_url), nativeId: str(item.id), company: str(item.company_name || task.context.board || new URL(task.url).pathname.split('/')[3]), location: str(object(item.location).name), date: str(item.first_published || item.updated_at), formatsText: str(object(item.location).name) }
    }
    else if (source.kind === 'lever') { const categories = object(item.categories); input = { title: str(item.text), description: `${str(item.description)}\n${array(item.lists).map(value => { const section = object(value); return `<h3>${str(section.text)}</h3>${str(section.content)}` }).join('\n')}\n${str(item.additional)}`, url: str(item.hostedUrl), originalUrl: str(item.applyUrl) || undefined, nativeId: str(item.id), company: str(task.context.board || new URL(task.url).pathname.split('/')[3]), location: str(categories.location), date: item.createdAt ? new Date(Number(item.createdAt)).toISOString() : '', remote: str(item.workplaceType), formatsText: str(categories.location) } }
    if (input) {
      if (source.id === 'himalayas') input.applicantLocations = array(item.locationRestrictions).map(named)
      if (source.id === 'remotive' && item.candidate_required_location) input.applicantLocations = [str(item.candidate_required_location)]
      if (Array.isArray(item.excludedCountries)) input.excludedLocations = item.excludedCountries.map(named)
      input.level = str(item.seniority || item.level || object(item.categories).level) || (source.id === 'himalayas' ? array(item.seniority).map(str).join(', ') : '')
      const job = vacancy(source, input); if (job) out.jobs.push(job); out.boards.push(...[...descriptionLinks(input.description), input.originalUrl || ''].filter(value => !!boardFromUrl(value)))
    }
  }
  if (source.id === 'himalayas' && root.nextCursor && Number(task.context.depth || 0) < 29) {
    const next = new URL(source.url); next.searchParams.set('cursor', str(root.nextCursor))
    out.links.push({ url: next.href, kind: 'feed', context: { depth: Number(task.context.depth || 0)+1, recurring: false } })
  }
  if (source.kind === 'lever') {
    const next = new URL(task.url), limit = Number(next.searchParams.get('limit')), skip = Number(next.searchParams.get('skip') || 0)
    if (Number.isInteger(limit) && limit > 0 && jobs.length === limit && Number.isInteger(skip) && skip >= 0 && skip + limit < 1000) {
      next.searchParams.set('skip', String(skip + limit))
      out.links.push({ url: next.href, kind: 'page', context: { board: task.context.board, recurring: true } })
    }
  }
  out.message = `${jobs.length} записей получено, ${out.jobs.length} полных карточек${out.links.length ? `, ${out.links.length} заданий добавлено` : ''}`
  return out
}
function parseRss(source: SourceDefinition, body: string) {
  const $ = load(body, { xml: true }), out = result()
  if (!$('rss,feed').length) throw new Error('Ответ не похож на RSS / Atom')
  $('item,entry').each((_, node) => {
    const item = $(node), title = item.find('title').first().text(), titleParts = title.split(': ')
    const applicantLocations = item.find('region,country,state').map((_, n) => $(n).text()).get().filter(Boolean)
    const job = vacancy(source, { title: titleParts.length > 1 ? titleParts.slice(1).join(': ') : title, company: titleParts.length > 1 ? titleParts[0] : undefined, description: item.find('description,content,content\\:encoded').first().text(), url: item.find('link').first().text() || item.find('link').first().attr('href') || item.find('guid').text(), location: applicantLocations.join(' · '), applicantLocations, date: item.find('pubDate,published,updated').first().text(), remote: true })
    if (job) out.jobs.push(job)
    out.boards.push(...descriptionLinks(item.find('description,content,content\\:encoded').first().text()).filter(value => !!boardFromUrl(value)))
  })
  out.message = `${out.jobs.length} полных карточек из RSS`; return out
}
function jobPostingNodes(value: unknown, depth = 0): Obj[] {
  if (depth > 8) return []
  if (Array.isArray(value)) return value.flatMap(item => jobPostingNodes(item, depth+1))
  const item = object(value)
  if (item['@type'] === 'JobPosting' || array(item['@type']).includes('JobPosting')) return [item]
  return ['@graph', 'itemListElement', 'item'].flatMap(key => jobPostingNodes(item[key], depth+1))
}
export function isJobLink(source: SourceDefinition, value: string) {
  const url = new URL(value)
  if (!allowedSourceUrl(source, value)) return false
  const patterns: Record<string, RegExp> = { habr: /^\/vacancies\/\d+$/, geekjob: /^\/vacancy\/[a-f0-9]{12,}$/, getmatch: /^\/vacancies\/\d+(?:-[^/]*)?$/, budu: /^\/vacancy\/[a-z0-9-]+$/ }
  return patterns[source.id]?.test(url.pathname) || false
}
function parseHtml(source: SourceDefinition, body: string, task: SourceTask) {
  const $ = load(body), out = result()
  if (/captcha|access denied|just a moment/i.test($('title').text())) throw new Error('Источник запросил проверку доступа / капчу')
  const allLinks = $('a[href]').map((_, a) => normalizeUrl($(a).attr('href')!, task.url)).get().filter((url): url is string => !!url)
  const boards = allLinks.filter(value => boardFromUrl(value)); out.boards = [...new Set(boards)]
  if (task.kind !== 'detail') {
    const irrelevant = new Set($('a[href]').map((_, a) => {
      const label = $(a).text().trim()
      const url = normalizeUrl($(a).attr('href')!, task.url)
      return url && label.length > 5 && isJobLink(source,url) && isExcludedWebTitle(label) ? url : null
    }).get().filter(Boolean))
    const discovered = allLinks.filter(value=>isJobLink(source,value)).length
    const relevantLinks = allLinks.filter(value=>!irrelevant.has(value))
    out.links = [...new Set(relevantLinks.filter(value => isJobLink(source, value)))].slice(0, 100).map(url => ({url,kind:'detail'}))
    const depth = Number(task.context.depth || 0)
    if (depth < 7) for (const value of allLinks) {
      const next = new URL(value), current = new URL(task.url)
      const page = Number(next.searchParams.get('page') || 0)
      if (allowedSourceUrl(source, value) && next.pathname === current.pathname && page > Number(current.searchParams.get('page') || 0) && page <= 8) out.links.push({ url: value, kind: 'index', context: { depth: depth+1, recurring: false } })
    }
    if (!out.links.length && source.id === 'getmatch') { out.links.push({ url: 'https://getmatch.ru/sitemap.xml', kind: 'index', context: { recurring: true } }); out.message = 'Публичная выдача загружается браузером; используем карту сайта'; return out }
    if (!out.links.length && !discovered) throw new Error('Не найдены ссылки на карточки: проверка доступа или изменение разметки')
    out.message = `${out.links.filter(link => ['detail', 'public-job'].includes(link.kind)).length} ссылок на вакансии`; return out
  }
  const nodes: Obj[] = []
  $('script[type="application/ld+json"]').each((_, script) => { try { nodes.push(...jobPostingNodes(JSON.parse($(script).text()))) } catch { /* Other structured blocks may be invalid. */ } })
  const item = nodes[0]
  const selectors: Record<string, string> = { habr: '.vacancy-description__text', geekjob: '.description', getmatch: '.b-vacancy-description,.b-vacancy-page__description', budu: '[itemprop="description"]' }
  const description = str(item?.description) || $(selectors[source.id] || '[itemprop="description"]').first().html() || ''
  const title = str(item?.title) || $('h1').first().text().trim()
  const metadata = $('body').clone(); metadata.find('script,style,footer,nav').remove()
  const formatText = metadata.text().replace(/\s+/g, ' ')
  const organization = object(item?.hiringOrganization)
  const locations = array(item?.jobLocation).length ? array(item?.jobLocation) : [item?.jobLocation]
  const location = locations.map(value => { const address = object(object(value).address); return [named(address.addressLocality), named(address.addressCountry)].filter(Boolean).join(', ') }).filter(Boolean).join(' · ')
  const descriptionLinks = load(description)('a[href]').map((_, a) => normalizeUrl(a.attribs.href, task.url)).get().filter((value): value is string => !!value)
  const applyLinks = $('a[href]').filter((_, a) => /отклик|apply|подать заявку/iu.test($(a).text())).map((_, a) => normalizeUrl($(a).attr('href')!, task.url)).get().filter((value): value is string => !!value)
  const original = [...descriptionLinks, ...applyLinks].find(value => !!originalIdentity(value))
  const closed = item?.validThrough ? Date.parse(str(item.validThrough)) < Date.now() : /Вакансия в архиве|вакансия закрыта|позиция закрыта/iu.test(formatText)
  const getmatchCompany = source.id === 'getmatch' ? $('h1').parent().find('a[href*="/companies/"]').first().text().trim() || $('.b-company-info').text().replace(/^О компании\s*/u, '').trim() : ''
  const level = /(?:Уровень|Квалификация|Seniority)\s*[:：]?\s*(?:[^(\s]{0,20}\s*\()?\s*(Senior|Middle|Junior|Lead|сеньор|сениор|мидл|джуниор|стажёр|ведущий)/iu.exec(formatText)?.[1]
  const job = vacancy(source, { title, description, url: task.url, nativeId: str(object(item?.identifier).value) || task.url, company: str(organization.name) || $('[itemprop="hiringOrganization"],.company_name,.company-name').first().text().trim() || getmatchCompany, location, date: str(item?.datePosted) || $('time[datetime]').first().attr('datetime'), remote: item?.jobLocationType, formatsText: `${plainText(description)}\n${formatText.slice(0, 1800)}`, salary: structuredSalary(item?.baseSalary), skills: array(item?.skills).map(str), level, originalUrl: original, closed })
  if (job && item?.applicantLocationRequirements) {
    const requirements = Array.isArray(item.applicantLocationRequirements) ? item.applicantLocationRequirements : [item.applicantLocationRequirements]
    job.applicant_locations = requirements.map(value => { const data = object(value); return str(data.name) || named(object(data.address).addressCountry) }).filter(Boolean)
  }
  if (!job && !closed) throw new Error('Не удалось получить полное описание вакансии; карточка не сохранена')
  if (job) out.jobs.push(job)
  out.message = closed ? 'Вакансия закрыта' : 'Полная карточка прочитана'; return out
}
function parseTelegram(source: SourceDefinition, body: string) {
  const $ = load(body), out = result()
  if (!$('.tgme_widget_message').length) throw new Error('Публичная веб-лента Telegram недоступна или изменила разметку')
  $('.tgme_widget_message').each((_, node) => {
    const item = $(node), message = item.find('.tgme_widget_message_text').first()
    const description = plainText(message.html() || '')
    if (!/ваканси|ищем|должност|разработчик|developer|менеджер|специалист|маркетолог|верстальщик|hiring/iu.test(description) || /прайс на рекламу|стоимость размещения вакансии|разместить вакансию.{0,50}пишите/iu.test(description.slice(0, 300))) return
    const link = item.find('a.tgme_widget_message_date').attr('href')
    if (!link) return
    const lines = description.split('\n').map(text => text.trim()).filter(text => text && !/^(?:#|\d+[\s.,]|http)/u.test(text))
    const titleLine = lines.find(text => /^(?:вакансия|должность|позиция)\s*[:—-]/iu.test(text))
    const title = titleLine?.replace(/^(?:вакансия|должность|позиция)\s*[:—-]\s*/iu, '') || lines.find(text => /developer|разработчик|менеджер|специалист|маркетолог|верстальщик|frontend|fullstack/iu.test(text) && text.length < 180) || lines[0]
    const urls = message.find('a[href]').map((_, a) => normalizeUrl($(a).attr('href')!, link)).get().filter((value): value is string => !!value)
    const original = urls.find(value => !!originalIdentity(value))
    const company = /(?:Компания|Работодатель)\s*[:—-]\s*([^\n]+)/iu.exec(description)?.[1]
    const job = vacancy(source, { title: title || '', description: message.html() || '', url: link, company, originalUrl: original, date: item.find('time[datetime]').attr('datetime'), location: /(?:География|Локация|Страна|Location)\s*[:—-]\s*([^\n]+)/iu.exec(description)?.[1] })
    if (job) out.jobs.push(job)
    out.boards.push(...urls.filter(value => !!boardFromUrl(value)))
  })
  out.message = `${out.jobs.length} полных объявлений из публичной ленты`; return out
}
export function parseSource(source: SourceDefinition, body: string, task: SourceTask): AdapterResult {
  if (source.id === 'getmatch' && new URL(task.url).pathname === '/sitemap.xml') {
    const $ = load(body, { xml: true }), out = result()
    if (!$('urlset').length) throw new Error('getmatch не вернул публичную карту сайта')
    const urls = [...new Set($('url > loc').map((_, node) => $(node).text().trim()).get().filter(value => { try { return isJobLink(source, value) } catch { return false } }))]
    urls.sort((a, b) => Number(/\/vacancies\/(\d+)/.exec(b)?.[1]) - Number(/\/vacancies\/(\d+)/.exec(a)?.[1]))
    const webUrls = urls.filter(url => /front|back|fullstack|full-stack|developer|razrabot|verst|support|podderzh|test|qa-|devops|web|veb|node|react/iu.test(new URL(url).pathname))
    out.links = webUrls.slice(0, 1000).map(url => ({ url, kind: 'detail' }))
    out.message = `Найдено ${urls.length} адресов; до 1000 новых ID поставлены на проверку. Архивные и офисные карточки не сохраняются.`
    return out
  }
  if (source.kind === 'rss') return parseRss(source, body)
  if (source.kind === 'telegram') return parseTelegram(source, body)
  if (source.kind === 'html') return parseHtml(source, body, task)
  if (source.kind === 'search') {
    const json = object(JSON.parse(body)), out = result()
    if (!Array.isArray(json.organic)) throw new Error('Поисковый API не вернул organic')
    out.boards = array(json.organic).map(item => str(object(item).link)).filter(value => !!boardFromUrl(value))
    out.message = `${array(json.organic).length} результатов поиска, ${out.boards.length} карьерных страниц`; return out
  }
  return parseJson(source, body, task)
}
