import type { Vacancy } from '../src/lib/hh.ts'
export type CrawlTask = {
  kind: 'market' | 'direction' | 'profession' | 'focus' | 'slice' | 'page' | 'detail'
  label: string; roles?: string[]; directionId?: string; area?: string; experience?: string;
  from: string; to: string; page?: number; cycle: string; depth?: number
  candidate?: Vacancy
  format?: 'REMOTE' | 'HYBRID'; text?: string; focus?: boolean
}

export const moscowDay = (time = Date.now()) => new Date(time + 3 * 3_600_000).toISOString().slice(0, 10)
export const shiftDay = (day: string, offset: number) => new Date(Date.parse(day) + offset * 86_400_000).toISOString().slice(0, 10)
const hhDate = (date: string) => date.split('-').reverse().join('.')

export function taskUrl(task: CrawlTask) {
  if (task.kind === 'detail') {
    if (!task.candidate || !/^\d+$/.test(task.candidate.id)) throw new Error('Некорректный ID карточки вакансии')
    return `https://hh.ru/vacancy/${task.candidate.id}`
  }
  const query = new URLSearchParams({ area: task.area || '113', date_from: hhDate(task.from), date_to: hhDate(task.to), items_on_page: '100', order_by: 'publication_time', page: String(task.page || 0), no_magic: 'true' })
  for (const role of task.roles || []) query.append('professional_role', role)
  if (task.experience) query.set('experience', task.experience)
  if (task.text) query.set('text', task.text)
  for (const format of task.format ? [task.format] : ['REMOTE', 'HYBRID']) query.append('work_format', format)
  return `https://hh.ru/search/vacancy?${query}`
}

export function taskKey(task: CrawlTask) {
  return task.kind === 'detail' ? `detail|${task.candidate?.id}` : `${task.kind}|${task.directionId || ''}|${taskUrl(task)}`
}

export function expandTask(task: CrawlTask, found: number, regions: { id: string; name: string }[]) {
  if (['market', 'direction', 'page', 'detail'].includes(task.kind) || found <= 100) return { tasks: [] as CrawlTask[], limited: false }
  const base = { ...task, kind: 'slice' as const, depth: (task.depth || 0) + 1 }
  if (found > 2000 && task.from !== task.to) {
    const days = Math.round((Date.parse(task.to) - Date.parse(task.from)) / 86_400_000)
    const middle = shiftDay(task.from, Math.floor(days / 2))
    return { tasks: [{ ...base, to: middle }, { ...base, from: shiftDay(middle, 1) }], limited: false }
  }
  if (found > 2000 && (!task.area || task.area === '113') && regions.length) {
    return { tasks: regions.map(region => ({ ...base, area: region.id, label: `${task.label} · ${region.name}` })), limited: false }
  }
  if (found > 2000 && !task.experience) {
    return { tasks: ['noExperience', 'between1And3', 'between3And6', 'moreThan6'].map(experience => ({ ...base, experience })), limited: false }
  }
  return {
    tasks: Array.from({ length: Math.min(20, Math.ceil(found / 100)) - 1 }, (_, index): CrawlTask => ({ ...task, kind: 'page', page: index + 1 })),
    limited: found > 2000,
  }
}
