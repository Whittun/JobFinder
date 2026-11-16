import { randomUUID } from 'node:crypto'
import { sourceDefinitions } from '../src/lib/sources.ts'
import type { SourceDefinition } from '../src/lib/sources.ts'
import { parseSource, allowedSourceUrl } from './source-adapters.ts'
import { boardFromUrl } from './source-identity.ts'
import type { Store } from './store.ts'
import type { SourceTask } from './source-state.ts'
import { retryAfterMs } from './collector-policy.ts'

async function bodyLimited(response: Response, max = 12000000) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []; let length = 0
  try {
    while (true) { const value = await reader.read(); if (value.done) break; length += value.value.byteLength; if (length > max) throw new Error('Ответ источника превышает 12 МБ'); chunks.push(value.value) }
  } finally { await reader.cancel().catch(() => {}) }
  return Buffer.concat(chunks).toString('utf8')
}

export class SourceRunner {
  store: Store
  private owner = randomUUID()
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false
  private active = new Set<Promise<void>>()
  private controllers = new Set<AbortController>()
  constructor(store: Store) { this.store = store }
  start() {
    this.store.sources.initializeOrigins()
    for (const source of sourceDefinitions) {
      const previous = this.store.get<string | null>(`sourceEndpoint:${source.id}`, null)
      if (previous !== source.url) {
        // A changed public endpoint can fix a parser error. Access refusals and network cooldowns remain intact.
        const state = this.store.db.prepare('SELECT last_status,last_error FROM source_state WHERE id=?').get(source.id)
        if (state?.last_status === 200 && state.last_error && !/капч|проверк.*доступ/iu.test(String(state.last_error))) this.store.db.prepare('UPDATE source_state SET next_at=0 WHERE id=?').run(source.id)
        this.store.set(`sourceEndpoint:${source.id}`, source.url)
      }
      const board = boardFromUrl(source.url)
      if (board) {
        for (const row of this.store.db.prepare('SELECT url FROM source_boards WHERE source_id=?').all(source.id)) this.addBoard(String(row.url))
        this.addBoard(source.url)
      }
      else if (source.kind === 'search') {
        const queries = ['site:jobs.ashbyhq.com web Russian remote']
        this.store.db.prepare("UPDATE source_tasks SET status='superseded' WHERE source_id='search' AND kind='search' AND json_extract(context,'$.query') NOT IN (SELECT value FROM json_each(?))").run(JSON.stringify(queries))
        for (const query of queries) this.store.sources.enqueue(source.id, `${source.url}?q=${encodeURIComponent(query)}`, 'search', { query, recurring: true })
      } else this.store.sources.enqueue(source.id, source.url, source.kind === 'html' ? 'index' : 'feed', { recurring: true, depth: 0 })
    }
    this.schedule(2000)
  }
  addBoard(value: string) {
    const board = boardFromUrl(value)
    if (!board) throw new Error('Поддерживаются карьерные страницы Ashby, Greenhouse и Lever.')
    if (!sourceDefinitions.some(source => source.id === board.source)) throw new Error('Этот источник удалён из сборщика.')
    board.url = new URL(board.url).href
    // Retire old bulk endpoints and case aliases without touching job provenance or personal marks.
    for (const row of this.store.db.prepare('SELECT url FROM source_boards WHERE source_id=?').all(board.source)) {
      if (boardFromUrl(String(row.url))?.url === board.url && String(row.url) !== board.url) this.store.db.prepare('DELETE FROM source_boards WHERE source_id=? AND url=?').run(board.source, row.url)
    }
    for (const row of this.store.db.prepare("SELECT id,url FROM source_tasks WHERE source_id=? AND kind='board' AND status!='superseded'").all(board.source)) {
      if (boardFromUrl(String(row.url))?.url === board.url && new URL(String(row.url)).href !== new URL(board.url).href) {
        const current = new URL(String(row.url)); current.searchParams.sort()
        const target = new URL(board.url); target.searchParams.sort()
        if (current.href !== target.href) this.store.db.prepare("UPDATE source_tasks SET status='superseded' WHERE id=?").run(row.id)
      }
    }
    const exists = this.store.db.prepare('SELECT 1 FROM source_boards WHERE source_id=? AND url=?').get(board.source, board.url)
    if (!exists && this.store.count('SELECT count(*) count FROM source_boards') >= 500) throw new Error('Достигнут лимит 500 карьерных страниц.')
    this.store.db.prepare('INSERT OR IGNORE INTO source_boards VALUES (?,?,?)').run(board.source, board.url, board.label)
    this.store.sources.enqueue(board.source, board.url, 'board', { board: board.label, recurring: true })
    return board
  }
  private schedule(delay: number) {
    if (this.stopped) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => { void this.tick() }, delay); this.timer.unref()
  }
  async tick() {
    if (this.stopped) return
    try {
      if (!this.store.get('enabled', true)) return
      for (const source of sourceDefinitions) {
        if (this.active.size >= 3) break
        if (source.kind === 'search' && !process.env.SERPER_API_KEY) continue
        const task = this.store.sources.claim(source.id, this.owner)
        if (!task) continue
        const promise = this.run(source, task).catch(error => { if (!this.stopped) { try { this.store.sources.event(source.id, error instanceof Error ? error.message : String(error), 'error') } catch { /* Retry on the next scheduler tick if SQLite is busy. */ } } }).finally(() => this.active.delete(promise))
        this.active.add(promise)
      }
    } catch (error) { if (!this.stopped) { try { this.store.sources.event('system', error instanceof Error ? error.message : String(error), 'error') } catch { /* Retry on the next scheduler tick. */ } } }
    finally { this.schedule(1500) }
  }
  private async run(source: SourceDefinition, task: SourceTask) {
    const controller = new AbortController(); this.controllers.add(controller)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])
    const db = this.store.db
    let status = 0, retry = 0
    try {
      if (!allowedSourceUrl(source, task.url)) throw new Error('Адрес задачи не входит в разрешённые домены источника')
      const search = source.kind === 'search'
      const headers: Record<string, string> = { 'User-Agent': 'JobFinder/0.2', Accept: 'application/json,text/html,application/rss+xml,application/xml', 'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.7' }
      if (source.kind === 'lever') headers['Accept-Encoding'] = 'identity'
      if (search) { headers['X-API-KEY'] = process.env.SERPER_API_KEY!; headers['Content-Type'] = 'application/json' }
      const cached = db.prepare('SELECT etag,last_modified FROM source_http_cache WHERE url=?').get(task.url)
      if (cached?.etag) headers['If-None-Match'] = String(cached.etag)
      if (cached?.last_modified) headers['If-Modified-Since'] = String(cached.last_modified)
      let target = search ? source.url : task.url
      let response: Response | undefined
      for (let redirect = 0; redirect <= 4; redirect++) {
        response = await fetch(target, { method: search ? 'POST' : 'GET', headers, body: search ? JSON.stringify({ q: task.context.query, num: 20 }) : undefined, signal, redirect: 'manual' })
        if (![301,302,303,307,308].includes(response.status)) break
        const location = response.headers.get('location')
        await response.body?.cancel()
        if (!location) throw new Error('Источник вернул перенаправление без адреса')
        target = new URL(location, target).href
        if (!allowedSourceUrl(source, target)) throw new Error('Переход на другой источник остановлен; циклический обход не запускается')
        response = undefined
      }
      if (!response) throw new Error('Слишком много перенаправлений')
      status = response.status
      if (status === 304) {
        await response.body?.cancel()
        db.prepare("UPDATE source_tasks SET status=?,due=?,checked_at=? WHERE id=?").run(task.context.recurring ? 'pending' : 'done', Date.now()+source.interval, Date.now(), task.id)
        db.prepare('UPDATE source_state SET last_success=?,last_error=NULL,last_status=304,failures=0,next_at=? WHERE id=?').run(new Date().toISOString(),Date.now()+source.pace,source.id)
        this.store.sources.event(source.id,'Лента не изменилась (304): скачивание и разбор пропущены')
        return
      }
      retry = retryAfterMs(response.headers.get('retry-after'))
      if (!response.ok) { await response.body?.cancel(); throw new Error(`HTTP ${status}: ${status === 429 ? 'источник ограничил частоту запросов' : status === 403 ? 'источник запретил автоматический доступ' : status === 404 ? 'страница или карьерный борд не найдены' : 'не удалось получить данные'}`) }
      const body = await bodyLimited(response)
      if (this.stopped) return
      const parsed = parseSource(source, body, task)
      db.prepare('INSERT OR REPLACE INTO source_http_cache VALUES (?,?,?)').run(task.url,response.headers.get('etag'),response.headers.get('last-modified'))
      const counts = this.store.sources.accept(source.id, parsed.jobs, items => this.store.ingest({ items, found: items.length, fetchedAt: new Date().toISOString(), sourceUrl: task.url }))
      for (const link of parsed.links) if (allowedSourceUrl(source, link.url)) this.store.sources.enqueue(source.id, link.url, link.kind, link.context || {})
      for (const board of [...new Set(parsed.boards)].slice(0, 20)) { try { this.addBoard(board) } catch { /* A discovery must not stop collection if the registry is full. */ } }
      const recurring = task.context.recurring === true
      db.prepare('UPDATE source_tasks SET status=?,due=?,attempts=0,checked_at=? WHERE id=?').run(recurring ? 'pending' : 'done', recurring ? Date.now()+source.interval : 0, Date.now(), task.id)
      db.prepare('UPDATE source_state SET last_success=?,last_error=NULL,last_status=?,failures=0,next_at=? WHERE id=?').run(new Date().toISOString(), status, Date.now()+source.pace, source.id)
      this.store.sources.event(source.id, `${parsed.message}; новых ${counts.saved}, повторов ${counts.duplicates}, отсеяно ${counts.rejected}`)
    } catch (error) {
      if (this.stopped || controller.signal.aborted) return
      const cause = error instanceof Error && error.cause && typeof error.cause === 'object' && 'code' in error.cause ? String(error.cause.code) : ''
      const message = error instanceof Error && error.name === 'TimeoutError' ? 'Источник не ответил за 20 секунд' : `${error instanceof Error ? error.message : String(error)}${/^[A-Z0-9_]+$/.test(cause) ? ` (${cause})` : ''}`
      const failures = Number(db.prepare('SELECT failures FROM source_state WHERE id=?').get(source.id)?.failures || 0)+1
      const blocked = [403,429].includes(status) || /капч|проверку доступа/iu.test(message)
      const delay = Math.max(retry, Math.min(6*3600000, (blocked ? 15 : 5)*60000*2**Math.min(failures-1, 6)))
      db.prepare('UPDATE source_tasks SET attempts=attempts+1,due=?,checked_at=?,status=? WHERE id=?').run(Date.now()+delay, Date.now(), status === 404 ? 'failed' : 'pending', task.id)
      db.prepare('UPDATE source_state SET last_error=?,last_status=?,failures=?,next_at=? WHERE id=?').run(message, status || null, failures, status === 404 ? Date.now()+source.pace : Date.now()+delay, source.id)
      this.store.sources.event(source.id, message, 'error')
    } finally {
      this.controllers.delete(controller)
      db.prepare("UPDATE source_state SET lease_owner='',lease_until=0 WHERE id=? AND lease_owner=?").run(source.id, this.owner)
    }
  }
  async close() {
    this.stopped = true; clearTimeout(this.timer)
    for (const controller of this.controllers) controller.abort()
    await Promise.allSettled([...this.active])
  }
}
