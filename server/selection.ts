import { isWebVacancy } from './web-scope.ts'
import type { Vacancy } from '../src/lib/hh.ts'
import { classifyMarket, marketRejectionNames } from '../src/lib/market-policy.ts'

export const SELECTION_VERSION = 'web-remote-v2'
export type Rejection = 'office' | 'sales' | 'calls' | 'teaching' | 'closed' | 'no_description' | 'not_web' | 'communication' | 'russia_restricted' | 'seniority'
export const rejectionNames: Record<Rejection, string> = {
  office: 'Без удалённого или гибридного формата', sales: 'Продажи', calls: 'Обзвоны и колл-центры',
  teaching: 'Преподавание и сопровождение обучения', closed: 'Закрытые вакансии', no_description: 'Нет полного описания',
  ...marketRejectionNames, not_web: 'Не относится к вебу',
}
const clean = (text: string) => text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim()
const technicalSupport = /техподдерж|технич\S*\s+поддерж|поддерж\S*\s+(?:пользовател|по|программ|сервис|продукт)|(?:technical|customer)\s+support|help.?desk|service.?desk|клиентск\S*\s+сервис|customer\s+service/i
const salesTitle = /продаж|продавец|продавщ|\bsales\b|\b(?:sdr|bdr)\b|account\s+executive|менеджер\S*\s+по\s+(?:привлечени|лидогенерац)|ри[еэ]лтор|\brealtor\b/i
const callTitle = /кол[л-]*[ -]?центр|call[ -]?cent(?:er|re)|контакт[ -]?центр|телемаркет|обзвон|исходящ\S*\s+звон|холодн\S*\s+звон/i
const teachingTitle = /репетитор|преподавател|учител|педагог|тьютор|методист|\btutor\b|\bteacher\b|\blecturer\b|(?:куратор|наставник|администратор|менеджер)\S*\s+(?:онлайн[ -]?школ|(?:онлайн[ -]?)?курс|обучени|ученик|студент)|тренер\s+(?:английского|немецкого|математик)/i
const technicalRole = /разработ|программист|developer|devops|аналитик|дизайнер|маркетолог|smm/i

function activeDuty(text: string, pattern: RegExp, technical = false) {
  for (const match of text.matchAll(new RegExp(pattern.source, 'gi'))) {
    const before = text.slice(Math.max(0, match.index! - 45), match.index)
    if (/(?:без|нет|никаких|without|no|не\s+(?:нужно|требуется|предстоит|будет)|отсутствие)\s+(?:[а-яa-z-]+\s+){0,3}$/i.test(before)) continue
    if (technical && /(?:платформ|сервис|систем|продукт|инструмент|позволя|помога|автоматизац).{0,40}$/i.test(before)) continue
    return true
  }
  return false
}

function duties(text: string) {
  const lines=text.split('\n')
  const start=lines.findIndex(line=>line.length<120&&/^(?:ваши\s+)?(?:обязанности|задачи|чем предстоит заниматься|чем вы будете заниматься|что предстоит делать|responsibilities)\s*[:：]?$/i.test(line.trim()))
  if(start<0)return clean(text)
  const rest=lines.slice(start+1)
  const end=rest.findIndex(line=>line.length<120&&/^(?:наши\s+)?(?:требования|условия|мы предлагаем|что мы предлагаем|что мы ожидаем|requirements|benefits)\s*[:：]?$/i.test(line.trim()))
  return clean((end<0?rest:rest.slice(0,end)).join('\n'))
}

export function rejectionFor(vacancy: Vacancy, requireDescription = false): Rejection | null {
  if (vacancy.closed) return 'closed'
  if (vacancy.work_format?.some(format => format.id === 'FIELD_WORK')) return 'office'
  if (!vacancy.work_format?.some(format => ['REMOTE','HYBRID'].includes(format.id))) return 'office'
  const title = clean(vacancy.name)
  if (salesTitle.test(title) && !technicalRole.test(title)) return 'sales'
  if (teachingTitle.test(title)) return 'teaching'
  if (/телемаркетолог|telemarketer/i.test(title)) return 'calls'
  if (callTitle.test(title) && !technicalSupport.test(title) && !technicalRole.test(title)) return 'calls'
  const body = duties(vacancy.description || '')
  const technical=technicalRole.test(title)
  if (!technical && /(?:affiliate|account|key[ -]?account).*manager|менеджер.{0,50}(?:клиент|партнер)/i.test(title) && activeDuty(clean(vacancy.description||''),/(?:навыки\s+продаж\s*:|обязателен\s+опыт\s+(?:в\s+)?продаж)/)) return 'sales'
  if (!technical && (/(?:affiliate|account|key[ -]?account).*manager|менеджер.{0,50}(?:клиент|партнер)/i.test(title)||vacancy.role_ids?.includes('70')) && activeDuty(body,/(?:продажа|продажи)\s+(?:услуг|товар|тариф|курс)|заключать\s+сделки|привлекать\s+новых\s+клиентов/)) return 'sales'
  if (activeDuty(body, /(?:холодн\S*|исходящ\S*)\s+(?:телефонн\S*\s+)?(?:звонк|обзвон)|(?:совершать|осуществлять|проводить|вести|делать)\s+(?:регулярн\S*\s+)?обзвон|обзванивать\s+(?:базу|клиентов|потенциальных)|\b(?:outbound|cold)\s+calls\b/,technical)) return 'calls'
  if (activeDuty(body, /(?:выполнени[ея]|выполнять|обеспечивать)\s+(?:личн\S*\s+)?план\S*\s+(?:по\s+)?продаж|(?:активн\S*|прям\S*|холодн\S*)\s+продаж|допродаж|продавать\s+(?:услуг|товар|продукт|тариф|курс)|\b(?:upsell|cross[ -]?sell)\b|поиск\s+и\s+привлечение\s+(?:новых|потенциальных)\s+клиентов/,technical)) return 'sales'
  if (activeDuty(body, /(?:проводить|вести|проведение)\s+(?:индивидуальн\S*\s+)?(?:онлайн[ -]?)?(?:уроки|уроков|занятия|занятий)|(?:проверять|проверка)\s+домашни\S*\s+задани\S*|(?:обучать|обучение)\s+(?:учеников|школьников|студентов)|преподавать\s+(?:английский|немецкий|математику|программирование)|\b(?:conduct|teach)\s+(?:online\s+)?(?:lessons|classes)\b/,technical)) return 'teaching'
  if (requireDescription && clean(vacancy.description||'').length < 40) return 'no_description'
  if (requireDescription && !isWebVacancy(vacancy)) return 'not_web'
  if (requireDescription) return classifyMarket(vacancy).reason
  return null
}

export function skipProfession(name: string) {
  const title = clean(name)
  // These broad HH roles also contain service/support positions; inspect each job.
  if (/работе с клиентами|контактного центра|call-центра|колл-центра/.test(title)) return false
  return salesTitle.test(title) || teachingTitle.test(title)
}

export function professionPriority(name: string) {
  return /разработ|программист|тестиров|аналитик|devops|smm|дизайнер|поддерж|менеджер продукта|менеджер проект|маркетолог/i.test(name) ? 0 : 3
}
