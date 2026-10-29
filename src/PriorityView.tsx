import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { defaultRemoteFilters, experienceOptions, getAnalytics } from './lib/analytics'
import type { Analytics, AnalyticsFilters, Ranking } from './lib/analytics'
import { formatSalary, number } from './lib/hh'
import { priorityDirections } from './lib/priorities'
import './RemoteView.css'
import './PriorityView.css'

const initialFilters: AnalyticsFilters = { ...defaultRemoteFilters, priority: 'any' }
const influenceFilters: AnalyticsFilters = { ...defaultRemoteFilters, priority: 'influence' }
const sources = { title: 'В названии', skills: 'В навыках', description: 'В описании' }

export default function PriorityView({ influenceOnly = false }: { influenceOnly?: boolean }) {
  const defaults = influenceOnly ? influenceFilters : initialFilters
  const heading = influenceOnly ? 'Инфлюенс и блогеры' : 'Приоритетные направления'
  const directions = influenceOnly ? priorityDirections.filter(item => item.id === 'influence') : priorityDirections
  const [filters, setFilters] = useState(defaults)
  const [search, setSearch] = useState('')
  const [result, setResult] = useState<{ key: string; data: Analytics; at: Date } | null>(null)
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const key = JSON.stringify(filters)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        const data = await getAnalytics(filters, controller.signal)
        if (!controller.signal.aborted) { setResult({ key, data, at: new Date() }); setError('') }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Не удалось загрузить направления.')
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => { void refresh() }, 15_000)
      }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [filters, key, revision])
  const data = result?.key === key ? result.data : null
  const priority = data?.priority
  const page = data?.remote
  const choose = (patch: Partial<AnalyticsFilters>) => { setFilters(current => ({ ...current, ...patch, ...(influenceOnly ? { priority: 'influence' } : {}), page: '0' })); setError('') }
  const reset = () => { setFilters(defaults); setSearch(''); setError('') }
  const submit = (event: FormEvent) => { event.preventDefault(); choose({ text: search.trim() }) }
  const selected = priorityDirections.find(item => item.id === filters.priority)
  const skillPanel = (title: string, rows: Ranking[]) => <section className="panel priority-skills" key={title}><h2>{title}</h2><div className="technology-chips">{rows.slice(0, 20).map(row => <button key={row.id} className={filters.technology === row.name ? 'selected' : ''} onClick={() => choose({ technology: filters.technology === row.name ? '' : row.name })}><span>{row.name}</span><strong>{number(row.count)}</strong></button>)}</div>{!rows.length && <p className="chart-note">В этой выборке упоминаний пока нет.</p>}</section>

  return <div className="app-shell remote-view priority-view">
    <header className="site-header"><a className="brand" href="/"><span className="brand-mark">j<span>f</span></span>jobfinder<span className="brand-divider" /><span className="brand-section">{heading}</span></a><a className="source-link" href="/">Вся удалёнка ↗</a></header>
    <nav className="view-navigation curated-navigation" aria-label="Разделы"><a href="/">Вся удалёнка</a><a href="/?view=priority" aria-current={!influenceOnly ? 'page' : undefined}>Приоритетные направления</a><a href="/?view=influence" aria-current={influenceOnly ? 'page' : undefined}>Инфлюенс</a><a href="#priority-jobs">Вакансии</a></nav>
    <main>
      <div className="page-heading"><div><div className="eyebrow">{influenceOnly ? 'INFLUENCE MARKETING · РАБОТА С БЛОГЕРАМИ' : 'ЛИЧНЫЙ ФОКУС · АВТОМАТИЧЕСКИЙ ОТБОР'}</div><h1>{heading}<span>.</span></h1><p>{influenceOnly ? 'Поиск блогеров, рекламные интеграции и работа с лидерами мнений. Найденные вакансии автоматически собираются здесь вместе со статистикой по должностям, зарплатам и инструментам.' : 'Веб, разработка, блогеры и близкие роли. Уже найденные и новые вакансии автоматически попадают сюда по ключевым словам и рабочим задачам.'}</p></div></div>
      <section className="panel remote-controls" aria-label={influenceOnly ? 'Фильтры вакансий инфлюенса' : 'Фильтры приоритетных вакансий'}>
        <form className="remote-search" onSubmit={submit}><label><span>{influenceOnly ? 'Поиск среди вакансий инфлюенса' : 'Поиск внутри приоритетных направлений'}</span><input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} placeholder={influenceOnly ? 'Должность, компания или инструмент' : 'Должность, компания или технология'} /></label><button type="submit">Найти</button></form>
        <div className="remote-selects">
          <label><span>Должность</span><select value={filters.group} onChange={event => choose({ group: event.target.value })}><option value="">Все должности</option>{result?.data.options.groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
          <label><span>Опыт</span><select value={filters.experience} onChange={event => choose({ experience: event.target.value })}><option value="">Любой опыт</option>{experienceOptions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label><span>Публикация</span><select value={filters.period} onChange={event => choose({ period: event.target.value })}><option value="1">За сутки</option><option value="7">За 7 дней</option><option value="30">За 30 дней</option><option value="90">За 90 дней</option></select></label>
        </div>
        <div className="remote-toggles"><label><input type="checkbox" checked={filters.workFormat === 'REMOTE'} onChange={event => choose({ workFormat: event.target.checked ? 'REMOTE' : 'REMOTE_ONLY' })} />Показывать гибрид и полуофис</label><label><input type="checkbox" checked={filters.salary === 'specified'} onChange={event => choose({ salary: event.target.checked ? 'specified' : 'any' })} />Только с зарплатой</label><button className="text-button" onClick={reset}>Сбросить фильтры</button></div>
        {(filters.text || filters.technology) && <div className="remote-active-filters">{filters.text && <button onClick={() => { choose({ text: '' }); setSearch('') }}>Поиск: {filters.text} ×</button>}{filters.technology && <button onClick={() => choose({ technology: '' })}>Навык: {filters.technology} ×</button>}</div>}
      </section>
      {error && <div className="panel error-state" role="alert"><p>{error}</p><button className="text-button" onClick={() => setRevision(value => value + 1)}>Повторить</button></div>}
      {!influenceOnly && <section className="priority-directions" aria-label="Выбор направления" aria-busy={!data}>
        <div className="priority-section-heading"><div><h2>Куда смотреть</h2><p>Счётчики учитывают фильтры выше. Направления пересекаются; в общем списке каждая вакансия учитывается один раз.</p></div><button className={`priority-all ${filters.priority === 'any' ? 'selected' : ''}`} aria-pressed={filters.priority === 'any'} onClick={() => choose({ priority: 'any' })}>Все приоритетные · {priority ? number(priority.total) : '…'}</button></div>
        <div className="priority-grid">{priorityDirections.map(item => <button type="button" key={item.id} data-direction={item.id} className={`priority-card ${filters.priority === item.id ? 'selected' : ''}`} aria-pressed={filters.priority === item.id} onClick={() => choose({ priority: filters.priority === item.id ? 'any' : item.id })}><span className="priority-card-top"><strong>{item.name}</strong><b>{priority ? number(priority.directions.find(row => row.id === item.id)?.count || 0) : '…'}</b></span><span>{item.description}</span><small>{item.keywords.slice(0, 5).join(' · ')}</small></button>)}</div>
      </section>}
      <details className="panel selection-rules"><summary>{influenceOnly ? 'Как находим работу с блогерами · ключевые слова' : 'Как распознаются направления · словарь ключевых слов'}</summary><p>{influenceOnly ? 'Ищем influence/influencer-роли в названии и задачи по поиску блогеров, переговорам, закупке интеграций и ведению кампаний в описании. Обычный SMM без таких задач сюда не попадает. Упоминания блогеров только в рассказе о компании недостаточно.' : 'Проверяем название, отдельные навыки и рабочие задачи в полном описании. Общих слов «разработка», «безопасность» или «тестирование» недостаточно.'} Для каждого совпадения показываем фрагмент и источник. Отбор по правилам может ошибаться — открыть оригинал можно в карточке.</p>{directions.map(item => <p key={item.id}><strong>{item.name}:</strong> {item.keywords.join(', ')}.</p>)}<p>Это представление сохранённых вакансий, а не вся выдача hh.ru. У каждой новой сохранённой вакансии направления определяются автоматически. Гибрид скрыт по умолчанию.</p></details>
      {!data && !error && <p className="priority-loading" role="status">Подбираем вакансии и считаем статистику…</p>}
      {data && <div className="priority-results" aria-live="polite">
        <section className="metrics remote-metrics" aria-label="Статистика выборки">
          <article className="metric metric-accent"><p>{selected?.name || 'Все приоритетные'}</p><strong>{number(data.totals.filtered)}</strong><small>уникальных вакансий в текущей выборке</small></article>
          <article className="metric"><p>Должностей</p><strong>{number(page?.groups.length || 0)}</strong><small>похожие названия объединены словарём</small></article>
          <article className="metric"><p>Компаний</p><strong>{number(data.totals.employers)}</strong><small>{number(data.totals.withSalary)} вакансий указывают зарплату</small></article>
          <article className="metric"><p>Медиана нижней границы зарплаты</p><strong>{data.totals.medianLower === null ? '—' : `${number(Math.round(data.totals.medianLower))} ₽`}</strong><small>на руки в месяц · {number(data.totals.salaryCount)} вакансий с подходящими данными</small></article>
        </section>
        <section className="panel priority-roles"><div className="panel-heading"><h2>Какие должности встречаются</h2><span className="tag">В выбранном направлении</span></div><div className="technology-chips">{page?.groups.slice(0, 24).map(group => <button className={filters.group === group.id ? 'selected' : ''} key={group.id} title={group.examples.join(' / ')} onClick={() => choose({ group: filters.group === group.id ? '' : group.id })}><span>{group.name}</span><strong>{number(group.count)}</strong></button>)}</div>{!page?.groups.length && <p className="chart-note">Совпадений с текущими фильтрами пока нет.</p>}</section>
        <div className="priority-skill-grid">{influenceOnly ? <>{skillPanel('Инструменты', data.local.tools)}{skillPanel('Технологии', data.local.technologies)}{skillPanel('Иностранные языки', data.local.spokenLanguages)}</> : <>{skillPanel('Языки программирования', data.local.languages)}{skillPanel('Технологии', data.local.technologies)}{skillPanel('Инструменты', data.local.tools)}</>}</div>
        <section id="priority-jobs" className="priority-jobs"><div className="priority-section-heading"><div><h2>{selected?.name || 'Все приоритетные вакансии'}</h2><p>{number(data.totals.filtered)} вакансий · сначала свежие · обновлено {result?.at.toLocaleTimeString('ru-RU')}</p></div></div>
          {!data.recent.length && <div className="panel priority-empty"><h2>Вакансий пока нет</h2><p>{influenceOnly ? 'Ослабьте фильтры. Новые вакансии по работе с блогерами появятся здесь по мере сбора.' : 'Попробуйте другое направление или ослабьте фильтры. Новые подходящие объявления появятся здесь по мере сбора.'}</p><button className="text-button" onClick={reset}>Сбросить фильтры</button></div>}
          <div className="priority-job-list">{data.recent.map(job => <article className="panel priority-job" key={job.id} data-job-id={job.id}>
            <div className="priority-job-heading"><div><h3>{job.alternate_url ? <a href={job.alternate_url} target="_blank" rel="noreferrer">{job.name} ↗</a> : job.name}</h3><p>{job.employer.name} · {job.area.name}</p></div><strong>{formatSalary(job)}</strong></div>
            <div className="priority-job-meta"><span>{job.normalized_title?.name || job.name}</span><span>{job.work_format?.map(item => item.name).join(' / ')}</span>{job.experience && <span>{job.experience.name}</span>}<time dateTime={job.published_at}>{new Date(job.published_at).toLocaleDateString('ru-RU')}</time></div>
            <div className="priority-match-tags">{priority?.matches[job.id]?.filter(match => !influenceOnly || match.id === 'influence').map(match => <button key={match.id} data-match={match.id} className={filters.priority === match.id ? 'selected' : ''} onClick={() => choose({ priority: match.id })}>{match.name}</button>)}</div>
            <details className="priority-evidence"><summary>{influenceOnly ? 'Почему это работа с блогерами' : 'Почему в приоритетах'}</summary>{priority?.matches[job.id]?.filter(match => !influenceOnly || match.id === 'influence').map(match => <div key={match.id}><h4>{match.name}</h4>{match.reasons.map((reason, index) => <blockquote key={index}><small>{sources[reason.source]} · «{reason.keyword}»</small><p>{reason.evidence}</p></blockquote>)}</div>)}</details>
            <details className="vacancy-details"><summary>Описание и навыки</summary><p className="description-text">{job.description}</p><div className="matched-skills">{job.skill_mentions?.map(skill => <button key={skill.name} title={skill.evidence} onClick={() => choose({ technology: skill.name })}>{skill.name}</button>)}</div></details>
          </article>)}</div>
          {!!page?.totalPages && <div className="remote-pagination"><button disabled={!page.page} onClick={() => setFilters(current => ({ ...current, page: String(page.page - 1) }))}>← Назад</button><span>Страница {page.page + 1} из {page.totalPages}</span><button disabled={page.page + 1 >= page.totalPages} onClick={() => setFilters(current => ({ ...current, page: String(page.page + 1) }))}>Далее →</button></div>}
        </section>
      </div>}
      <footer className="priority-footer">База: {number(result?.data.totals.stored || 0)} сохранённых вакансий. {priority && (influenceOnly ? <>С текущими фильтрами — {number(data?.totals.filtered || 0)} вакансий по работе с блогерами.</> : <>В фильтрах до отбора направлений — {number(priority.candidates)}, из них приоритетных — {number(priority.total)}.</>)} <a href="/">Общая аналитика и управление сбором ↗</a></footer>
    </main>
  </div>
}
