import type { IncomingMessage, ServerResponse } from 'node:http'
import { WorkspaceError, WorkspaceState } from './workspace-state.ts'

export async function workspaceApi(req: IncomingMessage, res: ServerResponse, url: URL, state: WorkspaceState) {
  if (!['/api/vacancy-state', '/api/processed'].includes(url.pathname)) return false
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  const send = (status: number, body: unknown) => res.writeHead(status).end(JSON.stringify(body))
  const method = url.pathname === '/api/processed' ? 'GET' : 'POST'
  if (req.method !== method) { res.setHeader('Allow', method); send(405, { message: `Доступен только ${method}.` }); return true }
  try {
    if (method === 'GET') {
      const text = (url.searchParams.get('text') || '').trim(), page = url.searchParams.get('page') || '0'
      if (text.length > 200 || !/^\d{1,5}$/.test(page) || Number(page) > 10000) throw new WorkspaceError(400, 'Некорректные фильтры.')
      send(200, state.list(text, Number(page)))
    } else {
      if (req.headers.origin) {
        let host: string
        try { host = new URL(req.headers.origin).host } catch { throw new WorkspaceError(403, 'Некорректный источник запроса.') }
        if (host !== req.headers.host) throw new WorkspaceError(403, 'Запрос с другого сайта запрещён.')
      }
      if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw new WorkspaceError(415, 'Ожидается application/json.')
      let input = ''
      for await (const chunk of req) { input += String(chunk); if (Buffer.byteLength(input) > 2048) throw new WorkspaceError(413, 'Слишком большой запрос.') }
      let body: { id?: unknown; processed?: unknown } | null
      try { body = JSON.parse(input) } catch { throw new WorkspaceError(400, 'Ожидается JSON.') }
      if (!body || typeof body.id !== 'string' || !/^(?:\d{1,20}|[a-z][a-z0-9-]{0,30}:[a-f0-9]{24})$/.test(body.id) || typeof body.processed !== 'boolean') throw new WorkspaceError(400, 'Укажите ID вакансии и processed: true или false.')
      send(200, state.mark(body.id, body.processed))
    }
  } catch (error) {
    send(error instanceof WorkspaceError ? error.status : 500, { message: error instanceof WorkspaceError ? error.message : 'Не удалось изменить список обработанных вакансий.' })
  }
  return true
}
