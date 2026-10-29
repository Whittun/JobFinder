import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { searchUrlFor } from '../src/lib/hh.ts'
import { HhPageError, parseSearchPage } from './hh-page.ts'
import { attachAnalytics } from './analytics-api.ts'

type ApiResult = { status: number; body: unknown }
type CacheEntry = { expires: number; result: ApiResult }

export function hhApi(): Plugin {
  const cache = new Map<string, CacheEntry>()
  const pending = new Map<string, Promise<ApiResult>>()

  async function request(sourceUrl: string): Promise<ApiResult> {
    try {
      const response = await fetch(sourceUrl, {
        headers: { Accept: 'text/html', 'Accept-Language': 'ru-RU,ru;q=0.9', 'User-Agent': 'JobFinder/0.1' },
        signal: AbortSignal.timeout(20_000),
      })
      if (!response.ok) {
        const messages: Record<number, string> = {
          403: 'hh.ru временно ограничил доступ к поиску. Откройте поиск на hh.ru в браузере и повторите позже.',
          429: 'Лимит запросов hh.ru исчерпан. Подождите минуту и повторите поиск.',
        }
        return { status: response.status >= 500 ? 502 : response.status, body: { message: messages[response.status] || `Поиск hh.ru временно недоступен (${response.status}). Повторите позже.` } }
      }
      const html = await response.text()
      if (html.length > 8_000_000) return { status: 502, body: { message: 'Страница поиска hh.ru слишком большая. Уточните поисковый запрос.' } }
      return { status: 200, body: parseSearchPage(html, sourceUrl) }
    } catch (error) {
      return { status: 502, body: { message: error instanceof HhPageError ? error.message : 'Не удалось связаться с hh.ru. Проверьте соединение и повторите запрос.' } }
    }
  }

  async function middleware(req: IncomingMessage, res: ServerResponse, next: () => void) {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname !== '/api/hh/vacancies') return next()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET')
      res.writeHead(405).end(JSON.stringify({ message: 'Доступен только GET.' }))
      return
    }
    const text = (url.searchParams.get('text') || '').trim()
    const area = url.searchParams.get('area') || '113'
    const period = url.searchParams.get('period') || '30'
    if (text.length > 200 || !['113', '1', '2', '4', '3', '88'].includes(area) || !['1', '7', '30'].includes(period)) {
      res.writeHead(400).end(JSON.stringify({ message: 'Некорректные фильтры поиска.' }))
      return
    }
    const key = searchUrlFor({ text, area, period })
    for (const [cacheKey, entry] of cache) if (entry.expires <= Date.now()) cache.delete(cacheKey)
    let result = cache.get(key)?.result
    if (!result) {
      let promise = pending.get(key)
      if (!promise) {
        promise = request(key)
        pending.set(key, promise)
      }
      result = await promise
      pending.delete(key)
      // Pause repeated requests after rate limits or access refusals.
      const ttl = result.status === 200 ? 5 * 60_000 : [403, 429].includes(result.status) ? 60_000 : 0
      if (ttl) {
        if (cache.size >= 50) cache.delete(cache.keys().next().value!)
        cache.set(key, { result, expires: Date.now() + ttl })
      }
    }
    res.writeHead(result.status).end(JSON.stringify(result.body))
  }

  return {
    name: 'hh-public-search',
    configureServer(server) { if (server.httpServer) attachAnalytics(server); server.middlewares.use(middleware) },
    configurePreviewServer(server) { if (server.httpServer) attachAnalytics(server); server.middlewares.use(middleware) },
  }
}
