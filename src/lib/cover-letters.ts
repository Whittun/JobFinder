import type { Vacancy } from './hh.ts'

export type CoverLetter = { id: string; name: string; categories: string[]; text: string }
export const coverLetters: CoverLetter[] = [{
  id: 'web-frontend-fullstack', name: 'Веб · Frontend · Fullstack', categories: ['Веб-разработка', 'Frontend', 'Fullstack'],
  text: `Здравствуйте! Заинтересовала ваша вакансия.

У меня 2 года коммерческого опыта создания и развития веб-проектов (HTML, CSS, JS и CMS системы) и 1+ год коммерческого опыта в создании интерфейсов B2B SaaS-платформы в сфере HR Tech (React, TypeScript, Redux).

В Okrate разрабатывал frontend-часть B2B SaaS-приложения с нуля: реализовывал пользовательские сценарии, формы, модальные окна и интеграцию с backend API. Проект: https://okrate.app/

Сейчас занимаюсь разработкой fullstack-проектов на React, TypeScript, NestJS и PostgreSQL.

Рассматриваю frontend и fullstack-позиции. Буду рад подробнее рассказать об опыте и обсудить задачи вашей команды.`,
}]

export function recommendedLetter(job: Vacancy): CoverLetter | undefined {
  const title = job.name.toLocaleLowerCase('ru-RU')
  if (/рекрутер|recruiter|\bhr\b|тестиров|\bqa\b|дизайнер|designer|react native|android|\bios\b|маркетолог|менеджер|\bmanager\b|product owner|аналитик/iu.test(title)) return undefined
  const frontend = /front[ -]?end|фронт[еэ]нд|full[ -]?stack|фул[л]?[ -]?ст[еэ]к|веб[ -]?(?:разработ|программист)|web[ -]?(?:developer|engineer)|в[её]рстальщик|верстальщик/iu.test(title)
  const jsRole = /(?:react|vue|angular|javascript|typescript|wordpress|webflow|cms)[ -]?(?:разработ|developer|engineer)|(?:разработчик|developer)\s+(?:на\s+)?(?:react|vue|angular|javascript|typescript|wordpress|webflow|cms)/iu.test(title)
  if (frontend || jsRole || ['frontend', 'fullstack'].includes(job.normalized_title?.id || '')) return coverLetters[0]
  return undefined
}
