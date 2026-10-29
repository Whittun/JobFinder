import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { PreviewServer, ViteDevServer } from 'vite'
import { Collector } from './collector.ts'
import { experienceOptions } from '../src/lib/analytics.ts'
import { priorityDirections } from '../src/lib/priorities.ts'

export function attachAnalytics(server: ViteDevServer | PreviewServer) {
  const collector = new Collector(resolve(process.cwd(), 'data/jobfinder.sqlite'))
  collector.start()
  server.httpServer?.once('close', () => { void collector.close() })
  server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname.startsWith('/data/')) { res.writeHead(403).end(); return }
    if (!['/api/analytics', '/api/collector'].includes(url.pathname)) return next()
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    const send = (status: number, body: unknown) => res.writeHead(status).end(JSON.stringify(body))
    try {
      if (url.pathname === '/api/collector') {
        if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); send(405, { message: 'Доступен только POST.' }); return }
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { send(403, { message: 'Запрос с другого сайта запрещён.' }); return }
        let input = ''
        for await (const chunk of req) {
          input += String(chunk)
          if (input.length > 2048) { send(413, { message: 'Слишком большой запрос.' }); return }
        }
        let body: { enabled?: unknown }
        try { body = JSON.parse(input) } catch { send(400, { message: 'Ожидается JSON.' }); return }
        if (typeof body?.enabled !== 'boolean') { send(400, { message: 'Укажите enabled: true или false.' }); return }
        collector.control(body.enabled)
        send(200, { enabled: body.enabled })
        return
      }
      if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); send(405, { message: 'Доступен только GET.' }); return }
      const text = (url.searchParams.get('text') || '').trim()
      const area = url.searchParams.get('area') || '113'
      const period = url.searchParams.get('period') || '30'
      const direction = url.searchParams.get('direction') || ''
      const profession = url.searchParams.get('profession') || ''
      const workFormat = url.searchParams.get('workFormat') || 'REMOTE_ONLY'
      const experience = url.searchParams.get('experience') || ''
      const technology = url.searchParams.get('technology') || ''
      const title = url.searchParams.get('title') || ''
      const salary = url.searchParams.get('salary') || 'any'
      const page = url.searchParams.get('page') || '0'
      const group = url.searchParams.get('group') || ''
      const priority = url.searchParams.get('priority') || ''
      if (priority && priority !== 'any' && !priorityDirections.some(item => item.id === priority)) { send(400, { message: 'Неизвестное приоритетное направление.' }); return }
      if (text.length > 200 || !['113','1','2','3','4','88'].includes(area) || !['1','7','30','90'].includes(period) || !/^(category-\d+)?$/.test(direction) || !/^\d*$/.test(profession) || profession.length > 10 || !['REMOTE','REMOTE_ONLY'].includes(workFormat) || (experience && !experienceOptions.some(item => item.id === experience)) || technology.length > 40 || title.length > 1000 || !['any','specified'].includes(salary) || !/^\d{1,5}$/.test(page) || Number(page) > 10000 || !/^[a-z0-9-]*$/.test(group) || group.length > 100) {
        send(400, { message: 'Некорректные фильтры.' }); return
      }
      send(200, collector.store.analytics({ text, area, period, direction, profession, workFormat, experience, technology, title, salary, page, group, priority }))
    } catch {
      send(500, { message: 'Не удалось прочитать локальную базу. Проверьте журнал сервера.' })
    }
  })
}
