import { Store } from '../server/store.ts'
const store=new Store(process.env.JOBFINDER_DB || 'data/jobfinder.sqlite')
const enabled=store.get('enabled',true)
store.set('enabled',false)
try{
  const deadline=Date.now()+25000
  while((store.get('running',false)&&store.get('lease',{until:0}).until>Date.now()) || store.db.prepare('SELECT 1 FROM source_state WHERE lease_until>? LIMIT 1').get(Date.now())){
    if(Date.now()>deadline)throw new Error('Текущий запрос ещё выполняется. Повторите проверку позже.')
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  const success=store.get('lastSuccess',null)
  const rows=store.db.prepare('SELECT v.id,v.payload,v.last_seen FROM vacancies v WHERE NOT EXISTS(SELECT 1 FROM vacancy_market m WHERE m.vacancy_id=v.id AND m.overridden=1)').all()
  store.ingest({items:rows.map(row=>JSON.parse(row.payload))})
  for(const row of rows)store.db.prepare('UPDATE vacancies SET last_seen=? WHERE id=?').run(row.last_seen,row.id)
  store.set('lastSuccess',success)
  console.log(JSON.stringify({checked:rows.length,retained:store.count('SELECT count(*) count FROM vacancies')},null,2))
}finally{store.set('enabled',enabled);store.close()}
