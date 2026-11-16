import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { rejectionFor, SELECTION_VERSION } from '../server/selection.ts'
import { normalizeJobTitle } from '../server/knowledge.ts'
import { classifyMarket } from '../src/lib/market-policy.ts'

const db=new DatabaseSync('data/jobfinder.sqlite',{readOnly:true})
try {
  const policy=JSON.parse(db.prepare("SELECT value FROM meta WHERE key='selectionVersion'").get()?.value||'null')
  assert.equal(policy,SELECTION_VERSION)
  const rows=db.prepare('SELECT v.id,v.payload,g.group_id,m.eligible,m.reason FROM vacancies v LEFT JOIN vacancy_groups g ON g.vacancy_id=v.id LEFT JOIN vacancy_market m ON m.vacancy_id=v.id').all()
  let pureRemote=0,hybrid=0,hidden=0
  for(const row of rows){
    const job=JSON.parse(row.payload)
    if (row.eligible) {
      assert.equal(rejectionFor(job,true),null,`Rejected vacancy exposed: ${job.id} ${job.name}`)
      assert.equal(classifyMarket(job).eligible,true)
    } else {
      assert.ok(['communication','russia_restricted','seniority'].includes(row.reason),`Missing market classification: ${job.id}`)
      hidden++
    }
    assert.ok(job.description.length>=40)
    assert.ok(job.detail_fetched_at,`No detail verification: ${job.id}`)
    assert.equal(row.group_id,normalizeJobTitle(job.name).id)
    assert.ok(Array.isArray(job.skill_mentions))
    if(row.eligible){if(job.work_format.every(format=>format.id==='REMOTE'))pureRemote++;else hybrid++}
  }
  const exclusions=db.prepare('SELECT reason,count(*) count FROM rejected_ids GROUP BY reason').all()
  console.log(JSON.stringify({policy,checked:rows.length,hidden,pureRemote,hybrid,exclusions},null,2))
}finally{db.close()}
