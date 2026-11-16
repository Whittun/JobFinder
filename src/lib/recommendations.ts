import type { Vacancy } from './hh.ts'
import type { PriorityReason } from './priorities.ts'

export type RecommendationKind = 'development'
export type Recommendation = { matched: boolean; reasons: PriorityReason[]; notes: PriorityReason[]; excluded: string[] }
type Statement = { text: string; section: 'requirements' | 'optional' | 'duties' | 'stack' | 'other' }
const boundary = (pattern: string, flags = 'iu') => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, flags)
const react = boundary('react(?:\\.js|js)?')
const ts = boundary('typescript|ts')
const redux = boundary('redux(?:[ -]?toolkit)?|rtk(?: query)?')
const nest = boundary('nest(?:\\.?js)?')
const postgres = boundary('postgres(?:ql)?|постгрес(?:ql)?')
const js = boundary('javascript|js|ecmascript|es6')
const html = boundary('html5?'), css = boundary('css3?|scss|sass')
const junior = boundary('junior|jun|джун[а-я]*|стаж[её]р[а-я]*|intern|trainee|начинающ[а-я]*')
const senior = boundary('senior|sr\\.?|сеньор[а-я]*|сениор[а-я]*|lead|team[ -]?lead|tech[ -]?lead|тимлид[а-я]*|техлид[а-я]*|ведущий|ведущая|главный|главная|старший|старшая|архитектор[а-я]*|architect|principal|staff|head|cto|руководител[а-я]*')
const webRole = /front[ -]?end|фронт[еэ]нд|full[ -]?stack|фул[л]?[ -]?ст[еэ]к|веб|web|в[её]рст|html|css/iu
const codingRole = /разработчик|разработчица|программист|developer|software engineer|frontend|backend|fullstack|верстальщик|вёрстальщик/iu
const auxiliary = /рекрутер|recruiter|\bhr\b|подбор персонала|преподавател|репетитор|методист|автор (?:дисциплин|курсов)|дизайнер|designer|тестиров|по тестированию|\bqa\b|\bsdet\b|менеджер|\bmanager\b|product owner|аналитик|маркетолог|\bsmm\b|devops|\bsre\b/iu
const optional = /будет.{0,18}(?:плюсом|преимуществом)|плюсом|желательн|необязательн|опциональн|приветствуется|будет полезно|optional|nice[ -]to[ -]have|as a plus|is a plus|would be a plus/iu
const required = /обязател[а-я]*|необходим[а-я]*|требуется|must[ -]have|required|mandatory/iu
const knowledge = /опыт|знани|знать|владени|владеть|уметь|умеете|понима|навык|experience|proficien|knowledge|competenc|работать на|пишем на/iu
const company = /^(?:наша компания|наши клиенты|наша команда|мы (?:разрабатываем|созда[её]м|используем)|в (?:нашей )?команде (?:есть|работают)|наш (?:backend|бэкенд|мобильный отдел))/iu
const foreignPattern = boundary('react[ -]?native|reactnative|native[ -]?script|vue(?:\\.js|js)?(?: ?v?\\d+(?:\\.\\d+)*)?|vuex|pinia|nuxt(?:\\.js)?|angular(?:js)?(?: ?v?\\d+(?:\\.\\d+)*)?|ngrx|svelte(?:kit)?|solidjs|ember(?:\\.js)?|backbone(?:\\.js)?|next\\.js|nextjs|flutter|dart|kotlin|swift|android|ios|java|spring(?: boot)?|python|django|flask|fastapi|golang|go|rust|[cс]\\+\\+(?:\\d+)?|[cс]#|\\.net|asp\\.net|php|laravel|symfony|drupal|ruby|rails|elixir|erlang|scala|1[сc]|mongodb|mysql|unity|cocos(?: creator)?|unreal(?: engine)?|bpmsoft|terrasoft|creatio', 'giu')
const alternativeStack = 'react(?:\\.js|js)?|typescript|redux|nest(?:\\.?js)?|postgres(?:ql)?|javascript|html|css'
const alternativeJoin = '(?:/|и/или|или|or)'
const beforeAlternative = new RegExp(`(?:${alternativeStack})(?:\\s*${alternativeJoin}\\s*[\\p{L}\\p{N}.+#-]+){0,4}\\s*${alternativeJoin}\\s*$`, 'iu')
const afterAlternative = new RegExp(`^\\s*${alternativeJoin}\\s*(?:[\\p{L}\\p{N}.+#-]+\\s*${alternativeJoin}\\s*){0,4}(?:${alternativeStack})(?![\\p{L}\\p{N}])`, 'iu')
const tokenKey = (token: string) => token.toLowerCase().replace(/^(vue|angular)(?:\.js|js)?(?: ?v?\d+(?:\.\d+)*)?$/, '$1').replace(/^(nuxt|next)(?:\.js|js)$/, '$1').replace(/^react[ -]?native$/, 'react native')

function statements(description: string): Statement[] {
  let section: Statement['section'] = 'other'
  const output: Statement[] = []
  const lines = description.replace(/<\/(?:p|li|div|h\d)>|<br\s*\/?>/giu, '\n').replace(/<[^>]*>/g, ' ').split(/\n+/)
  for (const raw of lines) {
    const line = raw.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').replace(/^[•\-*]\s*/, '').trim()
    if (!line) continue
    const heading = line.replace(/[:：]\s*$/, '')
    if (heading.length < 90) {
      if (/^(?:(?:наши|основные|обязательные|ключевые|минимальные)\s+)*(?:требования|requirements|must[ -]have)|^мы (?:ожидаем|жд[её]м от|ищем)|^что (?:нужно|важно|ожидаем|мы ожидаем|для нас важно)|^от вас|^нам важно|^вы нам подойд[её]те/iu.test(heading)) section = 'requirements'
      else if (/^(?:будет|будут|плюсом|желательно|nice[ -]to[ -]have|преимуществ|дополнительн|необязательно)/iu.test(heading) && optional.test(heading)) section = 'optional'
      else if (/^(?:ваши |основные )?(?:задачи|обязанности|responsibilities)|^вам предстоит|^чем (?:предстоит|вы)|^что предстоит|^какие задачи/iu.test(heading)) section = 'duties'
      else if (/^(?:наш |основной |технологический )?стек\s*[:：]?$/iu.test(heading)) section = 'stack'
      else if (/^(?:условия|мы предлагаем|мы готовы предложить|о компании|о нас|benefits|что мы предлагаем)/iu.test(heading)) section = 'other'
    }
    for (const text of line.split(/(?<=[!?;])\s+|(?<=\.)\s+(?=[А-ЯA-Z])/u)) output.push({ text, section })
  }
  return output
}

function reason(keyword: string, text: string, source: PriorityReason['source']): PriorityReason {
  const offset = text.toLocaleLowerCase('ru-RU').indexOf(keyword.toLocaleLowerCase('ru-RU'))
  const start = Math.max(0, offset - 65), end = Math.min(text.length, Math.max(0, offset) + keyword.length + 120)
  return { keyword, source, evidence: `${start ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}` }
}

function optionalAt(statement: Statement, token: string) {
  // An explicit mandatory clause wins over the surrounding optional section.
  const offset = statement.text.toLowerCase().indexOf(token.toLowerCase())
  const before = statement.text.slice(Math.max(0, offset - 65), offset)
  const after = statement.text.slice(offset + token.length, offset + token.length + 65)
  const nearby = `${before.split(/[,;]/).at(-1)} ${token} ${after.split(/[,;]/)[0]}`
  if (required.test(nearby) && !/необязател|не\s+(?:обязател|требуется|required)/iu.test(nearby)) return false
  return optional.test(nearby) || (statement.section === 'optional' && !required.test(nearby))
}

function negatedAt(statement: Statement, token: string) {
  const offset = statement.text.toLowerCase().indexOf(token.toLowerCase())
  const before = statement.text.slice(Math.max(0, offset - 45), offset)
  const after = statement.text.slice(offset + token.length, offset + token.length + 35)
  return /(?:не (?:нуж[а-я]*|требуется|требуем)|без (?:знания|опыта)(?: работы)?|не нужно знать)\s*$/iu.test(before) || /^[\p{L}]*\s*(?:не требуется|не обязател|не нужен)/iu.test(after)
}

function alternativeAt(text: string, token: string) {
  const offset = text.toLowerCase().indexOf(token.toLowerCase())
  const before = text.slice(Math.max(0, offset - 75), offset), after = text.slice(offset + token.length, offset + token.length + 75)
  // Slash / OR are alternatives. Plain AND means both competencies are needed.
  return beforeAlternative.test(before) || afterAlternative.test(after)
}

export function recommendDevelopment(vacancy: Vacancy): Recommendation {
  const result: Recommendation = { matched: false, reasons: [], notes: [], excluded: [] }
  const title = vacancy.name
  if (auxiliary.test(title) || (!codingRole.test(title) && /безопасност|appsec|пентест|security|кибер/iu.test(title))) { result.excluded.push('Это не вакансия разработчика или верстальщика'); return result }
  const lines = statements(vacancy.description || '')
  if (/ретуш[её]р|полиграф|допечат|\bdtp\b/iu.test(title) || (!html.test(vacancy.description || '') && /в[её]рстк[а-я]* полиграф/iu.test(vacancy.description || ''))) { result.excluded.push('Полиграфия и ретушь вместо веб-вёрстки'); return result }
  if (!codingRole.test(title) && !webRole.test(title) && !lines.some(line => line.section === 'duties' && /(?:разработк|в[её]рстк|написани[ея] кода)/iu.test(line.text))) {
    result.excluded.push('Не найдены задачи разработки'); return result
  }
  if (senior.test(title) || senior.test(vacancy.professional_level || '') || vacancy.experience?.id === 'moreThan6') result.excluded.push('Senior / lead или опыт более 6 лет')
  for (const line of lines) {
    if (company.test(line.text) || line.section === 'optional') continue
    if ((line.section === 'requirements' || /ищем|уровень|позици|ваканси/iu.test(line.text)) && senior.test(line.text) && /senior|сеньор|сениор|lead|тимлид|техлид|ведущий разработчик|старший разработчик|principal|staff|уровень|позици/iu.test(line.text) && !/наставник|ментор|вырасти|рост до|в команде|with senior|взаимодейств|под руководством/iu.test(line.text)) result.excluded.push('В описании требуется senior / lead')
    if ((line.section === 'requirements' || knowledge.test(line.text)) && /опыт|experience|стаж/iu.test(line.text) && /(?:от|не менее|минимум|at least)\s*(?:[5-9]|\d{2,})\s*(?:лет|years)|(?:[5-9]|\d{2,})\+\s*(?:лет|years)/iu.test(line.text)) result.excluded.push('Требуется от 5 лет опыта')
  }
  const softTokens = new Set<string>()
  const hardTokens = new Set<string>()
  const inspect = (text: string, source: PriorityReason['source'], statement?: Statement) => {
    for (const hit of text.matchAll(foreignPattern)) {
      const token = hit[0], key = tokenKey(token)
      if (key === 'go' && source === 'description' && token === 'go' && !/на go|in go|язык.{0,15}go/iu.test(text)) continue
      if (statement && company.test(statement.text)) continue
      if (statement && negatedAt(statement, token)) { softTokens.add(key); continue }
      if ((statement && optionalAt(statement, token)) || alternativeAt(text, token)) {
        softTokens.add(key)
        if (result.notes.length < 4) result.notes.push(reason(token, text, source))
        continue
      }
      if (source === 'title' || source === 'skills' || (statement && (statement.section === 'requirements' || required.test(text) || knowledge.test(text) || (statement.section === 'duties' && /разработ|программ|писать|код|поддерж|реализ|внедр/iu.test(text)) || (statement.section === 'stack' && /vue|angular|svelte|next|native|flutter/iu.test(token))))) hardTokens.add(key)
    }
  }
  // Read the prose before structured tags so explicit optional wording can qualify a tag.
  for (const line of lines) inspect(line.text, 'description', line)
  inspect(title, 'title')
  for (const skill of vacancy.key_skills || []) {
    const tokens = [...skill.matchAll(foreignPattern)]
    if (tokens.every(hit => softTokens.has(tokenKey(hit[0])) && !hardTokens.has(tokenKey(hit[0])))) continue
    inspect(skill, 'skills')
  }
  for (const token of hardTokens) result.excluded.push(`Требуется другой стек: ${token}`)
  if (result.excluded.length) return { ...result, excluded: [...new Set(result.excluded)] }

  const sources: [PriorityReason['source'], string][] = [['title', title], ...(vacancy.key_skills || []).map(skill => ['skills', skill] as [PriorityReason['source'], string]), ...lines.filter(line => !company.test(line.text)).map(line => ['description', line.text] as [PriorityReason['source'], string])]
  for (const [label, pattern] of [['React', react], ['TypeScript', ts], ['Redux', redux]] as const) {
    const source = sources.find(([, text]) => pattern.test(text))
    if (source) result.reasons.push(reason(label, source[1], source[0]))
  }
  const text = sources.map(([, text]) => text).join('\n')
  if (nest.test(text) && postgres.test(text)) result.reasons.push(reason('Nest.js + PostgreSQL', sources.find(([, value]) => nest.test(value))?.[1] || title, 'description'))
  if (/(?:в[её]рстальщик|верстк|вёрстк|html[ -]?(?:developer|разработ))/iu.test(title) || (html.test(text) && css.test(text) && webRole.test(title))) result.reasons.push(reason('HTML / CSS · вёрстка', title, 'title'))
  if (js.test(text) && (junior.test(title) || vacancy.experience?.id === 'noExperience' || lines.some(line => /базов|основ[а-я]*\s+(?:знани|javascript|js)|начальн[а-я]*\s+знани/iu.test(line.text) && js.test(line.text)))) result.reasons.push(reason('Базовый JavaScript / junior', sources.find(([, value]) => js.test(value))?.[1] || title, 'description'))
  result.matched = result.reasons.length > 0
  if (!result.matched) result.excluded.push('Не найден подходящий веб-стек или начальные задачи JS / вёрстки')
  return result
}

export const recommendVacancy = (vacancy: Vacancy, kind: RecommendationKind) => kind === 'development' ? recommendDevelopment(vacancy) : { matched:false, reasons:[], notes:[], excluded:[] }
