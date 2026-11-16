import type { Vacancy } from './hh.ts'
import { excludedSeniority } from './seniority.ts'

export const MARKET_POLICY_VERSION = 'ru-rf-level-v2'
export type MarketRejection = 'communication' | 'russia_restricted' | 'seniority'
export type MarketDecision = { eligible: boolean; reason: MarketRejection | null; evidence: string }
export const marketRejectionNames: Record<MarketRejection, string> = {
  communication: 'Не подтверждена русская рабочая коммуникация',
  russia_restricted: 'Ограничения не допускают работу из РФ',
  seniority: 'Руководящая или senior-позиция',
}
const clean = (text: string) => text.replace(/<[^>]*>/g, ' ').replace(/ё/gi, 'е').replace(/[\u2010-\u2015]/g, '-').replace(/[ \t\u00a0]+/g, ' ').trim()
const russia = /(?<![\p{L}\p{N}])(?:russia|russian federation|rus|ru|росси[а-я]*|рф)(?![\p{L}\p{N}])/iu
const russianCity = /москв|санкт[ -]?петербург|питер|(?<![а-я])спб(?![а-я])|казан|екатеринбург|новосибирск|нижн[а-я ]+новгород|краснодар|ростов-на-дону|воронеж|самар|пермь|уфа|челябинск|омск|тюмень|саратов/iu
const unrestricted = /worldwide|anywhere|global|any (?:country|location)|all countries|весь мир|по всему миру|любая|любой|любые|люб[а-я ]{0,15}стран|без ограничени[а-я ]{0,20}(?:стран|локац|географ)|не (?:важн|ограничен)|снг|\bcis\b|еаэс|\beaeu\b/iu
const broadRegion = /^(?:remote[\s:,-]*)?(?:europe|европа|европе|emea)(?:[\s,;·/+-]*(?:only|remote|utc|gmt|cet|cest|msk|[\d: +-]))*$/iu
const timezoneOnly = /^(?:(?:utc|gmt|cet|cest|msk|мск|моск[а-я ]+врем[а-я]*|часов[а-я ]+пояс[а-я]*|time[ -]?zones?|overlap|hours)[\s\d: +/.,–—-]*)+$/iu
const permitsRussia = (value: string) => {
  const scope = value.replace(/[,;]\s*(?:работа|работаем|график|hours|overlap)[^\n]{0,100}(?:мск|московск[а-я ]*времен[а-я]*|utc|cet)[^\n]*$/iu, '')
  return russia.test(scope) || russianCity.test(scope) || unrestricted.test(scope) || broadRegion.test(scope.trim()) || timezoneOnly.test(scope.trim())
}
const regionNames = [new Intl.DisplayNames(['en'], { type: 'region' }), new Intl.DisplayNames(['ru'], { type: 'region' })]
const foreignNames: string[] = []
for (let first = 65; first <= 90; first++) for (let second = 65; second <= 90; second++) {
  const code = String.fromCharCode(first, second)
  if (code === 'RU') continue
  for (const names of regionNames) { const name = names.of(code); if (name && name !== code) foreignNames.push(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) }
}
const foreignCountry = new RegExp(`(?<![\\p{L}\\p{N}])(?:${foreignNames.sort((a,b) => b.length-a.length).join('|')})(?![\\p{L}\\p{N}])`, 'iu')
const foreignScope = (scope: string) => foreignCountry.test(scope) || /\b(?:US|USA|UK|EU|EEA|GB|CA|DE|FR|PL|UA|BY|KZ|AM|GE|CY|IL|AU|LATAM)\b/.test(scope) || /сша|евросоюз|(?<![а-я])ес(?![а-я])|северн[а-я ]+америк|латинск[а-я ]+америк|германи[юяи]|польш[аеуи]|серби[июя]|армени[юяи]|грузи[юяи]|беларус[ьи]|казахстан[еа]?|турци[юяи]|испани[яюи]|португали[юяи]|израил[еь]|кипр[еа]?|украин[еуыа]|великобритани[юяи]|канад[еуаы]|нидерланд[а-я]*|черногори[юяи]|таиланд[еа]?/iu.test(scope)
const reject = (reason: MarketRejection, evidence: string): MarketDecision => ({ eligible: false, reason, evidence: clean(evidence).slice(0, 260) })

const russianCommunication = [
  /русскоязычн[а-я]*\s+(?:команд[а-я]*|коллектив[а-я]*|коммуникаци[а-я]*|сред[а-я]*)/iu,
  /(?:рабочий|основной|корпоративный)\s+язык\s*(?:команд[а-я]*)?\s*[:=-]?\s*русск/iu,
  /(?:общени[ея]|коммуникаци[яи]|собеседовани[ея])[^.!?\n]{0,35}на русском/iu,
  /russian[ -]speaking\s+(?:team|company|environment|colleagues)/iu,
  /(?:working|primary|company|team|communication)\s+language\s*(?:is|:|-)?\s*russian/iu,
  /(?:team|internal)\s+communications?[^.!?\n]{0,25}(?:in\s+)?russian|communicat(?:e|ion|ions)\s+in\s+russian/iu,
  /(?:fluent|native)\s+russian|russian\s+(?:language\s+)?(?:is\s+)?(?:required|mandatory)/iu,
]
const foreignCommunication = [
  /(?:рабочий|основной|корпоративный)\s+язык\s*(?:команд[а-я]*)?\s*[:=-]?\s*(?:английск|немецк|французск|испанск|китайск)/iu,
  /язык\s+(?:общения|коммуникации|команды)\s*[:=-]?\s*(?:английск|немецк|французск|испанск|китайск)/iu,
  /(?:вс[ея]|ежедневн[а-я]*)\s+(?:общени[ея]|коммуникаци[яи]|созвон[а-я]*)[^.!?\n]{0,65}(?:английск|немецк|французск)/iu,
  /(?:общени[ея]|коммуникаци[яи])\s+(?:с\s+)?(?:командой|клиентами|заказчиками)[^.!?\n]{0,45}на\s+(?:английском|немецком|французском)/iu,
  /(?:working|primary|company|team|communication)\s+language\s*(?:is|:|-)?\s*(?:english|german|french|spanish|chinese)/iu,
  /(?:english|german|french)[ -]only\s+(?:team|communication|environment)|(?:all|daily)\s+(?:team\s+)?communication[^.!?\n]{0,35}(?:english|german|french)/iu,
  /english[ -]speaking\s+(?:team|environment)/iu,
  /communication\s*(?:is\s+)?(?:in|:)\s*(?:english|german|french)/iu,
]
const negativeRussia = [
  /(?:не\s+(?:нанимаем|рассматриваем|принимаем|работаем)|не\s+можем\s+(?:нанимать|оформлять|сотрудничать)|кроме|исключая|за исключением)[^.!?\n]{0,100}(?:россии|россию|российск[а-я]*|рф)(?![а-я])/iu,
  /(?:вне|за пределами)\s+(?:россии|рф)(?![а-я])/iu,
  /(?:из|в|на территории)\s+(?:россии|рф)(?![а-я])[^.!?;,\n]{0,45}(?:невозможн|недоступн|запрещен|не\s+(?:допускается|рассматрива[а-я]*|предусмотрен|можем|работаем))/iu,
  /(?:работать|работа|находиться|проживать)\s+(?:из|в)\s+(?:россии|рф)(?![а-я])\s+(?:нельзя|невозможно)/iu,
  /(?:outside|excluding|except(?: for)?|not (?:available|open) (?:in|to)|cannot hire (?:in|from)|do not hire (?:in|from))\s+(?:candidates?\s+(?:in|from)\s+)?(?:russia|the russian federation)(?![a-z])/iu,
  /(?:russia|russian federation|russian (?:residents|citizens|nationals))\s*(?:is|are)?\s*(?:excluded|not (?:eligible|supported|allowed))/iu,
]
function negated(text: string, index: number) {
  const before = text.slice(Math.max(0, index - 70), index)
  return /(?:не (?:нужно|требуется|обязательно|надо)|нет (?:требования|необходимости)|(?<![а-я])не|not required to|no need to|\bno|\bnot(?: a)?)\s*(?:быть|находиться|проживать|переезжать|be|live|reside)?\s*$/iu.test(before)
}
function restrictionFromText(text: string) {
  for (const pattern of negativeRussia) {
    for (const match of text.matchAll(new RegExp(pattern.source, 'giu'))) {
      if (negated(text, match.index!)) continue
      if (/^(?:вне|за пределами|outside)/iu.test(match[0])) {
        const before = text.slice(Math.max(0, match.index!-100), match.index!).split(/[.!?\n]/).at(-1) || ''
        const required = /локаци|географ|(?:нужно|необходимо|обязательн[а-я]*|должен|должны|только|строго|must|required|need to|based|located|reside|candidates?)|(?:находиться|проживать)/iu.test(before)
        const optional = /возможност|можно|можете|в том числе|разреш|допуска|опциональн|can\s+(?:work|live)|welcome/iu.test(before)
        if (optional && !/только|строго|обязательн|must|required/iu.test(before)) continue
        if (!required && text.trim() !== match[0].trim() && !/remote\s*[-:(]?\s*$/iu.test(before)) continue
      }
      return match[0]
    }
  }
  const locationPatterns = [
    /(?:локация|география|страны найма|доступные страны)\s*[:=-]\s*([^.!?\n]{2,180})/giu,
    /(?:требуется|обязательно|необходимо)\s+(?:проживание|находиться|проживать|резидентство|внж|разрешение на работу)\s*(?:в|на территории)?\s*([^.!?\n]{2,150})/giu,
    /(?:кандидаты|нанимаем|работа|удаленн[а-я]*)\s+(?:доступна\s+|возможна\s+)?(?:только|исключительно|строго)\s+(?:для\s+)?(?:кандидатов\s+)?(?:из|в|на территории)\s+([^.!?\n]{2,150})/giu,
    /(?:must|need to|have to|required to)\s+(?:be\s+)?(?:based|located|reside|live|be authorized to work)\s+(?:in|within)\s+([^.!?\n]{2,150})/giu,
    /remote\s*[-:(]?\s*(?:only\s+)?(?:within|from|in)\s+([^.!?\n]{2,100})/giu,
    /(?:только|исключительно)\s+(?:резиденты|граждане)\s+([^.!?\n]{2,100})/giu,
    /(?:проживание|резидентство|право на работу|внж)\s+(?:в\s+)?([^.!?\n]{2,100}?)\s+(?:обязательно|необходимо)/giu,
    /обязательн[а-я]*\s+релокаци[а-я]*\s+(?:в\s+)?([^.!?\n]{2,100})/giu,
  ]
  for (const pattern of locationPatterns) for (const match of text.matchAll(pattern)) {
    const scope = match[1].trim()
    if (negated(text, match.index!) || permitsRussia(scope)) continue
    if (/клиент|рынок|проект|пользовател|customers?|clients?|time[ -]?zones?|часов[а-я]* пояс/iu.test(scope)) continue
    if (foreignScope(scope)) return match[0]
  }
  const abroadOnly = /(?:работа|работать|кандидаты)\s+(?:только|исключительно)\s+(?:за рубежом|за границей|из-за границы)/iu.exec(text)
  if (abroadOnly && !negated(text, abroadOnly.index)) return abroadOnly[0]
  return null
}

/** This is a text/metadata heuristic, not a guarantee from the employer. Missing RF bans are allowed; missing Russian communication is not. */
export function classifyMarket(vacancy: Vacancy): MarketDecision {
  const level = excludedSeniority(vacancy)
  if (level) return reject('seniority', level)
  const description = clean(vacancy.description || '')
  const text = `${clean(vacancy.name)}\n${description}`
  const explicitBan = restrictionFromText(text)
  if (explicitBan) return reject('russia_restricted', explicitBan)
  if (vacancy.excluded_locations?.some(value => russia.test(value))) return reject('russia_restricted', `Исключённые страны: ${vacancy.excluded_locations.join(', ')}`)
  const locations = vacancy.applicant_locations?.map(clean).filter(Boolean) || []
  for (const location of locations) { const ban = restrictionFromText(location); if (ban) return reject('russia_restricted', ban) }
  if (locations.length && !locations.some(permitsRussia)) return reject('russia_restricted', `Допустимые локации кандидата: ${locations.join(', ')}`)
  // Older international adapters retained a job's candidate geography only in area.name.
  if (!locations.length && ['wwr', 'himalayas', 'remotive', 'remoteok', 'ashby', 'greenhouse', 'lever'].includes(vacancy.source?.id || '')) {
    const area = clean(vacancy.area.name)
    if (/^(?:remote\s*[-:(]?\s*)?(?:us(?:a)?|u\.s\.?|united states|canada|uk|united kingdom|eu|eea|european union|north america|latin america|latam|сша|канада|страны ес|евросоюз|великобритания)(?:\b|[\s,;/·-])/iu.test(area) && !permitsRussia(area)) return reject('russia_restricted', `География вакансии: ${area}`)
  }
  for (const pattern of foreignCommunication) {
    const match = pattern.exec(description)
    if (match && !negated(description, match.index)) return reject('communication', match[0])
  }
  for (const pattern of russianCommunication) {
    const match = pattern.exec(description)
    if (match && !negated(description, match.index) && !/^\s*(?:is\s+)?not\s+(?:required|mandatory|necessary)/iu.test(description.slice(match.index+match[0].length))) return { eligible: true, reason: null, evidence: match[0] }
  }
  const russianLetters = description.match(/[а-я]/giu)?.length || 0
  const prose = description.replace(/\b(?:react|typescript|javascript|redux|vue(?:\.js)?|angular|html|css|node(?:\.js)?|nest(?:\.js)?|postgresql|python|docker|figma|sql|api|git|next(?:\.js)?|tailwind)\b/giu, '')
  const latinLetters = prose.match(/[a-z]/giu)?.length || 0
  const russianWords = description.match(/(?<![\p{L}])(?:мы|вы|наша|наши|команда|работа|работать|разработка|разработки|требования|обязанности|знание|опыт|условия|задачи|проекта|проектов|командой|нужен|нужны|требуется|будет|пользовател[а-я]*|интерфейс[а-я]*|сервис[а-я]*|помогаем|предстоит|ведение|ищем)(?![\p{L}])/giu)?.length || 0
  if (russianLetters >= 15 && russianWords >= 1 && russianLetters >= latinLetters * 0.45 && (description.match(/[іїєґў]/giu)?.length || 0) < 3) return { eligible: true, reason: null, evidence: 'Полное описание вакансии преимущественно на русском' }
  return reject('communication', 'Нет признаков русскоязычной рабочей среды в полном описании')
}
