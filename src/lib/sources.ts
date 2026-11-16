export type SourceKind = 'json' | 'rss' | 'html' | 'telegram' | 'ashby' | 'greenhouse' | 'lever' | 'search'
export type SourceDefinition = { id: string; name: string; color: string; kind: SourceKind; url: string; interval: number; pace: number; note: string }
export const sourceDefinitions: SourceDefinition[] = [
  { id: 'himalayas', name: 'Himalayas', color: '#7c54b7', kind: 'json', url: 'https://himalayas.app/jobs/api/search?q=web&country=RU&sort=recent', interval: 24*3600000, pace: 10000, note: 'JSON API · фильтр веба и РФ' },
  { id: 'remotive', name: 'Remotive', color: '#dc7853', kind: 'json', url: 'https://remotive.com/api/remote-jobs', interval: 6*3600000, pace: 30000, note: 'Публичный API; выдача с задержкой 24 часа' },
  { id: 'remoteok', name: 'Remote OK', color: '#ca4c73', kind: 'json', url: 'https://remoteok.com/api', interval: 6*3600000, pace: 30000, note: 'Публичная JSON-лента' },
  { id: 'wwr', name: 'We Work Remotely', color: '#4f858b', kind: 'rss', url: 'https://weworkremotely.com/remote-jobs.rss', interval: 6*3600000, pace: 15000, note: 'Официальная RSS-лента' },
  { id: 'habr', name: 'Хабр Карьера', color: '#4b89a8', kind: 'html', url: 'https://career.habr.com/vacancies?remote=true', interval: 6*3600000, pace: 12000, note: 'Выдача и полные карточки вакансий' },
  { id: 'geekjob', name: 'Geekjob', color: '#8f9144', kind: 'html', url: 'https://geekjob.ru/vacancies', interval: 6*3600000, pace: 12000, note: 'IT и digital; публичные карточки' },
  { id: 'getmatch', name: 'getmatch', color: '#b07a35', kind: 'html', url: 'https://getmatch.ru/sitemap.xml', interval: 6*3600000, pace: 15000, note: 'Карта сайта и полные карточки; сначала новые ID' },
  { id: 'budu', name: 'БУДУ', color: '#9375b1', kind: 'html', url: 'https://budu.jobs/vacancies', interval: 6*3600000, pace: 15000, note: 'IT и digital; публичные карточки' },
  { id: 'tg-react', name: 'TG · React Job', color: '#508ccc', kind: 'telegram', url: 'https://t.me/s/job_react', interval: 30*60000, pace: 15000, note: 'Публичная веб-лента, без входа в аккаунт' },
  { id: 'tg-frontend', name: 'TG · FrontEnd Jobs', color: '#426cb1', kind: 'telegram', url: 'https://t.me/s/frontend_rabota', interval: 30*60000, pace: 15000, note: 'Frontend; ссылки на hh объединяются' },
  { id: 'ashby', name: 'Компании · Ashby', color: '#5b9c70', kind: 'ashby', url: 'https://api.ashbyhq.com/posting-api/job-board/posthog', interval: 6*3600000, pace: 10000, note: 'Публичные API карьерных страниц компаний' },
  { id: 'greenhouse', name: 'Компании · Greenhouse', color: '#368978', kind: 'greenhouse', url: 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs?content=true', interval: 6*3600000, pace: 10000, note: 'Публичный Job Board API' },
  { id: 'lever', name: 'Компании · Lever', color: '#608b48', kind: 'lever', url: 'https://api.lever.co/v0/postings/bluelightconsulting?mode=json', interval: 6*3600000, pace: 10000, note: 'Публичный Postings API' },
]
sourceDefinitions.sort((a,b)=>['habr','geekjob','getmatch','budu','tg-react','tg-frontend'].indexOf(b.id)-['habr','geekjob','getmatch','budu','tg-react','tg-frontend'].indexOf(a.id))
export type SourceTrack = {
  id: string; name: string; color: string; note: string; enabled: boolean; running: boolean;
  phase: 'running' | 'waiting' | 'paused' | 'error' | 'needs_key'; current: string; nextAt: number;
  lastSuccess: string | null; lastError: string | null; requests: number; saved: number; duplicates: number;
  rejected: number; pending: number; boards: number; lastStatus: number | null;
}
