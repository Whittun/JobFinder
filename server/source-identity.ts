import { createHash } from 'node:crypto'
import type { Vacancy } from '../src/lib/hh.ts'

export const digest = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 24)
export function normalizeUrl(value: string, base?: string) {
  try {
    const url = new URL(value, base)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    url.hash = ''; url.hostname = url.hostname.toLowerCase()
    for (const key of [...url.searchParams.keys()]) if (/^(utm_|gclid$|fbclid$|yclid$|ref$|source$|s$)/i.test(key)) url.searchParams.delete(key)
    url.searchParams.sort()
    url.pathname = url.pathname.replace(/\/$/, '') || '/'
    return url.href
  } catch { return null }
}
export function originalIdentity(value: string) {
  const normalized = normalizeUrl(value)
  if (!normalized) return null
  const url = new URL(normalized)
  const hh = /(?:^|\.)(?:hh\.ru|hh\.kz|hh\.uz|rabota\.by)$/.test(url.hostname) && /\/vacancy\/(\d+)/.exec(url.pathname)
  if (hh) return { key: `hh:${hh[1]}`, id: hh[1], url: `https://hh.ru/vacancy/${hh[1]}` }
  const greenhouse = /(?:^|\.)(?:greenhouse\.io)$/.test(url.hostname) && /\/(\d+)$/.exec(url.pathname)
  if (greenhouse || url.searchParams.has('gh_jid')) {
    const id = greenhouse ? greenhouse[1] : url.searchParams.get('gh_jid')!
    if (/^\d+$/.test(id)) return { key: `greenhouse:${id}`, id: `greenhouse:${digest(id)}`, url: normalized }
  }
  const uuid = /([a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})/i.exec(url.pathname)?.[1]?.toLowerCase()
  const system = /(?:^|\.)ashbyhq\.com$/.test(url.hostname) ? 'ashby' : /(?:^|\.)lever\.co$/.test(url.hostname) ? 'lever' : null
  if (system && uuid) return { key: `${system}:${uuid}`, id: `${system}:${digest(uuid)}`, url: normalized.replace(/\/(?:application|apply)$/, '') }
  return null
}
export function identityKeys(job: Vacancy) {
  const urls = [job.source?.url, job.source?.originalUrl, job.alternate_url].filter((value): value is string => !!value)
  const strong = urls.flatMap(value => {
    const normalized = normalizeUrl(value)
    const original = originalIdentity(value)
    return [...(original ? [original.key] : []), ...(normalized ? [`url:${normalized}`] : [])]
  })
  const plain = (text: string) => text.toLocaleLowerCase('ru-RU').replace(/<[^>]*>/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const fingerprint = (job.description?.length || 0) >= 120 && job.employer.name !== 'Работодатель не указан' ? `body:${digest([plain(job.name), plain(job.employer.name), plain(job.description || '')].join('|'))}` : null
  return { strong: [...new Set(strong)], fingerprint }
}
export function boardFromUrl(value: string): { source: string; url: string; label: string } | null {
  const normalized = normalizeUrl(value)
  if (!normalized) return null
  const url = new URL(normalized), parts = url.pathname.split('/').filter(Boolean)
  let source = '', slug = ''
  if (url.hostname === 'jobs.ashbyhq.com' || url.hostname === 'api.ashbyhq.com') { source = 'ashby'; slug = url.hostname === 'api.ashbyhq.com' ? parts[parts.indexOf('job-board') + 1] : parts[0] }
  if (['boards.greenhouse.io', 'job-boards.greenhouse.io', 'boards-api.greenhouse.io'].includes(url.hostname)) { source = 'greenhouse'; slug = url.hostname === 'boards-api.greenhouse.io' ? parts[2] : parts[0] }
  if (['jobs.lever.co', 'jobs.eu.lever.co', 'api.lever.co', 'api.eu.lever.co'].includes(url.hostname)) { source = 'lever'; slug = url.hostname.startsWith('api.') ? parts[2] : parts[0] }
  if (!/^[a-z0-9][a-z0-9_-]{0,90}$/i.test(slug || '') || !source) return null
  slug = slug.toLowerCase()
  const endpoint = source === 'ashby' ? `https://api.ashbyhq.com/posting-api/job-board/${slug}` : source === 'greenhouse' ? `https://boards-api.greenhouse.io/v1/boards/${slug}/jobs` : `https://${url.hostname.includes('.eu.') ? 'api.eu.lever.co' : 'api.lever.co'}/v0/postings/${slug}?mode=json&limit=1&skip=0`
  return { source, url: endpoint, label: slug }
}
