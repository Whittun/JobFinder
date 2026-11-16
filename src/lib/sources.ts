export type SourceKind = 'json' | 'rss' | 'html' | 'telegram' | 'ashby' | 'greenhouse' | 'lever' | 'search'
export type SourceDefinition = { id: string; name: string; color: string; kind: SourceKind; url: string; interval: number; pace: number; note: string }
export const sourceDefinitions: SourceDefinition[] = [
  { id: 'wwr', name: 'We Work Remotely', color: '#4f858b', kind: 'rss', url: 'https://weworkremotely.com/remote-jobs.rss', interval: 6*3600000, pace: 15000, note: 'Официальная RSS-лента' },
  { id: 'habr', name: 'Хабр Карьера', color: '#4b89a8', kind: 'html', url: 'https://career.habr.com/vacancies?remote=true', interval: 6*3600000, pace: 12000, note: 'Выдача и полные карточки вакансий' },
  { id: 'geekjob', name: 'Geekjob', color: '#8f9144', kind: 'html', url: 'https://geekjob.ru/vacancies', interval: 6*3600000, pace: 12000, note: 'IT и digital; публичные карточки' },
  { id: 'getmatch', name: 'getmatch', color: '#b07a35', kind: 'html', url: 'https://getmatch.ru/sitemap.xml', interval: 6*3600000, pace: 15000, note: 'Карта сайта и полные карточки; сначала новые ID' },
  { id: 'budu', name: 'БУДУ', color: '#9375b1', kind: 'html', url: 'https://budu.jobs/vacancies', interval: 6*3600000, pace: 15000, note: 'IT и digital; публичные карточки' },
  { id: 'ashby', name: 'Компании · Ashby', color: '#5b9c70', kind: 'ashby', url: 'https://api.ashbyhq.com/posting-api/job-board/posthog', interval: 6*3600000, pace: 10000, note: 'Публичные API карьерных страниц компаний' },
  { id: 'greenhouse', name: 'Компании · Greenhouse', color: '#368978', kind: 'greenhouse', url: 'https://boards-api.greenhouse.io/v1/boards/gitlab/jobs', interval: 6*3600000, pace: 10000, note: 'Короткий список → отдельные полные карточки' },
  { id: 'lever', name: 'Компании · Lever', color: '#608b48', kind: 'lever', url: 'https://api.lever.co/v0/postings/bluelightconsulting?mode=json&limit=1&skip=0', interval: 6*3600000, pace: 10000, note: 'Postings API; небольшие страницы без тяжёлой общей выгрузки' },
]
sourceDefinitions.sort((a,b)=>['habr','geekjob','getmatch','budu'].indexOf(b.id)-['habr','geekjob','getmatch','budu'].indexOf(a.id))
export type SourceTrack = {
  id: string; name: string; color: string; note: string; enabled: boolean; running: boolean;
  phase: 'running' | 'waiting' | 'paused' | 'error' | 'needs_key'; current: string; nextAt: number;
  lastSuccess: string | null; lastError: string | null; requests: number; saved: number; duplicates: number;
  rejected: number; pending: number; boards: number; lastStatus: number | null;
}
