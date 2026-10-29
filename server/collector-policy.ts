import { classifyPriorities } from '../src/lib/priorities.ts'
import type { Vacancy } from '../src/lib/hh.ts'
import { professionPriority, skipProfession } from './selection.ts'
import type { CrawlTask } from './crawl-plan.ts'

export const QUEUE_VERSION = 2
export const MIN_INTERVAL = 10_000
export const DETAIL_TTL = 3 * 86_400_000
export const REJECTION_TTL = 86_400_000
export const DISCOVERY_INTERVAL = 6 * 3_600_000
export type ResponseDiagnostic = { at: string; status: number; reason: string; url: string; title: string; retryAfter: string | null }

export function queuePriority(task: CrawlTask, roles: { id: string; name: string }[] = []) {
  if (task.kind === 'market') return -100
  const formats = task.candidate?.work_format || []
  const hybrid = task.kind === 'detail'
    ? !formats.length || formats.some(item => item.id !== 'REMOTE')
    : task.format === 'HYBRID'
  const sample = task.candidate || { name: task.label }
  const matches = classifyPriorities(sample)
  const topic = task.focus || matches.some(item => item.id === 'influence') ? 0
    : matches.length ? 1
    : professionPriority(sample.name) === 0 || roles.some(role => task.candidate?.role_ids?.includes(role.id) && professionPriority(role.name) === 0) ? 2 : 3
  const kind = { market: 0, focus: 1, profession: 2, direction: 2, slice: 3, page: 4, detail: 2 }[task.kind]
  return Number(hybrid) * 10_000 + topic * 100 + kind
}

export function searchPlan(roles: { id: string; name: string }[], base: Pick<CrawlTask, 'from' | 'to' | 'cycle'>): CrawlTask[] {
  const tasks: CrawlTask[] = []
  for (const format of ['REMOTE', 'HYBRID'] as const) {
    for (const text of ['блогер', 'influence', 'инфлюенс']) tasks.push({ ...base, kind: 'focus', label: `Работа с блогерами: ${text}`, text, focus: true, format })
    for (const role of roles.filter(role => !skipProfession(role.name))) tasks.push({ ...base, kind: 'profession', label: role.name, roles: [role.id], format })
  }
  return tasks
}

// Compare the short search fields, not the enriched description or derived skills.
export function candidateChanged(saved: Vacancy, candidate: Vacancy) {
  const summary = (job: Vacancy) => JSON.stringify({
    name: job.name, published: job.published_at, employer: [job.employer.id, job.employer.name], area: [job.area.id, job.area.name],
    formats: job.work_format?.map(item => item.id).sort(), experience: [job.experience?.id, job.experience?.name],
    salary: [job.salary_range || job.salary].map(salary => salary ? [salary.from, salary.to, salary.currency, salary.gross, salary.mode?.id] : null),
  })
  return summary(saved) !== summary(candidate)
}

export function retryAfterMs(value: string | null, now = Date.now()) {
  if (!value) return 0
  const parsed = /^\d+$/.test(value) ? Number(value) * 1000 : Date.parse(value) - now
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

export function responseDiagnostic(status: number, preview: string, url: string, retryAfter: string | null): ResponseDiagnostic {
  const captcha = /captcha|доступ ограничен|провер.{0,25}робот|access denied/iu.test(preview)
  const reason = captcha ? 'Проверка доступа / капча' : status === 429 ? 'Ограничение частоты запросов' : status === 403 ? 'Доступ запрещён; точная причина не указана' : status >= 500 ? 'Ошибка сервиса hh.ru' : 'Ошибка ответа hh.ru'
  const title = (/<title[^>]*>([\s\S]*?)<\/title>/iu.exec(preview)?.[1] || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160)
  return { at: new Date().toISOString(), status, reason, url, title, retryAfter }
}

export async function responsePreview(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return ''
  const decoder = new TextDecoder()
  let preview = ''
  try {
    while (preview.length < 4096) {
      const result = await reader.read()
      if (result.done) break
      preview += decoder.decode(result.value.subarray(0, 8192), { stream: true })
    }
  } catch { /* A broken error body must not bypass handling of its HTTP status. */ }
  finally { await reader.cancel().catch(() => {}) }
  return preview.slice(0, 4096)
}
