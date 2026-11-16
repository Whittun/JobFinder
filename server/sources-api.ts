import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Collector } from './collector.ts'
import type { SourceTrack } from '../src/lib/sources.ts'
import { sourceDefinitions } from '../src/lib/sources.ts'
import { boardFromUrl } from './source-identity.ts'

export async function sourcesApi(req: IncomingMessage, res: ServerResponse, url: URL, collector: Collector) {
  if (url.pathname !== '/api/sources' && !url.pathname.startsWith('/api/sources/')) return false
  const store = collector.store
  res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store')
  const send = (status: number, body: unknown) => res.writeHead(status).end(JSON.stringify(body))
  try {
    if (url.pathname === '/api/sources' && req.method === 'GET') {
      const now = Date.now(), enabled = store.get('hhEnabled', true), lease = store.get('lease', { until: 0 })
      const running = store.get('running', false) && lease.until > now
      const failure = store.get<{ status?: number } | null>('lastFailure', null)
      const lastError = store.get<string | null>('lastError', null)
      const hh: SourceTrack = {
        id: 'hh', name: 'hh.ru', color: '#d84750', note: 'Удалёнка и гибрид; веб-разработка и технические роли', enabled, running,
        phase: !enabled ? 'paused' : running ? 'running' : lastError ? 'error' : 'waiting', current: store.get('current', ''),
        nextAt: Math.max(store.get('nextAt', 0), store.get('blockedUntil', 0)), lastSuccess: store.get('hhLastSuccess', store.get('lastSuccess', null)), lastError, lastStatus: lastError ? failure?.status ?? null : null,
        requests: store.get('requests', 0), saved: store.count("SELECT count(*) count FROM vacancies WHERE json_extract(payload,'$.source.id') IS NULL OR json_extract(payload,'$.source.id')='hh'"),
        duplicates: store.get('cacheSkipped', 0), rejected: store.count('SELECT count(*) count FROM rejected_ids'), pending: store.taskStats().pending, boards: 0,
      }
      send(200, { enabled: store.get('enabled', true), stored: store.count('SELECT count(*) count FROM vacancies'), tracks: [hh, ...store.sources.tracks()], boards: store.db.prepare('SELECT source_id source,url,label FROM source_boards ORDER BY source_id,label').all(), events: store.db.prepare('SELECT id,source_id source,at,level,message FROM source_events ORDER BY id DESC LIMIT 35').all() })
      return true
    }
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); send(405, { message: 'Доступен только POST.' }); return true }
    if (req.headers.origin) { let host = ''; try { host = new URL(req.headers.origin).host } catch { /* Invalid origins are rejected. */ } if (host !== req.headers.host) { send(403, { message: 'Запрос с другого сайта запрещён.' }); return true } }
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { send(415, { message: 'Ожидается application/json.' }); return true }
    let input = ''
    for await (const chunk of req) { input += String(chunk); if (Buffer.byteLength(input) > 2048) { send(413, { message: 'Слишком большой запрос.' }); return true } }
    let body: Record<string, unknown>
    try { const parsed = JSON.parse(input); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); body = parsed } catch { send(400, { message: 'Ожидается JSON.' }); return true }
    if (url.pathname === '/api/sources/boards') {
      if (typeof body.url !== 'string' || body.url.length > 1000 || !boardFromUrl(body.url)) { send(400, { message: 'Укажите адрес карьерной страницы Ashby, Greenhouse или Lever.' }); return true }
      const board = collector.sources.addBoard(body.url)
      store.sources.event(board.source, `Добавлена карьерная страница ${board.label}`)
      send(200, board); return true
    }
    const id = url.pathname.slice('/api/sources/'.length)
    if (!['hh', ...sourceDefinitions.map(source => source.id)].includes(id)) { send(404, { message: 'Источник не найден.' }); return true }
    if (typeof body.enabled !== 'boolean') { send(400, { message: 'Укажите enabled: true или false.' }); return true }
    if (id === 'hh') store.set('hhEnabled', body.enabled)
    else store.db.prepare('UPDATE source_state SET enabled=? WHERE id=?').run(Number(body.enabled), id)
    store.sources.event(id, body.enabled ? 'Источник включён; существующие паузы после ошибок сохранены' : 'Источник приостановлен')
    send(200, { enabled: body.enabled })
  } catch { send(500, { message: 'Не удалось прочитать или изменить состояние источников.' }) }
  return true
}
