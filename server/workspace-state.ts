import type { DatabaseSync } from 'node:sqlite'
import type { ProcessedResult } from '../src/lib/workspace.ts'

export class WorkspaceError extends Error {
  status: number
  constructor(status: number, message: string) { super(message); this.status = status }
}

export class WorkspaceState {
  db: DatabaseSync
  constructor(db: DatabaseSync) {
    this.db = db
    db.exec(`CREATE TABLE IF NOT EXISTS vacancy_actions (
      vacancy_id TEXT PRIMARY KEY, processed_at TEXT NOT NULL, payload TEXT NOT NULL, search_text TEXT NOT NULL
    ); CREATE INDEX IF NOT EXISTS vacancy_actions_date ON vacancy_actions(processed_at DESC,vacancy_id);`)
  }
  mark(id: string, processed: boolean) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const vacancy = this.db.prepare('SELECT payload,search_text FROM vacancies WHERE id=?').get(id)
      const action = this.db.prepare('SELECT processed_at FROM vacancy_actions WHERE vacancy_id=?').get(id)
      if (processed) {
        if (!action) {
          if (!vacancy) throw new WorkspaceError(404, 'Вакансия не найдена в сохранённой базе.')
          this.db.prepare('INSERT INTO vacancy_actions VALUES (?,?,?,?)').run(id, new Date().toISOString(), vacancy.payload, vacancy.search_text)
        }
      } else {
        if (action && !vacancy) throw new WorkspaceError(409, 'Вакансия больше недоступна в общей базе. Её копия сохранена в обработанных.')
        this.db.prepare('DELETE FROM vacancy_actions WHERE vacancy_id=?').run(id)
      }
      this.db.exec('COMMIT')
      return { processed }
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  list(text = '', requestedPage = 0): ProcessedResult {
    const params = text ? [`%${text.toLocaleLowerCase('ru-RU').replace(/[!%_]/g, '!$&')}%`] : []
    const where = text ? "WHERE coalesce(v.search_text,a.search_text) LIKE ? ESCAPE '!'" : ''
    const join = 'FROM vacancy_actions a LEFT JOIN vacancies v ON v.id=a.vacancy_id'
    const total = Number(this.db.prepare('SELECT count(*) n FROM vacancy_actions').get()?.n || 0)
    const filtered = Number(this.db.prepare(`SELECT count(*) n ${join} ${where}`).get(...params)?.n || 0)
    const pageSize = 20, totalPages = Math.ceil(filtered / pageSize)
    const page = Math.min(Math.max(0, requestedPage), Math.max(0, totalPages - 1))
    const items = this.db.prepare(`SELECT coalesce(v.payload,a.payload) payload,a.processed_at,v.id live_id ${join} ${where} ORDER BY a.processed_at DESC,a.vacancy_id LIMIT ? OFFSET ?`).all(...params, pageSize, page * pageSize)
      .map(row => ({ vacancy: JSON.parse(String(row.payload)), processedAt: String(row.processed_at), canRestore: row.live_id != null }))
    return { total, filtered, page, pageSize, totalPages, items }
  }
}
