import type { DatabaseSync } from 'node:sqlite'
import type { Vacancy } from '../src/lib/hh.ts'
import { classifyMarket, MARKET_POLICY_VERSION, marketRejectionNames } from '../src/lib/market-policy.ts'
import type { MarketDecision, MarketRejection } from '../src/lib/market-policy.ts'

export class MarketState {
  db: DatabaseSync
  constructor(db: DatabaseSync) {
    this.db = db
    db.exec(`CREATE TABLE IF NOT EXISTS vacancy_market (vacancy_id TEXT PRIMARY KEY,eligible INTEGER NOT NULL,reason TEXT,evidence TEXT NOT NULL,overridden INTEGER NOT NULL DEFAULT 0);
      CREATE INDEX IF NOT EXISTS vacancy_market_eligible ON vacancy_market(eligible,vacancy_id);`)
    if (!db.prepare('PRAGMA table_info(vacancy_market)').all().some(row => row.name === 'overridden')) db.exec('ALTER TABLE vacancy_market ADD COLUMN overridden INTEGER NOT NULL DEFAULT 0')
    this.refresh()
  }
  refresh(force = false) {
    const current = () => this.db.prepare("SELECT value FROM meta WHERE key='marketPolicyVersion'").get()?.value === JSON.stringify(MARKET_POLICY_VERSION)
    if (!force && current()) return
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (force || !current()) {
        for (const row of this.db.prepare('SELECT v.payload FROM vacancies v WHERE NOT EXISTS(SELECT 1 FROM vacancy_market m WHERE m.vacancy_id=v.id AND m.overridden=1)').all()) this.record(JSON.parse(String(row.payload)))
        this.db.prepare("INSERT OR REPLACE INTO meta VALUES ('marketPolicyVersion',?)").run(JSON.stringify(MARKET_POLICY_VERSION))
      }
      this.db.exec('COMMIT')
    } catch (error) { this.db.exec('ROLLBACK'); throw error }
  }
  record(job: Vacancy) { this.save(job.id, classifyMarket(job)) }
  save(id: string, decision: MarketDecision, overridden = false) {
    this.db.prepare('INSERT INTO vacancy_market(vacancy_id,eligible,reason,evidence,overridden) VALUES (?,?,?,?,?) ON CONFLICT(vacancy_id) DO UPDATE SET eligible=excluded.eligible,reason=excluded.reason,evidence=excluded.evidence,overridden=excluded.overridden').run(id, Number(decision.eligible), decision.reason, decision.evidence, Number(overridden))
  }
  exclude(id: string, reason: MarketRejection) { this.save(id, { eligible: false, reason, evidence: marketRejectionNames[reason] }, true) }
  stats() {
    const rows = this.db.prepare('SELECT m.eligible,m.reason,count(*) n FROM vacancy_market m JOIN vacancies v ON v.id=m.vacancy_id GROUP BY m.eligible,m.reason').all()
    return { version: MARKET_POLICY_VERSION, included: rows.filter(row => row.eligible).reduce((n, row) => n + Number(row.n), 0), hidden: rows.filter(row => !row.eligible).reduce((n, row) => n + Number(row.n), 0), exclusions: rows.filter(row => !row.eligible).map(row => ({ reason: String(row.reason), name: marketRejectionNames[row.reason as MarketRejection], count: Number(row.n) })) }
  }
}
