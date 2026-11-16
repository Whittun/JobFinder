import type { Vacancy } from '../src/lib/hh.ts'
import { excludedSeniority } from '../src/lib/seniority.ts'

export const WEB_QUERIES = ['frontend OR фронтенд OR верстальщик', 'backend OR fullstack OR "веб-разработчик"', '"техническая поддержка" OR "инженер поддержки"', '"QA" OR "тестировщик"', 'DevOps OR SRE', '"web" OR "веб" OR "Node.js" OR "React"']
const web = /(?:\b(?:html|css|javascript|typescript|react|vue|angular|node\.?js|nest\.?js|next\.?js|php|laravel|django|fastapi|wordpress|webflow|tilda|http|https|rest|graphql|nginx|browser|web)\b|веб|сайт|браузер|фронтенд|интернет[ -]магазин)/iu
const unrelated = /инфлюенс|influenc|блогер|\bsmm\b|маркетолог|копирайтер|рекрутер|бухгалтер|продаж|репетитор|преподавател|\b(?:sales|recruiter)\b/iu
const direct = /front[ -]?end|фронт[еэ]нд|full[ -]?stack|фул[л]?[ -]?ст[еэ]к|back[ -]?end|б[еэ]к[еэ]нд|веб[ -]?(?:разработ|дизайнер|мастер)|верстальщик|вёрстальщик|html[ -]?(?:developer|разработ)|(?:react|node\.?js|php)[ -]?(?:developer|разработ)/iu
const technical = /разработ|программист|developer|engineer|инженер|тестиров|\bqa\b|поддерж|support|devops|\bsre\b|администр|аналитик|дизайнер|проект|product|внедрени|интеграци|безопасност|security|автоматизац|архитектор/iu

export function isWebVacancy(job: Pick<Vacancy, 'name' | 'description' | 'key_skills'>) {
  if (unrelated.test(job.name)) return false
  if (/react[ -]?native|android|\bios\b|flutter|unity|unreal|embedded|(?:^|\s)1[сc](?:\s|$)/iu.test(job.name) && !/\bweb\b|веб/iu.test(job.name)) return false
  if (direct.test(job.name)) return true
  const context = `${job.name}\n${job.key_skills?.join(' ') || ''}\n${job.description || ''}`
  return technical.test(job.name) && web.test(context)
}
// Search listings lack full descriptions. Keep plausible technical candidates for verification.
export function isWebCandidate(job: Pick<Vacancy, 'name' | 'description' | 'key_skills'>) {
  return !unrelated.test(job.name) && !excludedSeniority(job) && (direct.test(job.name) || technical.test(job.name))
}
export const isExcludedWebTitle = (title: string) => unrelated.test(title) || !!excludedSeniority({name:title})
