import type { Vacancy } from './lib/hh'
import './CollectorsPanel.css'

export default function VacancySource({ job }: { job: Vacancy }) {
  const origins = job.origins?.length ? job.origins : [{ source: job.source?.id || 'hh', name: job.source?.name || 'hh.ru', url: job.source?.url || job.alternate_url || '' }]
  return <div className="vacancy-source"><span>Найдено:</span>{origins.map(origin => <a key={`${origin.source}:${origin.url}`} href={origin.url} target="_blank" rel="noreferrer">{origin.name} ↗</a>)}{job.professional_level && <span>Уровень из источника: {job.professional_level}</span>}{job.date_estimated && <span className="source-date-note">Дата публикации не указана — показана дата обнаружения</span>}</div>
}
