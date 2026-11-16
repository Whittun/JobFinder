import type { DatabaseSync } from 'node:sqlite'
import { sourceDefinitions } from '../src/lib/sources.ts'
import type { SourceTrack } from '../src/lib/sources.ts'
import type { Vacancy } from '../src/lib/hh.ts'
import { digest, identityKeys, normalizeUrl, originalIdentity } from './source-identity.ts'
import { rejectionFor } from './selection.ts'

export type SourceTask = { id: number; source: string; url: string; kind: string; attempts: number; context: Record<string, unknown> }
const retiredReasons: Record<string, string> = {
  himalayas: 'Удалён из сборщика: публичный API недоступен с этой машины (ECONNRESET).',
  remotive: 'Удалён из сборщика: API и XML-ленты возвращают HTTP 403.',
  remoteok: 'Удалён из сборщика: JSON-ответы обрываются по таймауту; RSS возвращает HTTP 410.',
  'tg-react': 'Удалён из сборщика: публичная Telegram-лента недоступна (CONNECT_TIMEOUT); API требует отдельной авторизации.',
  'tg-frontend': 'Удалён из сборщика: публичная Telegram-лента недоступна (CONNECT_TIMEOUT); API требует отдельной авторизации.',
}
export class SourceState {
  db: DatabaseSync
  constructor(db: DatabaseSync) {
    this.db = db
    db.exec(`
      CREATE TABLE IF NOT EXISTS source_state (id TEXT PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 1,lease_owner TEXT NOT NULL DEFAULT '',lease_until INTEGER NOT NULL DEFAULT 0,next_at INTEGER NOT NULL DEFAULT 0,current TEXT NOT NULL DEFAULT '',last_success TEXT,last_error TEXT,last_status INTEGER,requests INTEGER NOT NULL DEFAULT 0,saved INTEGER NOT NULL DEFAULT 0,duplicates INTEGER NOT NULL DEFAULT 0,rejected INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS source_tasks (id INTEGER PRIMARY KEY,source_id TEXT NOT NULL,url TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',due INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,checked_at INTEGER NOT NULL DEFAULT 0,context TEXT NOT NULL DEFAULT '{}',UNIQUE(source_id,url));
      CREATE INDEX IF NOT EXISTS source_tasks_next ON source_tasks(source_id,status,due,id);
      CREATE TABLE IF NOT EXISTS source_hosts (host TEXT PRIMARY KEY,next_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS source_http_cache (url TEXT PRIMARY KEY,etag TEXT,last_modified TEXT);
      CREATE TABLE IF NOT EXISTS source_boards (source_id TEXT NOT NULL,url TEXT NOT NULL,label TEXT NOT NULL,PRIMARY KEY(source_id,url));
      CREATE TABLE IF NOT EXISTS vacancy_origins (alias_key TEXT PRIMARY KEY,vacancy_id TEXT NOT NULL,source_id TEXT NOT NULL,url TEXT NOT NULL,last_seen TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS vacancy_origins_job ON vacancy_origins(vacancy_id,source_id);
      CREATE TABLE IF NOT EXISTS source_events (id INTEGER PRIMARY KEY,source_id TEXT NOT NULL,at TEXT NOT NULL,level TEXT NOT NULL,message TEXT NOT NULL);
    `)
    for (const source of sourceDefinitions) db.prepare('INSERT OR IGNORE INTO source_state(id) VALUES (?)').run(source.id)
    const active = JSON.stringify(sourceDefinitions.map(source => source.id))
    for (const row of db.prepare('SELECT id FROM source_state WHERE id NOT IN (SELECT value FROM json_each(?)) AND enabled=1').all(active)) this.event(String(row.id), retiredReasons[String(row.id)] || 'Источник больше не используется; очередь остановлена.', 'info')
    db.prepare("UPDATE source_state SET enabled=0,lease_owner='',lease_until=0 WHERE id NOT IN (SELECT value FROM json_each(?))").run(active)
    db.prepare("UPDATE source_tasks SET status='retired' WHERE source_id NOT IN (SELECT value FROM json_each(?)) AND status!='retired'").run(active)
    db.prepare('DELETE FROM source_boards WHERE source_id NOT IN (SELECT value FROM json_each(?))').run(active)
  }
  event(source: string, message: string, level = 'info') {
    this.db.prepare('INSERT INTO source_events(source_id,at,level,message) VALUES (?,?,?,?)').run(source, new Date().toISOString(), level, message.slice(0, 800))
    if (Number(this.db.prepare('SELECT max(id) n FROM source_events').get()?.n) % 100 === 0) this.db.exec('DELETE FROM source_events WHERE id<(SELECT max(id)-10000 FROM source_events)')
  }
  resolve(job: Vacancy, fingerprint = false) {
    const keys = identityKeys(job)
    for (const key of [...keys.strong, ...(fingerprint && keys.fingerprint ? [keys.fingerprint] : [])]) {
      const row = this.db.prepare('SELECT vacancy_id FROM vacancy_origins WHERE alias_key=?').get(key)
      if (row) return String(row.vacancy_id)
      if (key.startsWith('hh:') && this.db.prepare('SELECT id FROM vacancies WHERE id=?').get(key.slice(3))) return key.slice(3)
    }
    const original = [job.source?.originalUrl, job.alternate_url].filter(Boolean).map(url => originalIdentity(url!)).find(Boolean)
    return original?.id || job.id
  }
  register(job: Vacancy) {
    const source = job.source?.id || 'hh'
    const url = job.source?.url || job.alternate_url || ''
    const keys = identityKeys(job)
    const statement = this.db.prepare('INSERT INTO vacancy_origins VALUES (?,?,?,?,?) ON CONFLICT(alias_key) DO UPDATE SET last_seen=excluded.last_seen')
    for (const key of [...keys.strong, ...(keys.fingerprint ? [keys.fingerprint] : []), `origin:${source}:${digest(url)}`]) statement.run(key, job.id, source, url, new Date().toISOString())
  }
  initializeOrigins() {
    if (this.db.prepare("SELECT 1 FROM meta WHERE key='sourceOriginsVersion'").get()) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const row of this.db.prepare('SELECT payload FROM vacancies').all()) this.register(JSON.parse(String(row.payload)))
      this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('sourceOriginsVersion','1')").run()
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  origins(id: string) {
    return this.db.prepare("SELECT source_id,url FROM vacancy_origins WHERE vacancy_id=? AND alias_key LIKE 'origin:%' GROUP BY source_id,url ORDER BY source_id").all(id).map(row => ({ source: String(row.source_id), name: row.source_id === 'hh' ? 'hh.ru' : sourceDefinitions.find(source => source.id === row.source_id)?.name || String(row.source_id), url: String(row.url) }))
  }
  enqueue(source: string, value: string, kind: string, context: Record<string, unknown> = {}, due = 0) {
    if (!sourceDefinitions.some(item => item.id === source)) return
    const url = normalizeUrl(value)
    if (!url) return
    this.db.prepare(`INSERT INTO source_tasks(source_id,url,kind,context,due) VALUES (?,?,?,?,?) ON CONFLICT(source_id,url) DO UPDATE SET status=CASE WHEN source_tasks.status IN ('done','failed') AND source_tasks.checked_at<? THEN 'pending' ELSE source_tasks.status END,due=CASE WHEN source_tasks.status IN ('done','failed') AND source_tasks.checked_at<? THEN excluded.due ELSE source_tasks.due END,context=excluded.context`).run(source, url, kind, JSON.stringify(context), due, Date.now() - 3*86400000, Date.now() - 3*86400000)
  }
  claim(source: string, owner: string): SourceTask | null {
    const definition = sourceDefinitions.find(item => item.id === source)
    if (!definition) return null
    const now = Date.now()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const state = this.db.prepare('SELECT * FROM source_state WHERE id=?').get(source)
      if (Number(this.db.prepare('SELECT count(*) n FROM source_state WHERE lease_until>?').get(now)?.n) >= 3) { this.db.exec('COMMIT'); return null }
      if (!state?.enabled || Number(state.lease_until) > now || Number(state.next_at) > now) { this.db.exec('COMMIT'); return null }
      const row = this.db.prepare("SELECT * FROM source_tasks WHERE source_id=? AND status='pending' AND due<=? ORDER BY CASE WHEN kind='public-job' THEN 0 WHEN kind='detail' THEN 1 ELSE 2 END,id LIMIT 1").get(source, now)
      if (!row) { this.db.exec('COMMIT'); return null }
      const host = new URL(String(row.url)).hostname
      const next = Number(this.db.prepare('SELECT next_at FROM source_hosts WHERE host=?').get(host)?.next_at || 0)
      if (next > now) { this.db.prepare('UPDATE source_state SET next_at=? WHERE id=?').run(next, source); this.db.exec('COMMIT'); return null }
      this.db.prepare('INSERT INTO source_hosts VALUES (?,?) ON CONFLICT(host) DO UPDATE SET next_at=excluded.next_at').run(host, now + definition.pace)
      this.db.prepare('UPDATE source_state SET lease_owner=?,lease_until=?,current=?,requests=requests+1 WHERE id=?').run(owner, now+90000, String(row.url), source)
      this.db.exec('COMMIT')
      return { id: Number(row.id), source, url: String(row.url), kind: String(row.kind), attempts: Number(row.attempts), context: JSON.parse(String(row.context)) }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  accept(sourceId: string, jobs: Vacancy[], ingest: (items: Vacancy[]) => void) {
    let saved = 0, duplicates = 0, rejected = 0
    for (const raw of jobs) {
      this.db.exec('BEGIN IMMEDIATE')
      try {
      const source = sourceDefinitions.find(item => item.id === sourceId)!
      const job = { ...raw, source: raw.source || { id: sourceId, name: source.name, url: raw.alternate_url || source.url } }
      job.id = this.resolve(job, true)
      const existing = this.db.prepare('SELECT payload FROM vacancies WHERE id=?').get(job.id)
      const previous = existing ? JSON.parse(String(existing.payload)) as Vacancy : null
      if (rejectionFor(job, true)) {
        if (previous?.source?.id === sourceId) ingest([job])
        rejected++; this.db.exec('COMMIT'); continue
      }
      if (existing) {
        duplicates++
        if (previous?.source?.id === sourceId) {
          if (job.date_estimated && previous.date_estimated) job.published_at = previous.published_at
          ingest([job])
        }
        this.register(job)
      } else {
        ingest([job]); this.register(job); saved++
      }
      this.db.exec('COMMIT')
      } catch (error) { this.db.exec('ROLLBACK'); throw error }
    }
    this.db.prepare('UPDATE source_state SET saved=saved+?,duplicates=duplicates+?,rejected=rejected+? WHERE id=?').run(saved, duplicates, rejected, sourceId)
    return { saved, duplicates, rejected }
  }
  tracks(): SourceTrack[] {
    const now = Date.now()
    return sourceDefinitions.map(source => {
      const row = this.db.prepare('SELECT * FROM source_state WHERE id=?').get(source.id)!
      const running = Number(row.lease_until) > now
      const needsKey = source.kind === 'search' && !process.env.SERPER_API_KEY
      const due = Number(this.db.prepare("SELECT min(due) n FROM source_tasks WHERE source_id=? AND status='pending'").get(source.id)?.n || 0)
      return { id: source.id, name: source.name, color: source.color, note: source.note, enabled: !!row.enabled, running, phase: !row.enabled ? 'paused' : needsKey ? 'needs_key' : running ? 'running' : row.last_error ? 'error' : 'waiting', current: String(row.current), nextAt: Math.max(Number(row.next_at), due), lastSuccess: row.last_success ? String(row.last_success) : null, lastError: row.last_error ? String(row.last_error) : null, lastStatus: row.last_status == null ? null : Number(row.last_status), requests: Number(row.requests), saved: Number(row.saved), duplicates: Number(row.duplicates), rejected: Number(row.rejected), pending: Number(this.db.prepare("SELECT count(*) n FROM source_tasks WHERE source_id=? AND status='pending'").get(source.id)?.n), boards: Number(this.db.prepare('SELECT count(*) n FROM source_boards WHERE source_id=?').get(source.id)?.n) }
    })
  }
}
