import { randomUUID } from 'node:crypto'
import { HhPageError, parseSearchPage } from './hh-page.ts'
import { Store } from './store.ts'
import { expandTask, moscowDay, shiftDay, taskUrl } from './crawl-plan.ts'
import type { CrawlTask } from './crawl-plan.ts'
import type { Named, Taxonomy } from '../src/lib/hh.ts'
import { parseVacancyDetail } from './hh-detail.ts'
import { rejectionFor, SELECTION_VERSION, skipProfession } from './selection.ts'
import { DISCOVERY_INTERVAL, MIN_INTERVAL, QUEUE_VERSION, responseDiagnostic, responsePreview, retryAfterMs, searchPlan } from './collector-policy.ts'
import type { ResponseDiagnostic } from './collector-policy.ts'

export class Collector {
  store: Store
  private owner = randomUUID()
  private stopped = false
  private timer: ReturnType<typeof setTimeout> | undefined
  private active: Promise<void> | undefined
  constructor(path: string) { this.store = new Store(path) }
  start() { this.schedule(0) }
  private schedule(delay: number) {
    if (this.stopped) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.active = this.tick().catch(error => {
      if (!this.stopped) { this.store.set('lastError', error instanceof Error ? error.message : String(error)); this.schedule(30_000) }
    }) }, delay)
    this.timer.unref()
  }
  private discovery(full = false) {
    const to = moscowDay()
    const previous = this.store.get('lastDiscovery', '')
    const from = full || !previous ? shiftDay(to, -29) : [shiftDay(to, -29), shiftDay(moscowDay(Date.parse(previous)), -1)].sort().at(-1)!
    const base = { from, to, cycle: new Date().toISOString() }
    const taxonomy = this.store.get<Taxonomy>('taxonomy', { roles: [], directions: [] })
    const seeds: CrawlTask[] = taxonomy.roles.length ? searchPlan(taxonomy.roles, base) : [{ ...base, kind: 'market', label: 'Удалёнка: поиск кандидатов', format: 'REMOTE' }]
    if (this.store.get<number>('queueVersion', 0) !== QUEUE_VERSION) this.store.optimizeQueue(seeds)
    else this.store.enqueueMany(seeds)
    this.store.set('cycle', base.cycle)
    this.store.set('lastDiscovery', base.cycle)
    this.store.set('nextDiscovery', Date.now() + DISCOVERY_INTERVAL)
    this.store.set('discoveryWindow', { from, to })
  }
  private block(diagnostic: ResponseDiagnostic) {
    const streak = this.store.get('blockStreak', 0) + 1
    const delay = Math.max(retryAfterMs(diagnostic.retryAfter), Math.min(30 * 60_000, 5 * 60_000 * 2 ** Math.min(streak - 1, 8)))
    this.store.set('blockStreak', streak)
    this.store.set('blockedUntil', Date.now() + delay)
    this.store.set('requestInterval', Math.min(60_000, Math.max(20_000, this.store.get('requestInterval', MIN_INTERVAL) * 2)))
    this.store.set('successStreak', 0)
    return delay
  }
  private success() {
    this.store.set('lastError', null)
    this.store.set('blockStreak', 0)
    this.store.set('blockedUntil', 0)
    const streak = this.store.get('successStreak', 0) + 1
    this.store.set('successStreak', streak % 10)
    if (streak >= 10) this.store.set('requestInterval', Math.max(MIN_INTERVAL, this.store.get('requestInterval', MIN_INTERVAL) - 2000))
  }
  async tick() {
    if (this.stopped) return
    if (!this.store.get('enabled', true) || !this.store.lease(this.owner)) { this.schedule(3000); return }
    if (this.store.get<string>('selectionVersion', '') !== SELECTION_VERSION) {
      this.store.set('enabled', false)
      this.store.set('lastError', 'База использует прежние правила. Для разрешённого обнуления запустите npm run reset-data.')
      this.schedule(3000); return
    }
    // Queue-only migration and periodic discovery do not bypass a network cooldown.
    if (this.store.get<number>('queueVersion', 0) !== QUEUE_VERSION) this.discovery(true)
    else if (this.store.get('nextDiscovery', 0) <= Date.now()) this.discovery()
    const nextAt = Math.max(this.store.get('nextAt', 0), this.store.get('blockedUntil', 0))
    if (nextAt > Date.now()) { this.schedule(Math.min(30_000, nextAt - Date.now())); return }
    const entry = this.store.next(this.store.get('requests', 0) % 3 !== 0)
    if (!entry) { this.schedule(3000); return }
    const { task } = entry
    this.store.set('running', true)
    this.store.set('current', `${task.candidate?.work_format?.every(item => item.id === 'REMOTE') || task.format === 'REMOTE' ? 'Удалённо' : 'Гибрид'} · ${task.label}${task.page ? ` · страница ${task.page + 1}` : ''} · ${task.from}…${task.to}`)
    this.store.set('requests', this.store.get('requests', 0) + 1)
    let delay = this.store.get('requestInterval', MIN_INTERVAL)
    try {
      const response = await fetch(taskUrl(task), {
        headers: { Accept: 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9', 'User-Agent': 'JobFinder/0.1' }, signal: AbortSignal.timeout(20_000),
      })
      if (task.kind === 'detail' && [404, 410].includes(response.status) && task.candidate) {
        this.store.reject(task.candidate.id, 'closed')
        this.store.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(entry.id)
        this.success()
        return
      }
      if (!response.ok) {
        const diagnostic = responseDiagnostic(response.status, await responsePreview(response), taskUrl(task), response.headers.get('retry-after'))
        this.store.set('lastFailure', diagnostic)
        if ([403, 429].includes(response.status)) delay = this.block(diagnostic)
        else if (response.status >= 500) delay = Math.max(delay, 60_000, retryAfterMs(diagnostic.retryAfter))
        else delay = Math.max(delay, retryAfterMs(diagnostic.retryAfter))
        throw new HhPageError(`hh.ru вернул ${response.status}: ${diagnostic.reason}.${diagnostic.title ? ` ${diagnostic.title}.` : ''} Повтор будет автоматическим.`)
      }
      const html = await response.text()
      if (html.length > 8_000_000) throw new HhPageError('Страница hh.ru слишком большая для обработки.')
      if (this.stopped) return
      if (!/id\s*=\s*["']HH-Lux-InitialState["']/i.test(html) && /captcha|access denied|доступ ограничен|провер.{0,25}робот/iu.test(html)) {
        const diagnostic = { ...responseDiagnostic(response.status, html.slice(0, 4096), taskUrl(task), response.headers.get('retry-after')), reason: 'Проверка доступа / капча' }
        this.store.set('lastFailure', diagnostic)
        delay = this.block(diagnostic)
        throw new HhPageError('hh.ru запросил проверку доступа / капчу. Сбор ждёт перед автоматическим повтором.')
      }
      if (task.kind === 'detail' && task.candidate) {
        const vacancy = parseVacancyDetail(html, task.candidate)
        const reason = rejectionFor(vacancy, true)
        if (reason) this.store.reject(vacancy.id, reason)
        else this.store.ingest({ items: [vacancy], found: 1, fetchedAt: new Date().toISOString(), sourceUrl: taskUrl(task) })
        this.store.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(entry.id)
        this.success()
        return
      }
      const data = parseSearchPage(html, taskUrl(task))
      if (this.stopped) return
      const requested = new URL(taskUrl(task)).searchParams
      if (!data.appliedFilters?.dateFrom.startsWith(requested.get('date_from')!) || !data.appliedFilters.dateTo.startsWith(requested.get('date_to')!) || data.appliedFilters.page !== (task.page || 0) || !data.appliedFilters.areas.includes(task.area || '113')) throw new HhPageError('hh.ru не применил фильтры даты, региона или страницы. Обход среза отложен.')
      const formats = requested.getAll('work_format')
      if (data.appliedFilters.workFormats.length !== formats.length || !formats.every(format => data.appliedFilters?.workFormats.includes(format))) throw new HhPageError('hh.ru не применил запрошенный формат работы. Обход среза отложен.')
      if (task.text && data.appliedFilters.text !== task.text) throw new HhPageError('hh.ru не применил поисковый текст. Обход среза отложен.')
      if (task.roles?.length && data.items.some(item => item.role_ids?.length && !item.role_ids.some(id => task.roles!.includes(id)))) throw new HhPageError('hh.ru вернул вакансии вне выбранной профессии. Обход этого среза отложен.')
      if (task.kind === 'market') {
        if (!data.taxonomy?.roles.length || !data.taxonomy.directions.length) throw new HhPageError('Не удалось получить классификатор профессий hh.ru.')
        this.store.taxonomy(data.taxonomy)
        this.store.market('total', 'all', 'Найдено до проверки исключений', data.found)
        for (const row of data.clusters?.find(cluster => cluster.id === 'professional_role')?.items || []) if (row.id) this.store.market('profession', row.id, row.name, row.count)
        const roles = data.taxonomy.roles.filter(role => !skipProfession(role.name))
        this.store.set('targetRoleCount', roles.length)
        this.store.enqueueMany(searchPlan(roles, task))
        if (!this.store.get<Named[]>('regions', []).length) {
          try {
            const areas = await fetch('https://api.hh.ru/areas/113', { headers: { 'User-Agent': 'JobFinder/0.1' }, signal: AbortSignal.timeout(15_000) })
            const body = await areas.json() as { areas?: Named[] }
            if (areas.ok && Array.isArray(body.areas)) this.store.set('regions', body.areas.map(({ id, name }) => ({ id, name })))
          } catch { /* Date/experience partitions work without geography. */ }
        }
      }
      const details: CrawlTask[] = []
      for (const vacancy of data.items) {
        const reason = rejectionFor(vacancy)
        if (reason) this.store.reject(vacancy.id, reason)
        else details.push({ ...task, kind: 'detail', label: `Описание: ${vacancy.name}`, candidate: vacancy, page: 0 })
      }
      const expansion = expandTask(task, data.found, this.store.get<Named[]>('regions', []))
      this.store.enqueueMany([...details, ...expansion.tasks])
      if (task.kind === 'direction' && task.directionId) this.store.market('direction', task.directionId, task.label, data.found)
      if (task.kind === 'profession' && task.roles?.[0]) this.store.market('profession', task.roles[0], task.label, data.found)
      this.store.db.prepare("UPDATE tasks SET status='done',limited=? WHERE id=?").run(Number(expansion.limited), entry.id)
      this.success()
    } catch (error) {
      if (this.stopped) return
      const taskDelay = Math.max(delay, Math.min(30 * 60_000, 60_000 * 2 ** entry.attempts))
      this.store.set('lastError', error instanceof Error ? error.message : String(error))
      this.store.db.prepare('UPDATE tasks SET attempts=attempts+1,due=?,status=? WHERE id=?').run(Date.now() + taskDelay, entry.attempts >= 5 ? 'failed' : 'pending', entry.id)
    } finally {
      if (!this.stopped) { this.store.set('running', false); this.store.set('nextAt', Date.now() + delay); this.schedule(delay) }
    }
  }
  control(enabled: boolean) {
    this.store.set('enabled', enabled)
    if (enabled) this.store.db.exec("UPDATE tasks SET status='pending',attempts=0,due=0 WHERE status='failed'")
  }
  async close() {
    this.stopped = true
    clearTimeout(this.timer)
    await this.active
    this.store.release(this.owner)
    this.store.close()
  }
}
