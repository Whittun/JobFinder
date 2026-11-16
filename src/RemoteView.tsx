import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { defaultRemoteFilters, experienceOptions, getAnalytics } from './lib/analytics'
import type { Analytics, AnalyticsFilters } from './lib/analytics'
import { formatSalary, number } from './lib/hh'
import CollectorsPanel from './CollectorsPanel'
import VacancyActions from './VacancyActions'
import VacancySource from './VacancySource'
import './RemoteView.css'
import './WebView.css'

export default function RemoteView() {
  const [filters,setFilters] = useState<AnalyticsFilters>(defaultRemoteFilters)
  const [search,setSearch] = useState('')
  const [result,setResult] = useState<{key:string;data:Analytics}|null>(null)
  const [error,setError] = useState('')
  const [revision,setRevision] = useState(0)
  const key = JSON.stringify(filters)
  useEffect(()=>{
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try { const data=await getAnalytics(filters,controller.signal); if(!controller.signal.aborted){setResult({key,data});setError('')} }
      catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'Не удалось загрузить вакансии')}
      finally{if(!controller.signal.aborted)timer=setTimeout(()=>{void refresh()},15000)}
    }
    void refresh()
    return()=>{controller.abort();clearTimeout(timer)}
  },[filters,key,revision])
  const data=result?.key===key?result.data:null
  const update=(patch:Partial<AnalyticsFilters>)=>setFilters(f=>({...f,...patch,page:'0'}))
  const submit=(e:FormEvent)=>{e.preventDefault();update({text:search.trim()})}
  const reset=()=>{setFilters(defaultRemoteFilters);setSearch('')}
  return <div className="app-shell remote-view web-view">
    <header className="site-header"><a className="brand" href="/">jobfinder<span className="brand-divider"/><span className="brand-section">Веб и технические роли</span></a><nav className="web-nav"><a href="/?view=processed">Обработанные{data?` · ${data.processedTotal}`:''}</a><a href="/?view=letters">Сопроводительное</a></nav></header>
    <main>
      <div className="page-heading"><div><h1>Работа в вебе<span>.</span></h1><p>Разработка, вёрстка, поддержка веб-сервисов, тестирование и инфраструктура. Русская коммуникация, без запрета работы из РФ.</p></div></div>
      <CollectorsPanel />
      <section className="panel remote-controls" aria-label="Поиск вакансий">
        <form className="remote-search" onSubmit={submit}><label><span>Должность, технология или компания</span><input type="search" value={search} maxLength={200} onChange={e=>setSearch(e.target.value)} placeholder="React, техническая поддержка, SQL…"/></label><button>Найти</button></form>
        <div className="remote-selects"><label><span>Профессия</span><select value={filters.group} onChange={e=>update({group:e.target.value})}><option value="">Все профессии</option>{result?.data.options.groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}</select></label><label><span>Опыт</span><select value={filters.experience} onChange={e=>update({experience:e.target.value})}><option value="">Любой</option>{experienceOptions.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label><span>Публикация</span><select value={filters.period} onChange={e=>update({period:e.target.value})}><option value="7">За неделю</option><option value="30">За месяц</option><option value="90">За 3 месяца</option></select></label></div>
        <div className="remote-toggles"><label><input type="checkbox" checked={filters.workFormat==='REMOTE'} onChange={e=>update({workFormat:e.target.checked?'REMOTE':'REMOTE_ONLY'})}/>Включить гибрид</label><label><input type="checkbox" checked={filters.salary==='specified'} onChange={e=>update({salary:e.target.checked?'specified':'any'})}/>С зарплатой</label><button className="text-button" onClick={reset}>Сбросить</button></div>
      </section>
      {error&&<p role="alert" className="panel error-state">{error}</p>}
      {!data&&!error&&<p className="panel loading-state">Загружаем вакансии…</p>}
      {data&&<>
        <div className="web-summary"><strong>Найдено: {number(data.totals.filtered)}</strong><span>Работодателей: {number(data.totals.employers)}</span></div>
        <details className="panel web-analytics"><summary>Аналитика по профессиям и технологиям</summary><div className="web-analytics-grid"><div><h3>Профессии</h3>{data.remote?.groups.slice(0,20).map(g=><button key={g.id} onClick={()=>update({group:g.id})}>{g.name}<b>{g.count}</b></button>)}</div><div><h3>Языки, технологии и инструменты</h3><div className="technology-chips">{[...data.local.languages,...data.local.technologies,...data.local.tools].sort((a,b)=>b.count-a.count).slice(0,40).map(s=><button key={s.name} className={filters.technology===s.name?'selected':''} onClick={()=>update({technology:filters.technology===s.name?'':s.name})}>{s.name} <b>{s.count}</b></button>)}</div></div></div></details>
        {filters.technology&&<button className="text-button" onClick={()=>update({technology:''})}>Навык: {filters.technology} ×</button>}
        <section className="web-jobs" aria-label="Вакансии">{data.recent.map(job=><article className="panel web-job" key={job.id} data-job-id={job.id}><h2><a href={job.alternate_url||'#'} target="_blank" rel="noreferrer">{job.name} ↗</a></h2><p>{job.employer.name} · {job.area.name}</p><p className="web-job-meta">{job.experience?.name||'Опыт не указан'} · {job.work_format?.every(f=>f.id==='REMOTE')?'Удалённо':'Гибрид'} · {new Date(job.published_at).toLocaleDateString('ru-RU')}</p><strong>{formatSalary(job)}</strong><details className="vacancy-details"><summary>Описание и навыки</summary>{!!job.key_skills?.length&&<p>{job.key_skills.join(' · ')}</p>}<p className="description-text">{job.description}</p></details><VacancySource job={job}/><VacancyActions job={job} onChanged={()=>setRevision(r=>r+1)}/></article>)}{!data.recent.length&&<p className="panel web-empty">Подходящих вакансий пока нет. Сборщик пополняет базу автоматически; попробуй изменить фильтры.</p>}</section>
        <div className="remote-pagination"><button disabled={!data.remote?.page} onClick={()=>setFilters(f=>({...f,page:String(Number(f.page)-1)}))}>← Назад</button><span>{(data.remote?.page||0)+1} / {data.remote?.totalPages||1}</span><button disabled={(data.remote?.page||0)+1 >= (data.remote?.totalPages||0)} onClick={()=>setFilters(f=>({...f,page:String(Number(f.page)+1)}))}>Дальше →</button></div>
      </>}
    </main>
  </div>
}
