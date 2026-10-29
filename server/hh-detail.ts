import type { Vacancy } from '../src/lib/hh.ts'
import { decodeEntities, HhPageError, parseState } from './hh-page.ts'

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const string = (value: unknown) => typeof value === 'string' ? value : ''
const formats: Record<string, string> = { REMOTE: 'Удалённо', HYBRID: 'Гибрид', ON_SITE: 'На месте работодателя', FIELD_WORK: 'Разъездной' }
const languageNames: Record<string, string> = { eng: 'Английский', deu: 'Немецкий', ger: 'Немецкий', fra: 'Французский', fre: 'Французский', zho: 'Китайский', chi: 'Китайский' }

export function plainDescription(html: string) {
  return decodeEntities(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,'').replace(/<\/?(?:p|div|li|ul|ol|br|h[1-6])\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,' '))
    .replace(/[ \t\u00a0]+/g,' ').replace(/\n\s*\n/g,'\n').trim().slice(0,120_000)
}

export function parseVacancyDetail(html: string, candidate: Vacancy): Vacancy {
  const state = parseState(html)
  const full = object(object(object(state.vacancyView).vacancyFull).vacancy)
  if (String(full.vacancyId) !== candidate.id) throw new HhPageError('Карточка hh.ru не соответствует запрошенному ID вакансии.')
  const description = plainDescription(string(full.description))
  if (description.length < 40) throw new HhPageError('Полное описание вакансии недоступно. Повторим получение позже.')
  const workFormats = Array.isArray(full.workFormats) ? full.workFormats.filter((value): value is string => typeof value === 'string') : null
  const keySkills = Array.isArray(full.keySkills) ? full.keySkills.map(value => typeof value === 'string' ? value : string(object(value).name)).filter(Boolean) : []
  const languages = Array.isArray(full.languages) ? full.languages.map(value => {
    if (typeof value === 'string') return languageNames[value] || value
    const item = object(value)
    return string(item.name) || languageNames[string(item.id)] || ''
  }).filter(Boolean) : []
  return {
    ...candidate, name: string(full.name) || candidate.name, description, key_skills: keySkills, spoken_languages: languages,
    work_format: workFormats ? workFormats.map(id => ({ id, name: formats[id] || id })) : candidate.work_format,
    closed: /closed|archived|deleted/i.test(string(full.status)) || full.closedForApplicants === true,
    detail_fetched_at: new Date().toISOString(),
  }
}
