import type { Vacancy } from './hh.ts'

export type PriorityReason = { keyword: string; source: 'title' | 'skills' | 'description'; evidence: string }
export type PriorityMatch = { id: string; name: string; reasons: PriorityReason[] }
type Rule = { id: string; name: string; description: string; keywords: string[]; title: RegExp; skills?: RegExp; descriptionPattern: RegExp }
const word = (pattern: string) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${pattern})(?![\\p{L}\\p{N}])`, 'iu')

export const priorityDirections: Rule[] = [
  {
    id: 'web', name: 'Веб и интерфейсы', description: 'Сайты, веб-приложения, frontend и вёрстка.',
    keywords: ['Frontend', 'веб-разработчик', 'верстальщик', 'React', 'Vue', 'Angular', 'Next.js', 'HTML / CSS'],
    title: word('front[ -]?end|full[ -]?stack|web[ -]?(?:developer|engineer|designer)|веб[ -]?(?:разработчик|дизайнер|программист|мастер)|верстальщик|вёрстальщик|React|Vue|Angular|Next\\.js|WordPress|Webflow'),
    skills: word('React(?:\\.js)?|Vue(?:\\.js)?|Angular|Next\\.js|Nuxt(?:\\.js)?|Svelte|HTML5?|CSS3?|Django|FastAPI|NestJS|Express\\.js|WordPress|Webflow|Tilda'),
    descriptionPattern: /(?:разработк[аиу]|создани[ею]|поддержк[аиу]|в[её]рстк[аиу])[^.!?\n]{0,65}(?:веб[ -]?(?:приложени|сайт|интерфейс)|web[ -]?(?:app|interface)|сайтов|сайта|frontend|фронтенд)|(?:разрабатыва|верста)[^.!?\n]{0,50}(?:интерфейс|сайт|веб)/iu,
  },
  {
    id: 'development', name: 'Разработка ПО', description: 'Backend, fullstack, мобильная и другая разработка программ.',
    keywords: ['разработчик', 'программист', 'Software Engineer', 'Backend', 'Fullstack', 'Android', 'iOS', '1С'],
    title: word('разработчик[а-я]*|программист[а-я]*|developer|software engineer|back[ -]?end|full[ -]?stack|инженер[ -]программист'),
    descriptionPattern: /(?:разработк[аиу]|написани[ею]|поддержк[аиу]|рефакторинг)[^.!?\n]{0,55}(?:программн|приложени|программ|микросервис|backend|бэкенд|исходного кода|API)|(?:писать|написание|ревью|ревьюить|разрабатывать)[^.!?\n]{0,30}(?:код|микросервис|API)/iu,
  },
  {
    id: 'influence', name: 'Influence и блогеры', description: 'Поиск блогеров, интеграции и ведение influencer-кампаний.',
    keywords: ['Influence', 'Influencer marketing', 'инфлюенс', 'работа с блогерами', 'лидеры мнений', 'закупка интеграций'],
    title: word('influenc(?:e|er)[ -]?(?:marketing|manager|маркетолог)?|инфлюенс[а-я]*|блогер[а-я]*|лидер[а-я]* мнений'),
    descriptionPattern: /(?:поиск|подбор|взаимодействи[ея]|работ[ауы]|переговор[ыа-я]*|коммуникаци[яи]|интеграци[яи]|закупк[аиу])[^.!?\n]{0,55}(?:блогер|инфлюенсер|лидерами мнений|лидеров мнений)|(?:вести|ведение|запуск|планирование)[^.!?\n]{0,40}(?:influencer|influence|инфлюенс)[^.!?\n]{0,20}(?:кампан|маркетинг)/iu,
  },
  {
    id: 'security', name: 'Кибербезопасность', description: 'Информационная безопасность, AppSec, SOC и пентесты.',
    keywords: ['кибербезопасность', 'информационная безопасность', 'AppSec', 'SOC', 'SIEM', 'пентест', 'DevSecOps'],
    title: word('кибербезопасност[а-я]*|информационн[а-я]+ безопасност[а-я]*|защит[а-я]+ информации|ИБ|AppSec|SOC|пентестер|pentester|security (?:engineer|analyst)|DevSecOps'),
    skills: word('AppSec|SIEM|pentest|Burp Suite|Metasploit|DevSecOps'),
    descriptionPattern: /(?:проведени[ею]|проводить|выполнять)[^.!?\n]{0,35}(?:пентест|тестировани[ея] на проникновени)|(?:анализ|устранени[ею]|выявлени[ею]|поиск)[^.!?\n]{0,35}уязвимост|(?:мониторинг|расследовани[ею]|реагировани[ею])[^.!?\n]{0,45}(?:кибер|инцидент[а-я]* (?:ИБ|информационной безопасности))|(?:обеспечени[ею]|управлени[ею]) информационной безопасност/iu,
  },
  {
    id: 'devops', name: 'DevOps и инфраструктура', description: 'Эксплуатация, платформы, автоматизация и надёжность систем.',
    keywords: ['DevOps', 'SRE', 'Platform Engineer', 'Kubernetes', 'Terraform', 'Ansible', 'CI/CD', 'системный администратор'],
    title: word('DevOps|DevSecOps|SRE|platform engineer|инженер платформ[а-я]*|системн[а-я]+ администратор|инженер инфраструктур[а-я]*'),
    skills: word('Terraform|Ansible|Pulumi'),
    descriptionPattern: /(?:настройк[аиу]|поддержк[аиу]|администрировани[ею]|разв[её]ртывани[ею]|управлени[ею])[^.!?\n]{0,50}(?:Kubernetes|k8s|кластер|CI\/CD|инфраструктур|серверов)|(?:автоматизаци[яи]|автоматизировать) (?:процессов |процессы )?(?:депло|разв[её]ртывани|инфраструктур)/iu,
  },
  {
    id: 'testing', name: 'Тестирование и QA', description: 'Ручное и автоматизированное тестирование ПО.',
    keywords: ['QA', 'SDET', 'тестировщик', 'автотесты', 'Selenium', 'Playwright', 'Cypress', 'регрессионное тестирование'],
    title: word('QA|SDET|тестировщик[а-я]*|test(?:ing)? engineer|инженер по тестированию|автоматизатор тестирования'),
    skills: word('Selenium|Playwright|Cypress|Appium|TestRail|Qase'),
    descriptionPattern: /(?:ручн[а-я]+|функциональн[а-я]+|регрессионн[а-я]+|нагрузочн[а-я]+|интеграционн[а-я]+) тестировани|(?:разработк[аиу]|написани[ею]|поддержк[аиу])[^.!?\n]{0,35}автотест|тестировани[ея][^.!?\n]{0,30}(?:приложени|программного обеспечения|API|веб-сервис)/iu,
  },
  {
    id: 'data', name: 'Данные и аналитика', description: 'Аналитика данных и продуктов, Data Engineering, ML и AI.',
    keywords: ['Data Analyst', 'Data Engineer', 'Data Scientist', 'ML Engineer', 'аналитик данных', 'BI', 'системный аналитик'],
    title: word('data (?:analyst|engineer|scientist)|(?:ML|AI|BI)[ -]?(?:engineer|developer|разработчик|аналитик)|аналитик данных|(?:системн[а-я]+|бизнес[ -]?|продуктов[а-я]+) ?аналитик|инженер данных|(?:главный|ведущий) аналитик|Lead SA'),
    descriptionPattern: /(?:построени[ею]|разработк[аиу]|поддержк[аиу])[^.!?\n]{0,40}(?:ETL|ELT|витрин данных|хранилищ данных|ML[ -]модел|моделей машинного обучения)|(?:анализ|аналитика) данных[^.!?\n]{0,65}(?:SQL|Python|BI)|(?:построени[ею]|разработк[аиу])[^.!?\n]{0,35}(?:дашборд|BI[ -]отч[её]т)/iu,
  },
  {
    id: 'product-design', name: 'Продукт и UX/UI', description: 'Цифровые продукты, UX/UI и управление IT-проектами.',
    keywords: ['UX/UI', 'Product Designer', 'Product Manager', 'веб-дизайнер', 'менеджер IT-проектов', 'продакт'],
    title: word('UX|UI|product (?:designer|manager|owner)|продакт[а-я]*|продуктов[а-я]+ дизайнер|веб[ -]?дизайнер|(?:менеджер|руководитель) (?:IT|ИТ|digital)[ -]?проектов'),
    descriptionPattern: /(?:проектировани[ею]|дизайн|прототипировани[ею]|разработк[аиу])[^.!?\n]{0,35}(?:пользовательск[а-я]+ интерфейс|UX|UI)|(?:управлени[ею]|ведение)[^.!?\n]{0,30}(?:IT|ИТ|digital)[ -]проект/iu,
  },
]

// Hiring a developer or selling IT services does not make a job a developer role.
const auxiliaryTitle = /рекрутер|recruiter|HR[ -]|HR$|HRBP|подбор[а-я]* персонала|бухгалтер|юрист|копирайтер|менеджер по продажам|аккаунт[ -]менеджер|автор (?:дисциплин|курсов|уроков)|методолог|преподавател|репетитор|учител/iu
const plain = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

export function classifyPriorities(vacancy: Pick<Vacancy, 'name' | 'description' | 'key_skills'>): PriorityMatch[] {
  if (auxiliaryTitle.test(vacancy.name)) return []
  const title = plain(vacancy.name)
  const skills = (vacancy.key_skills || []).map(plain)
  // Match work statements separately: a preceding negation must not create a hit.
  const statements = (vacancy.description || '').replace(/<\/(?:p|li|div|h\d)>|<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ' ').split(/[\n.!?;]+/).map(plain).filter(Boolean)
  const matches: PriorityMatch[] = []
  for (const rule of priorityDirections) {
    const reasons: PriorityReason[] = []
    const add = (text: string, pattern: RegExp, source: PriorityReason['source']) => {
      const hit = pattern.exec(text)
      if (!hit || reasons.length >= 3) return
      const before = text.slice(Math.max(0, hit.index - 45), hit.index)
      if (/(?:не требуется|не предполагается|не занимаемся|не входит|без)\s*$/iu.test(before)) return
      const start = Math.max(0, hit.index - 55)
      reasons.push({ keyword: hit[0], source, evidence: `${start ? '…' : ''}${text.slice(start, hit.index + hit[0].length + 100)}${text.length > hit.index + hit[0].length + 100 ? '…' : ''}` })
    }
    add(title, rule.title, 'title')
    if (rule.skills) for (const skill of skills) add(skill, rule.skills, 'skills')
    for (const statement of statements) {
      // Ignore company introductions and descriptions of other team members.
      if (/(?:наша компания|наша команда|мы разрабатываем|наши клиенты|в команде (?:есть|работают)|мы ищем (?:в команду|разработчиков))/iu.test(statement)) continue
      add(statement, rule.descriptionPattern, 'description')
    }
    if (reasons.length) matches.push({ id: rule.id, name: rule.name, reasons })
  }
  return matches
}
