import { createHash } from 'node:crypto'

export type SkillCategory = 'language' | 'technology' | 'tool' | 'human_language'
export type SkillMention = { name: string; category: SkillCategory; source: 'title' | 'skills' | 'description'; evidence: string }

// Edit this dictionary to add synonyms. Boundaries also work with Cyrillic text.
const dictionary: [string, SkillCategory, string[]][] = [
  ['Python','language',['python','python3','питон']], ['JavaScript','language',['javascript','java script','js']],
  ['TypeScript','language',['typescript','type script','ts']], ['Java','language',['java']], ['SQL','language',['sql','t-sql','pl/sql']],
  ['C++','language',['c++','cplusplus']], ['C#','language',['c#','csharp']], ['C','language',['язык c','c language']],
  ['Go','language',['golang','go']], ['PHP','language',['php']], ['Kotlin','language',['kotlin']], ['Swift','language',['swift']],
  ['Rust','language',['rust']], ['Ruby','language',['ruby']], ['Scala','language',['scala']], ['R','language',['язык r','r language']],
  ['Bash','language',['bash','shell scripting']], ['Dart','language',['dart']], ['HTML','language',['html','html5']], ['CSS','language',['css','css3','scss','sass']],
  ['React','technology',['react','react.js','reactjs']], ['Vue','technology',['vue','vue.js','vuejs']], ['Angular','technology',['angular','angularjs']],
  ['Next.js','technology',['next.js','nextjs']], ['Node.js','technology',['node.js','nodejs']], ['Django','technology',['django']],
  ['FastAPI','technology',['fastapi']], ['Flask','technology',['flask']], ['Spring','technology',['spring','spring boot']],
  ['.NET','technology',['.net','asp.net','dotnet']], ['Laravel','technology',['laravel']], ['Symfony','technology',['symfony']],
  ['Flutter','technology',['flutter']], ['React Native','technology',['react native']], ['Android','technology',['android']], ['iOS','technology',['ios']],
  ['REST API','technology',['rest','rest api','restful']], ['GraphQL','technology',['graphql']], ['gRPC','technology',['grpc']],
  ['Machine Learning','technology',['machine learning','машинное обучение','машинного обучения']], ['LLM','technology',['llm','large language model']],
  ['PyTorch','technology',['pytorch']], ['TensorFlow','technology',['tensorflow']], ['Pandas','technology',['pandas']],
  ['PostgreSQL','technology',['postgresql','postgres','постгрес']], ['MySQL','technology',['mysql']], ['MongoDB','technology',['mongodb']],
  ['Redis','technology',['redis']], ['ClickHouse','technology',['clickhouse']], ['Kafka','technology',['kafka']], ['RabbitMQ','technology',['rabbitmq']],
  ['Docker','tool',['docker']], ['Kubernetes','tool',['kubernetes','k8s']], ['Git','tool',['git']], ['GitLab','tool',['gitlab']], ['GitHub','tool',['github']],
  ['Linux','tool',['linux']], ['Jenkins','tool',['jenkins']], ['Ansible','tool',['ansible']], ['Terraform','tool',['terraform']],
  ['AWS','tool',['aws','amazon web services']], ['Azure','tool',['azure']], ['Yandex Cloud','tool',['yandex cloud','яндекс облако']],
  ['Jira','tool',['jira']], ['Confluence','tool',['confluence']], ['YouTrack','tool',['youtrack']], ['Notion','tool',['notion']],
  ['Postman','tool',['postman']], ['Swagger','tool',['swagger','openapi']], ['Selenium','tool',['selenium']], ['Playwright','tool',['playwright']], ['Cypress','tool',['cypress']],
  ['Figma','tool',['figma']], ['Photoshop','tool',['photoshop']], ['Illustrator','tool',['illustrator']], ['After Effects','tool',['after effects']],
  ['Premiere Pro','tool',['premiere pro']], ['Blender','tool',['blender']], ['Canva','tool',['canva']], ['Tilda','tool',['tilda']], ['WordPress','tool',['wordpress']],
  ['Excel','tool',['excel','эксель']], ['Google Sheets','tool',['google sheets','google таблицы','гугл таблицы']],
  ['Power BI','tool',['power bi','powerbi']], ['Tableau','tool',['tableau']], ['1С','tool',['1с','1c']], ['Битрикс24','tool',['битрикс24','bitrix24','битрикс 24']],
  ['amoCRM','tool',['amocrm','амоcrm']], ['Яндекс Метрика','tool',['яндекс метрика','яндекс.метрика','yandex metrica']],
  ['Google Analytics','tool',['google analytics','ga4']], ['Яндекс Директ','tool',['яндекс директ','яндекс.директ']], ['Google Ads','tool',['google ads','adwords']],
  ['AutoCAD','tool',['autocad']], ['Revit','tool',['revit']], ['BPMN','technology',['bpmn']], ['UML','technology',['uml']],
  ['Английский','human_language',['английский','английского','english']], ['Немецкий','human_language',['немецкий','немецкого','german']],
  ['Французский','human_language',['французский','французского','french']], ['Китайский','human_language',['китайский','китайского','chinese']],
]
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const compiled = dictionary.map(([name, category, aliases]) => ({ name, category, pattern: new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${aliases.map(escape).sort((a,b) => b.length-a.length).join('|')})${name==='C++'?'(?:\\d{2})?':''}(?=$|[^\\p{L}\\p{N}_])`, 'iu') }))

export function extractSkills(title: string, skills: string[] = [], description = ''): SkillMention[] {
  const mentions: SkillMention[] = []
  for (const entry of compiled) {
    for (const [source, body] of [['skills', skills.join('\n')], ['title', title], ['description', description]] as const) {
      const match = entry.pattern.exec(body)
      if (!match) continue
      // "Go" and "TS" in an English sentence are ambiguous; accept short aliases
      // from structured skills/title, or explicit technical context in descriptions.
      if (source === 'description' && entry.name === 'Go' && match[1].toLowerCase() === 'go' && !/(?:на|язык[ае]?|using|with|in)\s+Go\b|\bGo\b.{0,35}(?:разработ|developer|programming|language|микросервис)/.test(body)) continue
      if (source === 'description' && entry.name === 'TypeScript' && match[1].toLowerCase() === 'ts' && !/typescript/i.test(body)) continue
      const offset = match.index + match[0].indexOf(match[1])
      mentions.push({ name: entry.name, category: entry.category, source, evidence: body.slice(Math.max(0, offset - 45), offset + match[1].length + 65).replace(/\s+/g,' ').trim() })
      break
    }
  }
  return mentions
}

const groups: [string, string, RegExp][] = [
  ['system-analyst','Системный аналитик',/системн\S*\s+аналит|system[s]?\s+analyst/i],
  ['business-analyst','Бизнес-аналитик',/бизнес[ -]?аналит|business\s+analyst/i],
  ['product-analyst','Продуктовый аналитик',/продуктов\S*\s+аналит|product\s+analyst/i],
  ['data-analyst','Аналитик данных',/аналитик\S*\s+данных|data\s+analyst|bi[ -]?аналит/i],
  ['ml-engineer','ML-инженер / Data Scientist',/machine\s+learning|data\s+scien|ml[ -]?(?:engineer|инженер)|дата[ -]?са[йи]ентист/i],
  ['qa-automation','Инженер по автоматизации тестирования',/автоматизац\S*\s+тест|automation\s+(?:qa|test)|qa\s+automation|автотест/i],
  ['qa-manual','Тестировщик / QA',/тестиров|qa(?:\s|$|[ -])|quality\s+assurance|test\s+engineer/i],
  ['devops','DevOps / SRE',/devops|\bsre\b|site\s+reliability/i],
  ['frontend','Frontend-разработчик',/front[ -]?end|фронт[еэ]нд|react[ -]?(?:разработ|developer)|vue[ -]?(?:разработ|developer)|(?:разработчик|developer)\s+(?:на\s+)?(?:react|vue)/i],
  ['fullstack','Fullstack-разработчик',/full[ -]?stack|фул[л]?[ -]?ст[еэ]к/i],
  ['backend','Backend-разработчик',/back[ -]?end|б[еэ]к[еэ]нд/i],
  ['python','Python-разработчик',/python[ -]?(?:разработ|developer|engineer)|(?:разработчик|программист|developer)\s+(?:на\s+)?python/i],
  ['java','Java-разработчик',/(?:^|\W)java[ -]?(?:разработ|developer|engineer)|(?:разработчик|программист|developer)\s+(?:на\s+)?java(?:\W|$)/i],
  ['1c','Разработчик 1С',/(?:разработ|программист)\S*\s+(?:на\s+)?1[сc]|1[сc][ -]?(?:разработ|программист)/i],
  ['php','PHP-разработчик',/php[ -]?(?:разработ|developer)|(?:разработчик|программист)\s+(?:на\s+)?php/i],
  ['mobile','Мобильный разработчик',/android|ios[ -]?(?:разработ|developer)|flutter|mobile\s+developer|мобильн\S*\s+разработ/i],
  ['support','Техническая поддержка',/техподдерж|технич\S*\s+поддерж|поддерж\S*\s+(?:пользовател|по|программ)|technical\s+support|help.?desk|service.?desk/i],
  ['customer-service','Клиентский сервис',/клиентск\S*\s+сервис|customer\s+(?:service|success)|менеджер\s+поддержки/i],
  ['product-manager','Менеджер продукта',/product\s+(?:manager|owner)|продакт|менеджер\s+продукт/i],
  ['project-manager','Менеджер проектов',/project\s+manager|проектн\S*\s+менеджер|менеджер\s+проект|руководитель\s+проект/i],
  ['smm','SMM-специалист',/\bsmm\b|social\s+media|смм|социальн\S*\s+сет/i],
  ['seo','SEO-специалист',/\bseo\b|сео[ -]специалист/i],
  ['ads','Специалист по рекламе',/таргетолог|контекстн\S*\s+реклам|директолог|ppc[ -]|performance\s+market/i],
  ['marketing','Маркетолог',/маркетолог|marketing\s+(?:manager|specialist)|интернет[ -]маркет/i],
  ['uiux','UI/UX-дизайнер',/ui[ /-]?ux|ux[ /-]?ui|продуктов\S*\s+дизайнер|дизайнер\s+интерфейс/i],
  ['graphic-design','Графический дизайнер',/графическ\S*\s+дизайнер|graphic\s+design/i],
  ['content','Контент-менеджер',/контент[ -]?менеджер|content\s+manager/i],
  ['writer','Копирайтер / редактор',/копирайтер|редактор|copywriter|technical\s+writer|техническ\S*\s+писател/i],
  ['recruiter','Рекрутер / HR',/рекрутер|recruiter|\bhr\b|подбор\S*\s+персонал/i],
  ['accountant','Бухгалтер',/бухгалтер|accountant/i],
]

export function normalizeJobTitle(title: string) {
  const normalized = title.normalize('NFKC').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[\u2010-\u2015]/g,'-').replace(/\s+/g,' ').trim()
  for (const [id, name, pattern] of groups) if (pattern.test(normalized)) return { id, name }
  const fallback = normalized.replace(/\b(?:junior|middle|senior|lead|intern)\b|(?:^|\s)(?:ведущий|старший|младший|главный)\s/gi,' ').replace(/\((?:удален\S*|remote|м\/ж|m\/f\/d)[^)]*\)/gi,'').replace(/\s+/g,' ').trim()
  return { id: `other-${createHash('sha256').update(fallback).digest('hex').slice(0,16)}`, name: fallback ? fallback[0].toUpperCase() + fallback.slice(1) : title }
}
