import { DatabaseSync } from 'node:sqlite'
import { resolve } from 'node:path'
import { SELECTION_VERSION } from '../server/selection.ts'

const path = resolve(process.env.JOBFINDER_DB || 'data/jobfinder.sqlite')
const database = new DatabaseSync(path, { timeout: 5000 })
try {
  const set = (key,value) => database.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value))
  set('enabled',false)
  const running = JSON.parse(database.prepare("SELECT value FROM meta WHERE key='running'").get()?.value || 'false')
  const lease = JSON.parse(database.prepare("SELECT value FROM meta WHERE key='lease'").get()?.value || '{}')
  if (running && lease.until > Date.now()) throw new Error('Сборщик заканчивает текущий запрос. Повторите сброс через 20 секунд.')
  const hasTable = name => !!database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)
  if (hasTable('source_state') && database.prepare('SELECT 1 FROM source_state WHERE lease_until>? LIMIT 1').get(Date.now())) throw new Error('Дополнительный сборщик заканчивает запрос. Дождитесь его завершения и повторите сброс.')
  const before = database.prepare('SELECT count(*) count FROM vacancies').get().count
  const tables = ['vacancy_roles','vacancy_formats','vacancy_terms','vacancy_groups','vacancy_skills','vacancy_market','rejected_ids','vacancies','tasks','market_counts','role_directions','roles','directions','meta']
  database.exec('BEGIN IMMEDIATE')
  try {
    for (const table of tables) if (database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)) database.exec(`DELETE FROM ${table}`)
    if (hasTable('source_tasks')) database.exec("DELETE FROM source_tasks WHERE COALESCE(json_extract(context,'$.recurring'),0)<>1; UPDATE source_tasks SET status='pending',due=0,attempts=0,checked_at=0")
    if (hasTable('source_state')) database.exec("UPDATE source_state SET current='',requests=0,saved=0,duplicates=0,rejected=0")
    if (process.argv.includes('--fresh-sources')) for (const table of ['source_tasks','source_state','source_hosts','source_http_cache','source_events','source_boards']) if (hasTable(table)) database.exec(`DELETE FROM ${table}`)
    // Keep aliases for processed snapshots so a future discovery retains the user's mark.
    if (hasTable('vacancy_origins')) database.exec(hasTable('vacancy_actions') ? 'DELETE FROM vacancy_origins WHERE vacancy_id NOT IN (SELECT vacancy_id FROM vacancy_actions)' : 'DELETE FROM vacancy_origins')
    set('selectionVersion',SELECTION_VERSION)
    set('enabled',!process.argv.includes('--paused'))
    set('resetAt',new Date().toISOString())
    database.exec('COMMIT')
  } catch (error) { database.exec('ROLLBACK'); throw error }
  console.log(JSON.stringify({ path, cleared: before, remaining: database.prepare('SELECT count(*) count FROM vacancies').get().count, enabled: !process.argv.includes('--paused'), policy: SELECTION_VERSION },null,2))
} finally { database.close() }
