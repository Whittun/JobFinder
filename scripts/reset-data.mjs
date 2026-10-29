import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { SELECTION_VERSION } from '../server/selection.ts'

const path = resolve('data/jobfinder.sqlite')
const database = new DatabaseSync(path, { timeout: 5000 })
try {
  const set = (key,value) => database.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value))
  set('enabled',false)
  const running = JSON.parse(database.prepare("SELECT value FROM meta WHERE key='running'").get()?.value || 'false')
  const lease = JSON.parse(database.prepare("SELECT value FROM meta WHERE key='lease'").get()?.value || '{}')
  if (running && lease.until > Date.now()) throw new Error('Сборщик заканчивает текущий запрос. Повторите сброс через 20 секунд.')
  const before = database.prepare('SELECT count(*) count FROM vacancies').get().count
  const tables = ['vacancy_roles','vacancy_formats','vacancy_terms','vacancy_groups','vacancy_skills','rejected_ids','vacancies','tasks','market_counts','role_directions','roles','directions','meta']
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const table of tables) if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) database.exec(`DELETE FROM ${table}`)
    set('selectionVersion',SELECTION_VERSION)
    set('enabled',!process.argv.includes('--paused'))
    set('resetAt',new Date().toISOString())
    database.exec('COMMIT')
  } catch (error) { database.exec('ROLLBACK'); throw error }
  console.log(JSON.stringify({ path, cleared: before, remaining: database.prepare('SELECT count(*) count FROM vacancies').get().count, enabled: !process.argv.includes('--paused'), policy: SELECTION_VERSION },null,2))
} finally { database.close() }
