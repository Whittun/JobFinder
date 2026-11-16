import type { Vacancy } from './hh.ts'

const rank = '(?:senior|sr\\.?|сеньор[а-я]*|сениор[а-я]*|lead|team[ -]?lead|tech[ -]?lead|тимлид[а-я]*|техлид[а-я]*|principal|staff|head|cto|директор[а-я]*|руководител[а-я]*|начальник[а-я]*|ведущий|ведущая|старший|старшая|главный|главная|architect|архитектор[а-я]*)'
const highLevel = new RegExp(`(?<![\\p{L}\\p{N}])${rank}(?![\\p{L}\\p{N}])`, 'iu')
const manager = /(?:engineering|development|project|team|department)\s+manager|менеджер\s+(?:команды|отдела|проект[а-я]*)/iu
const declared = new RegExp(`(?:грейд|уровень|seniority|позици[яию]|ваканси[яию])\\s*(?:[:=—-]|от|не ниже|уровня|для)?\\s*${rank}(?![\\p{L}\\p{N}])`, 'iu')
const hiring = new RegExp(`(?:ищем|требуется|looking for|hiring)\\s+(?:опытного\\s+|a\\s+|an\\s+)?${rank}(?![\\p{L}\\p{N}])`, 'iu')

export function excludedSeniority(job: Pick<Vacancy,'name'|'professional_level'|'description'>): string | null {
  if (highLevel.test(job.name) || manager.test(job.name)) return job.name
  if (highLevel.test(job.professional_level || '')) return `Уровень: ${job.professional_level}`
  for (const line of (job.description || '').replace(/<[^>]*>/g,' ').split(/[\n.!?]+/)) {
    if (/не\s+(?:требуется|обязательно)|не нужен|рост до|вырасти|под руководством|с ментором|with senior|взаимодейств|работать с|работа с|наставник/iu.test(line)) continue
    if (declared.test(line) || hiring.test(line)) return line.trim().slice(0,240)
  }
  return null
}
