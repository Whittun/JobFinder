import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Analytics, AnalyticsFilters, JobGroupSummary, ProfessionSummary, Ranking } from '../src/lib/analytics.ts'
import { experienceOptions } from '../src/lib/analytics.ts'
import { median, salaryOf } from '../src/lib/hh.ts'
import type { Taxonomy, VacanciesResponse, Vacancy } from '../src/lib/hh.ts'
import { taskKey } from './crawl-plan.ts'
import type { CrawlTask } from './crawl-plan.ts'
import { extractSkills, normalizeJobTitle } from './knowledge.ts'
import { rejectionFor, rejectionNames, SELECTION_VERSION } from './selection.ts'
import type { Rejection } from './selection.ts'
import { classifyPriorities, priorityDirections } from '../src/lib/priorities.ts'
import type { PriorityMatch } from '../src/lib/priorities.ts'
import { candidateChanged, DETAIL_TTL, QUEUE_VERSION, queuePriority, REJECTION_TTL } from './collector-policy.ts'

export const titleTerms = (title: string) => extractSkills(title).map(item => item.name)
const rankings = (rows: Record<string, unknown>[]): Ranking[] => rows.map(row => ({ id: String(row.id), name: String(row.name), count: Number(row.count), ...(row.collected != null ? { collected: Number(row.collected) } : {}), ...(row.updated_at ? { updatedAt: String(row.updated_at) } : {}) }))

export class Store {
  db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path, { timeout: 5000 })
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS vacancies (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, name TEXT NOT NULL, search_text TEXT NOT NULL,
        area_id TEXT NOT NULL, area_name TEXT NOT NULL, area_path TEXT NOT NULL,
        published INTEGER NOT NULL, employer TEXT NOT NULL, experience TEXT NOT NULL,
        has_salary INTEGER NOT NULL, salary_lower REAL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS vacancies_published ON vacancies(published);
      CREATE INDEX IF NOT EXISTS vacancies_area ON vacancies(area_id);
      CREATE TABLE IF NOT EXISTS roles (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS directions (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS role_directions (role_id TEXT, direction_id TEXT, PRIMARY KEY(role_id,direction_id));
      CREATE TABLE IF NOT EXISTS vacancy_roles (vacancy_id TEXT, role_id TEXT, PRIMARY KEY(vacancy_id,role_id));
      CREATE INDEX IF NOT EXISTS vacancy_roles_role ON vacancy_roles(role_id,vacancy_id);
      CREATE TABLE IF NOT EXISTS vacancy_formats (vacancy_id TEXT, name TEXT, PRIMARY KEY(vacancy_id,name));
      CREATE TABLE IF NOT EXISTS vacancy_terms (vacancy_id TEXT, name TEXT, PRIMARY KEY(vacancy_id,name));
      CREATE TABLE IF NOT EXISTS vacancy_groups (vacancy_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, name TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS vacancy_groups_name ON vacancy_groups(group_id,vacancy_id);
      CREATE TABLE IF NOT EXISTS vacancy_skills (vacancy_id TEXT, name TEXT, category TEXT NOT NULL, source TEXT NOT NULL, evidence TEXT NOT NULL, PRIMARY KEY(vacancy_id,name));
      CREATE INDEX IF NOT EXISTS vacancy_skills_name ON vacancy_skills(name,vacancy_id);
      CREATE TABLE IF NOT EXISTS rejected_ids (id TEXT PRIMARY KEY, reason TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS market_counts (kind TEXT, id TEXT, name TEXT, count INTEGER, updated_at TEXT, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, task_key TEXT UNIQUE, payload TEXT NOT NULL, kind TEXT NOT NULL,
        priority INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, due INTEGER NOT NULL DEFAULT 0, limited INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS tasks_queue ON tasks(status,due,priority,id);
      CREATE INDEX IF NOT EXISTS tasks_priority ON tasks(status,priority,due,id);
    `)
    if (!this.count('SELECT count(*) count FROM vacancies') && !this.get('selectionVersion', '')) this.set('selectionVersion', SELECTION_VERSION)
  }
  get<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key)
    return row ? JSON.parse(String(row.value)) as T : fallback
  }
  set(key: string, value: unknown) { this.db.prepare('INSERT INTO meta VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)) }
  count(sql: string, params: (string | number)[] = []) { return Number(this.db.prepare(sql).get(...params)?.count || 0) }
  taxonomy(taxonomy: Taxonomy) {
    const role = this.db.prepare('INSERT INTO roles VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name')
    const direction = this.db.prepare('INSERT INTO directions VALUES (?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name')
    const relation = this.db.prepare('INSERT OR IGNORE INTO role_directions VALUES (?,?)')
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const item of taxonomy.roles) { role.run(item.id, item.name); for (const category of item.directionIds) relation.run(item.id, category) }
      for (const item of taxonomy.directions) direction.run(item.id, item.name)
      this.set('taxonomy', taxonomy)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  ingest(data: VacanciesResponse) {
    const now = new Date().toISOString()
    const insert = this.db.prepare(`INSERT INTO vacancies VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
      payload=excluded.payload,name=excluded.name,search_text=excluded.search_text,area_id=excluded.area_id,area_name=excluded.area_name,
      area_path=excluded.area_path,published=excluded.published,employer=excluded.employer,experience=excluded.experience,
      has_salary=excluded.has_salary,salary_lower=excluded.salary_lower,last_seen=excluded.last_seen`)
    const role = this.db.prepare('INSERT OR IGNORE INTO vacancy_roles VALUES (?,?)')
    const format = this.db.prepare('INSERT OR IGNORE INTO vacancy_formats VALUES (?,?)')
    const term = this.db.prepare('INSERT OR IGNORE INTO vacancy_terms VALUES (?,?)')
    const group = this.db.prepare('INSERT INTO vacancy_groups VALUES (?,?,?)')
    const mention = this.db.prepare('INSERT INTO vacancy_skills VALUES (?,?,?,?,?)')
    const accepted = data.items.filter(item => {
      const reason = rejectionFor(item, true)
      if (reason) { this.reject(item.id, reason); return false }
      return true
    })
    this.db.exec('BEGIN IMMEDIATE')
    try {
      for (const item of accepted) {
        const salary = salaryOf(item)
        const lower = salary?.currency === 'RUR' && salary.mode?.id === 'MONTH' && salary.gross === false ? salary.from : null
        const normalized = normalizeJobTitle(item.name)
        const mentions = extractSkills(item.name, [...(item.key_skills || []), ...(item.spoken_languages || [])], item.description)
        insert.run(item.id, JSON.stringify({ ...item, normalized_title:normalized,skill_mentions:mentions }), item.name, `${item.name} ${item.employer.name} ${normalized.name} ${item.description || ''} ${(item.key_skills || []).join(' ')}`.toLocaleLowerCase('ru-RU'), item.area.id, item.area.name, item.area_path || '', Date.parse(item.published_at), item.employer.id || item.employer.name, item.experience?.name || 'Не указан', Number(!!salary && (salary.from != null || salary.to != null)), lower ?? null, now, now)
        for (const table of ['vacancy_roles', 'vacancy_formats', 'vacancy_terms', 'vacancy_groups', 'vacancy_skills']) this.db.prepare(`DELETE FROM ${table} WHERE vacancy_id=?`).run(item.id)
        for (const value of item.role_ids || []) role.run(item.id, value)
        for (const value of item.work_format || []) format.run(item.id, value.name)
        group.run(item.id, normalized.id, normalized.name)
        for (const value of mentions) {
          term.run(item.id, value.name)
          mention.run(item.id, value.name, value.category, value.source, value.evidence)
        }
        this.db.prepare('DELETE FROM rejected_ids WHERE id=?').run(item.id)
      }
      this.set('lastSuccess', now)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  reject(id: string, reason: Rejection) {
    for (const table of ['vacancy_roles','vacancy_formats','vacancy_terms','vacancy_groups','vacancy_skills']) this.db.prepare(`DELETE FROM ${table} WHERE vacancy_id=?`).run(id)
    this.db.prepare('DELETE FROM vacancies WHERE id=?').run(id)
    this.db.prepare('INSERT INTO rejected_ids VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET reason=excluded.reason,updated_at=excluded.updated_at').run(id, reason, new Date().toISOString())
  }
  market(kind: string, id: string, name: string, count: number) {
    this.db.prepare('INSERT INTO market_counts VALUES (?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET name=excluded.name,count=excluded.count,updated_at=excluded.updated_at').run(kind, id, name, count, new Date().toISOString())
  }
  enqueue(task: CrawlTask) {
    if (task.kind === 'detail' && task.candidate && this.detailFresh(task.candidate)) {
      this.set('cacheSkipped', this.get('cacheSkipped', 0) + 1)
      return
    }
    const roles = this.get<Taxonomy>('taxonomy', { roles: [], directions: [] }).roles
    const priority = queuePriority(task, roles)
    const key = taskKey(task)
    const existing = this.db.prepare('SELECT id,status,payload,due FROM tasks WHERE task_key=?').get(key)
    if (!existing) {
      this.db.prepare('INSERT INTO tasks(task_key,payload,kind,priority) VALUES (?,?,?,?)').run(key, JSON.stringify(task), task.kind, priority)
    } else if (existing.status === 'pending') {
      // An overlap can promote a job, but must not clear its retry deadline.
      this.db.prepare('UPDATE tasks SET payload=?,priority=min(priority,?) WHERE id=?').run(JSON.stringify(task), priority, existing.id)
    } else if ((existing.status === 'done' || existing.status === 'superseded' || (existing.status === 'failed' && Number(existing.due) <= Date.now() && JSON.parse(String(existing.payload)).cycle !== task.cycle)) && (task.kind === 'detail' || JSON.parse(String(existing.payload)).cycle !== task.cycle)) {
      this.db.prepare("UPDATE tasks SET payload=?,priority=?,status='pending',attempts=0,due=0,limited=0 WHERE id=?").run(JSON.stringify(task), priority, existing.id)
    }
  }
  enqueueMany(tasks: CrawlTask[]) {
    this.db.exec('BEGIN IMMEDIATE')
    try { for (const task of tasks) this.enqueue(task); this.db.exec('COMMIT') }
    catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  detailFresh(candidate: Vacancy) {
    const row = this.db.prepare('SELECT payload FROM vacancies WHERE id=?').get(candidate.id)
    if (row) {
      const saved = JSON.parse(String(row.payload))
      if (Date.parse(saved.detail_fetched_at || '') > Date.now() - DETAIL_TTL && !candidateChanged(saved, candidate)) return true
    }
    const rejected = this.db.prepare('SELECT reason,updated_at FROM rejected_ids WHERE id=?').get(candidate.id)
    return !!rejected && Date.parse(String(rejected.updated_at)) > Date.now() - (rejected.reason === 'closed' ? 7 * REJECTION_TTL : REJECTION_TTL)
  }
  optimizeQueue(seeds: CrawlTask[]) {
    if (this.get<number>('queueVersion', 0) === QUEUE_VERSION) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      // Keep previous tasks as history. Saved vacancies and their derived rows are untouched.
      this.db.prepare("UPDATE tasks SET status='superseded' WHERE kind<>'detail' AND status IN ('pending','failed')").run()
      const roles = this.get<Taxonomy>('taxonomy', { roles: [], directions: [] }).roles
      for (const row of this.db.prepare("SELECT id,payload FROM tasks WHERE kind='detail' AND status IN ('pending','failed') ORDER BY id").all()) {
        const task = JSON.parse(String(row.payload)) as CrawlTask
        if (task.candidate && this.detailFresh(task.candidate)) {
          this.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(row.id)
          this.set('cacheSkipped', this.get('cacheSkipped', 0) + 1)
          continue
        }
        const key = taskKey(task)
        const duplicate = this.db.prepare('SELECT id FROM tasks WHERE task_key=? AND id<>?').get(key, row.id)
        if (duplicate) this.db.prepare("UPDATE tasks SET status='superseded' WHERE id=?").run(row.id)
        else this.db.prepare('UPDATE tasks SET task_key=?,priority=? WHERE id=?').run(key, queuePriority(task, roles), row.id)
      }
      for (const task of seeds) this.enqueue(task)
      this.set('queueVersion', QUEUE_VERSION)
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  next(preferDetail = false) {
    for (let skipped = 0; skipped < 100; skipped++) {
      const now = Date.now()
      const tier = this.db.prepare("SELECT min(CAST(priority/100 AS INTEGER)) tier FROM tasks WHERE status='pending' AND due<=?").get(now)?.tier
      if (tier == null) return null
      const query = (detail: boolean) => this.db.prepare(`SELECT id,payload,attempts FROM tasks WHERE status='pending' AND due<=? AND priority>=? AND priority<? AND kind${detail ? '=' : '<>'}'detail' ORDER BY (attempts>0),priority,id LIMIT 1`).get(now, Number(tier) * 100, (Number(tier) + 1) * 100)
      const row = query(preferDetail) || query(!preferDetail)
      if (!row) return null
      const task = JSON.parse(String(row.payload)) as CrawlTask
      if (task.kind === 'detail' && task.candidate && this.detailFresh(task.candidate)) {
        this.db.prepare("UPDATE tasks SET status='done' WHERE id=?").run(row.id)
        this.set('cacheSkipped', this.get('cacheSkipped', 0) + 1)
        continue
      }
      return { id: Number(row.id), task, attempts: Number(row.attempts) }
    }
    return null
  }
  lease(owner: string) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const current = this.get('lease', { owner: '', until: 0 })
      const allowed = current.owner === owner || current.until < Date.now()
      if (allowed) this.set('lease', { owner, until: Date.now() + 60_000 })
      this.db.exec('COMMIT')
      return allowed
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  release(owner: string) { if (this.get('lease', { owner: '' }).owner === owner) this.set('lease', { owner: '', until: 0 }) }
  taskStats() {
    return {
      pending: this.count("SELECT count(*) count FROM tasks WHERE status='pending'"),
      done: this.count("SELECT count(*) count FROM tasks WHERE status='done'"),
      failed: this.count("SELECT count(*) count FROM tasks WHERE status='failed'"),
      limited: this.count('SELECT count(*) count FROM tasks WHERE limited=1'),
    }
  }
  analytics(filters: AnalyticsFilters): Analytics {
    const params: (string | number)[] = [Date.now() - Number(filters.period) * 86_400_000]
    const parts = ['v.published>=?']
    const remote = true
    // Resolve remote IDs once per query, then use the vacancy primary key instead
    // of probing formats for every record in the 100k+ general market dataset.
    const remoteClause = filters.workFormat === 'REMOTE_ONLY' ? "v.id IN (SELECT vacancy_id FROM vacancy_formats WHERE name='Удалённо')" : "v.id IN (SELECT vacancy_id FROM vacancy_formats WHERE name IN ('Удалённо','Гибрид'))"
    const mixedClause = "EXISTS(SELECT 1 FROM vacancy_formats mf WHERE mf.vacancy_id=v.id AND mf.name<>'Удалённо')"
    const availableRemote = remote ? this.count(`SELECT count(*) count FROM vacancies v WHERE v.published>=? AND ${remoteClause}${filters.workFormat === 'REMOTE_ONLY' ? ` AND NOT ${mixedClause}` : ''}`, [params[0]]) : 0
    const mixedExcluded = filters.workFormat === 'REMOTE_ONLY' ? this.count(`SELECT count(*) count FROM vacancies v WHERE v.published>=? AND (v.id NOT IN (SELECT vacancy_id FROM vacancy_formats WHERE name='Удалённо') OR ${mixedClause})`, [params[0]]) : 0
    if (remote) parts.push(remoteClause)
    if (filters.workFormat === 'REMOTE_ONLY') parts.push(`NOT ${mixedClause}`)
    if (filters.experience) { parts.push('v.experience=?'); params.push(experienceOptions.find(item => item.id === filters.experience)?.name || filters.experience) }
    if (filters.technology) { parts.push('EXISTS(SELECT 1 FROM vacancy_terms vt WHERE vt.vacancy_id=v.id AND vt.name=?)'); params.push(filters.technology) }
    if (filters.title) { parts.push('v.name=?'); params.push(filters.title) }
    if (filters.group) { parts.push('EXISTS(SELECT 1 FROM vacancy_groups vg WHERE vg.vacancy_id=v.id AND vg.group_id=?)'); params.push(filters.group) }
    if (filters.salary === 'specified') parts.push('v.has_salary=1')
    if (filters.area !== '113') { parts.push('(v.area_id=? OR v.area_path LIKE ?)'); params.push(filters.area, `%.${filters.area}.%`) }
    if (filters.text) { parts.push("v.search_text LIKE ? ESCAPE '!'"); params.push(`%${filters.text.toLocaleLowerCase('ru-RU').replace(/[!%_]/g, '!$&')}%`) }
    if (filters.profession) { parts.push('EXISTS(SELECT 1 FROM vacancy_roles vr WHERE vr.vacancy_id=v.id AND vr.role_id=?)'); params.push(filters.profession) }
    if (filters.direction) { parts.push('EXISTS(SELECT 1 FROM vacancy_roles vr JOIN role_directions rd ON vr.role_id=rd.role_id WHERE vr.vacancy_id=v.id AND rd.direction_id=?)'); params.push(filters.direction) }
    let priority: Analytics['priority']
    const priorityMatches = new Map<string, PriorityMatch[]>()
    if (filters.priority) {
      // Classify existing payloads without modifying the database or collector.
      const candidates = this.db.prepare(`SELECT v.id,v.payload FROM vacancies v WHERE ${parts.join(' AND ')}`).all(...params)
      const counts = new Map<string, number>()
      const selected: string[] = []
      for (const row of candidates) {
        const matches = classifyPriorities(JSON.parse(String(row.payload)))
        if (!matches.length) continue
        const id = String(row.id)
        priorityMatches.set(id, matches)
        for (const match of matches) counts.set(match.id, (counts.get(match.id) || 0) + 1)
        if (filters.priority === 'any' || matches.some(match => match.id === filters.priority)) selected.push(id)
      }
      priority = { total: priorityMatches.size, candidates: candidates.length, directions: priorityDirections.map(({ id, name }) => ({ id, name, count: counts.get(id) || 0 })), matches: {} }
      // One JSON parameter also handles large selections beyond SQLite's bind limit.
      parts.push('v.id IN (SELECT value FROM json_each(?))')
      params.push(JSON.stringify(selected))
    }
    const where = parts.join(' AND ')
    const rows = (sql: string) => this.db.prepare(sql).all(...params)
    const group = (id: string, name: string, join = '') => rankings(rows(`SELECT ${id} id,${name} name,count(DISTINCT v.id) count FROM vacancies v ${join} WHERE ${where} GROUP BY ${id} ORDER BY count DESC LIMIT 100`))
    const filtered = this.count(`SELECT count(*) count FROM vacancies v WHERE ${where}`, params)
    const salaryCount = this.count(`SELECT count(*) count FROM vacancies v WHERE ${where} AND salary_lower IS NOT NULL`, params)
    const middle = salaryCount ? this.db.prepare(`SELECT salary_lower value FROM vacancies v WHERE ${where} AND salary_lower IS NOT NULL ORDER BY salary_lower LIMIT ? OFFSET ?`).all(...params, salaryCount % 2 ? 1 : 2, Math.floor((salaryCount - 1) / 2)).map(row => Number(row.value)) : []
    const market = (kind: string) => rankings(this.db.prepare(`SELECT m.*, (SELECT count(DISTINCT vr.vacancy_id) FROM vacancy_roles vr ${kind === 'direction' ? 'JOIN role_directions rd ON rd.role_id=vr.role_id WHERE rd.direction_id=m.id' : 'WHERE vr.role_id=m.id'}) collected FROM market_counts m WHERE kind=? ORDER BY count DESC`).all(kind))
    const taxonomy = this.get<Taxonomy>('taxonomy', { roles: [], directions: [] })
    const marketTotal = this.db.prepare("SELECT count,updated_at FROM market_counts WHERE kind='total' AND id='all'").get()
    const pageSize = remote ? 20 : 15
    const totalPages = Math.ceil(filtered / pageSize)
    const page = remote ? Math.min(Math.max(0, Number(filters.page) || 0), Math.max(0, totalPages - 1)) : 0
    let remoteDetails: Analytics['remote']
    if (remote) {
      const byRole = new Map<string, ProfessionSummary & { salaries: number[] }>()
      for (const row of rows(`SELECT r.id,r.name,v.salary_lower,v.experience FROM vacancies v JOIN vacancy_roles vr ON vr.vacancy_id=v.id JOIN roles r ON r.id=vr.role_id WHERE ${where}`)) {
        const id = String(row.id)
        const role = byRole.get(id) || { id, name: String(row.name), count: 0, salaryMedian: null, salaryCount: 0, noExperience: 0, salaries: [] }
        role.count++
        if (typeof row.salary_lower === 'number') role.salaries.push(row.salary_lower)
        if (row.experience === 'Нет опыта') role.noExperience++
        byRole.set(id, role)
      }
      const professions = [...byRole.values()].map(({ salaries, ...role }) => ({ ...role, salaryMedian: median(salaries), salaryCount: salaries.length })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'ru'))
      const byGroup = new Map<string, JobGroupSummary & { salaries: number[]; names: Set<string> }>()
      for (const row of rows(`SELECT vg.group_id id,vg.name,v.name title,v.salary_lower,v.experience FROM vacancies v JOIN vacancy_groups vg ON vg.vacancy_id=v.id WHERE ${where}`)) {
        const id = String(row.id)
        const entry = byGroup.get(id) || { id, name: String(row.name), count: 0, salaryMedian: null, salaryCount: 0, noExperience: 0, variants: 0, examples: [], salaries: [], names: new Set<string>() }
        entry.count++; entry.names.add(String(row.title))
        if (typeof row.salary_lower === 'number') entry.salaries.push(row.salary_lower)
        if (row.experience === 'Нет опыта') entry.noExperience++
        byGroup.set(id,entry)
      }
      const groups = [...byGroup.values()].map(({ salaries, names, ...entry }) => ({ ...entry, variants: names.size, examples: [...names].slice(0,3), salaryMedian: median(salaries), salaryCount: salaries.length })).sort((a,b) => b.count-a.count || a.name.localeCompare(b.name,'ru'))
      remoteDetails = {
        professions, groups, titles: groups.map(({ id,name,count }) => ({ id,name,count })),
        tagged: this.count(`SELECT count(*) count FROM vacancies v WHERE ${where} AND EXISTS(SELECT 1 FROM vacancy_terms vt WHERE vt.vacancy_id=v.id)`, params),
        available: availableRemote, mixedExcluded, page, pageSize, totalPages,
        descriptions: this.count(`SELECT count(*) count FROM vacancies v WHERE ${where} AND json_extract(v.payload,'$.detail_fetched_at') IS NOT NULL`,params),
      }
    }
    const recent = this.db.prepare(`SELECT payload FROM vacancies v WHERE ${where} ORDER BY published DESC,v.id LIMIT ? OFFSET ?`).all(...params, pageSize, page * pageSize).map(row => JSON.parse(String(row.payload)))
    if (priority) for (const vacancy of recent) priority.matches[vacancy.id] = priorityMatches.get(vacancy.id) || []
    return {
      status: {
        enabled: this.get('enabled', true), running: this.get('running', false) && this.get('lease', { until: 0 }).until > Date.now(),
        current: this.get('current', ''), lastError: this.get('lastError', null), nextAt: this.get('nextAt', 0),
        ...this.taskStats(), requests: this.get('requests', 0), lastSuccess: this.get('lastSuccess', null), snapshotAt: marketTotal ? String(marketTotal.updated_at) : null,
        scannedRoles: this.count("SELECT count(DISTINCT json_extract(payload,'$.roles[0]')) count FROM tasks WHERE kind='profession' AND status='done'"), knownRoles: this.get('targetRoleCount',taxonomy.roles.length),
        detailPending: this.count("SELECT count(*) count FROM tasks WHERE kind='detail' AND status='pending'"),
        searchPending: this.count("SELECT count(*) count FROM tasks WHERE kind<>'detail' AND status='pending'"),
        optimization: {
          version: this.get('queueVersion', 0), intervalSeconds: this.get('requestInterval', 10_000) / 1000,
          cacheSkipped: this.get('cacheSkipped', 0), blockedUntil: this.get('blockedUntil', 0), lastFailure: this.get('lastFailure', null),
          remotePending: this.count("SELECT count(*) count FROM tasks WHERE status='pending' AND priority<10000"),
          hybridPending: this.count("SELECT count(*) count FROM tasks WHERE status='pending' AND priority>=10000"),
          priorityPending: this.count("SELECT count(*) count FROM tasks WHERE status='pending' AND priority<300"),
        },
        rejections: rankings(this.db.prepare('SELECT reason id,reason name,count(*) count FROM rejected_ids GROUP BY reason ORDER BY count DESC').all()).map(row => ({ ...row, name: rejectionNames[row.id as Rejection] || row.id })),
      },
      totals: {
        stored: this.count('SELECT count(*) count FROM vacancies'), filtered, market: marketTotal ? Number(marketTotal.count) : null,
        employers: this.count(`SELECT count(DISTINCT employer) count FROM vacancies v WHERE ${where}`, params),
        withSalary: this.count(`SELECT count(*) count FROM vacancies v WHERE ${where} AND has_salary=1`, params),
        medianLower: middle.length ? middle.reduce((a, b) => a + b, 0) / middle.length : null, salaryCount,
      },
      market: remote ? { professions: [], directions: [] } : { professions: market('profession'), directions: market('direction') },
      local: {
        professions: group('r.id', 'r.name', 'JOIN vacancy_roles vr ON vr.vacancy_id=v.id JOIN roles r ON r.id=vr.role_id'),
        directions: group('d.id', 'd.name', 'JOIN vacancy_roles vr ON vr.vacancy_id=v.id JOIN role_directions rd ON rd.role_id=vr.role_id JOIN directions d ON d.id=rd.direction_id'),
        regions: group('v.area_id', 'v.area_name'), experience: group('v.experience', 'v.experience'),
        formats: group('f.name', 'f.name', 'JOIN vacancy_formats f ON f.vacancy_id=v.id'),
        titleSkills: group('t.name', 't.name', 'JOIN vacancy_terms t ON t.vacancy_id=v.id'),
        languages: group('s.name','s.name',"JOIN vacancy_skills s ON s.vacancy_id=v.id AND s.category='language'"),
        technologies: group('s.name','s.name',"JOIN vacancy_skills s ON s.vacancy_id=v.id AND s.category='technology'"),
        tools: group('s.name','s.name',"JOIN vacancy_skills s ON s.vacancy_id=v.id AND s.category='tool'"),
        spokenLanguages: group('s.name','s.name',"JOIN vacancy_skills s ON s.vacancy_id=v.id AND s.category='human_language'"),
        daily: group('substr(v.first_seen,1,10)', 'substr(v.first_seen,1,10)').sort((a, b) => a.id.localeCompare(b.id)),
      },
      options: { professions: taxonomy.roles.map(({ id, name }) => ({ id, name })), directions: taxonomy.directions.map(({ id, name }) => ({ id, name })), groups: this.db.prepare('SELECT group_id id,name FROM vacancy_groups GROUP BY group_id ORDER BY name').all().map(row => ({ id: String(row.id),name: String(row.name) })) },
      recent,
      ...(priority ? { priority } : {}),
      ...(remoteDetails ? { remote: remoteDetails } : {}),
    }
  }
  close() { this.db.close() }
}
